-- Reset Account Lockout SQL Script
-- This script can be used to unlock accounts directly in the database
-- 
-- Usage:
--   mysql -u username -p database_name < migrations/reset_account_lockout.sql
--   Or run individual queries in MySQL client

-- ============================================
-- Option 1: Unlock ALL locked accounts
-- ============================================
UPDATE admin_users 
SET failed_login_attempts = 0, 
    locked_until = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE locked_until IS NOT NULL 
  AND UTC_TIMESTAMP() < locked_until;

-- ============================================
-- Option 2: Unlock specific user by username
-- ============================================
-- UPDATE admin_users 
-- SET failed_login_attempts = 0, 
--     locked_until = NULL,
--     updated_at = CURRENT_TIMESTAMP
-- WHERE username = 'admin';

-- ============================================
-- Option 3: Unlock specific user by ID
-- ============================================
-- UPDATE admin_users 
-- SET failed_login_attempts = 0, 
--     locked_until = NULL,
--     updated_at = CURRENT_TIMESTAMP
-- WHERE id = 1;

-- ============================================
-- Option 4: Reset failed attempts only (keep lockout if still valid)
-- ============================================
-- UPDATE admin_users 
-- SET failed_login_attempts = 0,
--     updated_at = CURRENT_TIMESTAMP
-- WHERE id = 1;

-- ============================================
-- Check locked accounts (before unlock)
-- ============================================
-- SELECT id, username, failed_login_attempts, locked_until,
--        CASE 
--          WHEN locked_until IS NULL THEN 0
--          WHEN UTC_TIMESTAMP() < locked_until THEN 1
--          ELSE 0
--        END as is_locked,
--        CASE 
--          WHEN locked_until IS NULL THEN NULL
--          WHEN UTC_TIMESTAMP() < locked_until THEN TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), locked_until)
--          ELSE NULL
--        END as remaining_minutes
-- FROM admin_users 
-- WHERE locked_until IS NOT NULL;

-- ============================================
-- Verify unlock (after unlock)
-- ============================================
-- SELECT id, username, failed_login_attempts, locked_until
-- FROM admin_users 
-- WHERE id = 1;



