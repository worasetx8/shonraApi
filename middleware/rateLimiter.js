import Logger from "../utils/logger.js";

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
    // Get client identifier (IP address or user ID)
    const clientId = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();

    // Clean up old entries (older than windowMs)
    if (requestCounts.has(clientId)) {
      const { count, resetTime } = requestCounts.get(clientId);
      if (now > resetTime) {
        // Reset window
        requestCounts.set(clientId, { count: 1, resetTime: now + windowMs });
        return next();
      }

      // Check if limit exceeded
      if (count >= maxRequests) {
        Logger.warn(`Rate limit exceeded for ${clientId}`, {
          ip: clientId,
          count,
          maxRequests,
          resetTime: new Date(resetTime).toISOString()
        });

        return res.status(429).json({
          success: false,
          error: message,
          retryAfter: Math.ceil((resetTime - now) / 1000) // seconds
        });
      }

      // Increment count
      requestCounts.set(clientId, { count: count + 1, resetTime });
    } else {
      // First request
      requestCounts.set(clientId, { count: 1, resetTime: now + windowMs });
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
