/**
 * Verify Timezone Configuration Script
 * ตรวจสอบการตั้งค่า timezone สำหรับ Account Lockout
 * 
 * Usage:
 *   node scripts/verify-timezone.js
 */

import { executeQuery } from "../config/database.js";
import Logger from "../utils/logger.js";

async function verifyTimezone() {
  Logger.info("🔍 Verifying Timezone Configuration...\n");

  // Check Node.js timezone
  Logger.info(`Node.js Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  Logger.info(`Node.js TZ env: ${process.env.TZ || 'not set'}`);
  Logger.info(`Node.js Date: ${new Date().toString()}\n`);

  // Check MySQL timezone
  const result = await executeQuery(`
    SELECT 
      @@global.time_zone as global_timezone,
      @@session.time_zone as session_timezone,
      NOW() as mysql_now,
      UTC_TIMESTAMP() as mysql_utc,
      TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), NOW()) as timezone_offset_hours
  `);

  if (result.success && result.data.length > 0) {
    const tz = result.data[0];
    Logger.info(`MySQL Global Timezone: ${tz.global_timezone}`);
    Logger.info(`MySQL Session Timezone: ${tz.session_timezone}`);
    Logger.info(`MySQL NOW(): ${tz.mysql_now}`);
    Logger.info(`MySQL UTC_TIMESTAMP(): ${tz.mysql_utc}`);
    Logger.info(`Timezone Offset: ${tz.timezone_offset_hours} hours\n`);

    // Verify
    if (tz.timezone_offset_hours === 7) {
      Logger.success("✅ Timezone configuration is correct!");
    } else {
      Logger.warn(`⚠️ Timezone offset is ${tz.timezone_offset_hours} hours (expected 7)`);
      Logger.warn("⚠️ This may cause issues with account lockout!");
    }
  } else {
    Logger.error("❌ Failed to query MySQL timezone");
    process.exit(1);
  }

  // Test account lockout query
  Logger.info("Testing Account Lockout Query...");
  const lockoutTest = await executeQuery(`
    SELECT 
      UTC_TIMESTAMP() as current_utc,
      DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) as future_utc,
      CASE 
        WHEN UTC_TIMESTAMP() < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) THEN 1
        ELSE 0
      END as is_future,
      TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)) as diff_minutes
  `);

  if (lockoutTest.success && lockoutTest.data.length > 0) {
    const test = lockoutTest.data[0];
    Logger.info(`Current UTC: ${test.current_utc}`);
    Logger.info(`Future UTC (+30 min): ${test.future_utc}`);
    Logger.info(`Difference: ${test.diff_minutes} minutes`);
    Logger.info(`Is Future: ${test.is_future === 1 ? 'Yes ✅' : 'No ❌'}`);
    
    if (test.is_future === 1 && test.diff_minutes === 30) {
      Logger.success("✅ Account lockout query is working correctly!");
    } else {
      Logger.error("❌ Account lockout query is NOT working correctly!");
      Logger.error(`Expected: is_future=1, diff_minutes=30`);
      Logger.error(`Got: is_future=${test.is_future}, diff_minutes=${test.diff_minutes}`);
      process.exit(1);
    }
  } else {
    Logger.error("❌ Failed to test account lockout query");
    process.exit(1);
  }

  Logger.info("\n✅ All timezone checks passed!");
}

verifyTimezone().catch(error => {
  Logger.error("Error verifying timezone:", error);
  process.exit(1);
});



