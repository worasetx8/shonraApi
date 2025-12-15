import express from "express";
import { executeQuery } from "../config/database.js";
import { hashPassword } from "../utils/auth.js";
import { formatResponse, validateRequiredFields, generatePagination } from "../utils/helpers.js";
import { requireAuth } from "./auth.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";

const router = express.Router();

// Middleware to check admin role
function requireAdmin(req, res, next) {
  const role = req.user?.role?.toLowerCase();
  if (!req.user || !["admin", "super admin"].includes(role)) {
    return res.status(403).json(formatResponse(false, null, "Admin access required"));
  }
  next();
}

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all admin users (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
// Get all admin users
router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || "";

    let whereClause = "WHERE 1=1";
    const queryParams = [];

    if (search) {
      whereClause += " AND (u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)";
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM admin_users u ${whereClause}`;
    const countResult = await executeQuery(countQuery, queryParams);
    const totalCount = countResult.success ? countResult.data[0].total : 0;

    // Get users with pagination and Role Name
    const offset = (page - 1) * limit;
    // Using direct interpolation for LIMIT/OFFSET to avoid prepared statement issues with numbers in some environments
    const usersQuery = `
      SELECT u.id, u.username, u.role_id, r.name as role_name, u.full_name, u.email, u.status, 
             u.last_login_at, u.created_at, u.updated_at 
      FROM admin_users u
      LEFT JOIN roles r ON u.role_id = r.id
      ${whereClause} 
      ORDER BY u.created_at DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await executeQuery(usersQuery, queryParams);

    if (result.success) {
      const pagination = generatePagination(page, limit, totalCount);

      res.json(
        formatResponse(
          true,
          {
            users: result.data,
            pagination
          },
          "Admin users retrieved successfully"
        )
      );
    } else {
      throw new Error("Failed to retrieve admin users");
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve admin users", 500, formatResponse);
  }
});

// Create new admin user
router.post("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const { username, password, role_id, full_name, email, status } = req.body;
    
    // Sanitize email if provided
    if (email) {
      const sanitizedEmail = sanitizeEmail(email);
      if (!sanitizedEmail) {
        return res.status(400).json(formatResponse(false, null, "Invalid email format"));
      }
      req.body.email = sanitizedEmail;
    }

    const missing = validateRequiredFields(req.body, ["username", "password", "role_id"]);
    if (missing.length > 0) {
      return res.status(400).json(formatResponse(false, null, `Missing required fields: ${missing.join(", ")}`));
    }

    // Check if username already exists
    const existingResult = await executeQuery("SELECT id FROM admin_users WHERE username = ?", [username]);

    if (existingResult.success && existingResult.data.length > 0) {
      return res.status(409).json(formatResponse(false, null, "Username already exists"));
    }

    // Hash password and create user
    const passwordHash = hashPassword(password);

    const insertQuery = `
      INSERT INTO admin_users (username, password_hash, role_id, full_name, email, status) 
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    // Default status to active if not provided
    const userStatus = status || 'active';

    const result = await executeQuery(insertQuery, [username, passwordHash, role_id, full_name || "", email || "", userStatus]);

    if (result.success) {
      res.status(201).json(formatResponse(true, { id: result.data.insertId }, "Admin user created successfully"));
    } else {
      throw new Error(result.error || "Failed to create admin user");
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to create admin user", 500, formatResponse);
    const isDevelopment = process.env.NODE_ENV === "development";
    const errorMessage = isDevelopment ? error.message : "Failed to create admin user. Please try again.";
    res.status(500).json(formatResponse(false, null, "Failed to create admin user", errorMessage));
  }
});

// Update admin user
router.patch("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Don't allow updating password through this endpoint
    delete updates.password;
    delete updates.password_hash;

    // Protect Super Admin from role changes by others (optional but good)
    if (id === '1' && updates.role_id && updates.role_id !== 1) {
         // Assuming ID 1 is root super admin
         return res.status(403).json(formatResponse(false, null, "Cannot change role of root Super Admin"));
    }

    const allowedFields = ["role_id", "full_name", "email", "status"];
    const updateFields = [];
    const updateValues = [];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        updateValues.push(updates[field]);
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json(formatResponse(false, null, "No valid fields to update"));
    }

    updateFields.push("updated_at = CURRENT_TIMESTAMP");
    updateValues.push(id);

    const updateQuery = `
      UPDATE admin_users 
      SET ${updateFields.join(", ")} 
      WHERE id = ?
    `;

    const result = await executeQuery(updateQuery, updateValues);

    if (result.success && result.data.affectedRows > 0) {
      res.json(formatResponse(true, null, "Admin user updated successfully"));
    } else {
      res.status(404).json(formatResponse(false, null, "Admin user not found"));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update admin user", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to update admin user", error.message));
  }
});

// Reset Password
router.post("/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json(formatResponse(false, null, "Password must be at least 6 characters"));
        }

        const passwordHash = hashPassword(password);

        const result = await executeQuery(
            "UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [passwordHash, id]
        );

        if (result.success && result.data.affectedRows > 0) {
            res.json(formatResponse(true, null, "Password reset successfully"));
        } else {
            res.status(404).json(formatResponse(false, null, "Admin user not found"));
        }
    } catch (error) {
        Logger.error("Reset password error:", error);
        res.status(500).json(formatResponse(false, null, "Failed to reset password", error.message));
    }
});

// Change admin user status
router.patch("/users/:id/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // active or inactive

    if (id === '1') {
        return res.status(403).json(formatResponse(false, null, "Cannot disable root Super Admin"));
    }

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json(formatResponse(false, null, "Invalid status value"));
    }

    const result = await executeQuery(
      "UPDATE admin_users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, id]
    );

    if (result.success && result.data.affectedRows > 0) {
      res.json(formatResponse(true, null, `Admin user ${status} successfully`));
    } else {
      res.status(404).json(formatResponse(false, null, "Admin user not found"));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update admin user status", 500, formatResponse);
  }
});

// Delete admin user
router.delete("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json(formatResponse(false, null, "Cannot delete your own account"));
    }
    
    // Prevent deleting root super admin
    if (id === '1') {
        return res.status(403).json(formatResponse(false, null, "Cannot delete root Super Admin"));
    }

    const result = await executeQuery("DELETE FROM admin_users WHERE id = ?", [id]);

    if (result.success && result.data.affectedRows > 0) {
      res.json(formatResponse(true, null, "Admin user deleted successfully"));
    } else {
      res.status(404).json(formatResponse(false, null, "Admin user not found"));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete admin user", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to delete admin user", error.message));
  }
});

// Get dashboard statistics
router.get("/stats", requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get product statistics
    const productStats = await executeQuery(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_products,
        COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_products
      FROM shopee_products
    `);

    // Get user statistics
    const userStats = await executeQuery(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users
      FROM admin_users
    `);

    // Get recent activity (last 7 days)
    const recentActivity = await executeQuery(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as products_added
      FROM shopee_products 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    const stats = {
      products: productStats.success ? productStats.data[0] : null,
      users: userStats.success ? userStats.data[0] : null,
      recent_activity: recentActivity.success ? recentActivity.data : []
    };

    res.json(formatResponse(true, stats, "Dashboard statistics retrieved successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve dashboard statistics", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to retrieve dashboard statistics", error.message));
  }
});

export default router;
