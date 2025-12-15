# Swagger API Documentation - Quick Start

## 🚀 เริ่มใช้งาน

### 1. ติดตั้ง Packages (ทำเสร็จแล้ว)
```bash
npm install
```

### 2. เริ่ม Server
```bash
npm run dev
```

### 3. เปิด Swagger UI
เปิด browser ไปที่:
```
http://localhost:3002/api-docs
```

## 🔐 Authentication

### Step 1: Login
1. ไปที่ `POST /api/auth/login`
2. คลิก "Try it out"
3. ใส่:
   ```json
   {
     "username": "admin",
     "password": "admin123"
   }
   ```
4. คลิก "Execute"
5. Copy `token` จาก response

### Step 2: Authorize
1. คลิกปุ่ม "Authorize" (🔒) ที่ด้านบนขวา
2. ใส่: `Bearer YOUR_TOKEN` (หรือแค่ `YOUR_TOKEN` ก็ได้)
3. คลิก "Authorize"
4. คลิก "Close"

### Step 3: ทดสอบ API
ตอนนี้ทุก endpoint ที่ต้องการ auth จะใช้ token อัตโนมัติ!

**หมายเหตุ:**
- Endpoints ที่มี `security: bearerAuth` จะบังคับให้ใส่ token ก่อนเรียก API
- Endpoints ที่เป็น public (เช่น `/api/products/search`, `/api/categories/public`) ไม่ต้องใส่ token
- Client/Backend Admin UI ที่ใช้ token อยู่แล้วจะทำงานได้ปกติ ไม่ต้องเปลี่ยนอะไร

## 📋 Endpoints ที่มี Documentation

### ✅ พร้อมใช้งาน
- Authentication (login, logout, me, change-password)
- Products (search, check, save, flash-sale, public)
- Categories (public, CRUD)
- Tags (public)
- Settings (get, update)
- Roles (CRUD, permissions)
- Social Media (CRUD)
- Banners (public)
- Admin (users)
- AI SEO (meta-description, keywords, alt-text, optimize)
- Health Check

## 🎯 ตัวอย่างการใช้งาน

### Example: Search Products
```
GET /api/products/search?search=phone&page=1
```

### Example: Get Categories (Public)
```
GET /api/categories/public
```

### Example: Create Category (ต้อง Auth)
```
POST /api/categories
Authorization: Bearer YOUR_TOKEN
Body: { "name": "Electronics" }
```

## 📖 Features

- ✅ Interactive API testing
- ✅ Request/Response examples
- ✅ Schema validation
- ✅ Authentication support
- ✅ Try it out functionality

## 🎉 พร้อมใช้งาน!

เปิด `http://localhost:3002/api-docs` และเริ่มทดสอบ API ได้เลย!

