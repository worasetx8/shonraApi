import express from "express";
import { executeQuery } from "../config/database.js";
import { formatResponse } from "../utils/helpers.js";
import { requireAuth } from "./auth.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { validateRequest } from "../middleware/requestValidator.js";
import { responseCache } from "../middleware/responseCache.js";

const router = express.Router();

// Get allowed origins and referers from environment
const allowedOrigins = process.env.CLIENT_URL 
  ? [process.env.CLIENT_URL, "http://localhost:3000"]
  : ["http://localhost:3000"];

const allowedReferers = process.env.CLIENT_URL
  ? [process.env.CLIENT_URL, "http://localhost:3000"]
  : ["http://localhost:3000"];

/**
 * @swagger
 * /api/tags/public:
 *   get:
 *     summary: Get all active tags with product counts (public)
 *     tags: [Tags]
 *     responses:
 *       200:
 *         description: Tags retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Tag'
 *       429:
 *         description: Rate limit exceeded
 */
// Get all tags with product counts (public endpoint for client)
// Apply rate limiting, caching, and request validation
router.get("/public",
  rateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }), // 30 requests per minute
  responseCache({ ttl: 5 * 60 * 1000 }), // Cache for 5 minutes
  validateRequest({
    allowedOrigins,
    requireReferer: process.env.NODE_ENV === 'production', // Only require in production
    allowedReferers,
    allowNoReferer: true // Allow direct browser access
  }),
  async (req, res) => {
  try {
    const query = `
      SELECT 
        t.id, t.name, t.is_active, t.created_at, t.updated_at,
        COUNT(DISTINCT pt.product_item_id) as product_count 
      FROM tags t 
      LEFT JOIN product_tags pt ON t.id = pt.tag_id 
      LEFT JOIN shopee_products sp ON pt.product_item_id = sp.item_id AND sp.status = 'active'
      WHERE t.is_active = 1
      GROUP BY t.id 
      ORDER BY t.name ASC
    `;
    const result = await executeQuery(query);

    if (result.success) {
      res.json(formatResponse(true, result.data, "Tags retrieved successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve tags", 500, formatResponse);
  }
});

// Get all tags with product counts (admin endpoint)
/**
 * @swagger
 * /api/tags:
 *   get:
 *     summary: Get all tags (admin)
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tags retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT 
        t.id, t.name, t.is_active, t.created_at, t.updated_at,
        COUNT(pt.product_item_id) as product_count 
      FROM tags t 
      LEFT JOIN product_tags pt ON t.id = pt.tag_id 
      GROUP BY t.id 
      ORDER BY t.name ASC
    `;
    const result = await executeQuery(query);

    if (result.success) {
      res.json(formatResponse(true, result.data, "Tags retrieved successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve tags", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags:
 *   post:
 *     summary: Create new tag
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tag created successfully
 *       400:
 *         description: Tag name is required
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Tag name already exists
 */
// Create new tag
router.post("/", requireAuth, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json(formatResponse(false, null, "Tag name is required"));
    }

    const result = await executeQuery(
      "INSERT INTO tags (name, is_active) VALUES (?, 1)",
      [name.trim()]
    );

    if (result.success) {
      res.status(201).json(formatResponse(true, { id: result.data.insertId, name, is_active: 1, product_count: 0 }, "Tag created successfully"));
    } else {
      if (result.error && result.error.includes("Duplicate entry")) {
        return res.status(409).json(formatResponse(false, null, "Tag name already exists"));
      }
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to create tag", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags/{id}:
 *   put:
 *     summary: Update tag name
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tag updated successfully
 *       400:
 *         description: Tag name is required
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Tag name already exists
 */
// Update tag (Name)
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json(formatResponse(false, null, "Tag name is required"));
    }

    const result = await executeQuery(
      "UPDATE tags SET name = ? WHERE id = ?",
      [name.trim(), id]
    );

    if (result.success) {
      res.json(formatResponse(true, { id, name }, "Tag updated successfully"));
    } else {
      if (result.error && result.error.includes("Duplicate entry")) {
        return res.status(409).json(formatResponse(false, null, "Tag name already exists"));
      }
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update tag", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags/{id}/status:
 *   patch:
 *     summary: Update tag status
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - is_active
 *             properties:
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Tag status updated successfully
 *       401:
 *         description: Unauthorized
 */
// Update tag status
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const result = await executeQuery(
      "UPDATE tags SET is_active = ? WHERE id = ?",
      [is_active ? 1 : 0, id]
    );

    if (result.success) {
      res.json(formatResponse(true, { id, is_active }, "Tag status updated successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update tag status", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags/{id}:
 *   delete:
 *     summary: Delete tag
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Tag deleted successfully
 *       400:
 *         description: Cannot delete tag with assigned products
 *       401:
 *         description: Unauthorized
 */
// Delete tag
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // For tags, we might just allow deletion and cascade removes the links (defined in SQL).
    // Or we can warn if products are attached. User requirements say "similar to Categories".
    // "Categories: If products linked... cannot delete".
    // So we should check for links first.

    const checkResult = await executeQuery(
      "SELECT COUNT(*) as count FROM product_tags WHERE tag_id = ?",
      [id]
    );

    if (checkResult.success && checkResult.data[0].count > 0) {
      return res.status(400).json(formatResponse(false, null, "Cannot delete tag because it has assigned products"));
    }

    const result = await executeQuery(
      "DELETE FROM tags WHERE id = ?",
      [id]
    );

    if (result.success) {
      res.json(formatResponse(true, null, "Tag deleted successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete tag", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags/{id}/products:
 *   get:
 *     summary: Get products by tag
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Tag products retrieved successfully
 *       401:
 *         description: Unauthorized
 */
// Get products by tag
router.get("/:id/products", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT p.item_id, p.product_name, p.image_url, p.price, p.status 
      FROM shopee_products p
      JOIN product_tags pt ON p.item_id = pt.product_item_id
      WHERE pt.tag_id = ?
      ORDER BY p.product_name ASC
    `;

    const result = await executeQuery(query, [id]);

    if (result.success) {
      res.json(formatResponse(true, result.data, "Tag products retrieved successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve tag products", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags/{id}/products/unassigned:
 *   get:
 *     summary: Get unassigned products for tag
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Unassigned products retrieved successfully
 *       401:
 *         description: Unauthorized
 */
// Get unassigned products (Not in this specific tag)
router.get("/:id/products/unassigned", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Select products that are NOT in the product_tags table for this tag_id
    const query = `
      SELECT item_id, product_name, image_url, price, status 
      FROM shopee_products 
      WHERE item_id NOT IN (
        SELECT product_item_id FROM product_tags WHERE tag_id = ?
      )
      ORDER BY product_name ASC
    `;

    const result = await executeQuery(query, [id]);

    if (result.success) {
      res.json(formatResponse(true, result.data, "Unassigned products retrieved successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve unassigned products", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags/{id}/assign:
 *   post:
 *     summary: Assign products to tag
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productIds
 *             properties:
 *               productIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Products assigned successfully
 *       400:
 *         description: No products selected
 *       401:
 *         description: Unauthorized
 */
// Assign products to tag
router.post("/:id/assign", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { productIds } = req.body; // Array of item_ids

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json(formatResponse(false, null, "No products selected"));
    }

    // We need to insert multiple rows. IGNORE duplicates just in case.
    const values = productIds.map(pid => [pid, id]);
    
    // Need to construct a multi-value insert or loop.
    // executeQuery helper might be tricky with nested arrays for bulk insert if not handled.
    // Let's do a loop for safety or construct the raw query carefully.
    // Or use pool.query directly if accessible. 
    // Let's use a loop of promises for simplicity with our helper wrapper,
    // or better: construct the VALUES string manually.
    
    const placeholders = productIds.map(() => '(?, ?)').join(',');
    const flatParams = [];
    productIds.forEach(pid => {
        flatParams.push(pid);
        flatParams.push(id);
    });

    const query = `INSERT IGNORE INTO product_tags (product_item_id, tag_id) VALUES ${placeholders}`;
    
    const result = await executeQuery(query, flatParams);

    if (result.success) {
      res.json(formatResponse(true, { updated: result.data.affectedRows }, "Products assigned to tag successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to assign products to tag", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags/{id}/remove-product:
 *   post:
 *     summary: Remove product from tag
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemId
 *             properties:
 *               itemId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product removed from tag successfully
 *       400:
 *         description: Item ID is required
 *       401:
 *         description: Unauthorized
 */
// Remove product from tag
router.post("/:id/remove-product", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json(formatResponse(false, null, "Item ID is required"));
    }

    const result = await executeQuery(
      "DELETE FROM product_tags WHERE product_item_id = ? AND tag_id = ?",
      [itemId, id]
    );

    if (result.success) {
      res.json(formatResponse(true, { updated: result.data.affectedRows }, "Product removed from tag successfully"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to remove product from tag", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/tags/product/{itemId}:
 *   get:
 *     summary: Get tags for a specific product
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product tags retrieved successfully
 *       401:
 *         description: Unauthorized
 */
// Get tags for a specific product
router.get("/product/:itemId", requireAuth, async (req, res) => {
    try {
        const { itemId } = req.params;
        
        const query = `
            SELECT t.* 
            FROM tags t
            JOIN product_tags pt ON t.id = pt.tag_id
            WHERE pt.product_item_id = ?
            ORDER BY t.name ASC
        `;
        
        const result = await executeQuery(query, [itemId]);
        
        if (result.success) {
            res.json(formatResponse(true, result.data, "Product tags retrieved successfully"));
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        return handleErrorWithFormat(error, res, "Failed to retrieve product tags", 500, formatResponse);
    }
});

/**
 * @swagger
 * /api/tags/product/{itemId}:
 *   post:
 *     summary: Update tags for a product
 *     tags: [Tags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tagIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Product tags updated successfully
 *       400:
 *         description: Tag IDs must be an array
 *       401:
 *         description: Unauthorized
 */
// Update tags for a product (Sync/Set tags)
router.post("/product/:itemId", requireAuth, async (req, res) => {
    try {
        const { itemId } = req.params;
        const { tagIds } = req.body; // Array of tag IDs

        if (!Array.isArray(tagIds)) {
             return res.status(400).json(formatResponse(false, null, "Tag IDs must be an array"));
        }

        // Transaction-like behavior: Delete all old tags for this product, then insert new ones.
        // Note: mysql2/promise with our wrapper doesn't expose transactions easily unless we refactor.
        // For now, we'll do it sequentially. It's a small risk of inconsistency if crash happens in between.
        
        // 1. Delete existing
        await executeQuery("DELETE FROM product_tags WHERE product_item_id = ?", [itemId]);
        
        // 2. Insert new if any
        if (tagIds.length > 0) {
            const placeholders = tagIds.map(() => '(?, ?)').join(',');
            const flatParams = [];
            tagIds.forEach(tagId => {
                flatParams.push(itemId);
                flatParams.push(tagId);
            });
            
            const insertQuery = `INSERT INTO product_tags (product_item_id, tag_id) VALUES ${placeholders}`;
            await executeQuery(insertQuery, flatParams);
        }

        res.json(formatResponse(true, null, "Product tags updated successfully"));

    } catch (error) {
        return handleErrorWithFormat(error, res, "Failed to update product tags", 500, formatResponse);
    }
});

export default router;

