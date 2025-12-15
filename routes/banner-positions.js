import express from "express";
import { executeQuery } from "../config/database.js";
import { formatResponse } from "../utils/helpers.js";
import { requireAuth } from "./auth.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";

const router = express.Router();

// Get all positions
router.get("/", requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT bp.*, COUNT(b.id) as banner_count 
      FROM banner_positions bp
      LEFT JOIN banners b ON bp.id = b.position_id
      GROUP BY bp.id
      ORDER BY bp.name ASC
    `;
    const result = await executeQuery(query);

    if (result.success) {
      res.json(formatResponse(true, result.data, "Positions retrieved successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve positions", 500, formatResponse);
  }
});

// Create position
router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, width, height } = req.body;

    if (!name || !name.trim() || !width || !height) {
      return res.status(400).json(formatResponse(false, null, "Name, width, and height are required"));
    }

    const result = await executeQuery(
      "INSERT INTO banner_positions (name, width, height, is_active) VALUES (?, ?, ?, 1)",
      [name.trim(), width, height]
    );

    if (result.success) {
      res.status(201).json(formatResponse(true, { id: result.data.insertId, name, width, height, is_active: 1, banner_count: 0 }, "Position created successfully"));
    } else {
      if (result.error && result.error.includes("Duplicate entry")) {
        return res.status(409).json(formatResponse(false, null, "Position name already exists"));
      }
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to create position", 500, formatResponse);
  }
});

// Update position
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, width, height } = req.body;

    if (!name || !name.trim() || !width || !height) {
      return res.status(400).json(formatResponse(false, null, "Name, width, and height are required"));
    }

    const result = await executeQuery(
      "UPDATE banner_positions SET name = ?, width = ?, height = ? WHERE id = ?",
      [name.trim(), width, height, id]
    );

    if (result.success) {
      res.json(formatResponse(true, { id, name, width, height }, "Position updated successfully"));
    } else {
      if (result.error && result.error.includes("Duplicate entry")) {
        return res.status(409).json(formatResponse(false, null, "Position name already exists"));
      }
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update position", 500, formatResponse);
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
            "SELECT COUNT(*) as count FROM banners WHERE position_id = ?",
            [id]
        );
        
        if (checkResult.success && checkResult.data[0].count > 0) {
            return res.status(400).json(formatResponse(false, null, "Cannot deactivate position with linked banners"));
        }
    }

    const result = await executeQuery(
      "UPDATE banner_positions SET is_active = ? WHERE id = ?",
      [is_active ? 1 : 0, id]
    );

    if (result.success) {
      res.json(formatResponse(true, { id, is_active }, "Position status updated successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update position status", 500, formatResponse);
  }
});

// Delete position
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await executeQuery(
      "SELECT COUNT(*) as count FROM banners WHERE position_id = ?",
      [id]
    );

    if (checkResult.success && checkResult.data[0].count > 0) {
      return res.status(400).json(formatResponse(false, null, "Cannot delete position with linked banners"));
    }

    const result = await executeQuery(
      "DELETE FROM banner_positions WHERE id = ?",
      [id]
    );

    if (result.success) {
      res.json(formatResponse(true, null, "Position deleted successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete position", 500, formatResponse);
  }
});

export default router;

