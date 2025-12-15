import express from 'express';
import { executeQuery } from '../config/database.js';
import { sanitizeObject } from '../utils/sanitize.js';
import Logger from '../utils/logger.js';
import { handleErrorWithFormat } from '../utils/errorHandler.js';
import { formatResponse } from '../utils/helpers.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { validateRequest } from '../middleware/requestValidator.js';
import { requireAuth } from './auth.js';

const router = express.Router();

// Get allowed origins and referers from environment
const allowedOrigins = [];
if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL);
}
if (process.env.BACKEND_URL) {
  allowedOrigins.push(process.env.BACKEND_URL);
}
// Always allow localhost for development
allowedOrigins.push("http://localhost:3000", "http://localhost:5173");

const allowedReferers = [];
if (process.env.CLIENT_URL) {
  allowedReferers.push(process.env.CLIENT_URL);
}
if (process.env.BACKEND_URL) {
  allowedReferers.push(process.env.BACKEND_URL);
}
// Always allow localhost for development
allowedReferers.push("http://localhost:3000", "http://localhost:5173");

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Get global settings (public, sensitive fields excluded)
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     website_name:
 *                       type: string
 *                     logo_url:
 *                       type: string
 *                     maintenance_mode:
 *                       type: boolean
 *                     enable_ai_seo:
 *                       type: boolean
 *       429:
 *         description: Rate limit exceeded
 */
// Get global settings (public endpoint for client)
// Apply rate limiting and request validation
router.get('/',
  rateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }), // 30 requests per minute
  validateRequest({
    allowedOrigins,
    requireReferer: process.env.NODE_ENV === 'production', // Only require in production
    allowedReferers,
    allowNoReferer: true // Allow direct browser access
  }),
  async (req, res) => {
  try {
    // Try to get all columns including SEO settings
    // If SEO columns don't exist, they will be null (graceful fallback)
    let result;
    try {
      result = await executeQuery(`
        SELECT 
          id, website_name, logo_url, logo_backend_url, logo_client_url,
          maintenance_mode, version,
          min_search_results, min_commission_rate, min_rating_star,
          site_url, sitemap_url, meta_description, meta_keywords, meta_title_template,
          og_image_url, og_title, og_description, twitter_handle,
          enable_ai_seo, ai_seo_language, canonical_url, robots_meta,
          created_at, updated_at
        FROM settings WHERE id = 1
      `);
    } catch (error) {
      // If SEO columns don't exist, fallback to basic columns
      if (error.code === 'ER_BAD_FIELD_ERROR') {
        Logger.warn('SEO columns not found, using basic columns. Please check database schema.');
        try {
          result = await executeQuery(`
            SELECT 
              id, website_name, logo_url, logo_backend_url, logo_client_url,
              maintenance_mode, version,
              min_search_results, min_commission_rate, min_rating_star,
              site_url, sitemap_url, meta_description, meta_keywords, meta_title_template,
              og_image_url, og_title, og_description, twitter_handle,
              enable_ai_seo, ai_seo_language, canonical_url, robots_meta,
              created_at, updated_at
            FROM settings WHERE id = 1
          `);
        } catch (fallbackError) {
          // If even basic SEO columns don't exist, use minimal columns
          result = await executeQuery(`
            SELECT 
              id, website_name, logo_url, logo_backend_url, logo_client_url,
              maintenance_mode, version,
              min_search_results, min_commission_rate, min_rating_star,
              created_at, updated_at
            FROM settings WHERE id = 1
          `);
        }
      } else {
        throw error;
      }
    }
    if (result.success && result.data.length > 0) {
      // Convert maintenance_mode to boolean if needed, though executeQuery helper might handle it if typed?
      // MySQL boolean is 0 or 1.
      const settings = result.data[0];
      settings.maintenance_mode = !!settings.maintenance_mode;
      // Convert enable_ai_seo to boolean if it exists
      if (settings.enable_ai_seo !== undefined) {
        settings.enable_ai_seo = !!settings.enable_ai_seo;
      }
      res.json({ success: true, data: settings });
    } else {
      // Initialize if missing
      await executeQuery("INSERT IGNORE INTO settings (id, website_name, maintenance_mode) VALUES (1, 'My Website', FALSE)");
      let newResult;
      try {
        newResult = await executeQuery(`
          SELECT 
            id, website_name, logo_url, logo_backend_url, logo_client_url,
            maintenance_mode, version,
            min_search_results, min_commission_rate, min_rating_star,
            site_url, sitemap_url, meta_description, meta_keywords, meta_title_template,
            og_image_url, og_title, og_description, twitter_handle,
            enable_ai_seo, ai_seo_language, canonical_url, robots_meta,
            created_at, updated_at
          FROM settings WHERE id = 1
        `);
      } catch (error) {
        // If SEO columns don't exist, fallback to basic columns
        if (error.code === 'ER_BAD_FIELD_ERROR') {
          try {
            newResult = await executeQuery(`
              SELECT 
                id, website_name, logo_url, logo_backend_url, logo_client_url,
                maintenance_mode, version,
                min_search_results, min_commission_rate, min_rating_star,
                site_url, sitemap_url, meta_description, meta_keywords, meta_title_template,
                og_image_url, og_title, og_description, twitter_handle,
                enable_ai_seo, ai_seo_language, canonical_url, robots_meta,
                created_at, updated_at
              FROM settings WHERE id = 1
            `);
          } catch (fallbackError) {
            // If even basic SEO columns don't exist, use minimal columns
            newResult = await executeQuery(`
              SELECT 
                id, website_name, logo_url, logo_backend_url, logo_client_url,
                maintenance_mode, version,
                min_search_results, min_commission_rate, min_rating_star,
                created_at, updated_at
              FROM settings WHERE id = 1
            `);
          }
        } else {
          throw error;
        }
      }
      const newSettings = newResult.data[0];
      newSettings.maintenance_mode = !!newSettings.maintenance_mode;
      // Convert enable_ai_seo to boolean if it exists
      if (newSettings.enable_ai_seo !== undefined) {
        newSettings.enable_ai_seo = !!newSettings.enable_ai_seo;
      }
      res.json({ success: true, data: newSettings });
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve settings", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/settings:
 *   put:
 *     summary: Update global settings (admin only)
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               website_name:
 *                 type: string
 *               logo_url:
 *                 type: string
 *               maintenance_mode:
 *                 type: boolean
 *               gemini_api_key:
 *                 type: string
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
// Update global settings (requires authentication and admin role)
router.put('/', requireAuth, async (req, res) => {
  // Check if user is admin
  const role = req.user?.role?.toLowerCase();
  if (!req.user || !["admin", "super admin"].includes(role)) {
    return res.status(403).json(formatResponse(false, null, "Admin access required"));
  }
  // Sanitize input
  req.body = sanitizeObject(req.body);
  const { 
    website_name, 
    logo_url, 
    logo_backend_url, 
    logo_client_url, 
    maintenance_mode, 
    maintenance_bypass_token, 
    version,
    min_search_results,
    min_commission_rate,
    min_rating_star,
    // SEO Settings
    site_url,
    sitemap_url,
    meta_description,
    meta_keywords,
    meta_title_template,
    og_image_url,
    og_title,
    og_description,
    twitter_handle,
    google_verification_code,
    bing_verification_code,
    enable_ai_seo,
    gemini_api_key,
    ai_seo_language,
    canonical_url,
    robots_meta
  } = req.body;
  
  try {
    // Build query dynamically based on provided fields
    const updates = [];
    const params = [];

    if (website_name !== undefined) {
      updates.push('website_name = ?');
      params.push(website_name);
    }
    if (logo_url !== undefined) {
      updates.push('logo_url = ?');
      params.push(logo_url);
    }
    if (logo_backend_url !== undefined) {
      updates.push('logo_backend_url = ?');
      params.push(logo_backend_url);
    }
    if (logo_client_url !== undefined) {
      updates.push('logo_client_url = ?');
      params.push(logo_client_url);
    }
    if (maintenance_mode !== undefined) {
      updates.push('maintenance_mode = ?');
      params.push(maintenance_mode ? 1 : 0);
    }
    if (maintenance_bypass_token !== undefined) {
      updates.push('maintenance_bypass_token = ?');
      params.push(maintenance_bypass_token);
    }
    if (version !== undefined) {
        updates.push('version = ?');
        params.push(version);
    }
    if (min_search_results !== undefined) {
      updates.push('min_search_results = ?');
      params.push(parseInt(min_search_results) || 10);
    }
    if (min_commission_rate !== undefined) {
      updates.push('min_commission_rate = ?');
      params.push(parseFloat(min_commission_rate) || 10.00);
    }
    if (min_rating_star !== undefined) {
      updates.push('min_rating_star = ?');
      params.push(parseFloat(min_rating_star) || 4.5);
    }

    // SEO Settings
    if (site_url !== undefined) {
      updates.push('site_url = ?');
      params.push(site_url);
    }
    if (sitemap_url !== undefined) {
      updates.push('sitemap_url = ?');
      params.push(sitemap_url);
    }
    if (meta_description !== undefined) {
      updates.push('meta_description = ?');
      params.push(meta_description);
    }
    if (meta_keywords !== undefined) {
      updates.push('meta_keywords = ?');
      params.push(meta_keywords);
    }
    if (meta_title_template !== undefined) {
      updates.push('meta_title_template = ?');
      params.push(meta_title_template);
    }
    if (og_image_url !== undefined) {
      updates.push('og_image_url = ?');
      params.push(og_image_url);
    }
    if (og_title !== undefined) {
      updates.push('og_title = ?');
      params.push(og_title);
    }
    if (og_description !== undefined) {
      updates.push('og_description = ?');
      params.push(og_description);
    }
    if (twitter_handle !== undefined) {
      // Validate Twitter handle format (optional @, alphanumeric and underscore)
      const twitterRegex = /^@?[a-zA-Z0-9_]{1,15}$/;
      if (twitter_handle && !twitterRegex.test(twitter_handle)) {
        return res.status(400).json({ success: false, message: 'Invalid Twitter handle format' });
      }
      updates.push('twitter_handle = ?');
      params.push(twitter_handle);
    }
    if (google_verification_code !== undefined) {
      updates.push('google_verification_code = ?');
      params.push(google_verification_code);
    }
    if (bing_verification_code !== undefined) {
      updates.push('bing_verification_code = ?');
      params.push(bing_verification_code);
    }
    if (enable_ai_seo !== undefined) {
      updates.push('enable_ai_seo = ?');
      params.push(enable_ai_seo ? 1 : 0);
    }
    if (gemini_api_key !== undefined) {
      updates.push('gemini_api_key = ?');
      params.push(gemini_api_key || null);
    }
    if (ai_seo_language !== undefined) {
      // Validate language (th or en)
      if (!['th', 'en'].includes(ai_seo_language)) {
        return res.status(400).json({ success: false, message: 'Invalid AI SEO language. Must be "th" or "en"' });
      }
      updates.push('ai_seo_language = ?');
      params.push(ai_seo_language);
    }
    if (canonical_url !== undefined) {
      updates.push('canonical_url = ?');
      params.push(canonical_url);
    }
    if (robots_meta !== undefined) {
      updates.push('robots_meta = ?');
      params.push(robots_meta);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    params.push(1); // WHERE id = 1

    const query = `UPDATE settings SET ${updates.join(', ')} WHERE id = ?`;
    const result = await executeQuery(query, params);

    if (result.success) {
      res.json({ success: true, message: 'Settings updated successfully' });
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update settings", 500, formatResponse);
  }
});

export default router;

