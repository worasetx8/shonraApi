import Logger from '../utils/logger.js';

/**
 * Validate required environment variables
 * Throws error if any required variable is missing
 */
export const validateEnv = () => {
  const requiredEnvVars = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
  ];

  const missing = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missing.length > 0) {
    const error = `Missing required environment variables: ${missing.join(', ')}`;
    Logger.error(error);
    throw new Error(error);
  }

  // Optional but recommended
  const recommendedEnvVars = [
    'SESSION_SECRET',
    'CLIENT_URL',
    'NODE_ENV'
  ];

  const missingRecommended = recommendedEnvVars.filter(varName => !process.env[varName]);

  if (missingRecommended.length > 0) {
    Logger.warn(`Missing recommended environment variables: ${missingRecommended.join(', ')}`);
  }

  Logger.info('Environment variables validated successfully');
};

