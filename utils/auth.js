import crypto from "crypto";
import Logger from "./logger.js";

/**
 * Hash a password with salt using PBKDF2
 * @param {string} password - Plain text password
 * @returns {string} Hashed password in format "salt:hash"
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password to verify
 * @param {string} passwordHash - Stored hash in format "salt:hash"
 * @returns {boolean} True if password matches
 */
export function verifyPassword(password, passwordHash) {
  try {
    const [salt, hash] = passwordHash.split(":");
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
    return hash === verifyHash;
  } catch (error) {
    return false;
  }
}

/**
 * Generate a secure random password
 * @param {number} length - Password length (default: 12)
 * @returns {string} Random password string
 */
export function generatePassword(length = 12) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, charset.length);
    password += charset[randomIndex];
  }

  return password;
}

/**
 * Generate a simple session token
 * @returns {string} Random session token
 */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Simple session storage (in production, use Redis or database)
 */
const sessions = new Map();

// Session timeout: 7 days (configurable via environment variable)
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS) || (7 * 24 * 60 * 60 * 1000); // Default: 7 days
// Auto-refresh threshold: extend session if less than this time remaining
const AUTO_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createSession(userId, userData) {
  const token = generateSessionToken();
  const expiresAt = Date.now() + SESSION_TIMEOUT_MS;

  sessions.set(token, {
    userId,
    userData,
    expiresAt,
    createdAt: Date.now(),
    lastAccessAt: Date.now()
  });

  return token;
}

export function getSession(token, autoRefresh = true) {
  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  // Check if session expired
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  // Auto-refresh: extend session if less than threshold time remaining
  if (autoRefresh) {
    const timeRemaining = session.expiresAt - Date.now();
    if (timeRemaining < AUTO_REFRESH_THRESHOLD_MS) {
      // Extend session by another full timeout period
      session.expiresAt = Date.now() + SESSION_TIMEOUT_MS;
      Logger.debug(`[Auth] Session auto-refreshed for user ${session.userId}`);
    }
    // Update last access time
    session.lastAccessAt = Date.now();
  }

  return session;
}

export function deleteSession(token) {
  return sessions.delete(token);
}

export function cleanupExpiredSessions() {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    Logger.debug(`[Auth] Cleaned up ${cleanedCount} expired session(s)`);
  }
  return cleanedCount;
}

// Get session timeout in hours (for debugging)
export function getSessionTimeoutHours() {
  return SESSION_TIMEOUT_MS / (60 * 60 * 1000);
}
