-- Performance Optimization Indexes
-- Created: $(date)
-- Purpose: Add indexes to improve query performance based on QUERY_PERFORMANCE_ANALYSIS.md

-- ============================================
-- shopee_products table indexes
-- ============================================

-- Status filter (used very frequently)
-- Note: MySQL doesn't support IF NOT EXISTS for CREATE INDEX, so duplicate errors will be handled by script
CREATE INDEX idx_status ON shopee_products(status);

-- Category filter
CREATE INDEX idx_category_id ON shopee_products(category_id);

-- Updated_at for sorting (DESC order)
CREATE INDEX idx_updated_at ON shopee_products(updated_at DESC);

-- Composite index for common filters (status + category + sorting)
CREATE INDEX idx_status_category ON shopee_products(status, category_id, updated_at DESC);

-- Flash sale filters (status + is_flash_sale + time range)
CREATE INDEX idx_flash_sale_status ON shopee_products(status, is_flash_sale, period_start_time, period_end_time);

-- Composite index for flash sale query optimization
CREATE INDEX idx_flash_sale_composite ON shopee_products(status, is_flash_sale, price, sales_count, updated_at DESC);

-- FULLTEXT index for product search (product_name and shop_name)
-- Note: FULLTEXT index requires MyISAM or InnoDB with innodb_ft_min_token_size setting
-- Check if FULLTEXT is supported before creating
-- CREATE FULLTEXT INDEX IF NOT EXISTS idx_product_search ON shopee_products(product_name, shop_name);

-- ============================================
-- product_tags table indexes
-- ============================================

-- Index for tag filtering (if not exists as part of primary key)
CREATE INDEX idx_tag_id ON product_tags(tag_id);

-- Index for product lookup (if not exists as part of primary key)
CREATE INDEX idx_product_item_id ON product_tags(product_item_id);

-- ============================================
-- categories table indexes
-- ============================================

-- Active filter
CREATE INDEX idx_is_active ON categories(is_active);

-- ============================================
-- category_keywords table indexes
-- ============================================

-- Index for category lookup (if not exists as part of primary key)
CREATE INDEX idx_category_id ON category_keywords(category_id);

-- ============================================
-- Verify indexes
-- ============================================

-- Run these queries to verify indexes were created:
-- SHOW INDEXES FROM shopee_products;
-- SHOW INDEXES FROM product_tags;
-- SHOW INDEXES FROM categories;
-- SHOW INDEXES FROM category_keywords;

