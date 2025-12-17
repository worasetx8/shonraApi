import Logger from "../utils/logger.js";
import { recordViolation, isWhitelisted, getClientIP, isBlocked } from "./ipBlocking.js";

// Simple in-memory rate limiter
// In production, consider using Redis for distributed rate limiting
const requestCounts = new Map();

/**
 * Rate limiter middleware
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds (default: 1 minute)
 * @param {number} options.maxRequests - Maximum requests per window (default: 60)
 * @param {string} options.message - Error message (default: "Too many requests")
 */
export const rateLimiter = (options = {}) => {
  const {
    windowMs = 60 * 1000, // 1 minute
    maxRequests = 60, // 60 requests per minute
    message = "Too many requests, please try again later"
  } = options;

  return (req, res, next) => {
    // Get client identifier (IP address) - use same method as IP blocking
    const clientId = getClientIP(req);
    
    // Check if IP is blocked first (before rate limiting)
    // If blocked, let IP blocking middleware handle it (it will return 403)
    const blockStatus = isBlocked(clientId);
    if (blockStatus.isBlocked) {
      // IP is blocked, skip rate limiting and let IP blocking middleware handle it
      // This ensures blocked IPs get 403 instead of 429
      console.log(`[RateLimiter] IP ${clientId} is blocked, skipping rate limiting (IP blocking middleware will handle)`);
      return next();
    }
    
    // Debug: Log every request to verify middleware is being called
    console.log(`[RateLimiter] Processing request from ${clientId} to ${req.method} ${req.path}, limit: ${maxRequests}/${windowMs}ms`);
    
    // Skip rate limiting for whitelisted IPs
    if (isWhitelisted(clientId)) {
      console.log(`[RateLimiter] Skipping rate limit for whitelisted IP: ${clientId}`);
      Logger.info(`[RateLimiter] Skipping rate limit for whitelisted IP: ${clientId}`);
      return next();
    }
    
    const now = Date.now();

    // Clean up old entries (older than windowMs)
    if (requestCounts.has(clientId)) {
      const { count, resetTime } = requestCounts.get(clientId);
      if (now > resetTime) {
        // Reset window
        Logger.info(`[RateLimiter] Window reset for ${clientId}, old count: ${count}`);
        requestCounts.set(clientId, { count: 1, resetTime: now + windowMs });
        return next();
      }

      // Check if limit exceeded
      if (count >= maxRequests) {
        console.log(`[RateLimiter] ⚠️ RATE LIMIT EXCEEDED for ${clientId}: ${count}/${maxRequests}`);
        Logger.warn(`[RateLimiter] Rate limit exceeded for ${clientId}`, {
          ip: clientId,
          count,
          maxRequests,
          resetTime: new Date(resetTime).toISOString(),
          remainingTime: Math.ceil((resetTime - now) / 1000)
        });

        // Record violation for auto-blocking
        recordViolation(clientId, `Rate limit exceeded: ${count}/${maxRequests} requests`);

        return res.status(429).json({
          success: false,
          error: message,
          retryAfter: Math.ceil((resetTime - now) / 1000) // seconds
        });
      }

      // Increment count
      const newCount = count + 1;
      requestCounts.set(clientId, { count: newCount, resetTime });
      console.log(`[RateLimiter] Request ${newCount}/${maxRequests} for ${clientId} (path: ${req.path})`);
      Logger.info(`[RateLimiter] Request ${newCount}/${maxRequests} for ${clientId} (path: ${req.path})`);
    } else {
      // First request
      requestCounts.set(clientId, { count: 1, resetTime: now + windowMs });
      console.log(`[RateLimiter] First request for ${clientId} (path: ${req.path}), window expires at ${new Date(now + windowMs).toISOString()}, limit: ${maxRequests}/${windowMs}ms`);
      Logger.info(`[RateLimiter] First request for ${clientId} (path: ${req.path}), window expires at ${new Date(now + windowMs).toISOString()}, limit: ${maxRequests}/${windowMs}ms`);
    }

    next();
  };
};

/**
 * Strict rate limiter for sensitive endpoints (login, password reset, etc.)
 * More restrictive than regular rate limiter
 * In development, allows more requests for testing
 */
export const strictRateLimit = (options = {}) => {
  const isDevelopment = process.env.NODE_ENV !== "production";

  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxRequests = isDevelopment ? 20 : 20, // Allow 20 requests per 15 minutes
    message = "Too many login attempts. Please try again later."
  } = options;

  return rateLimiter({
    windowMs,
    maxRequests,
    message
  });
};

/**
 * Cleanup old entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [clientId, { resetTime }] of requestCounts.entries()) {
    if (now > resetTime) {
      requestCounts.delete(clientId);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes
