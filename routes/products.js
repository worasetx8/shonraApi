import express from "express";
import { executeQuery } from "../config/database.js";
import { generateSignature, createAuthorizationHeader } from "../utils/helpers.js";
import { formatResponse, validateRequiredFields } from "../utils/helpers.js";
import { requireAuth } from "./auth.js";
import { PRODUCT_OFFER_QUERY } from "../queries.js";
import { sanitizeObject } from "../utils/sanitize.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";
import { responseCache } from "../middleware/responseCache.js";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { buildProductQuery } from "../utils/productQueryBuilder.js";
import { prepareProductData, saveProduct } from "../utils/productService.js";
// Category analysis moved to utils/categoryService.js (used via productService)

const router = express.Router();

// Constants
const API_URL = "https://open-api.affiliate.shopee.co.th/graphql";
const APP_ID = process.env.SHOPEE_APP_ID;
const APP_SECRET = process.env.SHOPEE_APP_SECRET;

// Cache constants (moved to categoryService.js)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute
const FLASH_SALE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const PUBLIC_PRODUCTS_CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const MAX_FLASH_SALE_LIMIT = 20; // Maximum products to show in flash sale

// Category cache moved to utils/categoryService.js
// Import clearCategoryCache from categoryService if needed

// Debug environment variables on startup (only in development)
Logger.debug("Products Route Environment:", {
  API_URL: API_URL,
  APP_ID: APP_ID ? "SET" : "NOT SET",
  APP_SECRET: APP_SECRET ? "SET (length: " + APP_SECRET.length + ")" : "NOT SET"
});

// Alternative query format (if needed)
const PRODUCT_SEARCH_QUERY = `
  query ProductSearch($keyword: String!, $page: Int) {
    productSearch(keyword: $keyword, page: $page) {
      items {
        itemid
        name
        shopid
        shop_name
        price
        price_min
        price_max
        commission_rate
        seller_commission_rate
        shopee_commission_rate
        image
        link
        offer_link
        rating_star
        historical_sold
        discount
        start_time
        end_time
        is_active
      }
      total_count
      has_more
    }
  }
`;

async function makeGraphQLRequest(query, variables = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ query, variables });

  const signature = generateSignature({
    appId: APP_ID,
    timestamp: timestamp.toString(),
    payload,
    secret: APP_SECRET
  });

  const authHeader = createAuthorizationHeader({
    appId: APP_ID,
    timestamp: timestamp.toString(),
    signature
  });

  Logger.debug("Making request to Shopee API:", {
    url: API_URL,
    bodyLength: payload.length
  });

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader
      },
      body: payload
    });

    Logger.debug("Response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      Logger.error("Error response body:", errorText);
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const jsonResponse = await response.json();
    Logger.debug("Response received:", {
      hasData: !!jsonResponse.data,
      hasErrors: !!jsonResponse.errors
    });

    return jsonResponse;
  } catch (error) {
    Logger.error("GraphQL Request failed:", error);
    throw error;
  }
}

/**
 * @swagger
 * /api/products/search:
 *   get:
 *     summary: Search products from Shopee API
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: commissionRate
 *         schema:
 *           type: number
 *         description: Minimum commission rate filter
 *       - in: query
 *         name: ratingStar
 *         schema:
 *           type: number
 *         description: Minimum rating filter
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [commission, sales, price]
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       500:
 *         description: Server error
 */
// Search products from Shopee API
router.get("/search", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const keyword = req.query.search || "";
    const commissionRate = parseFloat(req.query.commissionRate) || 0;
    const ratingStar = parseFloat(req.query.ratingStar) || 0;
    const sortBy = req.query.sortBy;
    const sortOrder = req.query.sortOrder;

    Logger.debug("Product Search:", { page, keyword, commissionRate, ratingStar, sortBy, sortOrder });

    // Check if credentials are available
    if (!APP_ID || !APP_SECRET) {
      Logger.error("Missing Shopee API credentials:", { APP_ID: !!APP_ID, APP_SECRET: !!APP_SECRET });
      return res.status(500).json(formatResponse(false, null, "Shopee API credentials not configured"));
    }

    if (!keyword.trim()) {
      return res.json(
        formatResponse(
          true,
          {
            data: {
              productOfferV2: {
                nodes: [],
                total: 0,
                hasMore: false
              }
            }
          },
          "Please enter a search keyword"
        )
      );
    }

    const variables = {
      keyword: keyword.trim(),
      page: page
    };

    Logger.debug("Making GraphQL request with variables:", variables);

    // Try the first query format
    let data;
    try {
      Logger.debug("Trying ProductOfferV2 query...");
      data = await makeGraphQLRequest(PRODUCT_OFFER_QUERY, variables);
    } catch (error1) {
      Logger.warn("ProductOfferV2 failed, trying ProductSearch query...", error1.message);

      try {
        data = await makeGraphQLRequest(PRODUCT_SEARCH_QUERY, variables);
        // Transform response to match expected format
        if (data.data?.productSearch) {
          data.data.productOfferV2 = {
            nodes: data.data.productSearch.items.map((item) => ({
              itemId: item.itemid,
              productName: item.name,
              shopName: item.shop_name,
              shopId: item.shopid,
              price: item.price,
              priceMin: item.price_min,
              priceMax: item.price_max,
              commissionRate: item.commission_rate,
              sellerCommissionRate: item.seller_commission_rate,
              shopeeCommissionRate: item.shopee_commission_rate,
              imageUrl: item.image,
              productLink: item.link,
              offerLink: item.offer_link,
              ratingStar: item.rating_star,
              sales: item.historical_sold,
              priceDiscountRate: item.discount, // Changed from discountRate
              periodStartTime: item.start_time,
              periodEndTime: item.end_time,
              campaignActive: item.is_active || false // Default to false
            })),
            total: data.data.productSearch.total_count,
            hasMore: data.data.productSearch.has_more
          };
          delete data.data.productSearch;
        }
      } catch (error2) {
        Logger.error("Both queries failed:", error2.message);
        throw new Error(`Shopee API queries failed: ${error1.message}, ${error2.message}`);
      }
    }

    Logger.debug("Shopee API Response:", {
      hasData: !!data,
      hasProductOfferV2: !!data?.data?.productOfferV2,
      nodesLength: data?.data?.productOfferV2?.nodes?.length || 0,
      hasErrors: !!data?.errors
    });

    // Check if we got valid data
    if (!data?.data?.productOfferV2) {
      Logger.error("Invalid API response structure:", data);
      return res.status(500).json(formatResponse(false, null, "Invalid API response from Shopee"));
    }

    // Apply client-side filtering if needed
    if (data.data.productOfferV2.nodes && (commissionRate > 0 || ratingStar > 0)) {
      const filteredNodes = data.data.productOfferV2.nodes.filter((product) => {
        let passesCommissionFilter = true;
        let passesRatingFilter = true;

        if (commissionRate > 0) {
          const productCommissionRate = parseFloat(product.commissionRate) || 0;
          // UI sends commission as whole number (e.g., 1 means 1%)
          // Shopee API returns commission as decimal (e.g., 0.015 means 1.5%)
          // So we need to convert UI value to decimal: 1 -> 0.01
          const filterCommissionRateDecimal = commissionRate / 100;
          passesCommissionFilter = productCommissionRate >= filterCommissionRateDecimal;
        }

        if (ratingStar > 0) {
          const productRating = parseFloat(product.ratingStar) || 0;
          passesRatingFilter = productRating >= ratingStar;
        }

        return passesCommissionFilter && passesRatingFilter;
      });

      data.data.productOfferV2.nodes = filteredNodes;
      data.data.productOfferV2.total = filteredNodes.length;
    }

    // Apply sorting if requested
    if (data.data.productOfferV2.nodes && sortBy) {
        Logger.debug(`Sorting results by ${sortBy} (${sortOrder || 'desc'})`);
        data.data.productOfferV2.nodes.sort((a, b) => {
            let valA = 0, valB = 0;
            
            if (sortBy === 'commission') {
                valA = parseFloat(a.commission) || 0;
                valB = parseFloat(b.commission) || 0;
            } else if (sortBy === 'sales') {
                valA = parseFloat(a.sales) || 0;
                valB = parseFloat(b.sales) || 0;
            } else if (sortBy === 'price') {
                valA = parseFloat(a.price) || 0;
                valB = parseFloat(b.price) || 0;
            }

            if (sortOrder === 'asc') {
                return valA - valB;
            } else {
                return valB - valA;
            }
        });
    }

    res.json(formatResponse(true, data, "Products retrieved successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to search products", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/check:
 *   post:
 *     summary: Check if product exists in database
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
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
 *         description: Product check result
 *       400:
 *         description: Missing itemId
 *       401:
 *         description: Unauthorized
 */
// Check if product exists in database
router.post("/check", requireAuth, async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json(formatResponse(false, null, "Item ID is required"));
    }

    const result = await executeQuery(`
      SELECT 
        id, item_id, product_name, description, price, price_min, price_max,
        image_url, product_url, offer_link, shop_id, shop_name, shop_type,
        category_id, commission_rate, commission, rating_star, sales_count,
        is_flash_sale, status, source, created_at, updated_at
      FROM shopee_products 
      WHERE item_id = ?
    `, [itemId]);

    if (result.success && result.data.length > 0) {
      const existingProduct = result.data[0];

      // Compare with new product data if provided
      const newProduct = req.body;
      const differences = [];

      const fieldsToCompare = [
        { key: "product_name", newKey: "productName", label: "ชื่อสินค้า" },
        { key: "shop_name", newKey: "shopName", label: "ชื่อร้าน" },
        { key: "shop_id", newKey: "shopId", label: "รหัสร้าน", isNumber: true },
        { key: "price", newKey: "price", label: "ราคา", isNumber: true },
        { key: "price_min", newKey: "priceMin", label: "ราคาต่ำสุด", isNumber: true },
        { key: "price_max", newKey: "priceMax", label: "ราคาสูงสุด", isNumber: true },
        { key: "commission_rate", newKey: "commissionRate", label: "อัตรา commission", isDecimal: true },
        {
          key: "seller_commission_rate",
          newKey: "sellerCommissionRate",
          label: "อัตรา commission ผู้ขาย",
          isDecimal: true
        },
        { key: "commission_amount", newKey: "commission", label: "จำนวน commission", isNumber: true },
        { key: "sales_count", newKey: "sold", label: "ยอดขาย", isNumber: true },
        { key: "rating_star", newKey: "ratingStar", label: "เรตติ้งดาว", isDecimal: true },
        { key: "discount_rate", newKey: "discountRate", label: "อัตราส่วนลด", isNumber: true },
        { key: "period_start_time", newKey: "periodStartTime", label: "เวลาเริ่ม", isNumber: true },
        { key: "period_end_time", newKey: "periodEndTime", label: "เวลาสิ้นสุด", isNumber: true },
        { key: "campaign_active", newKey: "campaignActive", label: "แคมเปญ", isBoolean: true }
      ];

      fieldsToCompare.forEach((field) => {
        let existingValue = existingProduct[field.key];
        let newValue = newProduct[field.newKey];

        // Convert values for comparison
        if (field.isNumber) {
          existingValue = parseFloat(existingValue) || 0;
          newValue = parseFloat(newValue) || 0;
        } else if (field.isDecimal) {
          existingValue = parseFloat(existingValue) || 0;
          newValue = parseFloat(newValue) || 0;
          // Show as decimal for display
          existingValue = existingValue.toFixed(2);
          newValue = newValue.toFixed(2);
        } else if (field.isBoolean) {
          existingValue = !!existingValue;
          newValue = !!newValue;
        }

        if (existingValue != newValue) {
          differences.push({
            field: field.label,
            oldValue: existingValue,
            newValue: newValue
          });
        }
      });

      res.json(
        formatResponse(
          true,
          {
            exists: true,
            product: existingProduct,
            differences: differences,
            hasChanges: differences.length > 0
          },
          "Product found in database with comparison"
        )
      );
    } else {
      res.json(
        formatResponse(
          true,
          {
            exists: false,
            hasChanges: false
          },
          "Product not found in database"
        )
      );
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to check product", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/save:
 *   post:
 *     summary: Save product to database (admin) - Refactored with auto category assignment
 *     description: |
 *       Saves or updates a product in the database. 
 *       - Automatically assigns category based on product name if category_id is not provided
 *       - Uses productService for data preparation and saving
 *       - Supports tag management if tags array is provided
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemId
 *               - productName
 *             properties:
 *               itemId:
 *                 type: string
 *                 description: Unique product item ID from Shopee
 *                 example: "1234567890"
 *               productName:
 *                 type: string
 *                 description: Product name (used for auto category assignment)
 *                 example: "เครื่องสำอางครีมบำรุงผิว"
 *               price:
 *                 type: number
 *                 description: Product price
 *                 example: 299
 *               priceMin:
 *                 type: number
 *                 description: Minimum price (if price range)
 *                 example: 250
 *               priceMax:
 *                 type: number
 *                 description: Maximum price (if price range)
 *                 example: 350
 *               commissionRate:
 *                 type: number
 *                 description: Commission rate (decimal, e.g., 0.1 for 10%)
 *                 example: 0.1
 *               sellerCommissionRate:
 *                 type: number
 *                 description: Seller commission rate
 *                 example: 0.05
 *               shopeeCommissionRate:
 *                 type: number
 *                 description: Shopee commission rate
 *                 example: 0.05
 *               commission:
 *                 type: number
 *                 description: Commission amount
 *                 example: 29.9
 *               category_id:
 *                 type: integer
 *                 description: Category ID (optional - will auto-assign if not provided)
 *                 example: 1
 *               shopName:
 *                 type: string
 *                 description: Shop name
 *                 example: "ร้านตัวอย่าง"
 *               shopId:
 *                 type: string
 *                 description: Shop ID
 *                 example: "12345"
 *               imageUrl:
 *                 type: string
 *                 description: Product image URL
 *                 example: "https://example.com/image.jpg"
 *               productLink:
 *                 type: string
 *                 description: Product link
 *                 example: "https://shopee.co.th/product/1234567890"
 *               offerLink:
 *                 type: string
 *                 description: Affiliate offer link
 *                 example: "https://shopee.co.th/product/1234567890?affiliate"
 *               ratingStar:
 *                 type: number
 *                 description: Product rating (0-5)
 *                 example: 4.5
 *               sold:
 *                 type: integer
 *                 description: Sales count
 *                 example: 1000
 *               discountRate:
 *                 type: number
 *                 description: Discount rate percentage
 *                 example: 20
 *               is_flash_sale:
 *                 type: boolean
 *                 description: Is flash sale product
 *                 example: false
 *               periodStartTime:
 *                 type: integer
 *                 description: Flash sale start time (Unix timestamp)
 *                 example: 1702647123
 *               periodEndTime:
 *                 type: integer
 *                 description: Flash sale end time (Unix timestamp)
 *                 example: 1702733523
 *               campaignActive:
 *                 type: boolean
 *                 description: Campaign active status
 *                 example: true
 *               tags:
 *                 type: array
 *                 description: Array of tag IDs (optional - will update product tags if provided)
 *                 items:
 *                   type: integer
 *                 example: [1, 2, 3]
 *               source:
 *                 type: string
 *                 description: "Product source (default: 'backend')"
 *                 example: "backend"
 *     responses:
 *       200:
 *         description: Product saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Product ID (insertId for new products)
 *                     action:
 *                       type: string
 *                       enum: [inserted, updated]
 *                       description: Action performed
 *                 message:
 *                   type: string
 *                   example: "Product saved successfully"
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Save product to database
router.post("/save", requireAuth, async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const productData = req.body;

    Logger.debug("productData received:", productData);

    const missing = validateRequiredFields(productData, ["itemId", "productName"]);
    if (missing.length > 0) {
      return res.status(400).json(formatResponse(false, null, `Missing required fields: ${missing.join(", ")}`));
    }

    // Prepare product data using service helper
    const preparedData = await prepareProductData(productData, {
      fromFrontend: false,
      autoAssignCategory: true
    });

    Logger.debug(`[Save-from-backend] Product: ${preparedData.productName}`);
    Logger.debug(`[Save-from-backend] Final categoryId to save: ${preparedData.categoryId}`);

    // Save product using service helper
    const result = await saveProduct(preparedData, {
      updateTags: Array.isArray(productData.tags) // Update tags if provided
    });

    res.json(
      formatResponse(
        true,
        {
          id: result.insertId,
          action: result.action
        },
        `Product ${result.action === "updated" ? "updated" : "saved"} successfully`
      )
    );
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to save product", 500, formatResponse);
  }
});

// Save product from frontend (public endpoint, no auth required)
/**
 * Analyzes product name and matches it to the most appropriate category
 * @param {string} productName - The product name to analyze
 * @param {Array} categories - Array of category objects with id and name
 * @returns {number|null} - Category ID or null if no match found
 */
// analyzeCategory function moved to utils/categoryService.js

/**
 * @swagger
 * /api/products/save-from-frontend:
 *   post:
 *     summary: Save product from frontend (public, rate limited) - Refactored with auto category assignment
 *     description: |
 *       Public endpoint for saving products from frontend.
 *       - Rate limited: 10 requests per minute per IP
 *       - Automatically assigns category based on product name
 *       - Converts commission rate from percentage to decimal if > 1 (e.g., 10 -> 0.1)
 *       - Uses productService for data preparation and saving
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemId
 *               - productName
 *             properties:
 *               itemId:
 *                 type: string
 *                 description: Unique product item ID from Shopee
 *                 example: "1234567890"
 *               productName:
 *                 type: string
 *                 description: Product name (used for auto category assignment)
 *                 example: "เครื่องสำอางครีมบำรุงผิว"
 *               price:
 *                 type: number
 *                 description: Product price
 *                 example: 299
 *               priceMin:
 *                 type: number
 *                 description: Minimum price (if price range)
 *                 example: 250
 *               priceMax:
 *                 type: number
 *                 description: Maximum price (if price range)
 *                 example: 350
 *               commissionRate:
 *                 type: number
 *                 description: Commission rate (can be percentage e.g., 10 or decimal 0.1 - will be converted if > 1)
 *                 example: 10
 *               imageUrl:
 *                 type: string
 *                 description: Product image URL
 *                 example: "https://example.com/image.jpg"
 *               productLink:
 *                 type: string
 *                 description: Product link
 *                 example: "https://shopee.co.th/product/1234567890"
 *               offerLink:
 *                 type: string
 *                 description: Affiliate offer link
 *                 example: "https://shopee.co.th/product/1234567890?affiliate"
 *               ratingStar:
 *                 type: number
 *                 description: Product rating (0-5)
 *                 example: 4.5
 *               salesCount:
 *                 type: integer
 *                 description: Sales count
 *                 example: 1000
 *               discountRate:
 *                 type: number
 *                 description: Discount rate percentage
 *                 example: 20
 *               shopName:
 *                 type: string
 *                 description: Shop name
 *                 example: "ร้านตัวอย่าง"
 *               shopId:
 *                 type: string
 *                 description: Shop ID
 *                 example: "12345"
 *               category_id:
 *                 type: integer
 *                 description: Category ID (optional - will auto-assign if not provided)
 *                 example: 1
 *               is_flash_sale:
 *                 type: boolean
 *                 description: Is flash sale product
 *                 example: false
 *               periodStartTime:
 *                 type: integer
 *                 description: Flash sale start time (Unix timestamp)
 *                 example: 1702647123
 *               periodEndTime:
 *                 type: integer
 *                 description: Flash sale end time (Unix timestamp)
 *                 example: 1702733523
 *               campaignActive:
 *                 type: boolean
 *                 description: Campaign active status
 *                 example: true
 *     responses:
 *       200:
 *         description: Product saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Product ID
 *                     action:
 *                       type: string
 *                       example: "saved"
 *                     categoryId:
 *                       type: integer
 *                       nullable: true
 *                       description: Auto-assigned category ID (if auto-assigned)
 *                 message:
 *                   type: string
 *                   example: "Product saved successfully from frontend. Auto-assigned to category ID: 1"
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded (10 requests per minute)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Too many requests, please try again later"
 *                 retryAfter:
 *                   type: integer
 *                   description: Seconds until retry is allowed
 *                   example: 45
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/save-from-frontend", 
  rateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: RATE_LIMIT_MAX_REQUESTS }),
  async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const productData = req.body;
    
    // Ensure source is set to 'frontend'
    productData.source = 'frontend';

    const missing = validateRequiredFields(productData, ["itemId", "productName"]);
    if (missing.length > 0) {
      return res.status(400).json(formatResponse(false, null, `Missing required fields: ${missing.join(", ")}`));
    }

    // Prepare product data using service helper (with frontend-specific options)
    const preparedData = await prepareProductData(productData, {
      fromFrontend: true, // Enable commission rate conversion
      autoAssignCategory: true
    });

    Logger.debug(`[Save-from-frontend] Product: ${preparedData.productName}`);
    Logger.debug(`[Save-from-frontend] Final categoryId to save: ${preparedData.categoryId}`);

    // Save product using service helper
    const result = await saveProduct(preparedData, {
      updateTags: false // Frontend endpoint doesn't handle tags
    });

    Logger.success(`[Save-from-frontend] Product saved successfully. InsertId: ${result.insertId}, categoryId: ${preparedData.categoryId}`);

    res.json(
      formatResponse(
        true,
        {
          id: result.insertId,
          action: "saved",
          categoryId: preparedData.categoryId // Return assigned category ID
        },
        preparedData.categoryId 
          ? `Product saved successfully from frontend. Auto-assigned to category ID: ${preparedData.categoryId}`
          : "Product saved successfully from frontend"
      )
    );
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to save product", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/test-shopee:
 *   get:
 *     summary: Test Shopee API connection (development only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Test result
 *       403:
 *         description: Not available in production
 *       401:
 *         description: Unauthorized
 */
// Test Shopee API connection (development only)
router.get("/test-shopee", requireAuth, async (req, res) => {
  // Only allow in development mode
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json(formatResponse(false, null, "Test endpoint is not available in production"));
  }

  try {
    Logger.info("Testing Shopee API connection...");

    if (!APP_ID || !APP_SECRET) {
      return res.json({
        success: false,
        error: "Missing credentials",
        APP_ID: !!APP_ID,
        APP_SECRET: !!APP_SECRET
      });
    }

    // Simple test query
    const testQuery = `
      query {
        productOfferV2(keyword: "test", page: 1) {
          total
        }
      }
    `;

    Logger.debug("Testing with query:", testQuery.trim());

    const data = await makeGraphQLRequest(testQuery, {});

    Logger.debug("Test response:", data);

    res.json({
      success: true,
      data: data,
      credentials: {
        APP_ID: "***HIDDEN***", // Don't expose credentials
        APP_SECRET_LENGTH: APP_SECRET.length
      }
    });
  } catch (error) {
    const isDevelopment = process.env.NODE_ENV === "development";
    Logger.error("Shopee API test failed:", error);
    res.json({
      success: false,
      error: error.message,
      ...(isDevelopment && { stack: error.stack })
    });
  }
});

/**
 * @swagger
 * /api/products/test-db:
 *   get:
 *     summary: Test database connection (development only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Database test result
 *       403:
 *         description: Not available in production
 *       401:
 *         description: Unauthorized
 */
// Test database connection (development only, requires auth)
router.get("/test-db", requireAuth, async (req, res) => {
  // Only allow in development mode
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json(formatResponse(false, null, "Test endpoint is not available in production"));
  }

  try {
    Logger.info("Testing database connection...");

    // Test basic query
    const testResult = await executeQuery("SELECT 1 as test", []);
    Logger.debug("Basic query result:", testResult);

    // Check if table exists
    const tableResult = await executeQuery('SHOW TABLES LIKE "shopee_products"', []);
    Logger.debug("Table check result:", tableResult);

    // Don't expose table structure in response - security risk
    res.json({
      success: true,
      data: {
        basicQuery: testResult,
        tableExists: tableResult,
        message: "Database connection successful"
      }
    });
  } catch (error) {
    Logger.error("Database test error:", error);
    const isDevelopment = process.env.NODE_ENV === "development";
    res.status(500).json({
      success: false,
      error: isDevelopment ? error.message : "Database test failed"
    });
  }
});

/**
 * @swagger
 * /api/products/sync-single:
 *   post:
 *     summary: Sync single product with Shopee API
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemId
 *               - searchName
 *             properties:
 *               itemId:
 *                 type: string
 *               searchName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product synced successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 */
// Sync single product with Shopee API
router.post("/sync-single", requireAuth, async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const { itemId, searchName } = req.body;

    if (!itemId || !searchName) {
      return res.status(400).json(formatResponse(false, null, "Item ID and search name are required"));
    }

    Logger.info(`Syncing product: ${itemId} with name: "${searchName}"`);

    // Check credentials
    if (!APP_ID || !APP_SECRET) {
      throw new Error("Shopee API credentials not configured");
    }

    // 1. Call Shopee API Search
    const variables = {
      keyword: searchName,
      page: 1,
      limit: 20 // Get enough results to find match
    };

    // Try ProductOfferV2 first
    let shopeeData;
    try {
      shopeeData = await makeGraphQLRequest(PRODUCT_OFFER_QUERY, variables);
    } catch (error) {
      Logger.warn("ProductOfferV2 search failed during sync, trying fallback...");
      // Fallback logic if needed, or just fail
    }

    let foundProduct = null;
    let newStatus = 'inactive';

    if (shopeeData && shopeeData.data && shopeeData.data.productOfferV2 && shopeeData.data.productOfferV2.nodes) {
      const results = shopeeData.data.productOfferV2.nodes;
      
      // 2. Find matching Item ID
      foundProduct = results.find(p => String(p.itemId) === String(itemId));
      
      if (foundProduct) {
        newStatus = 'active';
        Logger.success(`Match found for ${itemId}. Status -> active`);
      } else {
        Logger.warn(`No match found for ${itemId} in search results. Status -> inactive`);
      }
    } else {
      Logger.warn(`No results from Shopee API for "${searchName}". Status -> inactive`);
    }

    // 3. Update Database
    let updateQuery;
    let queryParams;

    if (foundProduct) {
      // Update details and status to active
      updateQuery = `
        UPDATE shopee_products 
        SET 
          product_name = ?,
          price = ?,
          price_min = ?,
          price_max = ?,
          commission_rate = ?,
          seller_commission_rate = ?,
          shopee_commission_rate = ?,
          commission_amount = ?,
          image_url = ?,
          rating_star = ?,
          sales_count = ?,
          discount_rate = ?,
          status = 'active',
          updated_at = CURRENT_TIMESTAMP
        WHERE item_id = ?
      `;
      queryParams = [
        foundProduct.productName,
        foundProduct.price,
        foundProduct.priceMin,
        foundProduct.priceMax,
        foundProduct.commissionRate,
        foundProduct.sellerCommissionRate,
        foundProduct.shopeeCommissionRate,
        foundProduct.commission, // commission amount
        foundProduct.imageUrl,
        foundProduct.ratingStar,
        foundProduct.sales,
        foundProduct.priceDiscountRate || 0,
        String(itemId)
      ];
    } else {
      // Not found, set status to inactive
      updateQuery = `
        UPDATE shopee_products 
        SET status = 'inactive', updated_at = CURRENT_TIMESTAMP 
        WHERE item_id = ?
      `;
      queryParams = [String(itemId)];
    }

    const result = await executeQuery(updateQuery, queryParams);

    if (result.success) {
      res.json(formatResponse(true, { 
        status: newStatus, 
        found: !!foundProduct,
        updated: result.data.affectedRows > 0
      }, `Product synced. Status: ${newStatus}`));
    } else {
      throw new Error(result.error || "Failed to update database");
    }

  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to sync product", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/{id}/status:
 *   patch:
 *     summary: Update product status
 *     tags: [Products]
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
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Product status updated successfully
 *       400:
 *         description: Invalid status
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 */
// Update product status
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json(formatResponse(false, null, "Invalid status. Must be 'active' or 'inactive'"));
    }

    const result = await executeQuery(
      "UPDATE shopee_products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, id]
    );

    if (result.success && result.data.affectedRows > 0) {
      res.json(formatResponse(true, null, "Product status updated successfully"));
    } else {
      res.status(404).json(formatResponse(false, null, "Product not found"));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update product status", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/{id}/flash-sale:
 *   patch:
 *     summary: Update flash sale status
 *     tags: [Products]
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
 *               - isFlashSale
 *             properties:
 *               isFlashSale:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Flash sale status updated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 */
// Update flash sale status
router.patch("/:id/flash-sale", requireAuth, async (req, res) => {
  try {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    const { id } = req.params;
    const { isFlashSale } = req.body;

    if (typeof isFlashSale !== 'boolean') {
      return res.status(400).json(formatResponse(false, null, "isFlashSale must be a boolean"));
    }

    const result = await executeQuery(
      "UPDATE shopee_products SET is_flash_sale = ?, updated_at = CURRENT_TIMESTAMP WHERE item_id = ?",
      [isFlashSale ? 1 : 0, id]
    );

    if (result.success && result.data.affectedRows > 0) {
      res.json(formatResponse(true, null, "Flash sale status updated successfully"));
    } else {
      res.status(404).json(formatResponse(false, null, "Product not found"));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to update flash sale status", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/delete:
 *   delete:
 *     summary: Delete product by itemId
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
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
 *         description: Product deleted successfully
 *       400:
 *         description: Item ID is required
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 */
// Delete product by itemId (specific route must come before parameterized route)
router.delete("/delete", requireAuth, async (req, res) => {
  try {
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json(formatResponse(false, null, "Item ID is required"));
    }

    Logger.debug("Delete request - itemId:", itemId);

    const deleteQuery = `DELETE FROM shopee_products WHERE item_id = ?`;
    const result = await executeQuery(deleteQuery, [String(itemId)]);

    if (result.success && result.data.affectedRows > 0) {
      res.json(
        formatResponse(
          true,
          {
            affectedRows: result.data.affectedRows
          },
          "Product deleted successfully"
        )
      );
    } else if (result.success && result.data.affectedRows === 0) {
      res.status(404).json(formatResponse(false, null, "Product not found"));
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete product", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete product by ID
 *     tags: [Products]
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
 *         description: Product deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 */
// Delete product by ID (parameterized route comes after specific routes)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await executeQuery("DELETE FROM shopee_products WHERE id = ?", [id]);

    if (result.success && result.data.affectedRows > 0) {
      res.json(formatResponse(true, null, "Product deleted successfully"));
    } else {
      res.status(404).json(formatResponse(false, null, "Product not found"));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete product", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/saved:
 *   get:
 *     summary: Get saved products with pagination and filtering
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, active, inactive, flash-sale]
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: tag_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [date, commission, sales, price]
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *       401:
 *         description: Unauthorized
 */
// Get saved products with pagination, filtering, and search
router.get("/saved", requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status || "all";
    const categoryId = req.query.category_id || "all";
    const tagId = req.query.tag_id || "all";
    const search = req.query.search || "";
    const sortBy = req.query.sort_by;
    const sortOrder = req.query.sort_order === 'asc' ? 'ASC' : 'DESC';

    Logger.debug(`Fetching saved products: page=${page}, limit=${limit}, status=${status}, category=${categoryId}, tag=${tagId}, sort=${sortBy}:${sortOrder}`);

    // Build query using helper function
    const { selectQuery, countQuery, queryParams } = buildProductQuery({
      filters: {
        status,
        categoryId,
        tagId,
        search
      },
      sortBy,
      sortOrder,
      limit,
      offset,
      onlyActive: false, // Admin endpoint - show all statuses
      includeAllFields: true // Admin endpoint - include all fields
    });

    // Execute queries
    const [countResult, productsResult] = await Promise.all([
      executeQuery(countQuery, queryParams),
      executeQuery(selectQuery, queryParams)
    ]);

    if (!countResult.success) {
      throw new Error(`Count query failed: ${countResult.error}`);
    }

    if (!productsResult.success) {
      throw new Error(`Select query failed: ${productsResult.error}`);
    }

    const totalCount = countResult.data[0]?.total || 0;
    const products = productsResult.data || [];

    Logger.debug(`Returning ${products.length} saved products (${totalCount} total)`);

    res.json(
      formatResponse(
        true,
        {
          data: products,
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit)
        },
        "Products retrieved successfully"
      )
    );
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve saved products", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/status:
 *   patch:
 *     summary: Update product status by itemId
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemId
 *               - status
 *             properties:
 *               itemId:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Product status updated successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 */
// Update product status via patch (for consistency)
router.patch("/status", requireAuth, async (req, res) => {
    try {
      // Sanitize input
      req.body = sanitizeObject(req.body);
      const { itemId, status } = req.body;
  
      if (!itemId || !status) {
        return res.status(400).json(formatResponse(false, null, "Item ID and status are required"));
      }
  
      Logger.debug("Update status request:", { itemId, status });
  
      const updateQuery = `
        UPDATE shopee_products 
        SET status = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE item_id = ?
      `;
  
      const result = await executeQuery(updateQuery, [status, String(itemId)]);
  
      if (result.success && result.data.affectedRows > 0) {
        res.json(
          formatResponse(
            true,
            {
              affectedRows: result.data.affectedRows
            },
            `Product status updated to ${status}`
          )
        );
      } else if (result.success && result.data.affectedRows === 0) {
        res.status(404).json(formatResponse(false, null, "Product not found"));
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      return handleErrorWithFormat(error, res, "Failed to update product status", 500, formatResponse);
    }
  });

/**
 * @swagger
 * /api/products/flash-sale:
 *   get:
 *     summary: Get Flash Sale products (public) - Optimized query with parameterized timestamps
 *     description: |
 *       Returns active flash sale products.
 *       - Optimized query with parameterized timestamps (no UNIX_TIMESTAMP() in WHERE clause)
 *       - Uses composite indexes for better performance
 *       - Cached for 2 minutes
 *       - Maximum 20 products per page
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 20
 *           minimum: 1
 *         description: Number of products per page (max 20)
 *     responses:
 *       200:
 *         description: Flash Sale products retrieved successfully
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
 *                     $ref: '#/components/schemas/Product'
 */
// Public endpoint for client - Get Flash Sale products (auto-select top 6 by price & sales)
router.get("/flash-sale", 
  responseCache({ ttl: FLASH_SALE_CACHE_TTL }),
  async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const effectiveLimit = Math.min(limit, MAX_FLASH_SALE_LIMIT);
    const offset = (page - 1) * effectiveLimit;

    Logger.debug(`[Public] Auto-selecting Flash Sale products: page=${page}, limit=${effectiveLimit}`);

    // 1) เลือกสินค้าที่เข้าเงื่อนไข Flash Sale อัตโนมัติจากทั้งตาราง
    //    - ต้อง active
    //    - ถ้ามี campaign_active = 1 และอยู่ในช่วงเวลา → ใช้ได้
    //    - ถ้าไม่มี campaign_active หรือ campaign_active = 0 → ก็ใช้ได้ (เพื่อให้มีสินค้าแสดง)
    //    - ถ้ามี period_start_time / period_end_time ให้เช็คให้อยู่ในช่วงเวลา NOW
    //    - เรียงลำดับ: ราคาถูกที่สุดก่อน แล้วตามด้วยยอดขายสูงสุด
    // Optimized: ใช้ parameter แทน UNIX_TIMESTAMP() เพื่อให้ใช้ index ได้ดีขึ้น
    const currentTimestamp = Math.floor(Date.now() / 1000); // Current Unix timestamp
    const selectQuery = `
      SELECT DISTINCT 
        p.id, p.item_id, p.category_id, c.name as category_name, 
        p.product_name, p.price, p.price_min, p.price_max, 
        p.commission_rate, p.commission_amount,
        p.image_url, p.shop_name, p.shop_id, p.product_link, p.offer_link, p.rating_star, 
        p.sales_count, p.discount_rate, 
        p.status, p.is_flash_sale, p.period_start_time, p.period_end_time, p.campaign_active, p.updated_at
      FROM shopee_products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 
        p.status = 'active'
        AND (
          -- กรณี 1: ไม่ตั้งเวลาเลย → แสดงได้
          ( (p.period_start_time IS NULL OR p.period_start_time = 0) 
            AND (p.period_end_time IS NULL OR p.period_end_time = 0) )
          OR
          -- กรณี 2: ตั้งเวลาแล้ว และอยู่ในช่วงเวลาปัจจุบัน → แสดงได้
          ( p.period_start_time IS NOT NULL 
            AND p.period_start_time > 0 
            AND p.period_start_time <= ?
            AND p.period_end_time IS NOT NULL
            AND p.period_end_time > 0
            AND p.period_end_time >= ?
          )
        )
      ORDER BY 
        p.price ASC,
        p.sales_count DESC,
        p.updated_at DESC
      LIMIT ${parseInt(effectiveLimit)} OFFSET ${parseInt(offset)}
    `;

    const queryParams = [currentTimestamp, currentTimestamp];
    Logger.debug(`[Flash Sale] Query params:`, { currentTimestamp, effectiveLimit, offset, queryParams });
    
    const productsResult = await executeQuery(selectQuery, queryParams);

    if (!productsResult.success) {
      Logger.error(`[Flash Sale] Query failed:`, productsResult.error);
      Logger.error(`[Flash Sale] Query:`, selectQuery);
      Logger.error(`[Flash Sale] Params:`, queryParams);
      throw new Error(`Query failed: ${productsResult.error}`);
    }

    let flashSaleProducts = productsResult.data || [];
    
    // Random shuffle products (only if we got products)
    if (flashSaleProducts.length > 0) {
      for (let i = flashSaleProducts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [flashSaleProducts[i], flashSaleProducts[j]] = [flashSaleProducts[j], flashSaleProducts[i]];
      }
    }

    // 2) อัปเดตสถานะ is_flash_sale ให้เฉพาะชุดที่เลือก (สูงสุด 20 ตัว)
    //    - เคลียร์ is_flash_sale ทั้งหมดก่อน
    //    - จากนั้นตั้ง is_flash_sale = 1 เฉพาะ item_id ที่อยู่ใน flashSaleProducts
    const clearFlashSaleQuery = `
      UPDATE shopee_products
      SET is_flash_sale = 0, updated_at = CURRENT_TIMESTAMP
      WHERE is_flash_sale = 1
    `;
    await executeQuery(clearFlashSaleQuery);

    if (flashSaleProducts.length > 0) {
      const itemIds = flashSaleProducts
        .map(p => p.item_id)
        .filter(id => id !== null && id !== undefined);

      if (itemIds.length > 0) {
        const placeholders = itemIds.map(() => "?").join(",");
        const markFlashSaleQuery = `
          UPDATE shopee_products
          SET is_flash_sale = 1, updated_at = CURRENT_TIMESTAMP
          WHERE item_id IN (${placeholders})
        `;
        await executeQuery(markFlashSaleQuery, itemIds);
      }
    }

    res.json(formatResponse(true, flashSaleProducts, "Flash Sale products retrieved successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve flash sale products", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/public:
 *   get:
 *     summary: Get active products with filtering (public) - Refactored with optimized queries
 *     description: |
 *       Returns active products with advanced filtering and pagination.
 *       - Supports category filtering, tag filtering (single or multiple), and search
 *       - Uses optimized COUNT query with subquery when JOINs are present
 *       - Cached for 3 minutes
 *       - Uses productQueryBuilder for consistent query building
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 100
 *         description: Number of products per page
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: integer
 *         description: Filter by category ID (use "all" to show all categories)
 *         example: 1
 *       - in: query
 *         name: tag_id
 *         schema:
 *           type: array
 *           items:
 *             type: integer
 *         description: Filter by tag ID(s) - can specify multiple tags (e.g., ?tag_id=1&tag_id=2)
 *         example: [1, 2]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword (searches in product name and shop name)
 *         example: "ครีมบำรุง"
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [price, sales_count, updated_at, rating_star]
 *         description: Sort field
 *         example: "price"
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *         example: "desc"
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     limit:
 *                       type: integer
 *                       example: 50
 *                     total:
 *                       type: integer
 *                       example: 100
 *                     totalPages:
 *                       type: integer
 *                       example: 2
 *       400:
 *         description: Invalid parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Public endpoint for client - Get active products with filtering
router.get("/public", 
  responseCache({ 
    ttl: PUBLIC_PRODUCTS_CACHE_TTL,
    keyGenerator: (req) => {
      // Include query params in cache key for different filters
      const params = new URLSearchParams(req.query).toString();
      return `GET:/api/products/public?${params}`;
    }
  }), 
  async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const categoryId = req.query.category_id || "all";
    // Handle multiple tag IDs (support multiple tag_id query params)
    const tagIds = Array.isArray(req.query.tag_id) 
      ? req.query.tag_id 
      : req.query.tag_id 
        ? [req.query.tag_id] 
        : [];
    const search = req.query.search || "";

    Logger.debug(`[Public] Fetching products: page=${page}, limit=${limit}, category=${categoryId}, tags=${tagIds.join(',')}`);

    // Build query using helper function - ONLY ACTIVE PRODUCTS
    // Convert tagIds array to single value or array for productQueryBuilder
    const tagIdFilter = tagIds.length === 0 ? "all" : (tagIds.length === 1 ? tagIds[0] : tagIds);

    const { selectQuery, queryParams } = buildProductQuery({
      filters: {
        status: "all", // Public endpoint - status filter not applicable (always active)
        categoryId,
        tagId: tagIdFilter, // Can be single value or array
        search
      },
      sortBy: undefined, // Use default sort (updated_at DESC)
      sortOrder: "DESC",
      limit,
      offset,
      onlyActive: true, // Public endpoint - only show active products
      includeAllFields: false // Public endpoint - minimal fields only
    });

    const productsResult = await executeQuery(selectQuery, queryParams);

    if (!productsResult.success) {
      throw new Error(`Query failed: ${productsResult.error}`);
    }

    res.json(formatResponse(true, productsResult.data, "Products retrieved successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve products", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/products/saved-public:
 *   get:
 *     summary: Get saved products (public, active only)
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: tag_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [date, commission, sales, price]
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *       429:
 *         description: Rate limit exceeded
 */
// Get saved products (public endpoint - active products only, no auth required)
// Similar to /saved but public and only shows active products
router.get("/saved-public",
  rateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }), // 30 requests per minute
  responseCache({ 
    ttl: 2 * 60 * 1000, // Cache for 2 minutes
    keyGenerator: (req) => {
      const params = new URLSearchParams(req.query).toString();
      return `GET:/api/products/saved-public?${params}`;
    }
  }),
  async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const categoryId = req.query.category_id || "all";
    const tagId = req.query.tag_id || "all";
    const search = req.query.search || "";
    const sortBy = req.query.sort_by;
    const sortOrder = req.query.sort_order === 'asc' ? 'ASC' : 'DESC';

    Logger.debug(`[Public] Fetching saved products: page=${page}, limit=${limit}, category=${categoryId}, tag=${tagId}, sort=${sortBy}:${sortOrder}`);

    // Build query using helper function - ONLY ACTIVE PRODUCTS for security
    const { selectQuery, countQuery, queryParams } = buildProductQuery({
      filters: {
        status: "all", // Public endpoint - status filter not applicable (always active)
        categoryId,
        tagId,
        search
      },
      sortBy,
      sortOrder,
      limit,
      offset,
      onlyActive: true, // Public endpoint - only show active products
      includeAllFields: true // Include all fields for saved-public endpoint
    });

    // Execute queries
    const [countResult, productsResult] = await Promise.all([
      executeQuery(countQuery, queryParams),
      executeQuery(selectQuery, queryParams)
    ]);

    if (!countResult.success) {
      throw new Error(`Count query failed: ${countResult.error}`);
    }

    if (!productsResult.success) {
      throw new Error(`Select query failed: ${productsResult.error}`);
    }

    const totalCount = countResult.data[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limit);

    res.json(formatResponse(true, {
      products: productsResult.data,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    }, "Products retrieved successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to retrieve products", 500, formatResponse);
  }
});

export default router;
