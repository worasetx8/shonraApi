/**
 * Create Test Products Script
 * สร้างสินค้าเทสเข้า database สำหรับการทดสอบ
 * 
 * Usage:
 *   node shonraApi/scripts/create-test-products.js [--count=5]
 * 
 * Options:
 *   --count=5  - จำนวนสินค้าที่จะสร้าง (default: 5)
 */

import { prepareProductData, saveProduct } from "../utils/productService.js";
import { executeQuery } from "../config/database.js";
import Logger from "../utils/logger.js";

const TEST_PREFIX = "TEST_";
const DEFAULT_COUNT = 5;

// ตัวอย่างข้อมูลสินค้าเทส
const TEST_PRODUCTS = [
  {
    productName: "เครื่องสำอางครีมบำรุงผิว",
    price: 299,
    priceMin: 250,
    priceMax: 350,
    commissionRate: 0.1,
    ratingStar: 4.5,
    salesCount: 1000,
    discountRate: 20,
    shopName: "ร้านเทสต์",
    shopId: "TEST_SHOP_001",
    imageUrl: "https://via.placeholder.com/300x300?text=Test+Product+1",
    productLink: "https://shopee.co.th/test-product-1",
    offerLink: "https://shopee.co.th/test-product-1?affiliate",
    category_id: null, // จะ auto-assign จาก productName
    is_flash_sale: false
  },
  {
    productName: "เสื้อผ้าแฟชั่นผู้หญิง",
    price: 599,
    priceMin: 500,
    priceMax: 700,
    commissionRate: 0.15,
    ratingStar: 4.8,
    salesCount: 2500,
    discountRate: 30,
    shopName: "ร้านแฟชั่นเทสต์",
    shopId: "TEST_SHOP_002",
    imageUrl: "https://via.placeholder.com/300x300?text=Test+Product+2",
    productLink: "https://shopee.co.th/test-product-2",
    offerLink: "https://shopee.co.th/test-product-2?affiliate",
    category_id: null,
    is_flash_sale: false
  },
  {
    productName: "อุปกรณ์อิเล็กทรอนิกส์มือถือ",
    price: 8999,
    priceMin: 8500,
    priceMax: 9500,
    commissionRate: 0.05,
    ratingStar: 4.7,
    salesCount: 500,
    discountRate: 10,
    shopName: "ร้านอิเล็กทรอนิกส์เทสต์",
    shopId: "TEST_SHOP_003",
    imageUrl: "https://via.placeholder.com/300x300?text=Test+Product+3",
    productLink: "https://shopee.co.th/test-product-3",
    offerLink: "https://shopee.co.th/test-product-3?affiliate",
    category_id: null,
    is_flash_sale: true,
    periodStartTime: Math.floor(Date.now() / 1000),
    periodEndTime: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
    campaignActive: true
  },
  {
    productName: "อาหารเสริมสุขภาพ",
    price: 1299,
    commissionRate: 0.12,
    ratingStar: 4.6,
    salesCount: 800,
    discountRate: 15,
    shopName: "ร้านสุขภาพเทสต์",
    shopId: "TEST_SHOP_004",
    imageUrl: "https://via.placeholder.com/300x300?text=Test+Product+4",
    productLink: "https://shopee.co.th/test-product-4",
    offerLink: "https://shopee.co.th/test-product-4?affiliate",
    category_id: null,
    is_flash_sale: false
  },
  {
    productName: "ของเล่นเด็ก",
    price: 399,
    commissionRate: 0.08,
    ratingStar: 4.9,
    salesCount: 1500,
    discountRate: 25,
    shopName: "ร้านของเล่นเทสต์",
    shopId: "TEST_SHOP_005",
    imageUrl: "https://via.placeholder.com/300x300?text=Test+Product+5",
    productLink: "https://shopee.co.th/test-product-5",
    offerLink: "https://shopee.co.th/test-product-5?affiliate",
    category_id: null,
    is_flash_sale: false
  }
];

async function createTestProducts(count = DEFAULT_COUNT) {
  console.log(`🚀 Creating ${count} test products...\n`);
  
  const results = {
    created: [],
    updated: [],
    failed: []
  };
  
  for (let i = 0; i < count; i++) {
    const template = TEST_PRODUCTS[i % TEST_PRODUCTS.length];
    const timestamp = Date.now();
    const itemId = `${TEST_PREFIX}${timestamp}_${i}`;
    
    const productData = {
      itemId: itemId,
      productName: `${template.productName} ${i + 1}`,
      price: template.price,
      priceMin: template.priceMin,
      priceMax: template.priceMax,
      commissionRate: template.commissionRate,
      ratingStar: template.ratingStar,
      sold: template.salesCount + i * 10, // Note: productService uses 'sold' field name
      discountRate: template.discountRate,
      shopName: template.shopName,
      shopId: template.shopId,
      imageUrl: template.imageUrl,
      productLink: template.productLink,
      offerLink: template.offerLink,
      category_id: template.category_id,
      is_flash_sale: template.is_flash_sale || false,
      periodStartTime: template.periodStartTime || 0,
      periodEndTime: template.periodEndTime || 0,
      campaignActive: template.campaignActive || false,
      source: "test-script"
    };
    
    try {
      console.log(`⏳ Creating product ${i + 1}/${count}: ${productData.productName}...`);
      
      // Prepare product data (auto-assign category)
      const preparedData = await prepareProductData(productData, {
        fromFrontend: false,
        autoAssignCategory: true
      });
      
      // Save product
      const result = await saveProduct(preparedData);
      
      if (result.action === "inserted") {
        console.log(`✅ Created: ${productData.productName} (ID: ${result.insertId}, Item ID: ${itemId})`);
        results.created.push({
          id: result.insertId,
          itemId: itemId,
          productName: productData.productName,
          categoryId: preparedData.categoryId
        });
      } else {
        console.log(`🔄 Updated: ${productData.productName} (Item ID: ${itemId})`);
        results.updated.push({
          itemId: itemId,
          productName: productData.productName
        });
      }
    } catch (error) {
      console.error(`❌ Failed to create product ${i + 1}:`, error.message);
      results.failed.push({
        itemId: itemId,
        productName: productData.productName,
        error: error.message
      });
    }
  }
  
  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary");
  console.log("=".repeat(60));
  console.log(`✅ Created: ${results.created.length}`);
  console.log(`🔄 Updated: ${results.updated.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  
  if (results.created.length > 0) {
    console.log("\n✅ Created Products:");
    results.created.forEach(p => {
      console.log(`   - ${p.productName} (Item ID: ${p.itemId}, Category ID: ${p.categoryId || 'None'})`);
    });
  }
  
  if (results.updated.length > 0) {
    console.log("\n🔄 Updated Products:");
    results.updated.forEach(p => {
      console.log(`   - ${p.productName} (Item ID: ${p.itemId})`);
    });
  }
  
  if (results.failed.length > 0) {
    console.log("\n❌ Failed Products:");
    results.failed.forEach(p => {
      console.log(`   - ${p.productName} (Item ID: ${p.itemId}): ${p.error}`);
    });
  }
  
  console.log("\n" + "=".repeat(60));
  console.log(`💡 To delete test products, run:`);
  console.log(`   node shonraApi/scripts/cleanup-test-products.js`);
  console.log("=".repeat(60) + "\n");
  
  return results;
}

// Parse command line arguments
const countArg = process.argv.find(arg => arg.startsWith("--count="));
const count = countArg ? parseInt(countArg.split("=")[1]) : DEFAULT_COUNT;

// Run script
createTestProducts(count).catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

