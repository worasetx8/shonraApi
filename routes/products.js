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

const router = express.Router();

// Constants
const API_URL = "https://open-api.affiliate.shopee.co.th/graphql";
const APP_ID = process.env.SHOPEE_APP_ID;
const APP_SECRET = process.env.SHOPEE_APP_SECRET;

// Cache constants
const CATEGORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute
const FLASH_SALE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const PUBLIC_PRODUCTS_CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const MAX_FLASH_SALE_LIMIT = 20; // Maximum products to show in flash sale

// Category cache to avoid repeated database queries
let categoryCache = null;
let categoryCacheTimestamp = null;

// Function to clear category cache (call when categories are updated)
export function clearCategoryCache() {
  categoryCache = null;
  categoryCacheTimestamp = null;
  Logger.info("[Cache] Category cache cleared");
}

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
 *     summary: Save product to database (admin)
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
 *               productName:
 *                 type: string
 *               price:
 *                 type: number
 *               category_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Product saved successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
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

    // Use INSERT ... ON DUPLICATE KEY UPDATE to handle both insert and update
    const source = productData.source || 'backend'; // frontend or backend

    // Category ID:
    // - ถ้า backend เลือก category เอง จะมาจาก productData.category_id
    // - ถ้าไม่ได้เลือก ให้ใช้ logic analyzeCategory แบบเดียวกับฝั่ง frontend
    let categoryId = productData.category_id ? parseInt(productData.category_id) : null;

    Logger.debug(`[Save-from-backend] Product: ${productData.productName}`);
    Logger.debug(`[Save-from-backend] Initial categoryId from request: ${categoryId}`);

    if (!categoryId && productData.productName) {
      Logger.debug(`[Save-from-backend] Analyzing category for product: ${productData.productName}`);
      categoryId = await analyzeCategory(productData.productName);
      if (categoryId) {
        Logger.success(`[Save-from-backend] Auto-assigned category ID: ${categoryId}`);
      } else {
        Logger.info(`[Save-from-backend] No matching category found, product will be uncategorized`);
      }
    }

    Logger.debug(`[Save-from-backend] Final categoryId to save: ${categoryId}`);

    const upsertQuery = `
      INSERT INTO shopee_products (
        item_id, product_name, shop_name, shop_id,
        price, price_min, price_max,
        commission_rate, seller_commission_rate, shopee_commission_rate, commission_amount,
        image_url, product_link, offer_link,
        rating_star, sales_count, discount_rate,
        period_start_time, period_end_time, campaign_active,
        category_id, is_flash_sale, source,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        product_name = VALUES(product_name),
        shop_name = VALUES(shop_name),
        shop_id = VALUES(shop_id),
        price = VALUES(price),
        price_min = VALUES(price_min),
        price_max = VALUES(price_max),
        commission_rate = VALUES(commission_rate),
        seller_commission_rate = VALUES(seller_commission_rate),
        shopee_commission_rate = VALUES(shopee_commission_rate),
        commission_amount = VALUES(commission_amount),
        image_url = VALUES(image_url),
        product_link = VALUES(product_link),
        offer_link = VALUES(offer_link),
        rating_star = VALUES(rating_star),
        sales_count = VALUES(sales_count),
        discount_rate = VALUES(discount_rate),
        period_start_time = VALUES(period_start_time),
        period_end_time = VALUES(period_end_time),
        campaign_active = VALUES(campaign_active),
        category_id = VALUES(category_id),
        is_flash_sale = VALUES(is_flash_sale),
        source = VALUES(source),
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    `;

    const values = [
      productData.itemId,
      productData.productName,
      productData.shopName || "",
      productData.shopId || "",
      parseFloat(productData.price) || 0,
      productData.priceMin ? parseFloat(productData.priceMin) : null,
      productData.priceMax ? parseFloat(productData.priceMax) : null,
      parseFloat(productData.commissionRate) || 0,
      parseFloat(productData.sellerCommissionRate) || 0,
      parseFloat(productData.shopeeCommissionRate) || 0,
      parseFloat(productData.commission) || 0,
      productData.imageUrl || "",
      productData.productLink || "",
      productData.offerLink || "",
      parseFloat(productData.ratingStar) || 0,
      parseInt(productData.sold) || 0,
      parseFloat(productData.discountRate) || 0,
      parseInt(productData.periodStartTime) || 0,
      parseInt(productData.periodEndTime) || 0,
      productData.campaignActive ? 1 : 0,
      categoryId,
      productData.is_flash_sale ? 1 : 0,
      source,
      "active"
    ];

    const result = await executeQuery(upsertQuery, values);

    if (result.success) {
      // Update tags if provided
      if (Array.isArray(productData.tags)) {
         const itemId = productData.itemId;
         const tagIds = productData.tags;
         
         // Delete existing tags
         await executeQuery("DELETE FROM product_tags WHERE product_item_id = ?", [itemId]);
         
         // Insert new tags
         if (tagIds.length > 0) {
            const placeholders = tagIds.map(() => '(?, ?)').join(',');
            const flatParams = [];
            tagIds.forEach(tagId => {
                flatParams.push(itemId);
                flatParams.push(tagId);
            });
            
            const insertTagsQuery = `INSERT INTO product_tags (product_item_id, tag_id) VALUES ${placeholders}`;
            await executeQuery(insertTagsQuery, flatParams);
         }
      }

      const isUpdate = result.data.affectedRows === 2; // 1 for delete, 1 for insert = update
      const isInsert = result.data.affectedRows === 1; // 1 for insert = new record

      res.json(
        formatResponse(
          true,
          {
            id: result.data.insertId,
            action: isUpdate ? "updated" : "inserted"
          },
          `Product ${isUpdate ? "updated" : "saved"} successfully`
        )
      );
    } else {
      throw new Error("Failed to save/update product to database");
    }
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
async function analyzeCategory(productName) {
  try {
    Logger.debug(`[analyzeCategory] Starting analysis for: ${productName}`);
    
    // Check cache first
    const now = Date.now();
    if (categoryCache && categoryCacheTimestamp && (now - categoryCacheTimestamp < CATEGORY_CACHE_TTL)) {
      Logger.debug(`[analyzeCategory] Using cached data (age: ${Math.round((now - categoryCacheTimestamp) / 1000)}s)`);
    } else {
      Logger.debug(`[analyzeCategory] Loading fresh data from database`);
      
      // Get all active categories from database
      const categoriesResult = await executeQuery(
        "SELECT id, name FROM categories WHERE is_active = 1 ORDER BY name ASC"
      );

      if (!categoriesResult.success || !categoriesResult.data || categoriesResult.data.length === 0) {
        Logger.warn(`[analyzeCategory] No categories available in database`);
        return null; // No categories available
      }

      const categories = categoriesResult.data;
      
      // Get all keywords from database for all categories
      const keywordsResult = await executeQuery(
        `SELECT ck.category_id, ck.keyword, ck.is_high_priority, c.name as category_name
         FROM category_keywords ck
         JOIN categories c ON ck.category_id = c.id
         WHERE c.is_active = 1
         ORDER BY ck.category_id, ck.is_high_priority DESC, ck.keyword ASC`
      );

      // Build cache structure
      const cache = {
        categories: [],
        categoryKeywords: {},
        categoryWords: {},
        categoryHighPriorityKeywords: {}
      };

      // Initialize keywords arrays for each category
      categories.forEach(cat => {
        cache.categories.push(cat);
        const catName = cat.name.toLowerCase();
        const keywords = [catName];
        const catWords = catName.split(/[\s\-_]+/).filter(w => w.length > 1);
        
        cache.categoryWords[cat.id] = catWords;
        keywords.push(...catWords);
        cache.categoryKeywords[cat.id] = keywords;
        cache.categoryHighPriorityKeywords[cat.id] = [];
      });

      // Populate keywords from database
      if (keywordsResult.success && keywordsResult.data && keywordsResult.data.length > 0) {
        keywordsResult.data.forEach(kw => {
          if (cache.categoryKeywords[kw.category_id]) {
            cache.categoryKeywords[kw.category_id].push(kw.keyword);
            if (kw.is_high_priority) {
              cache.categoryHighPriorityKeywords[kw.category_id].push(kw.keyword);
            }
          }
        });
        Logger.debug(`[analyzeCategory] Loaded ${keywordsResult.data.length} keywords from database`);
      } else {
        Logger.warn(`[analyzeCategory] No keywords found in database. Using category names only.`);
      }

      // Update cache
      categoryCache = cache;
      categoryCacheTimestamp = now;
      Logger.debug(`[analyzeCategory] Cache updated with ${categories.length} categories`);
    }

    // Use cached data for analysis
    const productNameLower = productName.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    categoryCache.categories.forEach(cat => {
      const keywords = categoryCache.categoryKeywords[cat.id] || [];
      let score = 0;
      const matchedKeywords = [];
      const highPriorityKeywords = categoryCache.categoryHighPriorityKeywords[cat.id] || [];

      keywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        const wordBoundaryRegex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        const isExactWord = wordBoundaryRegex.test(productNameLower);
        const isSubstring = productNameLower.includes(keywordLower);
        
        if (isExactWord || isSubstring) {
          const isHighPriority = highPriorityKeywords.some(highPriority => 
            keywordLower === highPriority.toLowerCase() || 
            keywordLower.includes(highPriority.toLowerCase()) || 
            highPriority.toLowerCase().includes(keywordLower)
          );
          
          if (keyword === cat.name.toLowerCase()) {
            score += 20;
            matchedKeywords.push(keyword);
          } 
          else if (categoryCache.categoryWords[cat.id] && categoryCache.categoryWords[cat.id].includes(keyword)) {
            score += 15;
            matchedKeywords.push(keyword);
          }
          else if (isHighPriority && isExactWord) {
            score += 10;
            matchedKeywords.push(keyword);
          }
          else if (isHighPriority && isSubstring) {
            score += 5;
            matchedKeywords.push(keyword);
          }
          else if (isExactWord) {
            score += 5;
            matchedKeywords.push(keyword);
          }
          else {
            score += 1;
            matchedKeywords.push(keyword);
          }
        }
      });

      // Bonus: Multiple keyword matches in same category
      if (matchedKeywords.length > 1) {
        score += matchedKeywords.length * 2;
      }

      // Bonus: Longer keyword matches (more specific)
      matchedKeywords.forEach(keyword => {
        if (keyword.length > 5) {
          score += 2;
        }
      });

      if (score > bestScore) {
        bestScore = score;
        bestMatch = cat.id;
      }
    });

    // Lower threshold: return category if score is at least 1 (any match)
    if (bestScore > 0) {
      Logger.success(`[analyzeCategory] Best match: Category ID ${bestMatch} with score ${bestScore}`);
      return bestMatch;
    } else {
      Logger.info(`[analyzeCategory] No category match found (bestScore: ${bestScore})`);
      return null;
    }
  } catch (error) {
    Logger.error("[analyzeCategory] Category analysis error:", error);
    return null;
  }
}

/**
 * @swagger
 * /api/products/save-from-frontend:
 *   post:
 *     summary: Save product from frontend (public, rate limited)
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
 *               productName:
 *                 type: string
 *               price:
 *                 type: number
 *     responses:
 *       200:
 *         description: Product saved successfully
 *       400:
 *         description: Missing required fields
 *       429:
 *         description: Rate limit exceeded
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

    // Analyze and assign category automatically if not provided
    let categoryId = productData.category_id ? parseInt(productData.category_id) : null;
    
    Logger.debug(`[Save-from-frontend] Product: ${productData.productName}`);
    Logger.debug(`[Save-from-frontend] Initial categoryId from request: ${categoryId}`);
    
    if (!categoryId && productData.productName) {
      Logger.debug(`Analyzing category for product: ${productData.productName}`);
      categoryId = await analyzeCategory(productData.productName);
      if (categoryId) {
        Logger.success(`Auto-assigned category ID: ${categoryId}`);
      } else {
        Logger.info(`No matching category found, product will be uncategorized`);
      }
    }
    
    Logger.debug(`[Save-from-frontend] Final categoryId to save: ${categoryId}`);

    // Use INSERT ... ON DUPLICATE KEY UPDATE to handle both insert and update
    const source = 'frontend';
    
    // commission_rate is stored as decimal (0.1 = 10%), but frontend may send as percentage (10)
    // Convert percentage to decimal if value > 1 (assuming it's percentage)
    // Database column is decimal(5,4) which supports -9.9999 to 9.9999
    const commissionRateValue = parseFloat(productData.commissionRate) || 0;
    const commissionRateDecimal = commissionRateValue > 1 ? commissionRateValue / 100 : commissionRateValue;
    
    const upsertQuery = `
      INSERT INTO shopee_products (
        item_id, product_name, shop_name, shop_id,
        price, price_min, price_max,
        commission_rate, seller_commission_rate, shopee_commission_rate, commission_amount,
        image_url, product_link, offer_link,
        rating_star, sales_count, discount_rate,
        period_start_time, period_end_time, campaign_active,
        category_id, is_flash_sale, source,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        product_name = VALUES(product_name),
        shop_name = VALUES(shop_name),
        shop_id = VALUES(shop_id),
        price = VALUES(price),
        price_min = VALUES(price_min),
        price_max = VALUES(price_max),
        commission_rate = VALUES(commission_rate),
        seller_commission_rate = VALUES(seller_commission_rate),
        shopee_commission_rate = VALUES(shopee_commission_rate),
        commission_amount = VALUES(commission_amount),
        image_url = VALUES(image_url),
        product_link = VALUES(product_link),
        offer_link = VALUES(offer_link),
        rating_star = VALUES(rating_star),
        sales_count = VALUES(sales_count),
        discount_rate = VALUES(discount_rate),
        period_start_time = VALUES(period_start_time),
        period_end_time = VALUES(period_end_time),
        campaign_active = VALUES(campaign_active),
        category_id = VALUES(category_id),
        is_flash_sale = VALUES(is_flash_sale),
        source = VALUES(source),
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    `;

    const values = [
      productData.itemId,
      productData.productName,
      productData.shopName || "",
      productData.shopId || "",
      parseFloat(productData.price) || 0,
      productData.priceMin ? parseFloat(productData.priceMin) : null,
      productData.priceMax ? parseFloat(productData.priceMax) : null,
      commissionRateDecimal, // Use converted decimal value (0.1 = 10%)
      parseFloat(productData.sellerCommissionRate) || 0,
      parseFloat(productData.shopeeCommissionRate) || 0,
      parseFloat(productData.commission) || 0,
      productData.imageUrl || "",
      productData.productLink || "",
      productData.offerLink || "",
      parseFloat(productData.ratingStar) || 0,
      parseInt(productData.sold) || 0,
      parseFloat(productData.discountRate) || 0,
      parseInt(productData.periodStartTime) || 0,
      parseInt(productData.periodEndTime) || 0,
      productData.campaignActive ? 1 : 0,
      categoryId, // Use analyzed category ID
      productData.is_flash_sale ? 1 : 0,
      source,
      "active"
    ];

    Logger.debug(`[Save-from-frontend] Saving product with categoryId: ${categoryId} (itemId: ${productData.itemId})`);

    const result = await executeQuery(upsertQuery, values);
    
    if (result.success) {
      Logger.success(`[Save-from-frontend] Product saved successfully. InsertId: ${result.data.insertId}, categoryId: ${categoryId}`);
    } else {
      Logger.error(`[Save-from-frontend] Failed to save product: ${result.error}`);
    }

    if (result.success) {
      res.json(
        formatResponse(
          true,
          {
            id: result.data.insertId,
            action: "saved",
            categoryId: categoryId // Return assigned category ID
          },
          categoryId 
            ? `Product saved successfully from frontend. Auto-assigned to category ID: ${categoryId}`
            : "Product saved successfully from frontend"
        )
      );
    } else {
      throw new Error("Failed to save product to database");
    }
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
 *     summary: Get Flash Sale products (public)
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
 *           maximum: 20
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
            AND p.period_start_time <= UNIX_TIMESTAMP()
            AND p.period_end_time IS NOT NULL
            AND p.period_end_time > 0
            AND p.period_end_time >= UNIX_TIMESTAMP()
          )
        )
      ORDER BY 
        p.price ASC,
        p.sales_count DESC,
        p.updated_at DESC
    `;

    const productsResult = await executeQuery(selectQuery);

    if (!productsResult.success) {
      throw new Error(`Query failed: ${productsResult.error}`);
    }

    let allProducts = productsResult.data || [];
    
    // Random shuffle products
    for (let i = allProducts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allProducts[i], allProducts[j]] = [allProducts[j], allProducts[i]];
    }
    
    // Take only the requested limit
    const flashSaleProducts = allProducts.slice(offset, offset + effectiveLimit);

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
 *     summary: Get active products with filtering (public)
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
 *           default: 50
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: tag_id
 *         schema:
 *           type: array
 *           items:
 *             type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
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
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
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

    // Build query with filters - only active products
    let whereClause = "WHERE p.status = 'active'";
    let queryParams = [];
    let joinClause = "";

    if (categoryId !== "all" && categoryId !== "") {
      whereClause += " AND p.category_id = ?";
      queryParams.push(categoryId);
    }

    if (tagIds.length > 0 && tagIds[0] !== "all" && tagIds[0] !== "") {
      joinClause += " JOIN product_tags pt ON p.item_id = pt.product_item_id";
      whereClause += " AND pt.tag_id IN (" + tagIds.map(() => "?").join(",") + ")";
      queryParams.push(...tagIds);
    }

    if (search.trim()) {
      whereClause += " AND (p.product_name LIKE ? OR p.shop_name LIKE ?)";
      queryParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    // Get products
    const selectQuery = `
      SELECT DISTINCT p.id, p.item_id, p.category_id, c.name as category_name, p.product_name, p.price, p.price_min, p.price_max, 
             p.commission_rate, p.commission_amount,
             p.image_url, p.shop_name, p.shop_id, p.product_link, p.offer_link, p.rating_star, 
             p.sales_count, p.discount_rate, 
             p.status, p.is_flash_sale, p.updated_at
      FROM shopee_products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${joinClause}
      ${whereClause}
      ORDER BY p.updated_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `;

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
