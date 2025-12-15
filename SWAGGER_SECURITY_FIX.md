# Swagger Security Fix

## ปัญหา
Swagger UI สามารถดึงข้อมูลได้ทุกเส้นโดยที่ยังไม่ได้ใส่ Authentication เพราะบาง endpoints ที่มี `requireAuth` แต่ยังไม่มี `security: bearerAuth` ใน Swagger docs

## การแก้ไข
เพิ่ม `security: bearerAuth` ให้กับทุก endpoint ที่มี `requireAuth` แต่ยังไม่มี security ใน Swagger docs

## สถานะการแก้ไข

### ✅ เสร็จแล้ว
- `routes/products.js` - เพิ่ม security ให้กับ:
  - POST /api/products/sync-single
  - PATCH /api/products/:id/status
  - PATCH /api/products/:id/flash-sale
  - DELETE /api/products/delete
  - DELETE /api/products/:id
  - GET /api/products/saved
  - PATCH /api/products/status

- `routes/categories.js` - เพิ่ม security ให้กับ:
  - PUT /api/categories/:id
  - PATCH /api/categories/:id/status
  - DELETE /api/categories/:id
  - GET /api/categories/:id/products
  - GET /api/categories/products/unassigned
  - POST /api/categories/unassign
  - POST /api/categories/:id/assign
  - POST /api/categories/:id/remove-product
  - POST /api/categories/:id/move-products

- `routes/tags.js` - เพิ่ม security ให้กับ:
  - GET /api/tags
  - POST /api/tags
  - PUT /api/tags/:id
  - PATCH /api/tags/:id/status
  - DELETE /api/tags/:id
  - GET /api/tags/:id/products
  - GET /api/tags/:id/products/unassigned
  - POST /api/tags/:id/assign
  - POST /api/tags/:id/remove-product
  - GET /api/tags/product/:itemId
  - POST /api/tags/product/:itemId

### ⏳ ยังต้องเพิ่ม
- `routes/banners.js` - ต้องเพิ่ม security ให้กับ:
  - GET /api/banners
  - POST /api/banners
  - PUT /api/banners/:id
  - PATCH /api/banners/:id/status
  - DELETE /api/banners/:id

- `routes/admin.js` - ต้องเพิ่ม security ให้กับ:
  - POST /api/admin/users
  - PATCH /api/admin/users/:id
  - POST /api/admin/users/:id/reset-password
  - PATCH /api/admin/users/:id/status
  - DELETE /api/admin/users/:id
  - GET /api/admin/stats

- `routes/upload.js` - ต้องเพิ่ม security ให้กับ:
  - POST /api/upload/banner
  - POST /api/upload/image
  - GET /api/upload/banners
  - GET /api/upload/banners/:filename/check
  - DELETE /api/upload/banners/:filename
  - GET /api/upload/all
  - DELETE /api/upload/:folder/:filename

- `routes/banner-positions.js` - ต้องเพิ่ม security ให้กับ:
  - GET /api/banner-positions
  - POST /api/banner-positions
  - PUT /api/banner-positions/:id
  - PATCH /api/banner-positions/:id/status
  - DELETE /api/banner-positions/:id

- `routes/banner-campaigns.js` - ต้องเพิ่ม security ให้กับ:
  - GET /api/banner-campaigns
  - POST /api/banner-campaigns
  - PUT /api/banner-campaigns/:id
  - PATCH /api/banner-campaigns/:id/status
  - DELETE /api/banner-campaigns/:id

- `routes/category-keywords.js` - ต้องเพิ่ม security ให้กับ:
  - GET /api/category-keywords/category/:categoryId
  - GET /api/category-keywords
  - POST /api/category-keywords
  - PUT /api/category-keywords/:id
  - DELETE /api/category-keywords/:id
  - POST /api/category-keywords/bulk

## หมายเหตุ
- Endpoints ที่เป็น public (เช่น `/api/products/search`, `/api/categories/public`) ไม่ต้องเพิ่ม security เพราะเป็น public endpoint จริงๆ
- Endpoints ที่มี `requireAuth` ต้องมี `security: bearerAuth` ใน Swagger docs เพื่อให้ Swagger UI บังคับให้ใส่ token

