import Logger from "../utils/logger.js";

/**
 * Validate request origin and referer
 * Prevents direct API access from unauthorized sources
 */
export const validateRequest = (options = {}) => {
  const {
    allowedOrigins = [],
    requireReferer = true,
    allowedReferers = [],
    allowNoReferer = false // Allow requests with no referer (e.g., direct browser access)
  } = options;

  return (req, res, next) => {
    const origin = req.headers.origin;
    const referer = req.headers.referer || req.headers.referrer;
    const userAgent = req.headers['user-agent'];
    
    // Check origin
    if (origin && allowedOrigins.length > 0) {
      if (!allowedOrigins.includes(origin)) {
        Logger.warn(`Invalid origin: ${origin}`, {
          ip: req.ip,
          origin,
          referer,
          userAgent
        });
        return res.status(403).json({
          success: false,
          error: "Forbidden: Invalid origin"
        });
      }
    }
    
    // Check referer (if required)
    if (requireReferer) {
      if (!referer && !allowNoReferer) {
        Logger.warn(`Missing referer header`, {
          ip: req.ip,
          origin,
          userAgent
        });
        return res.status(403).json({
          success: false,
          error: "Forbidden: Missing referer"
        });
      }
      
      if (referer && allowedReferers.length > 0) {
        const isValidReferer = allowedReferers.some(allowed => 
          referer.startsWith(allowed)
        );
        
        if (!isValidReferer) {
          Logger.warn(`Invalid referer: ${referer}`, {
            ip: req.ip,
            origin,
            referer,
            userAgent
          });
          return res.status(403).json({
            success: false,
            error: "Forbidden: Invalid referer"
          });
        }
      }
    }
    
    // Check for suspicious patterns (e.g., curl, wget, postman without proper headers)
    if (userAgent) {
      const suspiciousPatterns = [
        /^curl/i,
        /^wget/i,
        /^python-requests/i,
        /^Postman/i,
        /^insomnia/i
      ];
      
      const isSuspicious = suspiciousPatterns.some(pattern => 
        pattern.test(userAgent)
      );
      
      if (isSuspicious && !origin && !referer) {
        Logger.warn(`Suspicious request detected`, {
          ip: req.ip,
          userAgent,
          origin,
          referer
        });
        return res.status(403).json({
          success: false,
          error: "Forbidden: Unauthorized access method"
        });
      }
    }
    
    next();
  };
};

