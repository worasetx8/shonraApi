/**
 * Unlock Account Script
 * Utility script to unlock a locked admin account
 * 
 * Usage:
 *   node scripts/unlock-account.js --username=admin
 *   node scripts/unlock-account.js --user-id=1
 *   node scripts/unlock-account.js --username=admin --user-id=1
 */

import { executeQuery } from "../config/database.js";
import Logger from "../utils/logger.js";
import { clearAccountLockout, checkAccountLocked } from "../utils/accountLockout.js";

async function unlockAccount(options = {}) {
  const { username, userId } = options;

  if (!username && !userId) {
    Logger.error("Please provide either --username or --user-id");
    Logger.info("Usage: node scripts/unlock-account.js --username=admin");
    Logger.info("   or: node scripts/unlock-account.js --user-id=1");
    process.exit(1);
  }

  try {
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
        Logger.error(`User ID ${userId} not found`);
        process.exit(1);
      }
    } else if (username) {
      const result = await executeQuery(
        "SELECT id, username, failed_login_attempts, locked_until FROM admin_users WHERE username = ?",
        [username]
      );
      
      if (result.success && result.data.length > 0) {
        user = result.data[0];
      } else {
        Logger.error(`Username "${username}" not found`);
        process.exit(1);
      }
    }

    if (!user) {
      Logger.error("User not found");
      process.exit(1);
    }

    Logger.info(`Found user: ID=${user.id}, Username=${user.username}`);
    Logger.info(`Current status: failed_attempts=${user.failed_login_attempts}, locked_until=${user.locked_until || 'NULL'}`);

    // Check current lockout status
    const lockStatus = await checkAccountLocked(user.id);
    
    if (lockStatus.isLocked) {
      Logger.warn(`Account is currently LOCKED. Remaining: ${lockStatus.remainingMinutes} minutes`);
    } else {
      Logger.info("Account is NOT locked");
    }

    // Clear lockout
    Logger.info("Unlocking account...");
    const success = await clearAccountLockout(user.id);

    if (success) {
      Logger.success(`✅ Account unlocked successfully for user ID ${user.id} (${user.username})`);
      
      // Verify unlock
      const verifyStatus = await checkAccountLocked(user.id);
      if (!verifyStatus.isLocked) {
        Logger.success("✅ Verification: Account is now unlocked");
      } else {
        Logger.warn("⚠️ Warning: Account still appears locked after unlock");
      }
    } else {
      Logger.error("❌ Failed to unlock account");
      process.exit(1);
    }
  } catch (error) {
    Logger.error("Error unlocking account:", error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

args.forEach(arg => {
  if (arg.startsWith('--username=')) {
    options.username = arg.split('=')[1];
  } else if (arg.startsWith('--user-id=')) {
    options.userId = parseInt(arg.split('=')[1]);
  }
});

unlockAccount(options).catch(error => {
  Logger.error("Error running unlock-account script:", error);
  process.exit(1);
});


