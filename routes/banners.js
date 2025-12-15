import express from "express";
import { executeQuery } from "../config/database.js";
import { formatResponse } from "../utils/helpers.js";
import { requireAuth } from "./auth.js";
import { sanitizeObject } from "../utils/sanitize.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { validateRequest } from "../middleware/requestValidator.js";

const router = express.Router();

// Get allowed origins and referers from environment
const allowedOrigins = process.env.CLIENT_URL 
  ? [process.env.CLIENT_URL, "http://localhost:3000"]
  : ["http://localhost:3000"];

const allowedReferers = process.env.CLIENT_URL
  ? [process.env.CLIENT_URL, "http://localhost:3000"]
  : ["http://localhost:3000"];

// Cache TTL: 5 minutes
const CACHE_TTL = 5 * 60 * 1000;

// Helper function to clear banners cache
const clearBannersCache = () => {
  cache.clearPattern('banners:');
  Logger.debug('Banners cache cleared');
};

// Get all banners
router.get("/", requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT 
        b.id, b.position_id, b.campaign_id, b.image_url, b.target_url, b.alt_text, 
        b.title, b.description, b.sort_order, b.start_time, b.end_time, 
        b.open_new_tab, b.is_active, b.created_at, b.updated_at,
        bp.name as position_name, bp.width, bp.height, 
        bc.name as campaign_name, bc.start_time as campaign_start, 
        bc.end_time as campaign_end, bc.is_active as campaign_active
      FROM banners b
      JOIN banner_positions bp ON b.position_id = bp.id
      LEFT JOIN banner_campaigns bc ON b.campaign_id = bc.id
      ORDER BY b.created_at DESC
    `;
    const result = await executeQuery(query);

    if (result.success) {
      res.json(formatResponse(true, result.data, "Banners retrieved successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve banners", 500, formatResponse);
  }
});

// Create banner
router.post("/", requireAuth, async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const { 
      position_id, 
      campaign_id, 
      image_url, 
      target_url, 
      alt_text, 
      title, 
      description, 
      sort_order,
      start_time, 
      end_time, 
      open_new_tab 
    } = req.body;

    if (!position_id || !image_url) {
      return res.status(400).json(formatResponse(false, null, "Position and Image are required"));
    }

    // If campaign_id is provided, start/end time should be null (handled by campaign)
    // But we can just store them as null or ignore.
    const final_start = campaign_id ? null : (start_time || null);
    const final_end = campaign_id ? null : (end_time || null);
    
    const finalSortOrder = (sort_order !== undefined && sort_order !== null) ? sort_order : 0;

    // Check for duplicate sort_order in the same position
    const checkSort = await executeQuery(
        "SELECT id FROM banners WHERE position_id = ? AND sort_order = ?",
        [position_id, finalSortOrder]
    );
    if (checkSort.success && checkSort.data.length > 0) {
        return res.status(400).json(formatResponse(false, null, `Sort order ${finalSortOrder} is already used in this position.`));
    }

    const result = await executeQuery(
      `INSERT INTO banners (
        position_id, campaign_id, image_url, target_url, alt_text, title, description, sort_order,
        start_time, end_time, open_new_tab, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        position_id, 
        campaign_id || null, 
        image_url, 
        target_url || '', 
        alt_text || '', 
        title || '', 
        description || '', 
        finalSortOrder,
        final_start, 
        final_end, 
        open_new_tab ? 1 : 0
      ]
    );

    if (result.success) {
      res.status(201).json(formatResponse(true, { id: result.data.insertId }, "Banner created successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to create banner", 500, formatResponse);
  }
});

// Update banner
router.put("/:id", requireAuth, async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const { id } = req.params;
    const { 
      position_id, 
      campaign_id, 
      image_url, 
      target_url, 
      alt_text, 
      title, 
      description, 
      sort_order,
      start_time, 
      end_time, 
      open_new_tab 
    } = req.body;

    if (!position_id || !image_url) {
      return res.status(400).json(formatResponse(false, null, "Position and Image are required"));
    }

    // Check for duplicate sort_order in the same position (excluding current banner)
    const finalSortOrder = (sort_order !== undefined && sort_order !== null) ? sort_order : 0;

    const checkSort = await executeQuery(
        "SELECT id FROM banners WHERE position_id = ? AND sort_order = ? AND id != ?",
        [position_id, finalSortOrder, id]
    );
    if (checkSort.success && checkSort.data.length > 0) {
        return res.status(400).json(formatResponse(false, null, `Sort order ${finalSortOrder} is already used in this position.`));
    }

    const final_start = campaign_id ? null : (start_time || null);
    const final_end = campaign_id ? null : (end_time || null);

    const result = await executeQuery(
      `UPDATE banners SET 
        position_id = ?, campaign_id = ?, image_url = ?, target_url = ?, alt_text = ?, 
        title = ?, description = ?, sort_order = ?, start_time = ?, end_time = ?, open_new_tab = ?
       WHERE id = ?`,
      [
        position_id, 
        campaign_id || null, 
        image_url, 
        target_url || '', 
        alt_text || '', 
        title || '', 
        description || '', 
        finalSortOrder,
        final_start, 
        final_end, 
        open_new_tab ? 1 : 0,
        id
      ]
    );

    if (result.success) {
      res.json(formatResponse(true, { id }, "Banner updated successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update banner", 500, formatResponse);
  }
});

// Toggle status
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const result = await executeQuery(
      "UPDATE banners SET is_active = ? WHERE id = ?",
      [is_active ? 1 : 0, id]
    );

    if (result.success) {
      res.json(formatResponse(true, { id, is_active }, "Banner status updated successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update banner status", 500, formatResponse);
    const isDevelopment = process.env.NODE_ENV === "development";
    const errorMessage = isDevelopment ? error.message : "Failed to update banner status. Please try again.";
    res.status(500).json(formatResponse(false, null, "Failed to update banner status", errorMessage));
  }
});

// Delete banner
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await executeQuery(
      "DELETE FROM banners WHERE id = ?",
      [id]
    );

    if (result.success) {
      res.json(formatResponse(true, null, "Banner deleted successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete banner", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/banners/public/{positionName}:
 *   get:
 *     summary: Get active banner by position name (public)
 *     tags: [Banners]
 *     parameters:
 *       - in: path
 *         name: positionName
 *         required: true
 *         schema:
 *           type: string
 *         description: Banner position name
 *     responses:
 *       200:
 *         description: Banner retrieved successfully
 *       404:
 *         description: Position not found
 *       429:
 *         description: Rate limit exceeded
 */
// Public endpoint - Get active banner by position name
// Apply rate limiting and request validation
router.get("/public/:positionName",
  rateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }), // 30 requests per minute
  validateRequest({
    allowedOrigins,
    requireReferer: process.env.NODE_ENV === 'production', // Only require in production
    allowedReferers,
    allowNoReferer: true // Allow direct browser access
  }),
  async (req, res) => {
  try {
    const { positionName } = req.params;
    const decodedPositionName = decodeURIComponent(positionName);
    
    Logger.debug('[Banner API] Fetching banner for position:', decodedPositionName);
    
    // ตรวจสอบว่ามี position หรือไม่
    const checkPositionQuery = `SELECT id, name, is_active FROM banner_positions WHERE name = ?`;
    const positionResult = await executeQuery(checkPositionQuery, [decodedPositionName]);
    
    Logger.debug('[Banner API] Position check:', {
      found: positionResult.success && positionResult.data && positionResult.data.length > 0
    });
    
    if (!positionResult.success || !positionResult.data || positionResult.data.length === 0) {
      Logger.warn('[Banner API] Position not found:', decodedPositionName);
      return res.json(formatResponse(true, null, `Position "${decodedPositionName}" not found. Please create it in the backend first.`));
    }
    
    const position = positionResult.data[0];
    if (!position.is_active) {
      Logger.warn('[Banner API] Position is inactive:', decodedPositionName);
      return res.json(formatResponse(true, null, `Position "${decodedPositionName}" is inactive.`));
    }
    
    // ตรวจสอบว่ามี banner หรือไม่ (ไม่เช็คเวลา)
    const checkBannerQuery = `
      SELECT COUNT(*) as count 
      FROM banners 
      WHERE position_id = ? AND is_active = 1
    `;
    const bannerCountResult = await executeQuery(checkBannerQuery, [position.id]);
    Logger.debug('[Banner API] Banner count:', bannerCountResult.data?.[0]?.count || 0);
    
    // Query แบบยืดหยุ่น: ไม่เช็คเวลา ถ้ายังไม่มี banner
    // ถ้ามี banner หลายตัว ให้เลือกตัวที่ active และอยู่ในช่วงเวลาที่ถูกต้อง
    const query = `
      SELECT 
        b.id,
        b.image_url,
        b.target_url,
        b.alt_text,
        b.title,
        b.description,
        b.sort_order,
        b.open_new_tab,
        b.start_time,
        b.end_time,
        b.campaign_id,
        bc.start_time as campaign_start,
        bc.end_time as campaign_end,
        bc.is_active as campaign_active,
        bp.name as position_name
      FROM banners b
      JOIN banner_positions bp ON b.position_id = bp.id
      LEFT JOIN banner_campaigns bc ON b.campaign_id = bc.id
      WHERE 
        bp.name = ?
        AND bp.is_active = 1
        AND b.is_active = 1
        AND (
          -- กรณีมี campaign: เช็ค campaign status และเวลา
          (b.campaign_id IS NOT NULL 
            AND bc.is_active = 1
            AND (bc.start_time IS NULL OR bc.start_time <= NOW())
            AND (bc.end_time IS NULL OR bc.end_time >= NOW()))
          OR
          -- กรณีไม่มี campaign: เช็ค banner time (ถ้าไม่มีเวลา = แสดงได้เลย)
          (b.campaign_id IS NULL
            AND (b.start_time IS NULL OR b.start_time <= NOW())
            AND (b.end_time IS NULL OR b.end_time >= NOW()))
        )
      ORDER BY b.sort_order ASC, b.created_at DESC
    `;
    
    // Ensure query doesn't have LIMIT 1 (remove if exists)
    // Remove LIMIT clause from anywhere in the query - handle multiline and various formats
    let cleanQuery = query;
    
    // Remove LIMIT clause if exists (for multiple banners support)
    const hasLimitBefore = /LIMIT\s+\d+/i.test(cleanQuery);
    if (hasLimitBefore) {
      Logger.debug('[Banner API] Found LIMIT in query, removing...');
      cleanQuery = cleanQuery.replace(/\s+LIMIT\s+\d+\s*$/im, '');
      cleanQuery = cleanQuery.replace(/\s+LIMIT\s+\d+/gi, '');
      cleanQuery = cleanQuery.replace(/LIMIT\s+\d+/gi, '');
      cleanQuery = cleanQuery.trim();
    }
    
    const hasLimitAfter = /LIMIT\s+\d+/i.test(cleanQuery);
    if (hasLimitAfter) {
      Logger.warn('[Banner API] WARNING: LIMIT still exists in query after cleaning!');
    }
    
    const result = await executeQuery(cleanQuery, [decodedPositionName]);
    
    Logger.debug('[Banner API] Query result:', {
      success: result.success,
      dataLength: result.data?.length || 0
    });
    
    // ถ้าไม่พบ banner ที่เข้าเงื่อนไขเวลา → ลองหา banner ที่ active โดยไม่เช็คเวลา
    if (result.success && (!result.data || result.data.length === 0)) {
      Logger.debug('[Banner API] No banner found with time check, trying without time check...');
      const fallbackQuery = `
        SELECT 
          b.id,
          b.image_url,
          b.target_url,
          b.alt_text,
          b.title,
          b.description,
          b.sort_order,
          b.open_new_tab,
          b.start_time,
          b.end_time,
          b.campaign_id,
          bc.start_time as campaign_start,
          bc.end_time as campaign_end,
          bc.is_active as campaign_active,
          bp.name as position_name
        FROM banners b
        JOIN banner_positions bp ON b.position_id = bp.id
        LEFT JOIN banner_campaigns bc ON b.campaign_id = bc.id
        WHERE 
          bp.name = ?
          AND bp.is_active = 1
          AND b.is_active = 1
        ORDER BY b.sort_order ASC, b.created_at DESC
      `;
      
      // Ensure query doesn't have LIMIT 1 (remove if exists)
      // Remove LIMIT clause from anywhere in the query - handle multiline and various formats
      let cleanFallbackQuery = fallbackQuery;
      // Remove LIMIT at end of query (with newlines)
      cleanFallbackQuery = cleanFallbackQuery.replace(/\s+LIMIT\s+\d+\s*$/im, '');
      // Remove LIMIT anywhere in query (case insensitive)
      cleanFallbackQuery = cleanFallbackQuery.replace(/\s+LIMIT\s+\d+/gi, '');
      cleanFallbackQuery = cleanFallbackQuery.trim();
      
      const fallbackResult = await executeQuery(cleanFallbackQuery, [decodedPositionName]);
      
      Logger.debug('[Banner API] Fallback query result:', {
        success: fallbackResult.success,
        dataLength: fallbackResult.data?.length || 0
      });
      
      if (fallbackResult.success && fallbackResult.data && fallbackResult.data.length > 0) {
        const banners = fallbackResult.data;
        Logger.success('[Banner API] Banners found (fallback, no time check):', banners.length);
        
        // Ensure banners is always an array
        const bannersArray = Array.isArray(banners) ? banners : [banners];
        
        // Always return as array for consistency (frontend handles both array and object)
        return res.json(formatResponse(true, bannersArray, "Banners retrieved successfully (no time restriction)"));
      }
    }
    
    if (result.success && result.data && result.data.length > 0) {
      const banners = result.data;
      Logger.success('[Banner API] Banners found:', banners.length);
      
      // Ensure banners is always an array
      const bannersArray = Array.isArray(banners) ? banners : [banners];
      
      // Always return as array for consistency (frontend handles both array and object)
      res.json(formatResponse(true, bannersArray, "Banners retrieved successfully"));
    } else {
      // ไม่พบ banner active → return null
      Logger.info('[Banner API] No active banner found for position:', decodedPositionName);
      res.json(formatResponse(true, null, "No active banner found for this position"));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve banner", 500, formatResponse);
    const errorMessage = isDevelopment ? error.message : "Failed to retrieve banner. Please try again.";
    res.status(500).json(formatResponse(false, null, "Failed to retrieve banner", errorMessage));
  }
});

export default router;
