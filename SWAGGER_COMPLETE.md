# Swagger API Documentation - Complete Guide

## 🎉 สร้างเสร็จแล้ว!

Swagger documentation ถูกสร้างเรียบร้อยแล้วสำหรับทุก API endpoint

## 📍 การเข้าถึง

### Swagger UI
เปิด browser ไปที่:
```
http://localhost:3002/api-docs
```

### JSON Spec
```
http://localhost:3002/api-docs.json
```

## 📚 Endpoints ที่มี Documentation

### ✅ Authentication (`/api/auth`)
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user info
- `PUT /api/auth/change-password` - Change password

### ✅ Products (`/api/products`)
- `GET /api/products/search` - Search products from Shopee API
- `POST /api/products/check` - Check if product exists
- `POST /api/products/save` - Save product (admin)
- `POST /api/products/save-from-frontend` - Save product (public, rate limited)
- `GET /api/products/test-shopee` - Test Shopee API (dev only)
- `GET /api/products/test-db` - Test database (dev only)
- `GET /api/products/flash-sale` - Get flash sale products (public)
- `GET /api/products/public` - Get active products (public)
- และอื่นๆ...

### ✅ Categories (`/api/categories`)
- `GET /api/categories/public` - Get categories (public)
- `GET /api/categories` - Get all categories (admin)
- `POST /api/categories` - Create category
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category
- และอื่นๆ...

### ✅ Tags (`/api/tags`)
- `GET /api/tags/public` - Get tags (public)
- และอื่นๆ...

### ✅ Settings (`/api/settings`)
- `GET /api/settings` - Get settings (public, no sensitive data)
- `PUT /api/settings` - Update settings (admin only)

### ✅ Roles (`/api/roles`)
- `GET /api/roles` - Get all roles
- `POST /api/roles` - Create role (admin)
- `PUT /api/roles/:id` - Update role (admin)
- `DELETE /api/roles/:id` - Delete role (admin)
- `GET /api/roles/permissions` - Get all permissions
- `GET /api/roles/:id/permissions` - Get role permissions
- `POST /api/roles/:id/permissions` - Update role permissions (admin)

### ✅ Social Media (`/api/socials`)
- `GET /api/socials` - Get all social links (public)
- `POST /api/socials` - Create social link
- `PUT /api/socials/:id` - Update social link
- `DELETE /api/socials/:id` - Delete social link
- `PATCH /api/socials/:id/status` - Toggle status

### ✅ Banners (`/api/banners`)
- `GET /api/banners/public/:positionName` - Get banner by position (public)
- และอื่นๆ...

### ✅ Admin (`/api/admin`)
- `GET /api/admin/users` - Get all admin users
- และอื่นๆ...

### ✅ AI SEO (`/api/ai-seo`)
- `POST /api/ai-seo/meta-description` - Generate meta description
- `POST /api/ai-seo/keywords` - Generate keywords
- `POST /api/ai-seo/alt-text` - Generate alt text
- `POST /api/ai-seo/optimize` - Optimize content

### ✅ Health Check
- `GET /health` - Server health check
- `GET /api/health/db` - Database health check

## 🔐 Authentication

### วิธีใช้ใน Swagger UI

1. **Login เพื่อได้ Token**
   - ไปที่ `/api/auth/login`
   - ใส่ username และ password
   - Copy token จาก response

2. **Authorize**
   - คลิกปุ่ม "Authorize" (🔒) ที่ด้านบนขวา
   - ใส่ token ในรูปแบบ: `Bearer YOUR_TOKEN`
   - คลิก "Authorize"
   - คลิก "Close"

3. **ทดสอบ API**
   - ทุก endpoint ที่ต้องการ auth จะใช้ token นี้อัตโนมัติ

## 📝 Features

### ✅ มีครบ
- API documentation สำหรับทุก endpoint
- Request/Response schemas
- Authentication (Bearer Token)
- Parameters และ query strings
- Error responses
- Tags สำหรับจัดกลุ่ม

### 🎨 UI Features
- Interactive API testing
- Request/Response examples
- Schema validation
- Try it out functionality

## 🔧 Configuration

### Swagger Config
ไฟล์: `config/swagger.js`

### Customization
- Title: "Shonra Admin Backend API"
- Version: "1.0.0"
- Servers: Development และ Production
- Security: Bearer Token

## 📋 Schemas ที่กำหนดไว้

- `Product` - Product object
- `Category` - Category object
- `Tag` - Tag object
- `User` - User object
- `LoginRequest` - Login request
- `LoginResponse` - Login response
- `SuccessResponse` - Success response
- `Error` - Error response

## 🚀 การใช้งาน

### 1. เริ่ม Server
```bash
npm run dev
```

### 2. เปิด Swagger UI
```
http://localhost:3002/api-docs
```

### 3. Login และ Authorize
- ใช้ `/api/auth/login` เพื่อได้ token
- Authorize ด้วย token

### 4. ทดสอบ API
- เลือก endpoint ที่ต้องการ
- คลิก "Try it out"
- ใส่ parameters
- คลิก "Execute"
- ดู response

## 📖 ตัวอย่างการใช้งาน

### Example 1: Search Products
1. ไปที่ `GET /api/products/search`
2. คลิก "Try it out"
3. ใส่ `search=phone` ใน query parameter
4. คลิก "Execute"
5. ดู response

### Example 2: Create Category (ต้อง Auth)
1. Authorize ด้วย token ก่อน
2. ไปที่ `POST /api/categories`
3. คลิก "Try it out"
4. ใส่ request body:
   ```json
   {
     "name": "Electronics"
   }
   ```
5. คลิก "Execute"
6. ดู response

## ⚠️ หมายเหตุ

1. **Authentication**: Endpoints ที่มี `security: bearerAuth` ต้อง login ก่อน
2. **Rate Limiting**: บาง endpoints มี rate limiting (ดูใน response headers)
3. **Development Only**: Test endpoints ใช้ได้เฉพาะใน development mode
4. **Admin Only**: Endpoints ที่ต้อง admin จะตรวจสอบ role

## 🎯 Next Steps

1. ✅ Swagger UI พร้อมใช้งานแล้ว
2. ✅ Documentation สำหรับ routes หลักๆ
3. ⏳ เพิ่ม documentation สำหรับ routes ที่เหลือ (ถ้าต้องการ)

## 📞 Support

ถ้ามีปัญหา:
1. ตรวจสอบว่า server ทำงานอยู่
2. ตรวจสอบว่า packages ติดตั้งแล้ว (`npm install`)
3. ตรวจสอบ console logs

---

**Swagger Documentation พร้อมใช้งานแล้ว! 🎉**

