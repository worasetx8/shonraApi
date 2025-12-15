import crypto from "crypto";
import Logger from "./logger.js";

/**
 * Generate signature based on working example
 */
export function generateSignature({ appId, timestamp, payload, secret }) {
  // Concatenate values exactly as shown in example
  const factor = appId + timestamp + payload + secret;

  if (process.env.DEBUG === "true") {
    Logger.debug("=== Signature Generation Debug ===");
    Logger.debug("Factor components:");
    Logger.debug("1. App ID:", appId);
    Logger.debug("2. Timestamp:", timestamp);
    Logger.debug("3. Payload:", payload);
    Logger.debug("4. Secret length:", secret.length);
    Logger.debug("Final factor string:", factor);
  }

  // Create SHA256 hash
  const signature = crypto.createHash("sha256").update(factor).digest("hex");

  if (process.env.DEBUG === "true") {
    Logger.debug("Generated signature:", signature);
    Logger.debug("===============================");
  }

  return signature;
}

/**
 * Create authorization header based on working example
 */
export function createAuthorizationHeader({ appId, timestamp, signature }) {
  return `SHA256 Credential=${appId},Timestamp=${timestamp},Signature=${signature}`;
}

/**
 * Format API response consistently
 */
export function formatResponse(success, data = null, message = "", error = null) {
  return {
    success,
    data,
    message,
    error,
    timestamp: new Date().toISOString()
  };
}

/**
 * Validate required fields in request body
 */
export function validateRequiredFields(body, requiredFields) {
  const missing = [];

  for (const field of requiredFields) {
    if (!body[field] && body[field] !== 0 && body[field] !== false) {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Generate pagination info
 */
export function generatePagination(page, limit, totalCount) {
  const totalPages = Math.ceil(totalCount / limit);
  const offset = (page - 1) * limit;

  return {
    currentPage: page,
    totalPages,
    totalCount,
    limit,
    offset,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
}
