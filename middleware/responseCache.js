import Logger from "../utils/logger.js";

/**
 * Simple in-memory response cache middleware
 * For production, consider using Redis for distributed caching
 */
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes default

/**
 * Response cache middleware
 * @param {Object} options - Cache options
 * @param {number} options.ttl - Time to live in milliseconds (default: 5 minutes)
 * @param {Function} options.keyGenerator - Function to generate cache key from request
 * @param {Function} options.shouldCache - Function to determine if response should be cached
 */
export const responseCache = (options = {}) => {
  const {
    ttl = CACHE_TTL,
    keyGenerator = (req) => `${req.method}:${req.originalUrl}`,
    shouldCache = (req, res) => {
      // Only cache GET requests with 200 status
      return req.method === "GET" && res.statusCode === 200;
    }
  } = options;

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      return next();
    }

    const cacheKey = keyGenerator(req);
    const cached = cache.get(cacheKey);

    // Check if cached entry exists and is still valid
    if (cached && Date.now() < cached.expiresAt) {
      Logger.debug(`Cache HIT: ${cacheKey}`);
      res.setHeader("X-Cache", "HIT");
      return res.json(cached.data);
    }

    // If expired, remove from cache
    if (cached && Date.now() >= cached.expiresAt) {
      cache.delete(cacheKey);
      Logger.debug(`Cache EXPIRED: ${cacheKey}`);
    }

    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to cache response
    res.json = function (data) {
      // Only cache if shouldCache returns true
      if (shouldCache(req, res)) {
        cache.set(cacheKey, {
          data,
          expiresAt: Date.now() + ttl,
          createdAt: Date.now()
        });
        res.setHeader("X-Cache", "MISS");
        Logger.debug(`Cache SET: ${cacheKey} (TTL: ${ttl}ms)`);
      }

      // Call original json method
      return originalJson(data);
    };

    next();
  };
};

/**
 * Clear cache by pattern or all
 * @param {string} pattern - Pattern to match cache keys (optional)
 */
export const clearCache = (pattern = null) => {
  if (!pattern) {
    cache.clear();
    Logger.info("Cache cleared: all entries");
    return;
  }

  let cleared = 0;
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
      cleared++;
    }
  }
  Logger.info(`Cache cleared: ${cleared} entries matching "${pattern}"`);
};

/**
 * Cleanup expired cache entries periodically
 */
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of cache.entries()) {
    if (now >= value.expiresAt) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    Logger.debug(`Cache cleanup: removed ${cleaned} expired entries`);
  }
}, 60 * 1000); // Clean up every minute

export default responseCache;

