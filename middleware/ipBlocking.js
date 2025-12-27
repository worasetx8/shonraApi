/**
 * IP Blocking Middleware
 * Provides IP whitelisting and blacklisting functionality
 * Integrates with rate limiter to auto-block IPs after violations
 */

import Logger from "../utils/logger.js";

// In-memory IP blocking (in production, use Redis for distributed blocking)
const blockedIPs = new Map(); // IP -> { blockedUntil: timestamp, reason: string, violations: number }
const whitelistedIPs = new Set(); // IPs that bypass all checks

// In development, whitelist localhost by default to prevent self-blocking
if (process.env.NODE_ENV !== 'production') {
  whitelistedIPs.add('127.0.0.1');
  whitelistedIPs.add('::1');
  Logger.info('[IPBlocking] Development mode: Localhost whitelisted automatically');
}

const lastLogTime = new Map(); // IP -> last log timestamp (for rate limiting logs)

// Configuration
const AUTO_BLOCK_ENABLED = process.env.AUTO_BLOCK_ENABLED !== 'false'; // Default: enabled
const AUTO_BLOCK_VIOLATIONS_THRESHOLD = parseInt(process.env.AUTO_BLOCK_VIOLATIONS || '10'); // Block after 10 violations
const AUTO_BLOCK_DURATION_MS = parseInt(process.env.AUTO_BLOCK_DURATION_MS || '3600000'); // 1 hour default

/**
 * Get client IP address from request
 * Normalizes IPv6 localhost (::1) to IPv4 localhost (127.0.0.1) for consistency
 * @param {Object} req - Express request object
 * @returns {string} Client IP address
 */
export function getClientIP(req) {
  // Check X-Forwarded-For header (from reverse proxy)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first one
    let ip = forwardedFor.split(',')[0].trim();
    // Normalize IPv6 localhost to IPv4
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = '127.0.0.1';
    }
    return ip;
  }

  // Check X-Real-IP header (from nginx)
  if (req.headers['x-real-ip']) {
    let ip = req.headers['x-real-ip'];
    // Normalize IPv6 localhost to IPv4
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = '127.0.0.1';
    }
    return ip;
  }

  // Fallback to connection remote address
  let ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  
  // Normalize IPv6 localhost to IPv4 for consistency
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    ip = '127.0.0.1';
  }
  
  return ip;
}

/**
 * Check if IP is whitelisted
 * @param {string} ip - IP address
 * @returns {boolean} True if whitelisted
 */
export function isWhitelisted(ip) {
  return whitelistedIPs.has(ip);
}

/**
 * Check if IP is blocked
 * @param {string} ip - IP address
 * @returns {Object} Block status { isBlocked: boolean, blockedUntil: number|null, reason: string|null, violations: number }
 */
export function isBlocked(ip) {
  if (isWhitelisted(ip)) {
    return { isBlocked: false, blockedUntil: null, reason: null, violations: 0 };
  }

  const blockInfo = blockedIPs.get(ip);
  if (!blockInfo) {
    return { isBlocked: false, blockedUntil: null, reason: null, violations: 0 };
  }

  const now = Date.now();
  
  // If blocked and not expired
  if (blockInfo.blockedUntil && now < blockInfo.blockedUntil) {
    return {
      isBlocked: true,
      blockedUntil: blockInfo.blockedUntil,
      reason: blockInfo.reason,
      violations: blockInfo.violations || 0
    };
  } 
  // If block expired, remove it
  else if (blockInfo.blockedUntil && now >= blockInfo.blockedUntil) {
    blockedIPs.delete(ip);
    lastLogTime.delete(ip); // Clean up log tracking
    return { isBlocked: false, blockedUntil: null, reason: null, violations: 0 };
  }
  // If not blocked yet but has violations (blockedUntil: null)
  else if (!blockInfo.blockedUntil) {
    return {
      isBlocked: false,
      blockedUntil: null,
      reason: blockInfo.reason || null,
      violations: blockInfo.violations || 0
    };
  }
  
  return { isBlocked: false, blockedUntil: null, reason: null, violations: 0 };
}

/**
 * Block an IP address
 * @param {string} ip - IP address to block
 * @param {number} durationMs - Block duration in milliseconds
 * @param {string} reason - Reason for blocking
 * @returns {boolean} True if blocked successfully
 */
export function blockIP(ip, durationMs = AUTO_BLOCK_DURATION_MS, reason = 'Manual block') {
  if (isWhitelisted(ip)) {
    Logger.warn(`[IPBlocking] Attempted to block whitelisted IP: ${ip}`);
    return false;
  }

  const blockedUntil = Date.now() + durationMs;
  const existingBlock = blockedIPs.get(ip);

  blockedIPs.set(ip, {
    blockedUntil,
    reason,
    violations: existingBlock ? existingBlock.violations + 1 : 1,
    blockedAt: Date.now()
  });

  Logger.warn(`[IPBlocking] IP blocked: ${ip}`, {
    ip,
    blockedUntil: new Date(blockedUntil).toISOString(),
    reason,
    violations: blockedIPs.get(ip).violations
  });

  return true;
}

/**
 * Unblock an IP address
 * @param {string} ip - IP address to unblock
 * @returns {boolean} True if unblocked successfully
 */
export function unblockIP(ip) {
  const existed = blockedIPs.has(ip);
  blockedIPs.delete(ip);
  lastLogTime.delete(ip); // Clean up log tracking

  if (existed) {
    Logger.info(`[IPBlocking] IP unblocked: ${ip}`);
  }

  return existed;
}

/**
 * Record a violation for an IP (for auto-blocking)
 * @param {string} ip - IP address
 * @param {string} reason - Reason for violation
 * @returns {boolean} True if IP was auto-blocked
 */
export function recordViolation(ip, reason = 'Rate limit exceeded') {
  if (isWhitelisted(ip)) {
    return false; // Don't record violations for whitelisted IPs
  }

  if (!AUTO_BLOCK_ENABLED) {
    return false;
  }

  // Check if already blocked (don't increment violations if already blocked)
  const existingBlock = blockedIPs.get(ip);
  if (existingBlock && existingBlock.blockedUntil && Date.now() < existingBlock.blockedUntil) {
    // Already blocked, don't record more violations
    return false;
  }

  // Get current violation count (if exists and not blocked)
  const currentViolations = existingBlock && !existingBlock.blockedUntil 
    ? existingBlock.violations 
    : 0;
  const violations = currentViolations + 1;

  // Use info level logging for violations to make debugging easier
  Logger.info(`[IPBlocking] Recording violation for ${ip}: ${violations}/${AUTO_BLOCK_VIOLATIONS_THRESHOLD}`, {
    ip,
    violations,
    threshold: AUTO_BLOCK_VIOLATIONS_THRESHOLD,
    reason,
    existingBlock: existingBlock ? { violations: existingBlock.violations, blockedUntil: existingBlock.blockedUntil } : null
  });

  // Check if threshold reached
  if (violations >= AUTO_BLOCK_VIOLATIONS_THRESHOLD) {
    Logger.warn(`[IPBlocking] Threshold reached for ${ip}, blocking...`, {
      ip,
      violations,
      threshold: AUTO_BLOCK_VIOLATIONS_THRESHOLD
    });
    blockIP(ip, AUTO_BLOCK_DURATION_MS, `Auto-blocked after ${violations} violations: ${reason}`);
    return true;
  } else {
    // Record violation but don't block yet
    blockedIPs.set(ip, {
      blockedUntil: null,
      reason: `Violations: ${violations}/${AUTO_BLOCK_VIOLATIONS_THRESHOLD}`,
      violations,
      lastViolation: Date.now()
    });
    return false;
  }
}

/**
 * Whitelist an IP address
 * @param {string} ip - IP address to whitelist
 * @returns {boolean} True if whitelisted successfully
 */
export function whitelistIP(ip) {
  whitelistedIPs.add(ip);
  // Also unblock if currently blocked
  unblockIP(ip);
  Logger.info(`[IPBlocking] IP whitelisted: ${ip}`);
  return true;
}

/**
 * Remove IP from whitelist
 * @param {string} ip - IP address
 * @returns {boolean} True if removed successfully
 */
export function removeWhitelist(ip) {
  const existed = whitelistedIPs.has(ip);
  whitelistedIPs.delete(ip);
  if (existed) {
    Logger.info(`[IPBlocking] IP removed from whitelist: ${ip}`);
  }
  return existed;
}

/**
 * Get all blocked IPs
 * @returns {Array} Array of blocked IP info
 */
export function getBlockedIPs() {
  const now = Date.now();
  const blocked = [];

  for (const [ip, info] of blockedIPs.entries()) {
    if (now < info.blockedUntil) {
      blocked.push({
        ip,
        blockedUntil: info.blockedUntil,
        reason: info.reason,
        violations: info.violations,
        blockedAt: info.blockedAt
      });
    }
  }

  return blocked;
}

/**
 * Get all whitelisted IPs
 * @returns {Array} Array of whitelisted IPs
 */
export function getWhitelistedIPs() {
  return Array.from(whitelistedIPs);
}

/**
 * Cleanup expired blocks
 * Only removes entries that are actually blocked and expired
 * Keeps violation tracking entries (blockedUntil: null) for auto-blocking
 */
export function cleanupExpiredBlocks() {
  const now = Date.now();
  let cleaned = 0;
  const VIOLATION_RETENTION_MS = 5 * 60 * 1000; // Keep violations for 5 minutes

  for (const [ip, info] of blockedIPs.entries()) {
    // Only cleanup entries that are actually blocked and expired
    if (info.blockedUntil && now >= info.blockedUntil) {
      blockedIPs.delete(ip);
      lastLogTime.delete(ip); // Clean up log tracking
      cleaned++;
    } 
    // Cleanup violation tracking entries that are too old (no recent violations)
    else if (!info.blockedUntil && info.lastViolation && (now - info.lastViolation) > VIOLATION_RETENTION_MS) {
      blockedIPs.delete(ip);
      lastLogTime.delete(ip); // Clean up log tracking
      cleaned++;
    }
  }

  if (cleaned > 0) {
    Logger.debug(`[IPBlocking] Cleaned up ${cleaned} expired IP blocks/violations`);
  }
}

/**
 * IP Blocking Middleware
 * Checks if request IP is blocked and returns 403 if blocked
 * Bypasses blocking for static file serving (images, uploads)
 */
export function ipBlockingMiddleware(req, res, next) {
  const clientIP = getClientIP(req);
  const userAgent = req.headers['user-agent'] || '';

  // Bypass IP blocking for public static resources
  if (req.path.startsWith('/api/uploads/') || req.path === '/favicon.ico') {
    return next();
  }

  // Bypass IP blocking for public API endpoints when called from Next.js server-side
  // Security: Check User-Agent and optional secret header for additional security
  const isNextJsServerRequest = userAgent.includes('SHONRA-Frontend') || 
                                 userAgent.includes('node-fetch') || 
                                 userAgent.includes('undici');
  
  // Optional secret header for additional security (set in environment variable)
  // In production, this adds an extra layer of security
  const expectedSecret = process.env.NEXTJS_API_SECRET;
  const providedSecret = req.headers['x-nextjs-api-secret'];
  const hasValidSecret = !expectedSecret || providedSecret === expectedSecret;
  
  // Public API endpoints that should be accessible from Next.js server-side
  const publicApiPaths = [
    '/api/products/public',
    '/api/products/flash-sale',
    '/api/categories/public',
    '/api/tags/public',
    '/api/banners/public',
    '/api/settings',
    '/api/health'
  ];
  
  const isPublicApiPath = publicApiPaths.some(path => req.path.startsWith(path));
  
  // Bypass logic:
  // - In development: Allow if User-Agent matches (for easier testing)
  // - In production: Require both User-Agent AND secret header (if configured)
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const shouldBypass = isPublicApiPath && isNextJsServerRequest && 
                       (isDevelopment || hasValidSecret);
  
  if (shouldBypass) {
    return next();
  }
  
  // Log suspicious attempts in production (if secret is configured but missing)
  if (!isDevelopment && expectedSecret && isPublicApiPath && isNextJsServerRequest && !hasValidSecret) {
    Logger.warn(`[IPBlocking] Next.js server request missing secret header`, {
      ip: clientIP,
      path: req.path,
      userAgent
    });
  }

  // Check if whitelisted
  if (isWhitelisted(clientIP)) {
    return next();
  }

  // Check if blocked
  const blockStatus = isBlocked(clientIP);
  if (blockStatus.isBlocked) {
    const remainingMs = blockStatus.blockedUntil - Date.now();
    const remainingMinutes = Math.ceil(remainingMs / 60000);

    // Rate limit logging to avoid spam (log every 30 seconds max)
    const now = Date.now();
    const lastLog = lastLogTime.get(clientIP) || 0;
    const LOG_INTERVAL_MS = 30000; // 30 seconds

    if (now - lastLog > LOG_INTERVAL_MS) {
      Logger.warn(`[IPBlocking] Blocked IP attempted access: ${clientIP}`, {
        ip: clientIP,
        reason: blockStatus.reason,
        remainingMinutes
      });
      lastLogTime.set(clientIP, now);
    }

    return res.status(403).json({
      success: false,
      error: 'IP address blocked',
      message: `Your IP address has been blocked. Reason: ${blockStatus.reason}. Try again in ${remainingMinutes} minute(s).`,
      blockedUntil: new Date(blockStatus.blockedUntil).toISOString(),
      remainingMinutes
    });
  }

  next();
}

// Cleanup expired blocks every 5 minutes
setInterval(cleanupExpiredBlocks, 5 * 60 * 1000);

// Initialize whitelist from environment variable (comma-separated)
if (process.env.WHITELISTED_IPS) {
  const ips = process.env.WHITELISTED_IPS.split(',').map(ip => ip.trim()).filter(ip => ip);
  
  ips.forEach(ip => whitelistIP(ip));
  Logger.info(`[IPBlocking] Initialized ${ips.length} whitelisted IP(s) from environment`);
}

