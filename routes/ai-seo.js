/**
 * AI SEO API Routes
 * Provides endpoints for AI-powered SEO features
 */

import express from 'express';
import {
  generateMetaDescription,
  generateKeywords,
  generateImageAltText,
  optimizeContent,
} from '../services/aiSeoService.js';
import { handleErrorWithFormat } from '../utils/errorHandler.js';
import { requireAuth } from './auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * @swagger
 * /api/ai-seo/meta-description:
 *   post:
 *     summary: Generate SEO meta description
 *     tags: [AI SEO]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               type:
 *                 type: string
 *                 default: page
 *               language:
 *                 type: string
 *                 default: th
 *     responses:
 *       200:
 *         description: Meta description generated successfully
 *       400:
 *         description: Content is required
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 *       503:
 *         description: AI service is not available
 */
/**
 * POST /api/ai-seo/meta-description
 * Generate SEO meta description (requires authentication)
 */
router.post('/meta-description', 
  requireAuth,
  rateLimiter({ windowMs: 60 * 1000, maxRequests: 20 }), // 20 requests per minute
  async (req, res) => {
  try {
    const { content, type, language } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required',
      });
    }

    const description = await generateMetaDescription({
      content,
      type: type || 'page',
      language: language || 'th',
    });

    if (!description) {
      return res.status(503).json({
        success: false,
        message: 'AI service is not available',
      });
    }

    return res.json({
      success: true,
      data: {
        description,
      },
    });
  } catch (error) {
    return handleErrorWithFormat(error, res, 'Failed to generate meta description', 500);
  }
});

/**
 * POST /api/ai-seo/keywords
 * Generate keyword suggestions (requires authentication)
 */
router.post('/keywords', 
  requireAuth,
  rateLimiter({ windowMs: 60 * 1000, maxRequests: 20 }), // 20 requests per minute
  async (req, res) => {
  try {
    const { content, language, count } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required',
      });
    }

    const keywords = await generateKeywords({
      content,
      language: language || 'th',
      count: count || 10,
    });

    return res.json({
      success: true,
      data: {
        keywords,
      },
    });
  } catch (error) {
    return handleErrorWithFormat(error, res, 'Failed to generate keywords', 500);
  }
});

/**
 * POST /api/ai-seo/alt-text
 * Generate image alt text (requires authentication)
 */
router.post('/alt-text', 
  requireAuth,
  rateLimiter({ windowMs: 60 * 1000, maxRequests: 20 }), // 20 requests per minute
  async (req, res) => {
  try {
    const { imageUrl, context, language } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: 'Image URL is required',
      });
    }

    const altText = await generateImageAltText({
      imageUrl,
      context: context || '',
      language: language || 'th',
    });

    if (!altText) {
      return res.status(503).json({
        success: false,
        message: 'AI service is not available',
      });
    }

    return res.json({
      success: true,
      data: {
        altText,
      },
    });
  } catch (error) {
    return handleErrorWithFormat(error, res, 'Failed to generate alt text', 500);
  }
});

/**
 * POST /api/ai-seo/optimize
 * Optimize content for SEO (requires authentication)
 */
router.post('/optimize', 
  requireAuth,
  rateLimiter({ windowMs: 60 * 1000, maxRequests: 20 }), // 20 requests per minute
  async (req, res) => {
  try {
    const { content, targetKeywords, language } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required',
      });
    }

    const result = await optimizeContent({
      content,
      targetKeywords: targetKeywords || '',
      language: language || 'th',
    });

    if (!result) {
      return res.status(503).json({
        success: false,
        message: 'AI service is not available',
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleErrorWithFormat(error, res, 'Failed to optimize content', 500);
  }
});

export default router;


