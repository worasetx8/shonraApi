/**
 * Performance Test Script
 * 
 * Tests query performance after optimization
 * 
 * Usage:
 *   node shonraApi/scripts/test-performance.js
 */

import { executeQuery } from "../config/database.js";
import { buildProductQuery } from "../utils/productQueryBuilder.js";

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

// Performance test results
const results = {
  queries: [],
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    avgTime: 0
  }
};

async function testQuery(name, queryFn) {
  const startTime = Date.now();
  try {
    const result = await queryFn();
    const duration = Date.now() - startTime;
    
    results.queries.push({
      name,
      duration,
      success: result.success,
      rowCount: result.data?.length || 0
    });
    
    return { success: result.success, duration, data: result.data };
  } catch (error) {
    const duration = Date.now() - startTime;
    results.queries.push({
      name,
      duration,
      success: false,
      error: error.message
    });
    return { success: false, duration, error: error.message };
  }
}

async function runPerformanceTests() {
  console.log("🚀 Starting Performance Tests...\n");
  console.log(`Backend URL: ${BACKEND_URL}\n`);
  
  // Test 1: Product Listing Query (Public endpoint)
  console.log("=".repeat(60));
  console.log("TEST 1: Product Listing Query (Public)");
  console.log("=".repeat(60));
  
  await testQuery("GET /api/products/public", async () => {
    const { selectQuery, queryParams } = buildProductQuery({
      filters: {
        status: "all",
        categoryId: "all",
        tagId: "all",
        search: ""
      },
      sortBy: undefined,
      sortOrder: "DESC",
      limit: 50,
      offset: 0,
      onlyActive: true,
      includeAllFields: false
    });
    
    return await executeQuery(selectQuery, queryParams);
  });
  
  // Test 2: Product Listing with Category Filter
  await testQuery("GET /api/products/public?category_id=1", async () => {
    const { selectQuery, queryParams } = buildProductQuery({
      filters: {
        status: "all",
        categoryId: "1",
        tagId: "all",
        search: ""
      },
      sortBy: undefined,
      sortOrder: "DESC",
      limit: 50,
      offset: 0,
      onlyActive: true,
      includeAllFields: false
    });
    
    return await executeQuery(selectQuery, queryParams);
  });
  
  // Test 3: Product Listing with Search
  await testQuery("GET /api/products/public?search=test", async () => {
    const { selectQuery, queryParams } = buildProductQuery({
      filters: {
        status: "all",
        categoryId: "all",
        tagId: "all",
        search: "test"
      },
      sortBy: undefined,
      sortOrder: "DESC",
      limit: 50,
      offset: 0,
      onlyActive: true,
      includeAllFields: false
    });
    
    return await executeQuery(selectQuery, queryParams);
  });
  
  // Test 4: COUNT Query (without JOIN)
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: COUNT Query (without JOIN)");
  console.log("=".repeat(60));
  
  await testQuery("COUNT products (no JOIN)", async () => {
    const { countQuery, queryParams } = buildProductQuery({
      filters: {
        status: "all",
        categoryId: "all",
        tagId: "all",
        search: ""
      },
      onlyActive: true
    });
    
    return await executeQuery(countQuery, queryParams);
  });
  
  // Test 5: COUNT Query (with JOIN - tag filter)
  await testQuery("COUNT products (with JOIN - tag)", async () => {
    const { countQuery, queryParams } = buildProductQuery({
      filters: {
        status: "all",
        categoryId: "all",
        tagId: "1",
        search: ""
      },
      onlyActive: true
    });
    
    return await executeQuery(countQuery, queryParams);
  });
  
  // Test 6: Flash Sale Query (optimized)
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Flash Sale Query (Optimized)");
  console.log("=".repeat(60));
  
  await testQuery("GET /api/products/flash-sale", async () => {
    const currentTimestamp = Math.floor(Date.now() / 1000);
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
          ( (p.period_start_time IS NULL OR p.period_start_time = 0) 
            AND (p.period_end_time IS NULL OR p.period_end_time = 0) )
          OR
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
      LIMIT 20 OFFSET 0
    `;
    
    return await executeQuery(selectQuery, [currentTimestamp, currentTimestamp]);
  });
  
  // Test 7: Category Analysis Query (cached)
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: Category Analysis Query");
  console.log("=".repeat(60));
  
  await testQuery("Load categories", async () => {
    return await executeQuery(
      "SELECT id, name FROM categories WHERE is_active = 1 ORDER BY name ASC"
    );
  });
  
  await testQuery("Load category keywords", async () => {
    return await executeQuery(
      `SELECT ck.category_id, ck.keyword, ck.is_high_priority, c.name as category_name
       FROM category_keywords ck
       JOIN categories c ON ck.category_id = c.id
       WHERE c.is_active = 1
       ORDER BY ck.category_id, ck.is_high_priority DESC, ck.keyword ASC`
    );
  });
  
  // Print results
  console.log("\n" + "=".repeat(60));
  console.log("📊 Performance Test Results");
  console.log("=".repeat(60));
  
  results.queries.forEach((query, index) => {
    const status = query.success ? "✅" : "❌";
    const rowInfo = query.rowCount !== undefined ? ` (${query.rowCount} rows)` : "";
    console.log(`${status} ${index + 1}. ${query.name}: ${query.duration}ms${rowInfo}`);
    if (query.error) {
      console.log(`   Error: ${query.error}`);
    }
  });
  
  // Calculate summary
  const successfulQueries = results.queries.filter(q => q.success);
  const totalTime = successfulQueries.reduce((sum, q) => sum + q.duration, 0);
  const avgTime = successfulQueries.length > 0 ? Math.round(totalTime / successfulQueries.length) : 0;
  
  results.summary = {
    total: results.queries.length,
    passed: successfulQueries.length,
    failed: results.queries.length - successfulQueries.length,
    avgTime
  };
  
  console.log("\n" + "=".repeat(60));
  console.log("📈 Summary");
  console.log("=".repeat(60));
  console.log(`Total queries: ${results.summary.total}`);
  console.log(`✅ Passed: ${results.summary.passed}`);
  console.log(`❌ Failed: ${results.summary.failed}`);
  console.log(`⏱️  Average time: ${results.summary.avgTime}ms`);
  
  // Performance recommendations
  console.log("\n" + "=".repeat(60));
  console.log("💡 Performance Recommendations");
  console.log("=".repeat(60));
  
  const slowQueries = successfulQueries.filter(q => q.duration > 500);
  if (slowQueries.length > 0) {
    console.log("⚠️  Slow queries (>500ms):");
    slowQueries.forEach(q => {
      console.log(`   - ${q.name}: ${q.duration}ms`);
    });
    console.log("\n💡 Consider:");
    console.log("   - Check if indexes are being used (EXPLAIN query)");
    console.log("   - Optimize WHERE clauses");
    console.log("   - Consider adding more indexes");
  } else {
    console.log("✅ All queries are performing well (<500ms)");
  }
  
  const fastQueries = successfulQueries.filter(q => q.duration < 100);
  console.log(`\n✅ Fast queries (<100ms): ${fastQueries.length}/${successfulQueries.length}`);
  
  console.log("\n" + "=".repeat(60));
}

// Run tests
runPerformanceTests().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

