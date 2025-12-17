/**
 * Account Lockout Utility
 * Manages account lockout after failed login attempts
 */

import { executeQuery } from "../config/database.js";
import Logger from "./logger.js";

// Configuration
const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_DURATION_MINUTES = parseInt(process.env.ACCOUNT_LOCKOUT_MINUTES) || 30;
const LOCKOUT_DURATION_MS = LOCKOUT_DURATION_MINUTES * 60 * 1000;

/**
 * Check if account is locked
 * @param {number} userId - User ID
 * @returns {Promise<{isLocked: boolean, lockedUntil: Date|null, remainingMinutes: number|null}>}
 */
export async function checkAccountLocked(userId) {
  try {
    // Use UTC_TIMESTAMP() for comparison to ensure timezone consistency
    // MySQL TIMESTAMP columns are stored in UTC internally
    // Compare both values in UTC to avoid timezone conversion issues
    const result = await executeQuery(
      `SELECT 
        failed_login_attempts, 
        locked_until,
        CASE 
          WHEN locked_until IS NULL THEN 0
          WHEN UTC_TIMESTAMP() < locked_until THEN 1
          ELSE 0
        END as is_locked,
        CASE 
          WHEN locked_until IS NULL THEN NULL
          WHEN UTC_TIMESTAMP() < locked_until THEN TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), locked_until)
          ELSE NULL
        END as remaining_minutes
      FROM admin_users 
      WHERE id = ?`,
      [userId]
    );

    if (!result.success || result.data.length === 0) {
      Logger.debug(`[AccountLockout] User ID ${userId} not found or query failed`);
      return { isLocked: false, lockedUntil: null, remainingMinutes: null };
    }

    const user = result.data[0];
    
    // Handle MySQL datetime format for lockedUntil (for response)
    let lockedUntil = null;
    if (user.locked_until) {
      if (user.locked_until instanceof Date) {
        lockedUntil = user.locked_until;
      } else if (typeof user.locked_until === 'string') {
        const mysqlDateTime = user.locked_until.replace(' ', 'T');
        lockedUntil = new Date(mysqlDateTime);
        if (isNaN(lockedUntil.getTime())) {
          Logger.error(`[AccountLockout] Invalid locked_until date format for user ID ${userId}: ${user.locked_until}`);
          lockedUntil = null;
        }
      } else {
        lockedUntil = new Date(user.locked_until);
        if (isNaN(lockedUntil.getTime())) {
          Logger.error(`[AccountLockout] Invalid locked_until value for user ID ${userId}: ${user.locked_until} (type: ${typeof user.locked_until})`);
          lockedUntil = null;
        }
      }
    }

    // Use MySQL's comparison result (is_locked) instead of JavaScript comparison
    const isLocked = user.is_locked === 1 || user.is_locked === true;
    const remainingMinutes = user.remaining_minutes !== null ? Math.ceil(user.remaining_minutes) : null;

    Logger.warn(`[AccountLockout] Checking lockout for user ID ${userId}: locked_until=${user.locked_until} (type: ${typeof user.locked_until}), failed_attempts=${user.failed_login_attempts}, is_locked=${isLocked} (raw: ${user.is_locked}), remaining_minutes=${remainingMinutes} (raw: ${user.remaining_minutes})`);

    if (isLocked && remainingMinutes !== null && remainingMinutes > 0) {
      Logger.warn(`[AccountLockout] ✅ Account LOCKED for user ID ${userId}. Remaining: ${remainingMinutes} minutes`);
      
      return {
        isLocked: true,
        lockedUntil: lockedUntil,
        remainingMinutes: remainingMinutes
      };
    }
    
    // Lockout expired or invalid, clear it
    if (user.locked_until && !isLocked) {
      Logger.warn(`[AccountLockout] ⚠️ Lockout expired or invalid for user ID ${userId}, clearing lockout (locked_until exists but is_locked=false)`);
      await clearAccountLockout(userId);
    }

    return { isLocked: false, lockedUntil: null, remainingMinutes: null };
  } catch (error) {
    Logger.error("[AccountLockout] Error checking account lock:", error);
    return { isLocked: false, lockedUntil: null, remainingMinutes: null };
  }
}

/**
 * Increment failed login attempts and lock account if threshold reached
 * @param {number} userId - User ID
 * @returns {Promise<{isLocked: boolean, attempts: number, lockedUntil: Date|null}>}
 */
export async function incrementFailedAttempts(userId) {
  try {
    // Use UTC_TIMESTAMP() for comparison to ensure timezone consistency
    // MySQL TIMESTAMP columns are stored in UTC internally
    // Compare both values in UTC to avoid timezone conversion issues
    const currentResult = await executeQuery(
      `SELECT 
        failed_login_attempts, 
        locked_until,
        CASE 
          WHEN locked_until IS NULL THEN 0
          WHEN UTC_TIMESTAMP() < locked_until THEN 1
          ELSE 0
        END as is_locked
      FROM admin_users 
      WHERE id = ?`,
      [userId]
    );

    if (!currentResult.success || currentResult.data.length === 0) {
      return { isLocked: false, attempts: 0, lockedUntil: null };
    }

    const user = currentResult.data[0];
    
    // Use MySQL's comparison result (is_locked) instead of JavaScript comparison
    const isLocked = user.is_locked === 1 || user.is_locked === true;
    
    Logger.warn(`[AccountLockout] incrementFailedAttempts: Checking lockout for user ID ${userId}: locked_until=${user.locked_until}, is_locked=${isLocked} (raw: ${user.is_locked})`);
    
    if (isLocked && user.locked_until) {
      // Account is still locked, don't increment attempts
      let lockedUntil = null;
      if (user.locked_until instanceof Date) {
        lockedUntil = user.locked_until;
      } else if (typeof user.locked_until === 'string') {
        const mysqlDateTime = user.locked_until.replace(' ', 'T');
        lockedUntil = new Date(mysqlDateTime);
        if (isNaN(lockedUntil.getTime())) {
          Logger.error(`[AccountLockout] Invalid locked_until date format for user ID ${userId}: ${user.locked_until}`);
          lockedUntil = null;
        }
      } else {
        lockedUntil = new Date(user.locked_until);
        if (isNaN(lockedUntil.getTime())) {
          Logger.error(`[AccountLockout] Invalid locked_until value for user ID ${userId}: ${user.locked_until} (type: ${typeof user.locked_until})`);
          lockedUntil = null;
        }
      }
      
      Logger.warn(`[AccountLockout] ✅ Account already locked for user ID ${userId}, NOT incrementing attempts`);
      
      return {
        isLocked: true,
        attempts: user.failed_login_attempts || 0,
        lockedUntil: lockedUntil
      };
    }
    
    // Lockout expired or invalid - clear it first, then continue to increment
    if (user.locked_until && !isLocked) {
      Logger.debug(`[AccountLockout] Lockout expired for user ID ${userId}, clearing lockout before incrementing attempts`);
      await clearAccountLockout(userId);
    }

    // After clearing expired lockout, get fresh user data
    // If lockout was just cleared, failed_login_attempts should be 0
    // Otherwise, increment from current value
    const freshResult = await executeQuery(
      `SELECT failed_login_attempts FROM admin_users WHERE id = ?`,
      [userId]
    );
    
    const freshAttempts = freshResult.success && freshResult.data.length > 0
      ? (freshResult.data[0].failed_login_attempts || 0)
      : 0;
    
    const currentAttempts = freshAttempts + 1;
    
    const lockedUntilDate = new Date(Date.now() + LOCKOUT_DURATION_MS);
    
    // Convert to MySQL datetime format string (YYYY-MM-DD HH:mm:ss)
    // MySQL TIMESTAMP column stores in UTC internally
    // Connection timezone is +07:00, so MySQL will convert UTC string to local time
    // We need to pass UTC time string, and MySQL will store it correctly
    // Use toISOString() which gives UTC time, MySQL will handle conversion
    const lockedUntilString = lockedUntilDate.toISOString().slice(0, 19).replace('T', ' ');
    
    Logger.warn(`[AccountLockout] Setting lockout: Date=${lockedUntilDate.toISOString()}, String=${lockedUntilString}`);

    // Update failed attempts
    if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
      // Lock account - use string format for MySQL TIMESTAMP
      const lockResult = await executeQuery(
        `UPDATE admin_users 
         SET failed_login_attempts = ?, 
             locked_until = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [currentAttempts, lockedUntilString, userId]
      );

      if (!lockResult.success) {
        Logger.error(`[AccountLockout] Failed to lock account for user ID ${userId}:`, lockResult.error);
        // Continue anyway, but log the error
      } else {
        Logger.warn(`[AccountLockout] Account locked for user ID ${userId} after ${currentAttempts} failed attempts. Locked until ${lockedUntilString}`);
      }

      return {
        isLocked: true,
        attempts: currentAttempts,
        lockedUntil: lockedUntilDate
      };
    } else {
      // Just increment attempts
      await executeQuery(
        `UPDATE admin_users 
         SET failed_login_attempts = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [currentAttempts, userId]
      );

      Logger.debug(`[AccountLockout] Failed login attempt ${currentAttempts}/${MAX_FAILED_ATTEMPTS} for user ID ${userId}`);

      return {
        isLocked: false,
        attempts: currentAttempts,
        lockedUntil: null
      };
    }
  } catch (error) {
    Logger.error("[AccountLockout] Error incrementing failed attempts:", error);
    return { isLocked: false, attempts: 0, lockedUntil: null };
  }
}

/**
 * Clear account lockout (reset failed attempts and unlock)
 * @param {number} userId - User ID
 * @returns {Promise<boolean>}
 */
export async function clearAccountLockout(userId) {
  try {
    const result = await executeQuery(
      `UPDATE admin_users 
       SET failed_login_attempts = 0, 
           locked_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [userId]
    );

    if (result.success) {
      Logger.debug(`[AccountLockout] Account lockout cleared for user ID ${userId}`);
      return true;
    }
    return false;
  } catch (error) {
    Logger.error("[AccountLockout] Error clearing account lockout:", error);
    return false;
  }
}

/**
 * Get lockout configuration
 * @returns {Object} Lockout configuration
 */
export function getLockoutConfig() {
  return {
    maxFailedAttempts: MAX_FAILED_ATTEMPTS,
    lockoutDurationMinutes: LOCKOUT_DURATION_MINUTES,
    lockoutDurationMs: LOCKOUT_DURATION_MS
  };
}

