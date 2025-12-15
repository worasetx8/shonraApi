/**
 * Complete Database Setup Script
 * This script handles:
 * 1. Database initialization
 * 2. Table creation with proper schema
 * 3. Data insertion from production SQL dumps
 * 4. Index creation for performance
 * 5. Category keywords population
 *
 * Usage: node setup-database.js
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const config = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME || "shopee_affiliate",
  multipleStatements: true
};

console.log("🚀 Starting Complete Database Setup...");
console.log("📊 Database:", config.database);
console.log("🔌 Host:", config.host + ":" + config.port);
console.log("=".repeat(80) + "\n");

async function executeQuery(connection, query, description) {
  try {
    console.log(`⏳ ${description}...`);
    await connection.query(query);
    console.log(`✅ ${description} - Success\n`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} - Failed:`, error.message);
    return false;
  }
}

async function setupDatabase() {
  let connection;

  try {
    // Connect without database first to create it
    const initConnection = await mysql.createConnection({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port
    });

    console.log("✅ Connected to MySQL server\n");

    // Create database if not exists
    await initConnection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
    console.log(`✅ Database '${config.database}' ensured\n`);
    await initConnection.end();

    // Connect to the database
    connection = await mysql.createConnection(config);
    console.log(`✅ Connected to database '${config.database}'\n`);
    console.log("=".repeat(80) + "\n");

    // ============================================================
    // STEP 1: CREATE ALL TABLES
    // ============================================================
    console.log("📦 STEP 1: Creating Tables...\n");

    // 1. Roles table (no dependencies)
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create roles table"
    );

    // 2. Admin Users table (depends on roles)
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NULL,
        password_hash VARCHAR(255) NULL,
        email VARCHAR(100) NULL,
        full_name VARCHAR(100) NULL,
        status ENUM('active', 'inactive') DEFAULT 'active',
        role_id INT NULL,
        failed_login_attempts INT DEFAULT 0,
        locked_until TIMESTAMP NULL DEFAULT NULL,
        last_login_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_username (username),
        KEY idx_admin_users_username (username),
        KEY idx_admin_users_role_id (role_id),
        KEY idx_admin_users_status (status),
        CONSTRAINT fk_user_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create admin_users table"
    );

    // 3. Categories table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_name (name),
        KEY idx_categories_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create categories table"
    );

    // 4. Tags table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_name (name),
        KEY idx_tags_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create tags table"
    );

    // 5. Shopee Products table (depends on categories)
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS shopee_products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_id VARCHAR(50) UNIQUE NOT NULL,
        product_name VARCHAR(500) NULL,
        shop_id VARCHAR(50) NULL,
        shop_name VARCHAR(255) NULL,
        price DECIMAL(15,2) NULL,
        price_min DECIMAL(15,2) NULL,
        price_max DECIMAL(15,2) NULL,
        seller_commission_rate DECIMAL(5,2) NULL,
        shopee_commission_rate DECIMAL(5,2) NULL,
        default_commission_rate DECIMAL(5,2) NULL,
        image_url LONGTEXT NULL,
        product_link LONGTEXT NULL,
        offer_link LONGTEXT NULL,
        rating_star DECIMAL(3,2) NULL,
        historical_sold INT NULL,
        discount VARCHAR(50) NULL,
        start_time DATETIME NULL,
        end_time DATETIME NULL,
        is_flash_sale BOOLEAN DEFAULT FALSE,
        notes LONGTEXT NULL,
        status ENUM('active', 'inactive', 'out_of_stock') DEFAULT 'active',
        category_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_shopee_products_item_id (item_id),
        KEY idx_shopee_products_category (category_id),
        KEY idx_shopee_products_status (status),
        KEY idx_shopee_products_is_flash_sale (is_flash_sale),
        KEY idx_shopee_products_created_at (created_at),
        CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create shopee_products table"
    );

    // 6. Product Tags junction table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS product_tags (
        product_item_id VARCHAR(50) NOT NULL,
        tag_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (product_item_id, tag_id),
        KEY idx_product_item_id (product_item_id),
        KEY idx_product_tags_tag_id (tag_id),
        KEY idx_product_tags_item_id (product_item_id),
        KEY idx_product_tags_composite (tag_id, product_item_id),
        CONSTRAINT product_tags_ibfk_1 FOREIGN KEY (product_item_id) REFERENCES shopee_products (item_id) ON DELETE CASCADE,
        CONSTRAINT product_tags_ibfk_2 FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create product_tags table"
    );

    // 7. Category Keywords table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS category_keywords (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        is_priority TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_category_keyword (category_id, keyword),
        CONSTRAINT category_keywords_ibfk_1 FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
      "Create category_keywords table"
    );

    // 8. Banner Positions table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS banner_positions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        width INT NOT NULL,
        height INT NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_name (name),
        KEY idx_banner_positions_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create banner_positions table"
    );

    // 9. Banner Campaigns table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS banner_campaigns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        start_time DATETIME NULL,
        end_time DATETIME NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_name (name),
        KEY idx_banner_campaigns_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create banner_campaigns table"
    );

    // 10. Banners table (depends on banner_positions, banner_campaigns)
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        position_id INT NOT NULL,
        campaign_id INT NULL,
        image_url LONGTEXT NOT NULL,
        target_url TEXT NULL,
        alt_text VARCHAR(255) NULL,
        title VARCHAR(255) NULL,
        description TEXT NULL,
        sort_order INT DEFAULT 0,
        open_new_tab TINYINT(1) DEFAULT 0,
        start_time DATETIME NULL,
        end_time DATETIME NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_banners_position_id (position_id),
        KEY idx_banners_is_active (is_active),
        KEY idx_banners_composite (position_id, is_active),
        KEY campaign_id (campaign_id),
        CONSTRAINT banners_ibfk_1 FOREIGN KEY (position_id) REFERENCES banner_positions (id),
        CONSTRAINT banners_ibfk_2 FOREIGN KEY (campaign_id) REFERENCES banner_campaigns (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create banners table"
    );

    // 11. Permissions table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS permissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        description TEXT NULL,
        category VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_slug (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create permissions table"
    );

    // 12. Role Permissions junction table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INT NOT NULL,
        permission_id INT NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        KEY idx_role_id (role_id),
        KEY permission_id (permission_id),
        CONSTRAINT role_permissions_ibfk_1 FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
        CONSTRAINT role_permissions_ibfk_2 FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create role_permissions table"
    );

    // 13. Admin Activity Logs table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS admin_activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_user_id INT NULL,
        action VARCHAR(255) NOT NULL,
        details TEXT NULL,
        ip_address VARCHAR(45) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY admin_user_id (admin_user_id),
        CONSTRAINT admin_activity_logs_ibfk_1 FOREIGN KEY (admin_user_id) REFERENCES admin_users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create admin_activity_logs table"
    );

    // 14. Social Media table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS social_media (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        icon_url VARCHAR(255) NULL,
        url VARCHAR(500) NULL,
        is_active TINYINT(1) DEFAULT 1,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_social_media_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create social_media table"
    );

    // 15. Settings table
    await executeQuery(
      connection,
      `
      CREATE TABLE IF NOT EXISTS settings (
        id INT NOT NULL DEFAULT 1 PRIMARY KEY,
        site_name VARCHAR(255) NULL,
        site_description TEXT NULL,
        contact_email VARCHAR(255) NULL,
        contact_phone VARCHAR(50) NULL,
        maintenance_mode TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
      "Create settings table"
    );

    console.log("=".repeat(80) + "\n");

    // ============================================================
    // STEP 2: INSERT DATA FROM SQL DUMPS
    // ============================================================
    console.log("📝 STEP 2: Inserting Data...\n");

    // Roles
    await executeQuery(
      connection,
      `
      REPLACE INTO roles (id, name, description, created_at, updated_at) VALUES
      (1, 'Super Admin', 'Full access to all features', '2025-11-23 10:07:40', '2025-11-23 10:07:40'),
      (2, 'Admin', 'Can manage content and users', '2025-11-23 10:07:40', '2025-11-23 10:07:40'),
      (3, 'Editor', 'Can manage content', '2025-11-23 10:07:40', '2025-11-23 10:07:40'),
      (4, 'Viewer', 'Read-only access', '2025-11-23 10:07:40', '2025-11-23 10:07:40')
    `,
      "Insert roles"
    );

    // Permissions (28 records)
    await executeQuery(
      connection,
      `
      REPLACE INTO permissions (id, name, slug, description, category, created_at) VALUES
      (1, 'View Products', 'view_products', NULL, 'Products', '2025-11-23 10:07:40'),
      (2, 'Create Products', 'create_products', NULL, 'Products', '2025-11-23 10:07:40'),
      (3, 'Edit Products', 'edit_products', NULL, 'Products', '2025-11-23 10:07:40'),
      (4, 'Delete Products', 'delete_products', NULL, 'Products', '2025-11-23 10:07:40'),
      (5, 'View Categories', 'view_categories', NULL, 'Categories', '2025-11-23 10:07:40'),
      (6, 'Create Categories', 'create_categories', NULL, 'Categories', '2025-11-23 10:07:40'),
      (7, 'Edit Categories', 'edit_categories', NULL, 'Categories', '2025-11-23 10:07:40'),
      (8, 'Delete Categories', 'delete_categories', NULL, 'Categories', '2025-11-23 10:07:40'),
      (9, 'View Tags', 'view_tags', NULL, 'Tags', '2025-11-23 10:07:40'),
      (10, 'Create Tags', 'create_tags', NULL, 'Tags', '2025-11-23 10:07:40'),
      (11, 'Edit Tags', 'edit_tags', NULL, 'Tags', '2025-11-23 10:07:40'),
      (12, 'Delete Tags', 'delete_tags', NULL, 'Tags', '2025-11-23 10:07:40'),
      (13, 'View Banners', 'view_banners', NULL, 'Banners', '2025-11-23 10:07:40'),
      (14, 'Create Banners', 'create_banners', NULL, 'Banners', '2025-11-23 10:07:40'),
      (15, 'Edit Banners', 'edit_banners', NULL, 'Banners', '2025-11-23 10:07:40'),
      (16, 'Delete Banners', 'delete_banners', NULL, 'Banners', '2025-11-23 10:07:40'),
      (17, 'View Settings', 'view_settings', NULL, 'Settings', '2025-11-23 10:07:40'),
      (18, 'Create Settings', 'create_settings', NULL, 'Settings', '2025-11-23 10:07:40'),
      (19, 'Edit Settings', 'edit_settings', NULL, 'Settings', '2025-11-23 10:07:40'),
      (20, 'Delete Settings', 'delete_settings', NULL, 'Settings', '2025-11-23 10:07:40'),
      (21, 'View Admin Users', 'view_admin_users', NULL, 'Admin Users', '2025-11-23 10:07:40'),
      (22, 'Create Admin Users', 'create_admin_users', NULL, 'Admin Users', '2025-11-23 10:07:40'),
      (23, 'Edit Admin Users', 'edit_admin_users', NULL, 'Admin Users', '2025-11-23 10:07:40'),
      (24, 'Delete Admin Users', 'delete_admin_users', NULL, 'Admin Users', '2025-11-23 10:07:40'),
      (25, 'View Roles', 'view_roles', NULL, 'Roles', '2025-11-23 10:07:40'),
      (26, 'Create Roles', 'create_roles', NULL, 'Roles', '2025-11-23 10:07:40'),
      (27, 'Edit Roles', 'edit_roles', NULL, 'Roles', '2025-11-23 10:07:40'),
      (28, 'Delete Roles', 'delete_roles', NULL, 'Roles', '2025-11-23 10:07:40')
    `,
      "Insert permissions"
    );

    // Role Permissions (62 mappings)
    await executeQuery(
      connection,
      `
      REPLACE INTO role_permissions (role_id, permission_id) VALUES
      (1,1),(2,1),(3,1),(4,1),
      (1,2),(2,2),(3,2),
      (1,3),(2,3),
      (1,4),(2,4),
      (1,5),(2,5),(3,5),
      (1,6),(2,6),(3,6),
      (1,7),(2,7),
      (1,8),(2,8),
      (1,9),(2,9),(3,9),
      (1,10),(2,10),(3,10),
      (1,11),(2,11),
      (1,12),(2,12),
      (1,13),(2,13),(3,13),(4,13),
      (1,14),(2,14),(3,14),
      (1,15),(2,15),
      (1,16),(2,16),
      (1,17),(1,18),(1,19),(1,20),
      (1,21),(2,21),
      (1,22),(2,22),
      (1,23),(2,23),
      (1,24),(2,24),
      (1,25),(2,25),
      (1,26),(2,26),
      (1,27),(2,27),
      (1,28),(2,28)
    `,
      "Insert role permissions"
    );

    // Admin Users (with password_hash from SQL dump)
    await executeQuery(
      connection,
      `
      REPLACE INTO admin_users (id, username, password, password_hash, email, full_name, status, role_id, failed_login_attempts, locked_until, last_login_at, created_at, updated_at) VALUES
      (1, 'admin', NULL, 'def1d7374d36868512439415e593eb2b:6877475d3a2d2c6a013f5d242c4a99a838e703dd81becf9ae5dd7acd237e6c25fafcaa31979ba23133620f97c07050dddefec669b403c564727c10ff64069063', 'admin@example.com', 'Admin User', 'active', 1, 0, NULL, NULL, '2025-11-22 15:04:49', '2025-11-30 12:41:19'),
      (4, 'Admin2', NULL, 'd36782bb62e459062692c3a04db4c2c8:92325927c3892cdd1b7b1123cd0964310c5a98b14290180458b12cc36fe986e23a66b3934a1109f4ce474a8fbfd444709ce904719d50a2e4d21e18419c6b935d', 'admin', '', 'active', 2, 0, NULL, NULL, '2025-11-23 12:44:47', '2025-11-30 13:23:02'),
      (6, 'editor', NULL, '298c0e0eab5e4128dec28557ab8768a0:83b5abf8588103b44bbfca484ab2e8a497105e5d462903a871d0245a159d1ae481f1db373455b6d7f2906a323cdc62573a19b319789daee845f308e4d9878258', '', '', 'active', 3, 0, NULL, NULL, '2025-11-23 12:51:51', '2025-11-23 12:51:51')
    `,
      "Insert admin users"
    );

    // Categories
    await executeQuery(
      connection,
      `
      REPLACE INTO categories (id, name, created_at, updated_at, is_active) VALUES
      (7, 'Health & Beauty', '2025-11-23 04:16:53', '2025-11-23 04:16:53', 1),
      (8, 'Electronics', '2025-11-23 04:18:19', '2025-11-30 16:22:32', 1),
      (9, 'Fashion & Accessories', '2025-11-23 04:18:42', '2025-11-23 04:18:42', 1),
      (10, 'Home & Living', '2025-11-23 04:18:51', '2025-11-23 04:18:51', 1),
      (11, 'Family', '2025-11-23 04:19:48', '2025-11-23 04:19:48', 1),
      (12, 'Toys & Pets', '2025-11-23 04:19:56', '2025-11-23 04:19:56', 1),
      (14, 'Food & Beverage', '2025-11-29 11:01:04', '2025-12-07 14:55:51', 1)
    `,
      "Insert categories"
    );

    // Tags
    await executeQuery(
      connection,
      `
      REPLACE INTO tags (id, name, is_active, created_at, updated_at) VALUES
      (3, 'Skincare', 1, '2025-11-23 04:54:18', '2025-11-23 04:54:18'),
      (4, 'Makeup', 1, '2025-11-23 04:54:58', '2025-11-23 04:54:58')
    `,
      "Insert tags"
    );

    // Banner Positions
    await executeQuery(
      connection,
      `
      REPLACE INTO banner_positions (id, name, width, height, is_active, created_at, updated_at) VALUES
      (1, 'Homepage Top Banner', 1920, 600, 1, '2025-11-23 05:46:27', '2025-11-23 05:46:27'),
      (4, 'Banner Ads', 800, 800, 1, '2025-11-23 05:57:49', '2025-11-23 05:57:49'),
      (5, 'Flash Sale Banner', 1200, 240, 1, '2025-11-29 06:36:47', '2025-11-29 06:36:47'),
      (6, 'Banner Popup', 500, 500, 1, '2025-11-29 11:17:10', '2025-11-29 11:17:10')
    `,
      "Insert banner positions"
    );

    // Banner Campaigns
    await executeQuery(
      connection,
      `
      REPLACE INTO banner_campaigns (id, name, start_time, end_time, is_active, created_at, updated_at) VALUES
      (3, 'Black Friday', '2025-11-22 09:50:00', '2025-12-01 23:59:00', 0, '2025-11-23 05:50:03', '2025-12-07 02:54:20')
    `,
      "Insert banner campaigns"
    );

    // Banners
    await executeQuery(
      connection,
      `
      REPLACE INTO banners (id, position_id, campaign_id, image_url, target_url, alt_text, title, description, sort_order, open_new_tab, start_time, end_time, is_active, created_at, updated_at) VALUES
      (6, 5, NULL, '/api/uploads/banners/banner-1765093162698-1765093162707-660513297.jpg', 'https://s.shopee.co.th/9fDRryHKav', '', '', '', 0, 1, NULL, NULL, 1, '2025-11-29 07:39:22', '2025-12-07 07:39:25'),
      (7, 6, NULL, '/api/uploads/banners/banner-1765079322112-1765079322117-886687148.jpg', 'https://shopee.co.th/-%E0%B8%AA%E0%B9%88%E0%B8%87%E0%B8%9F%E0%B8%A3%E0%B8%B5-Dr.JiLL-Advanced-Serum-%E0%B8%94%E0%B8%A3.%E0%B8%88%E0%B8%B4%E0%B8%A5-%E0%B8%AA%E0%B8%B9%E0%B8%95%E0%B8%A3%E0%B9%83%E0%B8%AB%E0%B8%A1%E0%B9%88-2-%E0%B8%82%E0%B8%A7%E0%B8%94-%E0%B8%82%E0%B8%99%E0%B8%B2%E0%B8%94-30-ml-%E0%B9%80%E0%B8%8B%E0%B8%A3%E0%B8%B1%E0%B9%88%E0%B8%A1%E0%B8%84%E0%B8%B8%E0%B8%93%E0%B8%AB%E0%B8%A1%E0%B8%AD-i.504643137.8987241599', '', '', '', 0, 1, NULL, NULL, 1, '2025-11-29 11:18:21', '2025-12-07 03:48:45'),
      (8, 6, NULL, '/api/uploads/banners/banner-1765079335640-1765079335645-735386248.jpg', 'https://shopee.co.th/', '', '', '', 1, 1, NULL, NULL, 1, '2025-11-29 11:41:46', '2025-12-07 03:48:59')
    `,
      "Insert banners"
    );

    console.log("=".repeat(80) + "\n");

    // ============================================================
    // STEP 3: FINAL SUMMARY
    // ============================================================
    console.log("📊 STEP 3: Verification...\n");

    const [tables] = await connection.query("SHOW TABLES");
    console.log(`✅ Total tables created: ${tables.length}`);

    const counts = await Promise.all([
      connection.query("SELECT COUNT(*) as count FROM roles"),
      connection.query("SELECT COUNT(*) as count FROM permissions"),
      connection.query("SELECT COUNT(*) as count FROM role_permissions"),
      connection.query("SELECT COUNT(*) as count FROM admin_users"),
      connection.query("SELECT COUNT(*) as count FROM categories"),
      connection.query("SELECT COUNT(*) as count FROM tags"),
      connection.query("SELECT COUNT(*) as count FROM banner_positions"),
      connection.query("SELECT COUNT(*) as count FROM banner_campaigns"),
      connection.query("SELECT COUNT(*) as count FROM banners")
    ]);

    console.log("\n📈 Data Summary:");
    console.log(`   Roles: ${counts[0][0][0].count}`);
    console.log(`   Permissions: ${counts[1][0][0].count}`);
    console.log(`   Role Permissions: ${counts[2][0][0].count}`);
    console.log(`   Admin Users: ${counts[3][0][0].count}`);
    console.log(`   Categories: ${counts[4][0][0].count}`);
    console.log(`   Tags: ${counts[5][0][0].count}`);
    console.log(`   Banner Positions: ${counts[6][0][0].count}`);
    console.log(`   Banner Campaigns: ${counts[7][0][0].count}`);
    console.log(`   Banners: ${counts[8][0][0].count}`);

    console.log("\n" + "=".repeat(80));
    console.log("🎉 Database setup completed successfully!");
    console.log("=".repeat(80) + "\n");

    console.log("📝 Next steps:");
    console.log("   1. Start your server: npm run dev");
    console.log("   2. Login with: admin / (check password in database)");
    console.log("   3. Add category keywords via migration if needed\n");
  } catch (error) {
    console.error("\n❌ Fatal Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log("👋 Database connection closed\n");
    }
  }
}

// Run the setup
setupDatabase();
