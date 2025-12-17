/**
 * Product Service
 * Helper functions for product operations
 * Reduces code duplication between /save and /save-from-frontend endpoints
 */

import { executeQuery } from "../config/database.js";
import Logger from "./logger.js";
import { analyzeCategory } from "./categoryService.js";

/**
 * Prepare product data for saving
 * @param {Object} productData - Raw product data from request
 * @param {Object} options - Options for data preparation
 * @param {boolean} options.fromFrontend - If true, convert commission rate from percentage
 * @param {boolean} options.autoAssignCategory - If true, auto-assign category if not provided
 * @returns {Promise<Object>} Prepared product data with categoryId
 */
export async function prepareProductData(productData, options = {}) {
  const { fromFrontend = false, autoAssignCategory = true } = options;
  
  // Determine source
  const source = fromFrontend ? 'frontend' : (productData.source || 'backend');
  
  // Handle category ID
  let categoryId = productData.category_id ? parseInt(productData.category_id) : null;
  
  // Auto-assign category if needed
  if (autoAssignCategory && !categoryId && productData.productName) {
    Logger.debug(`[ProductService] Analyzing category for product: ${productData.productName}`);
    categoryId = await analyzeCategory(productData.productName);
    if (categoryId) {
      Logger.success(`[ProductService] Auto-assigned category ID: ${categoryId}`);
    } else {
      Logger.info(`[ProductService] No matching category found, product will be uncategorized`);
    }
  }
  
  // Handle commission rate conversion (frontend may send as percentage)
  let commissionRate = parseFloat(productData.commissionRate) || 0;
  if (fromFrontend && commissionRate > 1) {
    // Convert percentage to decimal (10 -> 0.1)
    commissionRate = commissionRate / 100;
  }
  
  return {
    ...productData,
    source,
    categoryId,
    commissionRate,
  };
}

/**
 * Build values array for product upsert query
 * @param {Object} preparedData - Prepared product data from prepareProductData
 * @returns {Array} Values array for SQL query
 */
export function buildProductValues(preparedData) {
  // Use original field names from productData
  const {
    itemId,
    productName,
    shopName = "",
    shopId = "",
    price = 0,
    priceMin,
    priceMax,
    commissionRate = 0,
    sellerCommissionRate = 0,
    shopeeCommissionRate = 0,
    commission = 0,
    imageUrl = "",
    productLink = "",
    offerLink = "",
    ratingStar = 0,
    sold = 0, // Note: field name is 'sold' not 'salesCount'
    discountRate = 0,
    periodStartTime = 0,
    periodEndTime = 0,
    campaignActive = false,
    categoryId,
    is_flash_sale = false,
    source,
  } = preparedData;
  
  return [
    itemId,
    productName,
    shopName,
    shopId,
    parseFloat(price) || 0,
    priceMin ? parseFloat(priceMin) : null,
    priceMax ? parseFloat(priceMax) : null,
    commissionRate,
    parseFloat(sellerCommissionRate) || 0,
    parseFloat(shopeeCommissionRate) || 0,
    parseFloat(commission) || 0,
    imageUrl,
    productLink,
    offerLink,
    parseFloat(ratingStar) || 0,
    parseInt(sold) || 0,
    parseFloat(discountRate) || 0,
    parseInt(periodStartTime) || 0,
    parseInt(periodEndTime) || 0,
    campaignActive ? 1 : 0,
    categoryId,
    is_flash_sale ? 1 : 0,
    source,
    "active"
  ];
}

/**
 * Save or update product in database
 * @param {Object} preparedData - Prepared product data
 * @param {Object} options - Options
 * @param {boolean} options.updateTags - If true, update product tags
 * @returns {Promise<Object>} Result object with insertId and action
 */
export async function saveProduct(preparedData, options = {}) {
  const { updateTags = false } = options;
  
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
  
  const values = buildProductValues(preparedData);
  
  const result = await executeQuery(upsertQuery, values);
  
  if (!result.success) {
    throw new Error(`Failed to save product: ${result.error}`);
  }
  
  // Update tags if requested
  if (updateTags && Array.isArray(preparedData.tags)) {
    const itemId = preparedData.itemId;
    const tagIds = preparedData.tags;
    
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
  
  return {
    insertId: result.data.insertId,
    action: isUpdate ? "updated" : "inserted",
    affectedRows: result.data.affectedRows
  };
}

