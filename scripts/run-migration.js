/**
 * Run Performance Indexes Migration
 * 
 * Usage:
 *   node shonraApi/scripts/run-migration.js
 * 
 * This script will:
 * 1. Read migration SQL file
 * 2. Execute each CREATE INDEX statement
 * 3. Verify indexes were created
 * 4. Show summary
 */

import { executeQuery } from "../config/database.js";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  console.log("🚀 Starting Performance Indexes Migration...\n");
  
  try {
    // Read migration file
    const migrationPath = join(__dirname, "..", "migrations", "add_performance_indexes.sql");
    const migrationSQL = await readFile(migrationPath, "utf-8");
    
    // Split SQL into individual statements
    // Remove comments and empty lines, then split by semicolon
    const cleanedSQL = migrationSQL
      .split("\n")
      .map(line => {
        // Remove inline comments
        const commentIndex = line.indexOf("--");
        if (commentIndex >= 0) {
          return line.substring(0, commentIndex).trim();
        }
        return line.trim();
      })
      .filter(line => line.length > 0 && !line.startsWith("/*") && !line.startsWith("*"))
      .join("\n");
    
    const statements = cleanedSQL
      .split(";")
      .map(s => s.trim())
      .filter(s => {
        const trimmed = s.trim();
        return trimmed.length > 0 && 
               !trimmed.startsWith("--") && 
               !trimmed.startsWith("/*") &&
               trimmed.toUpperCase().startsWith("CREATE INDEX");
      });
    
    console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
    
    const results = {
      success: [],
      failed: [],
      skipped: []
    };
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip comments and empty lines
      if (statement.startsWith("--") || statement.length === 0) {
        continue;
      }
      
      // Extract index name for logging
      const indexMatch = statement.match(/CREATE INDEX.*?(\w+)\s+ON/i);
      const indexName = indexMatch ? indexMatch[1] : `Statement ${i + 1}`;
      
      try {
        console.log(`⏳ Creating index: ${indexName}...`);
        
        // MySQL doesn't support IF NOT EXISTS for CREATE INDEX
        // So we'll catch duplicate key errors
        const result = await executeQuery(statement + ";");
        
        if (result.success) {
          console.log(`✅ Index created: ${indexName}\n`);
          results.success.push(indexName);
        } else {
          // Check if it's a duplicate key error
          if (result.error && result.error.code === "ER_DUP_KEYNAME") {
            console.log(`⚠️  Index already exists: ${indexName} (skipped)\n`);
            results.skipped.push(indexName);
          } else {
            throw new Error(result.error);
          }
        }
      } catch (error) {
        // Handle duplicate key error gracefully
        if (error.code === "ER_DUP_KEYNAME" || (error.message && error.message.includes("Duplicate key name"))) {
          console.log(`⚠️  Index already exists: ${indexName} (skipped)\n`);
          results.skipped.push(indexName);
        } else {
          console.error(`❌ Failed to create index ${indexName}:`, error.message);
          console.log(`   Statement: ${statement.substring(0, 100)}...\n`);
          results.failed.push({ name: indexName, error: error.message });
        }
      }
    }
    
    // Summary
    console.log("=".repeat(60));
    console.log("📊 Migration Summary");
    console.log("=".repeat(60));
    console.log(`✅ Successfully created: ${results.success.length}`);
    console.log(`⚠️  Already exists (skipped): ${results.skipped.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
      console.log("\n❌ Failed Indexes:");
      results.failed.forEach(f => {
        console.log(`   - ${f.name}: ${f.error}`);
      });
    }
    
    // Verify indexes
    console.log("\n" + "=".repeat(60));
    console.log("🔍 Verifying Indexes...");
    console.log("=".repeat(60));
    
    await verifyIndexes();
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ Migration completed!");
    console.log("=".repeat(60));
    
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

async function verifyIndexes() {
  const tables = [
    "shopee_products",
    "product_tags",
    "categories",
    "category_keywords"
  ];
  
  for (const table of tables) {
    try {
      const result = await executeQuery(`SHOW INDEXES FROM ${table}`);
      
      if (result.success) {
        const indexes = result.data.filter(idx => 
          idx.Key_name !== "PRIMARY" && 
          idx.Key_name.startsWith("idx_")
        );
        
        console.log(`\n📋 ${table}:`);
        if (indexes.length > 0) {
          indexes.forEach(idx => {
            console.log(`   ✅ ${idx.Key_name} (${idx.Column_name})`);
          });
        } else {
          console.log(`   ⚠️  No performance indexes found`);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to verify indexes for ${table}:`, error.message);
    }
  }
}

// Run migration
runMigration().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

