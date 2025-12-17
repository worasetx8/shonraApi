-- Add Account Lockout Columns
-- This migration adds columns for account lockout functionality
-- Note: MySQL doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- Run this script only if columns don't exist, or handle errors gracefully

-- Add failed_login_attempts column
-- Will fail if column already exists (this is OK)
ALTER TABLE admin_users 
ADD COLUMN failed_login_attempts INT DEFAULT 0;

-- Add locked_until column
-- Will fail if column already exists (this is OK)
ALTER TABLE admin_users 
ADD COLUMN locked_until TIMESTAMP NULL DEFAULT NULL;

-- Add index for faster lookups
-- Will fail if index already exists (this is OK)
CREATE INDEX idx_locked_until ON admin_users(locked_until);

