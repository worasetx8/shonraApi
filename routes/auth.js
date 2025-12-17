import express from "express";
import { strictRateLimit } from "../middleware/rateLimiter.js";
import { executeQuery } from "../config/database.js";
import { verifyPassword, createSession, getSession, deleteSession, hashPassword } from "../utils/auth.js";
import { formatResponse, validateRequiredFields } from "../utils/helpers.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";
import { checkAccountLocked, incrementFailedAttempts, clearAccountLockout, getLockoutConfig } from "../utils/accountLockout.js";
import { validatePasswordStrength, getPasswordPolicyDescription } from "../utils/passwordPolicy.js";

const router = express.Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many login attempts
 */
// Login endpoint with rate limiting
router.post("/login", strictRateLimit(), async (req, res) => {
  try {
    const { username, password } = req.body;

    const missing = validateRequiredFields(req.body, ["username", "password"]);
    if (missing.length > 0) {
      return res.status(400).json(formatResponse(false, null, `Missing required fields: ${missing.join(", ")}`));
    }

    // Find user in database with role info
    const userResult = await executeQuery(`
      SELECT u.id, u.username, u.password, u.password_hash, u.full_name, u.email, u.status, u.role_id, r.name as role_name 
      FROM admin_users u 
      LEFT JOIN roles r ON u.role_id = r.id 
      WHERE u.username = ?
    `, [username]);

    if (!userResult.success || userResult.data.length === 0) {
      // Don't reveal if username exists (security best practice)
      return res.status(401).json(formatResponse(false, null, "Invalid username or password"));
    }

    const user = userResult.data[0];

    // Check if account is locked
    const lockStatus = await checkAccountLocked(user.id);
    if (lockStatus.isLocked) {
      Logger.warn(`[Auth] ✅ Login attempt for LOCKED account: ${username}`, {
        userId: user.id,
        lockedUntil: lockStatus.lockedUntil,
        remainingMinutes: lockStatus.remainingMinutes,
        lockedUntilISO: lockStatus.lockedUntil?.toISOString()
      });
      
      return res.status(423).json(formatResponse(
        false,
        {
          locked: true,
          lockedUntil: lockStatus.lockedUntil?.toISOString(),
          remainingMinutes: lockStatus.remainingMinutes
        },
        `Account is temporarily locked due to too many failed login attempts. Please try again in ${lockStatus.remainingMinutes} minute(s).`
      ));
    }

    // Check if user is active
    if (user.status !== "active") {
      return res.status(401).json(formatResponse(false, null, "Account is disabled"));
    }

    // Check if password_hash is null (force password change scenario)
    if (!user.password_hash) {
      // Return special response code to indicate force password change
      // We'll create a temporary session for password change
      const tempUserData = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role_id: user.role_id,
        role: user.role_name || 'Viewer',
        permissions: [],
        requiresPasswordChange: true
      };
      
      const tempSessionToken = createSession(user.id, tempUserData);
      
      return res.status(403).json(
        formatResponse(
          false,
          {
            requiresPasswordChange: true,
            token: tempSessionToken,
            user: tempUserData
          },
          "Password change required. Please set a new password."
        )
      );
    }

    // Double-check lockout status before password verification
    // This prevents incrementing attempts if account was locked between checkAccountLocked and password verification
    const lockStatusBeforePassword = await checkAccountLocked(user.id);
    if (lockStatusBeforePassword.isLocked) {
      Logger.warn(`[Auth] ✅ Login attempt for LOCKED account (before password check): ${username}`, {
        userId: user.id,
        lockedUntil: lockStatusBeforePassword.lockedUntil,
        remainingMinutes: lockStatusBeforePassword.remainingMinutes,
        lockedUntilISO: lockStatusBeforePassword.lockedUntil?.toISOString()
      });
      
      return res.status(423).json(formatResponse(
        false,
        {
          locked: true,
          lockedUntil: lockStatusBeforePassword.lockedUntil?.toISOString(),
          remainingMinutes: lockStatusBeforePassword.remainingMinutes
        },
        `Account is temporarily locked due to too many failed login attempts. Please try again in ${lockStatusBeforePassword.remainingMinutes} minute(s).`
      ));
    }

    const isValidPassword = verifyPassword(password, user.password_hash);

    if (!isValidPassword) {
      // Increment failed login attempts and check if account should be locked
      const lockResult = await incrementFailedAttempts(user.id);
      
      if (lockResult.isLocked) {
        Logger.warn(`[Auth] Account locked after failed login: ${username}`, {
          userId: user.id,
          attempts: lockResult.attempts,
          lockedUntil: lockResult.lockedUntil
        });
        
        return res.status(423).json(formatResponse(
          false,
          {
            locked: true,
            lockedUntil: lockResult.lockedUntil.toISOString(),
            remainingMinutes: getLockoutConfig().lockoutDurationMinutes
          },
          `Too many failed login attempts. Account has been locked for ${getLockoutConfig().lockoutDurationMinutes} minutes.`
        ));
      }
      
      // Account not locked yet, but show remaining attempts
      const remainingAttempts = getLockoutConfig().maxFailedAttempts - lockResult.attempts;
      const message = remainingAttempts > 0 
        ? `Invalid username or password. ${remainingAttempts} attempt(s) remaining before account lockout.`
        : "Invalid username or password";
      
      return res.status(401).json(formatResponse(
        false,
        {
          remainingAttempts: remainingAttempts,
          attempts: lockResult.attempts,
          maxAttempts: getLockoutConfig().maxFailedAttempts
        },
        message
      ));
    }

    // Password is valid - clear failed attempts and unlock account
    await clearAccountLockout(user.id);

    // Fetch Permissions
    let permissions = [];
    if (user.role_id) {
        const permRes = await executeQuery(`
            SELECT p.slug 
            FROM permissions p 
            JOIN role_permissions rp ON p.id = rp.permission_id 
            WHERE rp.role_id = ?
        `, [user.role_id]);
        if (permRes.success) {
            permissions = permRes.data.map(p => p.slug);
        }
    }

    // Create session
    const userData = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      role_id: user.role_id,
      role: user.role_name || 'Viewer', // Fallback role name
      permissions
    };

    const sessionToken = createSession(user.id, userData);

    res.json(
      formatResponse(
        true,
        {
          user: userData,
          token: sessionToken
        },
        "Login successful"
      )
    );
  } catch (error) {
    Logger.error("Login error:", error);
    const isDevelopment = process.env.NODE_ENV === "development";
    const errorMessage = isDevelopment ? error.message : "Login failed. Please try again.";
    res.status(500).json(formatResponse(false, null, "Login failed", errorMessage));
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: User logout
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
// Logout endpoint
router.post("/logout", (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (token) {
      deleteSession(token);
    }

    res.json(formatResponse(true, null, "Logout successful"));
  } catch (error) {
    Logger.error("Logout error:", error);
    const isDevelopment = process.env.NODE_ENV === "development";
    const errorMessage = isDevelopment ? error.message : "Logout failed. Please try again.";
    res.status(500).json(formatResponse(false, null, "Logout failed", errorMessage));
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user information
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get current user info
router.get("/me", (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json(formatResponse(false, null, "No token provided"));
    }

    const session = getSession(token);
    if (!session) {
      return res.status(401).json(formatResponse(false, null, "Invalid or expired session"));
    }

    res.json(formatResponse(true, session.userData, "User info retrieved successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve user information", 500, formatResponse);
    const isDevelopment = process.env.NODE_ENV === "development";
    const errorMessage = isDevelopment ? error.message : "Failed to retrieve user information.";
    res.status(500).json(formatResponse(false, null, "Failed to get user info", errorMessage));
  }
});

/**
 * @swagger
 * /api/auth/change-password:
 *   put:
 *     summary: Change user password
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               oldPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized or incorrect password
 */
// Change password endpoint (for logged-in users)
router.put("/change-password", requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    // Validate new password is required
    if (!newPassword) {
      return res.status(400).json(formatResponse(false, null, "New password is required"));
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json(formatResponse(
        false,
        {
          errors: passwordValidation.errors,
          policy: getPasswordPolicyDescription()
        },
        passwordValidation.errors.join(". ")
      ));
    }

    const userId = req.user.id;

    // Get current user from database
    const userResult = await executeQuery(`
      SELECT id, password_hash 
      FROM admin_users 
      WHERE id = ?
    `, [userId]);

    if (!userResult.success || userResult.data.length === 0) {
      return res.status(404).json(formatResponse(false, null, "User not found"));
    }

    const user = userResult.data[0];

    // If password_hash is null, this is a force password change scenario
    // In this case, we skip old password verification (oldPassword is not required)
    if (user.password_hash) {
      // Normal password change - old password is required
      if (!oldPassword) {
        return res.status(400).json(formatResponse(false, null, "Current password is required"));
      }
      
      // Verify old password
      const isValidOldPassword = verifyPassword(oldPassword, user.password_hash);
      if (!isValidOldPassword) {
        return res.status(401).json(formatResponse(false, null, "Current password is incorrect"));
      }
    }
    // If password_hash is null, skip old password verification (force change)

    // Hash new password
    const newPasswordHash = hashPassword(newPassword);

    // Update password
    const updateResult = await executeQuery(
      "UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [newPasswordHash, userId]
    );

    if (updateResult.success && updateResult.data.affectedRows > 0) {
      res.json(formatResponse(true, null, "Password changed successfully"));
    } else {
      throw new Error("Failed to update password");
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to change password", 500, formatResponse);
    const isDevelopment = process.env.NODE_ENV === "development";
    const errorMessage = isDevelopment ? error.message : "Failed to change password. Please try again.";
    res.status(500).json(formatResponse(false, null, "Failed to change password", errorMessage));
  }
});

/**
 * @swagger
 * /api/auth/unlock-account:
 *   post:
 *     summary: Unlock a locked account (Admin only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: Username of the account to unlock
 *               userId:
 *                 type: integer
 *                 description: User ID of the account to unlock
 *             oneOf:
 *               - required: [username]
 *               - required: [userId]
 *     responses:
 *       200:
 *         description: Account unlocked successfully
 *       400:
 *         description: Bad request (missing username or userId)
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post("/unlock-account", requireAuth, async (req, res) => {
  try {
    const { username, userId } = req.body;

    if (!username && !userId) {
      return res.status(400).json(formatResponse(false, null, "Please provide either username or userId"));
    }

    // Find user by username or userId
    let user = null;
    
    if (userId) {
      const result = await executeQuery(
        "SELECT id, username, failed_login_attempts, locked_until FROM admin_users WHERE id = ?",
        [userId]
      );
      
      if (result.success && result.data.length > 0) {
        user = result.data[0];
      } else {
        return res.status(404).json(formatResponse(false, null, `User ID ${userId} not found`));
      }
    } else if (username) {
      const result = await executeQuery(
        "SELECT id, username, failed_login_attempts, locked_until FROM admin_users WHERE username = ?",
        [username]
      );
      
      if (result.success && result.data.length > 0) {
        user = result.data[0];
      } else {
        return res.status(404).json(formatResponse(false, null, `Username "${username}" not found`));
      }
    }

    // Check current lockout status
    const lockStatus = await checkAccountLocked(user.id);
    
    if (!lockStatus.isLocked) {
      return res.json(formatResponse(true, {
        userId: user.id,
        username: user.username,
        wasLocked: false,
        message: "Account is not locked"
      }, "Account is not locked"));
    }

    // Clear lockout
    const success = await clearAccountLockout(user.id);

    if (success) {
      Logger.info(`[Auth] Account unlocked by admin: ${req.user.username} unlocked account ${user.username} (ID: ${user.id})`);
      
      // Verify unlock
      const verifyStatus = await checkAccountLocked(user.id);
      
      return res.json(formatResponse(true, {
        userId: user.id,
        username: user.username,
        wasLocked: true,
        remainingMinutes: lockStatus.remainingMinutes,
        isUnlocked: !verifyStatus.isLocked
      }, `Account unlocked successfully for ${user.username}`));
    } else {
      return res.status(500).json(formatResponse(false, null, "Failed to unlock account"));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to unlock account", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/auth/check-lockout:
 *   get:
 *     summary: Check lockout status for an account
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         schema:
 *           type: string
 *         description: Username to check
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *         description: User ID to check
 *     responses:
 *       200:
 *         description: Lockout status retrieved successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: User not found
 */
router.get("/check-lockout", requireAuth, async (req, res) => {
  try {
    const { username, userId } = req.query;

    if (!username && !userId) {
      return res.status(400).json(formatResponse(false, null, "Please provide either username or userId"));
    }

    // Find user by username or userId
    let user = null;
    
    if (userId) {
      const result = await executeQuery(
        "SELECT id, username, failed_login_attempts, locked_until FROM admin_users WHERE id = ?",
        [userId]
      );
      
      if (result.success && result.data.length > 0) {
        user = result.data[0];
      } else {
        return res.status(404).json(formatResponse(false, null, `User ID ${userId} not found`));
      }
    } else if (username) {
      const result = await executeQuery(
        "SELECT id, username, failed_login_attempts, locked_until FROM admin_users WHERE username = ?",
        [username]
      );
      
      if (result.success && result.data.length > 0) {
        user = result.data[0];
      } else {
        return res.status(404).json(formatResponse(false, null, `Username "${username}" not found`));
      }
    }

    // Check lockout status
    const lockStatus = await checkAccountLocked(user.id);
    const lockoutConfig = getLockoutConfig();

    return res.json(formatResponse(true, {
      userId: user.id,
      username: user.username,
      failedLoginAttempts: user.failed_login_attempts,
      isLocked: lockStatus.isLocked,
      lockedUntil: lockStatus.lockedUntil?.toISOString(),
      remainingMinutes: lockStatus.remainingMinutes,
      lockoutConfig: lockoutConfig
    }, lockStatus.isLocked 
      ? `Account is locked. Remaining: ${lockStatus.remainingMinutes} minutes`
      : "Account is not locked"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to check lockout status", 500, formatResponse);
  }
});

// Middleware to check authentication
// Middleware to check admin role
export function requireAdmin(req, res, next) {
  const role = req.user?.role?.toLowerCase();
  if (!req.user || !["admin", "super_admin", "super admin"].includes(role)) {
    return res.status(403).json(formatResponse(false, null, "Admin access required"));
  }
  next();
}

export function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json(formatResponse(false, null, "Authentication required"));
    }

    const session = getSession(token);
    if (!session) {
      return res.status(401).json(formatResponse(false, null, "Invalid or expired session"));
    }

    req.user = session.userData;
    next();
  } catch (error) {
    Logger.error("Auth middleware error:", error);
    const isDevelopment = process.env.NODE_ENV === "development";
    const errorMessage = isDevelopment ? error.message : "Authentication error. Please login again.";
    res.status(500).json(formatResponse(false, null, "Authentication error", errorMessage));
  }
}

export default router;
