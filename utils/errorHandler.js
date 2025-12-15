/**
 * Error handler utility for consistent error responses
 * Prevents information disclosure in production
 */

/**
 * Handle and format error responses
 * @param {Error} error - The error object
 * @param {Object} res - Express response object
 * @param {string} defaultMessage - Default error message
 * @param {number} statusCode - HTTP status code (default: 500)
 */
export function handleError(error, res, defaultMessage = "An error occurred", statusCode = 500) {
  const isDevelopment = process.env.NODE_ENV === "development";
  
  // Log full error details (server-side only)
  console.error("Error:", {
    message: error.message,
    stack: error.stack,
    code: error.code,
    name: error.name
  });
  
  // Return sanitized error to client
  const errorMessage = isDevelopment ? error.message : defaultMessage;
  
  return res.status(statusCode).json({
    success: false,
    message: defaultMessage,
    error: errorMessage,
    ...(isDevelopment && { 
      stack: error.stack,
      code: error.code 
    })
  });
}

/**
 * Format error response using formatResponse helper
 * @param {Error} error - The error object
 * @param {Object} res - Express response object
 * @param {string} defaultMessage - Default error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {Function} formatResponse - formatResponse function from helpers
 */
export function handleErrorWithFormat(error, res, defaultMessage, statusCode = 500, formatResponse) {
  const isDevelopment = process.env.NODE_ENV === "development";
  
  // Log full error details (server-side only)
  console.error("Error:", {
    message: error.message,
    stack: error.stack,
    code: error.code,
    name: error.name
  });
  
  // Return sanitized error to client
  const errorMessage = isDevelopment ? error.message : `${defaultMessage}. Please try again.`;
  
  return res.status(statusCode).json(
    formatResponse(false, null, defaultMessage, errorMessage)
  );
}

