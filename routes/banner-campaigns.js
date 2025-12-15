import express from "express";
import { executeQuery } from "../config/database.js";
import { formatResponse } from "../utils/helpers.js";
import { requireAuth } from "./auth.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";

const router = express.Router();

// Get all campaigns
router.get("/", requireAuth, async (req, res) => {
  try {
    // Auto-update status if end_time passed? 
    // Requirement: "if Campaign End Date–Time chang status inactive"
    // Let's update status for expired campaigns first
    await executeQuery(`
        UPDATE banner_campaigns 
        SET is_active = 0 
        WHERE end_time < NOW() AND is_active = 1
    `);

    const query = `
      SELECT bc.*, COUNT(b.id) as banner_count 
      FROM banner_campaigns bc
      LEFT JOIN banners b ON bc.id = b.campaign_id
      GROUP BY bc.id
      ORDER BY bc.created_at DESC
    `;
    const result = await executeQuery(query);

    if (result.success) {
      res.json(formatResponse(true, result.data, "Campaigns retrieved successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve campaigns", 500, formatResponse);
  }
});

// Create campaign
router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, start_time, end_time } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json(formatResponse(false, null, "Campaign name is required"));
    }

    // Validate dates if provided
    // Assuming dates are ISO strings or timestamps
    const result = await executeQuery(
      "INSERT INTO banner_campaigns (name, start_time, end_time, is_active) VALUES (?, ?, ?, 1)",
      [name.trim(), start_time || null, end_time || null]
    );

    if (result.success) {
      res.status(201).json(formatResponse(true, { id: result.data.insertId, name, start_time, end_time, is_active: 1, banner_count: 0 }, "Campaign created successfully"));
    } else {
      if (result.error && result.error.includes("Duplicate entry")) {
        return res.status(409).json(formatResponse(false, null, "Campaign name already exists"));
      }
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to create campaign", 500, formatResponse);
  }
});

// Update campaign
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_time, end_time } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json(formatResponse(false, null, "Campaign name is required"));
    }

    const result = await executeQuery(
      "UPDATE banner_campaigns SET name = ?, start_time = ?, end_time = ? WHERE id = ?",
      [name.trim(), start_time || null, end_time || null, id]
    );

    if (result.success) {
      res.json(formatResponse(true, { id, name, start_time, end_time }, "Campaign updated successfully"));
    } else {
      if (result.error && result.error.includes("Duplicate entry")) {
        return res.status(409).json(formatResponse(false, null, "Campaign name already exists"));
      }
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update campaign", 500, formatResponse);
  }
});

// Toggle status
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (!is_active) {
        // Check if banners are linked before deactivating
        const checkResult = await executeQuery(
            "SELECT COUNT(*) as count FROM banners WHERE campaign_id = ?",
            [id]
        );
        
        if (checkResult.success && checkResult.data[0].count > 0) {
            return res.status(400).json(formatResponse(false, null, "Cannot deactivate campaign with linked banners"));
        }
    }

    const result = await executeQuery(
      "UPDATE banner_campaigns SET is_active = ? WHERE id = ?",
      [is_active ? 1 : 0, id]
    );

    if (result.success) {
      res.json(formatResponse(true, { id, is_active }, "Campaign status updated successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update campaign status", 500, formatResponse);
  }
});

// Delete campaign
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await executeQuery(
      "SELECT COUNT(*) as count FROM banners WHERE campaign_id = ?",
      [id]
    );

    if (checkResult.success && checkResult.data[0].count > 0) {
      return res.status(400).json(formatResponse(false, null, "Cannot delete campaign with linked banners"));
    }

    const result = await executeQuery(
      "DELETE FROM banner_campaigns WHERE id = ?",
      [id]
    );

    if (result.success) {
      res.json(formatResponse(true, null, "Campaign deleted successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete campaign", 500, formatResponse);
  }
});

export default router;

