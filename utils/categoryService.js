/**
 * Category Service
 * Handles category analysis and caching
 * Extracted from routes/products.js to reduce code duplication
 */

import { executeQuery } from "../config/database.js";
import Logger from "./logger.js";

// Cache constants
const CATEGORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Category cache (module-level)
let categoryCache = null;
let categoryCacheTimestamp = null;

/**
 * Clear category cache
 * Call this when categories or keywords are updated
 */
export function clearCategoryCache() {
  categoryCache = null;
  categoryCacheTimestamp = null;
  Logger.info("[CategoryService] Category cache cleared");
}

/**
 * Analyze product name and match it to the most appropriate category
 * @param {string} productName - Product name to analyze
 * @returns {Promise<number|null>} Category ID or null if no match found
 */
export async function analyzeCategory(productName) {
  try {
    Logger.debug(`[CategoryService] Starting analysis for: ${productName}`);
    
    // Check cache first
    const now = Date.now();
    if (categoryCache && categoryCacheTimestamp && (now - categoryCacheTimestamp < CATEGORY_CACHE_TTL)) {
      Logger.debug(`[CategoryService] Using cached data (age: ${Math.round((now - categoryCacheTimestamp) / 1000)}s)`);
    } else {
      Logger.debug(`[CategoryService] Loading fresh data from database`);
      
      // Get all active categories from database
      const categoriesResult = await executeQuery(
        "SELECT id, name FROM categories WHERE is_active = 1 ORDER BY name ASC"
      );

      if (!categoriesResult.success || !categoriesResult.data || categoriesResult.data.length === 0) {
        Logger.warn(`[CategoryService] No categories available in database`);
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
        Logger.debug(`[CategoryService] Loaded ${keywordsResult.data.length} keywords from database`);
      } else {
        Logger.warn(`[CategoryService] No keywords found in database. Using category names only.`);
      }

      // Update cache
      categoryCache = cache;
      categoryCacheTimestamp = now;
      Logger.debug(`[CategoryService] Cache updated with ${categories.length} categories`);
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
      Logger.success(`[CategoryService] Best match: Category ID ${bestMatch} with score ${bestScore}`);
      return bestMatch;
    } else {
      Logger.info(`[CategoryService] No category match found (bestScore: ${bestScore})`);
      return null;
    }
  } catch (error) {
    Logger.error("[CategoryService] Category analysis error:", error);
    return null;
  }
}

