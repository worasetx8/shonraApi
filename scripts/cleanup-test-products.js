/**
 * Cleanup Test Products Script
 * ลบสินค้าเทสออกจาก database
 * 
 * Usage:
 *   node shonraApi/scripts/cleanup-test-products.js [--confirm] [--by-name]
 * 
 * Options:
 *   --confirm  - ยืนยันการลบ (ถ้าไม่มีจะแสดง preview เท่านั้น)
 *   --by-name  - ลบตามชื่อสินค้าที่มีคำว่า "test" (case-insensitive)
 *                 ถ้าไม่มีจะลบตาม item_id ที่ขึ้นต้นด้วย "TEST_"
 */

import { executeQuery } from "../config/database.js";
import Logger from "../utils/logger.js";

const TEST_PREFIX = "TEST_";

async function cleanupTestProducts(confirm = false, byName = false) {
  console.log("🔍 Searching for test products...\n");
  
  try {
    let findQuery, findParams, deleteQuery, deleteParams, deleteTagsQuery, deleteTagsParams;
    
    if (byName) {
      // Find by product name containing "test" (case-insensitive)
      console.log("📝 Mode: Searching by product name containing 'test'\n");
      findQuery = `
        SELECT 
          id, item_id, product_name, shop_name, 
          price, status, created_at, category_id
        FROM shopee_products
        WHERE LOWER(product_name) LIKE ?
        ORDER BY created_at DESC
      `;
      findParams = ['%test%'];
      
      deleteQuery = `
        DELETE FROM shopee_products
        WHERE LOWER(product_name) LIKE ?
      `;
      deleteParams = ['%test%'];
      
      deleteTagsQuery = `
        DELETE pt FROM product_tags pt
        INNER JOIN shopee_products p ON pt.product_item_id = p.item_id
        WHERE LOWER(p.product_name) LIKE ?
      `;
      deleteTagsParams = ['%test%'];
    } else {
      // Find by item_id starting with TEST_
      console.log("📝 Mode: Searching by item_id starting with 'TEST_'\n");
      findQuery = `
        SELECT 
          id, item_id, product_name, shop_name, 
          price, status, created_at, category_id
        FROM shopee_products
        WHERE item_id LIKE ?
        ORDER BY created_at DESC
      `;
      findParams = [`${TEST_PREFIX}%`];
      
      deleteQuery = `
        DELETE FROM shopee_products
        WHERE item_id LIKE ?
      `;
      deleteParams = [`${TEST_PREFIX}%`];
      
      deleteTagsQuery = `
        DELETE pt FROM product_tags pt
        INNER JOIN shopee_products p ON pt.product_item_id = p.item_id
        WHERE p.item_id LIKE ?
      `;
      deleteTagsParams = [`${TEST_PREFIX}%`];
    }
    
    const findResult = await executeQuery(findQuery, findParams);
    
    if (!findResult.success) {
      throw new Error(`Failed to find test products: ${findResult.error}`);
    }
    
    const testProducts = findResult.data || [];
    
    if (testProducts.length === 0) {
      console.log("✅ No test products found!");
      if (byName) {
        console.log(`   (Looking for products with name containing "test")`);
      } else {
        console.log(`   (Looking for products with item_id starting with "${TEST_PREFIX}")`);
      }
      return;
    }
    
    console.log(`📋 Found ${testProducts.length} test products:\n`);
    
    // Display products
    testProducts.forEach((product, index) => {
      const createdAt = product.created_at ? new Date(product.created_at).toLocaleString('th-TH') : 'N/A';
      console.log(`${index + 1}. ${product.product_name}`);
      console.log(`   Item ID: ${product.item_id}`);
      console.log(`   Price: ${product.price} THB`);
      console.log(`   Status: ${product.status}`);
      console.log(`   Created: ${createdAt}`);
      console.log("");
    });
    
    if (!confirm) {
      console.log("=".repeat(60));
      console.log("⚠️  Preview mode - No products were deleted");
      console.log("=".repeat(60));
      console.log(`💡 To delete these products, run:`);
      console.log(`   node shonraApi/scripts/cleanup-test-products.js --confirm`);
      console.log("=".repeat(60) + "\n");
      return;
    }
    
    // Confirm deletion
    console.log("=".repeat(60));
    console.log(`⚠️  WARNING: About to delete ${testProducts.length} test products`);
    console.log("=".repeat(60));
    
    // Delete products
    const deleteResult = await executeQuery(deleteQuery, deleteParams);
    
    if (!deleteResult.success) {
      throw new Error(`Failed to delete test products: ${deleteResult.error}`);
    }
    
    const deletedCount = deleteResult.data.affectedRows || 0;
    
    // Also delete related product_tags if any
    const deleteTagsResult = await executeQuery(deleteTagsQuery, deleteTagsParams);
    const deletedTagsCount = deleteTagsResult.success ? (deleteTagsResult.data?.affectedRows || 0) : 0;
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ Cleanup Complete");
    console.log("=".repeat(60));
    console.log(`🗑️  Deleted products: ${deletedCount}`);
    if (deletedTagsCount > 0) {
      console.log(`🏷️  Deleted product tags: ${deletedTagsCount}`);
    }
    console.log("=".repeat(60) + "\n");
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Parse command line arguments
const confirm = process.argv.includes("--confirm");
const byName = process.argv.includes("--by-name");

// Run script
cleanupTestProducts(confirm, byName).catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

