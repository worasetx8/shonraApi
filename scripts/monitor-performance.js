/**
 * Query Performance Monitoring Script
 * 
 * Monitors query performance in production
 * 
 * Usage:
 *   node shonraApi/scripts/monitor-performance.js [--interval=60000]
 * 
 * Options:
 *   --interval=60000  - Check interval in milliseconds (default: 60000 = 1 minute)
 */

import { executeQuery } from "../config/database.js";
import Logger from "../utils/logger.js";

const CHECK_INTERVAL = parseInt(process.argv.find(arg => arg.startsWith("--interval="))?.split("=")[1]) || 60000; // 1 minute default

// Performance thresholds
const THRESHOLDS = {
  slowQuery: 1000, // 1 second
  verySlowQuery: 5000, // 5 seconds
  highMemoryUsage: 100 * 1024 * 1024 // 100MB (if available)
};

// Monitoring data
const monitoringData = {
  startTime: Date.now(),
  queries: [],
  slowQueries: [],
  errors: []
};

async function checkSlowQueries() {
  try {
    // Check MySQL slow query log (if enabled)
    // Note: This requires performance_schema to be enabled in MySQL
    // Column names in events_statements_summary_by_digest:
    // - digest_text (not sql_text)
    // - count_star (not exec_count) - total number of times the statement was executed
    const result = await executeQuery(`
      SELECT 
        digest_text,
        count_star,
        avg_timer_wait / 1000000000000 as avg_time_sec,
        max_timer_wait / 1000000000000 as max_time_sec,
        sum_timer_wait / 1000000000000 as total_time_sec
      FROM performance_schema.events_statements_summary_by_digest
      WHERE avg_timer_wait / 1000000000000 > ${THRESHOLDS.slowQuery / 1000}
      ORDER BY avg_timer_wait DESC
      LIMIT 10
    `);
    
    if (result.success && result.data && result.data.length > 0) {
      Logger.warn(`[Performance Monitor] Found ${result.data.length} slow queries`);
      result.data.forEach(query => {
        // Handle case-insensitive column names
        const digestText = query.digest_text || query.DIGEST_TEXT || query['digest_text'] || "N/A";
        const execCount = query.count_star || query.COUNT_STAR || query['count_star'] || 0;
        const avgTime = query.avg_time_sec || query.AVG_TIME_SEC || query['avg_time_sec'] || 0;
        const maxTime = query.max_time_sec || query.MAX_TIME_SEC || query['max_time_sec'] || 0;
        
        monitoringData.slowQueries.push({
          query: typeof digestText === 'string' ? digestText.substring(0, 200) : "N/A",
          avgTime: avgTime,
          maxTime: maxTime,
          execCount: execCount,
          timestamp: new Date().toISOString()
        });
      });
    }
  } catch (error) {
    // performance_schema might not be available or enabled
    // This is OK, we'll use alternative monitoring
    // Suppress error logging for common cases where performance_schema is not available
    if (error.code === "ER_BAD_FIELD_ERROR" || 
        error.code === "ER_TABLEACCESS_DENIED_ERROR" ||
        error.message?.includes("Unknown column") ||
        error.message?.includes("doesn't exist")) {
      // Performance schema not available or not configured - this is OK
      Logger.debug(`[Performance Monitor] Performance schema not available (this is OK): ${error.message}`);
    } else {
      Logger.debug(`[Performance Monitor] Could not check slow queries: ${error.message}`);
    }
  }
}

async function checkTableStats() {
  try {
    const result = await executeQuery(`
      SELECT 
        table_name,
        table_rows,
        ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
      FROM information_schema.TABLES
      WHERE table_schema = DATABASE()
        AND table_name IN ('shopee_products', 'product_tags', 'categories', 'category_keywords')
      ORDER BY size_mb DESC
    `);
    
    if (result.success && result.data && result.data.length > 0) {
      Logger.info("[Performance Monitor] Table Statistics:");
      result.data.forEach(table => {
        // Handle case-insensitive column names
        const tableName = table.table_name || table.TABLE_NAME || table['table_name'];
        const tableRows = table.table_rows || table.TABLE_ROWS || table['table_rows'] || 0;
        const sizeMb = table.size_mb || table.SIZE_MB || table['size_mb'] || 0;
        
        if (tableName) {
          Logger.info(`  ${tableName}: ${tableRows.toLocaleString()} rows, ${sizeMb} MB`);
        }
      });
    } else {
      Logger.info("[Performance Monitor] Table Statistics:");
      Logger.info("  No table statistics available");
    }
  } catch (error) {
    Logger.debug(`[Performance Monitor] Could not check table stats: ${error.message}`);
    Logger.info("[Performance Monitor] Table Statistics:");
    Logger.info("  Could not retrieve table statistics");
  }
}

async function checkIndexUsage() {
  try {
    const result = await executeQuery(`
      SELECT 
        table_name,
        index_name,
        seq_in_index,
        column_name,
        cardinality
      FROM information_schema.STATISTICS
      WHERE table_schema = DATABASE()
        AND table_name IN ('shopee_products', 'product_tags', 'categories', 'category_keywords')
        AND index_name LIKE 'idx_%'
      ORDER BY table_name, index_name, seq_in_index
    `);
    
    if (result.success && result.data && result.data.length > 0) {
      const indexesByTable = {};
      result.data.forEach(idx => {
        // Handle case-insensitive column names (MySQL may return uppercase)
        const tableName = idx.table_name || idx.TABLE_NAME || idx['table_name'];
        const indexName = idx.index_name || idx.INDEX_NAME || idx['index_name'];
        
        if (tableName && indexName) {
          if (!indexesByTable[tableName]) {
            indexesByTable[tableName] = [];
          }
          indexesByTable[tableName].push(indexName);
        }
      });
      
      Logger.info("[Performance Monitor] Performance Indexes:");
      if (Object.keys(indexesByTable).length > 0) {
        Object.keys(indexesByTable).forEach(table => {
          const uniqueIndexes = [...new Set(indexesByTable[table])];
          Logger.info(`  ${table}: ${uniqueIndexes.length} indexes`);
          uniqueIndexes.forEach(idx => {
            Logger.info(`    - ${idx}`);
          });
        });
      } else {
        Logger.info("  No performance indexes found (idx_*)");
      }
    } else {
      Logger.info("[Performance Monitor] Performance Indexes:");
      Logger.info("  No performance indexes found (idx_*)");
    }
  } catch (error) {
    Logger.debug(`[Performance Monitor] Could not check index usage: ${error.message}`);
    Logger.info("[Performance Monitor] Performance Indexes:");
    Logger.info("  Could not retrieve index information");
  }
}

async function testQueryPerformance() {
  const testQueries = [
    {
      name: "Product Listing (Public)",
      query: async () => {
        const { buildProductQuery } = await import("../utils/productQueryBuilder.js");
        const { selectQuery, queryParams } = buildProductQuery({
          filters: { status: "all", categoryId: "all", tagId: "all", search: "" },
          limit: 50,
          offset: 0,
          onlyActive: true,
          includeAllFields: false
        });
        return await executeQuery(selectQuery, queryParams);
      }
    },
    {
      name: "COUNT Query",
      query: async () => {
        const { buildProductQuery } = await import("../utils/productQueryBuilder.js");
        const { countQuery, queryParams } = buildProductQuery({
          filters: { status: "all", categoryId: "all", tagId: "all", search: "" },
          onlyActive: true
        });
        return await executeQuery(countQuery, queryParams);
      }
    }
  ];
  
  for (const test of testQueries) {
    const startTime = Date.now();
    try {
      const result = await test.query();
      const duration = Date.now() - startTime;
      
      monitoringData.queries.push({
        name: test.name,
        duration,
        success: result.success,
        timestamp: new Date().toISOString()
      });
      
      if (duration > THRESHOLDS.slowQuery) {
        Logger.warn(`[Performance Monitor] Slow query detected: ${test.name} took ${duration}ms`);
      } else {
        Logger.debug(`[Performance Monitor] ${test.name}: ${duration}ms`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      monitoringData.errors.push({
        name: test.name,
        error: error.message,
        duration,
        timestamp: new Date().toISOString()
      });
      Logger.error(`[Performance Monitor] Query failed: ${test.name}`, error);
    }
  }
}

async function generateReport() {
  const uptime = Date.now() - monitoringData.startTime;
  const uptimeMinutes = Math.floor(uptime / 60000);
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 Performance Monitoring Report");
  console.log("=".repeat(60));
  console.log(`Uptime: ${uptimeMinutes} minutes`);
  console.log(`Total queries monitored: ${monitoringData.queries.length}`);
  console.log(`Slow queries detected: ${monitoringData.slowQueries.length}`);
  console.log(`Errors: ${monitoringData.errors.length}`);
  
  if (monitoringData.queries.length > 0) {
    const avgTime = monitoringData.queries.reduce((sum, q) => sum + q.duration, 0) / monitoringData.queries.length;
    const maxTime = Math.max(...monitoringData.queries.map(q => q.duration));
    const minTime = Math.min(...monitoringData.queries.map(q => q.duration));
    
    console.log(`\nQuery Performance:`);
    console.log(`  Average: ${Math.round(avgTime)}ms`);
    console.log(`  Min: ${minTime}ms`);
    console.log(`  Max: ${maxTime}ms`);
  }
  
  if (monitoringData.slowQueries.length > 0) {
    console.log(`\n⚠️  Slow Queries:`);
    monitoringData.slowQueries.slice(0, 5).forEach(q => {
      console.log(`  - ${q.query.substring(0, 100)}...`);
      console.log(`    Avg: ${q.avgTime.toFixed(2)}s, Max: ${q.maxTime.toFixed(2)}s, Executions: ${q.execCount}`);
    });
  }
  
  console.log("=".repeat(60) + "\n");
}

async function monitor() {
  console.log("🔍 Starting Performance Monitoring...");
  console.log(`Check interval: ${CHECK_INTERVAL / 1000} seconds\n`);
  
  // Initial checks
  await checkTableStats();
  await checkIndexUsage();
  
  // Monitoring loop
  let checkCount = 0;
  const monitorInterval = setInterval(async () => {
    checkCount++;
    Logger.info(`[Performance Monitor] Check #${checkCount} - ${new Date().toISOString()}`);
    
    await testQueryPerformance();
    await checkSlowQueries();
    
    // Generate report every 10 checks
    if (checkCount % 10 === 0) {
      await generateReport();
    }
  }, CHECK_INTERVAL);
  
  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n🛑 Stopping performance monitor...");
    clearInterval(monitorInterval);
    generateReport().then(() => {
      console.log("✅ Monitoring stopped");
      process.exit(0);
    });
  });
  
  // Generate initial report
  await generateReport();
}

// Run monitoring
monitor().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

