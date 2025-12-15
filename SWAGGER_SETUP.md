# Swagger API Documentation Setup

## 📦 Installation

รันคำสั่งนี้เพื่อติดตั้ง packages:

```bash
npm install
```

Packages ที่เพิ่ม:
- `swagger-jsdoc` - สำหรับสร้าง Swagger spec จาก JSDoc comments
- `swagger-ui-express` - สำหรับแสดง Swagger UI

## 🚀 การใช้งาน

### 1. เริ่ม Server

```bash
npm run dev
```

### 2. เปิด Swagger UI

เปิด browser ไปที่:
```
http://localhost:3002/api-docs
```

## 📝 การเพิ่ม Documentation

Swagger documentation ถูกสร้างจาก JSDoc comments ใน route files

### ตัวอย่าง:

```javascript
/**
 * @swagger
 * /api/products/search:
 *   get:
 *     summary: Search products from Shopee API
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 */
router.get("/search", async (req, res) => {
  // ... handler code
});
```

## 📚 Documentation Structure

- **Schemas**: กำหนดไว้ใน `config/swagger.js`
- **Tags**: จัดกลุ่ม endpoints ตามหมวดหมู่
- **Security**: ใช้ Bearer Token authentication

## 🔐 Authentication

1. Login ผ่าน `/api/auth/login` เพื่อได้ token
2. คลิกปุ่ม "Authorize" ใน Swagger UI
3. ใส่ token ในรูปแบบ: `Bearer YOUR_TOKEN`
4. ทุก endpoint ที่ต้องการ auth จะใช้ token นี้

## 📋 Endpoints ที่มี Documentation

- ✅ Authentication (`/api/auth/*`)
- ✅ Health Check (`/health`, `/api/health/db`)
- ⏳ Products (กำลังเพิ่ม)
- ⏳ Categories (กำลังเพิ่ม)
- ⏳ Tags (กำลังเพิ่ม)
- ⏳ Settings (กำลังเพิ่ม)
- ⏳ และอื่นๆ

## 🎯 Next Steps

เพิ่ม JSDoc comments ใน route files อื่นๆ เพื่อให้มี documentation ครบทุก endpoint

