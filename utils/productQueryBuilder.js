/**
 * Product Query Builder
 * Helper utility to build product queries with filters, sorting, and pagination
 * Reduces code duplication between /saved, /saved-public, and /public endpoints
 * 
 * Features:
 * - Supports single or multiple tag IDs
 * - Supports category filtering
 * - Supports search filtering
 * - Supports sorting (date, commission, sales, price)
 * - Supports pagination
 * - Handles both admin and public endpoints
 */

import Logger from "./logger.js";

/**
 * Build WHERE clause and query parameters for product filters
 * @param {Object} filters - Filter options
 * @param {string} filters.status - Product status ('all', 'active', 'inactive', 'flash-sale')
 * @param {string} filters.categoryId - Category ID ('all' or number)
 * @param {string|Array<string|number>} filters.tagId - Tag ID ('all', single number, or array of numbers)
 * @param {string} filters.search - Search term
 * @param {boolean} filters.onlyActive - If true, only show active products (for public endpoints)
 * @returns {Object} - { whereClause, joinClause, queryParams }
 */
export function buildProductFilters(filters = {}) {
  const {
    status = "all",
    categoryId = "all",
    tagId = "all",
    search = "",
    itemId = null,
    onlyActive = false
  } = filters;

  let whereClause = onlyActive ? "WHERE p.status = 'active'" : "WHERE 1=1";
  let queryParams = [];
  let joinClause = "";

  // ItemId filter (for single product lookup)
  if (itemId) {
    whereClause += " AND p.item_id = ?";
    queryParams.push(itemId);
  }

  // Status filter (only for non-public endpoints)
  if (!onlyActive && status !== "all" && status !== "") {
    if (status === "flash-sale") {
      whereClause += " AND p.is_flash_sale = 1";
    } else {
      whereClause += " AND p.status = ?";
      queryParams.push(status);
    }
  }

  // Category filter
  if (categoryId !== "all" && categoryId !== "") {
    whereClause += " AND p.category_id = ?";
    queryParams.push(categoryId);
  }

  // Tag filter - support both single tagId and array of tagIds
  if (tagId !== "all" && tagId !== "") {
    joinClause += " JOIN product_tags pt ON p.item_id = pt.product_item_id";
    
    // Handle array of tag IDs (for multiple tag filtering)
    if (Array.isArray(tagId) && tagId.length > 0) {
      const validTagIds = tagId.filter(id => id !== "all" && id !== "");
      if (validTagIds.length > 0) {
        const placeholders = validTagIds.map(() => "?").join(",");
        whereClause += ` AND pt.tag_id IN (${placeholders})`;
        queryParams.push(...validTagIds);
      }
    } else {
      // Single tag ID
      whereClause += " AND pt.tag_id = ?";
      queryParams.push(tagId);
    }
  }

  // Search filter
  if (search && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    // For public endpoints, search only in product_name and shop_name
    // For admin endpoints, also search in item_id
    if (onlyActive) {
      whereClause += " AND (p.product_name LIKE ? OR p.shop_name LIKE ?)";
      queryParams.push(searchTerm, searchTerm);
    } else {
      whereClause += " AND (p.product_name LIKE ? OR p.shop_name LIKE ? OR p.item_id LIKE ?)";
      queryParams.push(searchTerm, searchTerm, searchTerm);
    }
  }

  return {
    whereClause,
    joinClause,
    queryParams
  };
}

/**
 * Build ORDER BY clause for product sorting
 * @param {string} sortBy - Sort field ('date', 'commission', 'sales', 'price')
 * @param {string} sortOrder - Sort order ('asc' or 'desc')
 * @param {string} defaultSort - Default sort field (default: 'updated_at')
 * @returns {string} - ORDER BY clause
 */
export function buildProductSort(sortBy, sortOrder = "DESC", defaultSort = "p.updated_at") {
  let orderClause = `ORDER BY ${defaultSort} DESC`; // Default sort

  if (sortBy) {
    const normalizedOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';
    
    switch (sortBy) {
      case 'date':
        orderClause = `ORDER BY p.created_at ${normalizedOrder}`;
        Logger.debug(`Sorting by Date Added (created_at) ${normalizedOrder}`);
        break;
      case 'commission':
        orderClause = `ORDER BY p.commission_amount ${normalizedOrder}`;
        Logger.debug(`Sorting by Commission ${normalizedOrder}`);
        break;
      case 'sales':
        orderClause = `ORDER BY p.sales_count ${normalizedOrder}`;
        Logger.debug(`Sorting by Sales ${normalizedOrder}`);
        break;
      case 'price':
        orderClause = `ORDER BY p.price ${normalizedOrder}`;
        Logger.debug(`Sorting by Price ${normalizedOrder}`);
        break;
      default:
        // Keep default sort
        break;
    }
  }

  Logger.debug(`Final ORDER BY clause: ${orderClause}`);
  return orderClause;
}

/**
 * Build SELECT query for products
 * @param {Object} options - Query options
 * @param {string} options.whereClause - WHERE clause
 * @param {string} options.joinClause - JOIN clause
 * @param {string} options.orderClause - ORDER BY clause
 * @param {Array} options.queryParams - Query parameters
 * @param {number} options.limit - Limit
 * @param {number} options.offset - Offset
 * @param {boolean} options.includeAllFields - If true, include all fields (for admin), else minimal fields (for public)
 * @returns {string} - SELECT query
 */
export function buildProductSelectQuery(options = {}) {
  const {
    whereClause,
    joinClause = "",
    orderClause,
    limit,
    offset,
    includeAllFields = true
    // queryParams is not used here but kept for consistency
  } = options;

  // Base fields that are always included
  const baseFields = `p.id, p.item_id, p.category_id, c.name as category_name, p.product_name, p.price, p.price_min, p.price_max, p.commission_rate, p.commission_amount, p.image_url, p.shop_name, p.shop_id, p.product_link, p.offer_link, p.rating_star, p.sales_count, p.discount_rate, p.status, p.is_flash_sale, p.updated_at`;

  // Additional fields for admin endpoints
  const adminFields = includeAllFields ? `, p.seller_commission_rate, p.shopee_commission_rate, p.period_start_time, p.period_end_time, p.campaign_active, p.created_at` : '';

  // Clean up joinClause and whereClause (remove extra spaces)
  const cleanJoinClause = joinClause.trim();
  const cleanWhereClause = whereClause.trim();
  const cleanOrderClause = orderClause.trim();
  
  const selectQuery = `SELECT DISTINCT ${baseFields}${adminFields} FROM shopee_products p LEFT JOIN categories c ON p.category_id = c.id${cleanJoinClause ? ' ' + cleanJoinClause : ''} ${cleanWhereClause} ${cleanOrderClause} LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

  return selectQuery;
}

/**
 * Build COUNT query for products
 * @param {Object} options - Query options
 * @param {string} options.whereClause - WHERE clause
 * @param {string} options.joinClause - JOIN clause
 * @returns {string} - COUNT query
 * 
 * Optimized: Uses subquery when there's a JOIN to avoid COUNT(DISTINCT) performance issues
 */
export function buildProductCountQuery(options = {}) {
  const {
    whereClause,
    joinClause = ""
  } = options;

  // If there's a JOIN (e.g., product_tags), use subquery for better performance
  if (joinClause && joinClause.trim()) {
    // Use subquery to count distinct products more efficiently
    return `SELECT COUNT(*) as total FROM (
      SELECT DISTINCT p.id 
      FROM shopee_products p ${joinClause} ${whereClause}
    ) as distinct_products`;
  }

  // Simple count when no JOIN
  return `SELECT COUNT(*) as total FROM shopee_products p ${whereClause}`;
}

/**
 * Build complete product query (helper function that combines all)
 * @param {Object} params - Query parameters
 * @param {Object} params.filters - Filter options
 * @param {string} params.sortBy - Sort field
 * @param {string} params.sortOrder - Sort order
 * @param {number} params.limit - Limit
 * @param {number} params.offset - Offset
 * @param {boolean} params.onlyActive - Only active products (for public endpoints)
 * @param {boolean} params.includeAllFields - Include all fields (for admin)
 * @returns {Object} - { selectQuery, countQuery, queryParams }
 */
export function buildProductQuery(params = {}) {
  const {
    filters = {},
    sortBy,
    sortOrder = "DESC",
    limit = 20,
    offset = 0,
    onlyActive = false,
    includeAllFields = true
  } = params;

  // Build filters
  const { whereClause, joinClause, queryParams } = buildProductFilters({
    ...filters,
    onlyActive
  });

  // Build sort
  const orderClause = buildProductSort(sortBy, sortOrder);

  // Build queries
  const selectQuery = buildProductSelectQuery({
    whereClause,
    joinClause,
    orderClause,
    queryParams,
    limit,
    offset,
    includeAllFields
  });

  const countQuery = buildProductCountQuery({
    whereClause,
    joinClause
  });

  return {
    selectQuery,
    countQuery,
    queryParams
  };
}

