import express from "express";
import { executeQuery } from "../config/database.js";
import { formatResponse, validateRequiredFields } from "../utils/helpers.js";
import { requireAuth } from "./auth.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";

const router = express.Router();

// Get all keywords for a category
router.get("/category/:categoryId", requireAuth, async (req, res) => {
  try {
    const { categoryId } = req.params;

    const query = `
      SELECT ck.*, c.name as category_name
      FROM category_keywords ck
      JOIN categories c ON ck.category_id = c.id
      WHERE ck.category_id = ?
      ORDER BY ck.is_high_priority DESC, ck.keyword ASC
    `;
    const result = await executeQuery(query, [categoryId]);

    if (result.success) {
      res.json(formatResponse(true, result.data, "Keywords retrieved successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve keywords", 500, formatResponse);
  }
});

// Get all keywords (for management page)
router.get("/", requireAuth, async (req, res) => {
  try {
    const { category_id, search } = req.query;

    let query = `
      SELECT ck.*, c.name as category_name, c.is_active as category_active
      FROM category_keywords ck
      JOIN categories c ON ck.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (category_id && category_id !== 'all') {
      query += ` AND ck.category_id = ?`;
      params.push(category_id);
    }

    if (search) {
      query += ` AND (ck.keyword LIKE ? OR c.name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY c.name ASC, ck.is_high_priority DESC, ck.keyword ASC`;

    const result = await executeQuery(query, params);

    if (result.success) {
      res.json(formatResponse(true, result.data || [], "Keywords retrieved successfully"));
    } else {
      // If table doesn't exist, return empty array instead of error
      if (result.error && result.error.includes("doesn't exist") || result.error.includes("Unknown table")) {
        Logger.warn("[Category Keywords] Table 'category_keywords' does not exist yet. Returning empty array.");
        return res.json(formatResponse(true, [], "Keywords retrieved successfully (table not created yet)"));
      }
      Logger.error("Get keywords query error:", result.error);
      throw new Error(result.error || "Database query failed");
    }
  } catch (error) {
    Logger.error("Get keywords error:", error);
    // If table doesn't exist, return empty array
    if (error.message && (error.message.includes("doesn't exist") || error.message.includes("Unknown table"))) {
      return res.json(formatResponse(true, [], "Keywords retrieved successfully (table not created yet)"));
    }
    res.status(500).json(formatResponse(false, null, "Failed to retrieve keywords", error.message));
  }
});

// Create keyword
router.post("/", requireAuth, async (req, res) => {
  try {
    const { category_id, keyword, is_high_priority } = req.body;

    const missing = validateRequiredFields(req.body, ["category_id", "keyword"]);
    if (missing.length > 0) {
      return res.status(400).json(formatResponse(false, null, `Missing required fields: ${missing.join(", ")}`));
    }

    // Check if category exists
    const categoryCheck = await executeQuery("SELECT id, name FROM categories WHERE id = ?", [category_id]);
    if (!categoryCheck.success || !categoryCheck.data || categoryCheck.data.length === 0) {
      return res.status(400).json(formatResponse(false, null, "Category not found"));
    }

    // Check for duplicate
    const duplicateCheck = await executeQuery(
      "SELECT id FROM category_keywords WHERE category_id = ? AND keyword = ?",
      [category_id, keyword.trim()]
    );
    if (duplicateCheck.success && duplicateCheck.data && duplicateCheck.data.length > 0) {
      return res.status(409).json(formatResponse(false, null, "Keyword already exists for this category"));
    }

    const result = await executeQuery(
      `INSERT INTO category_keywords (category_id, keyword, is_high_priority) VALUES (?, ?, ?)`,
      [category_id, keyword.trim(), is_high_priority ? 1 : 0]
    );

    if (result.success) {
      res.status(201).json(formatResponse(true, { id: result.data.insertId }, "Keyword created successfully"));
    } else {
      if (result.error && result.error.includes("Duplicate entry")) {
        return res.status(409).json(formatResponse(false, null, "Keyword already exists for this category"));
      }
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to create keyword", 500, formatResponse);
  }
});

// Update keyword
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { keyword, is_high_priority } = req.body;

    if (!keyword || !keyword.trim()) {
      return res.status(400).json(formatResponse(false, null, "Keyword is required"));
    }

    // Check if keyword exists
    const keywordCheck = await executeQuery("SELECT category_id FROM category_keywords WHERE id = ?", [id]);
    if (!keywordCheck.success || !keywordCheck.data || keywordCheck.data.length === 0) {
      return res.status(404).json(formatResponse(false, null, "Keyword not found"));
    }

    const categoryId = keywordCheck.data[0].category_id;

    // Check for duplicate (excluding current keyword)
    const duplicateCheck = await executeQuery(
      "SELECT id FROM category_keywords WHERE category_id = ? AND keyword = ? AND id != ?",
      [categoryId, keyword.trim(), id]
    );
    if (duplicateCheck.success && duplicateCheck.data && duplicateCheck.data.length > 0) {
      return res.status(409).json(formatResponse(false, null, "Keyword already exists for this category"));
    }

    const result = await executeQuery(
      `UPDATE category_keywords SET keyword = ?, is_high_priority = ? WHERE id = ?`,
      [keyword.trim(), is_high_priority ? 1 : 0, id]
    );

    if (result.success) {
      res.json(formatResponse(true, { id }, "Keyword updated successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update keyword", 500, formatResponse);
  }
});

// Delete keyword
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await executeQuery("DELETE FROM category_keywords WHERE id = ?", [id]);

    if (result.success) {
      res.json(formatResponse(true, null, "Keyword deleted successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete keyword", 500, formatResponse);
  }
});

// Bulk create keywords
router.post("/bulk", requireAuth, async (req, res) => {
  try {
    const { category_id, keywords } = req.body;

    if (!category_id || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json(formatResponse(false, null, "Category ID and keywords array are required"));
    }

    // Check if category exists
    const categoryCheck = await executeQuery("SELECT id, name FROM categories WHERE id = ?", [category_id]);
    if (!categoryCheck.success || !categoryCheck.data || categoryCheck.data.length === 0) {
      return res.status(400).json(formatResponse(false, null, "Category not found"));
    }

    let inserted = 0;
    let skipped = 0;

    for (const keywordData of keywords) {
      const keyword = typeof keywordData === 'string' ? keywordData : keywordData.keyword;
      const isHighPriority = typeof keywordData === 'object' ? (keywordData.is_high_priority || false) : false;

      if (!keyword || !keyword.trim()) continue;

      try {
        await executeQuery(
          `INSERT INTO category_keywords (category_id, keyword, is_high_priority) 
           VALUES (?, ?, ?) 
           ON DUPLICATE KEY UPDATE is_high_priority = VALUES(is_high_priority)`,
          [category_id, keyword.trim(), isHighPriority ? 1 : 0]
        );
        inserted++;
      } catch (error) {
        if (error.message && error.message.includes("Duplicate entry")) {
          skipped++;
        } else {
          Logger.error(`Failed to insert keyword "${keyword}":`, error);
        }
      }
    }

    res.json(formatResponse(true, { created: inserted, skipped }, `Bulk insert completed: ${inserted} inserted, ${skipped} skipped`));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to bulk create keywords", 500, formatResponse);
  }
});

export default router;

