# Test Endpoints Guide - คู่มือการใช้งาน Test Endpoints

## 📋 ภาพรวม

Test endpoints นี้ใช้สำหรับ **development และ debugging เท่านั้น** ไม่สามารถใช้ใน production ได้

---

## 🔧 Endpoint 1: `/api/products/test-shopee`

### วัตถุประสงค์
ทดสอบการเชื่อมต่อกับ Shopee API และตรวจสอบว่า credentials ถูกต้องหรือไม่

### ใช้เมื่อไหร่?
- ✅ ตั้งค่า Shopee API credentials ใหม่
- ✅ ตรวจสอบว่า Shopee API ทำงานหรือไม่
- ✅ Debug ปัญหาเกี่ยวกับ Shopee API
- ✅ ทดสอบ GraphQL query format

### ข้อกำหนด
- ✅ ต้อง login (มี authentication token)
- ✅ ต้องอยู่ใน development mode (`NODE_ENV !== "production"`)

### วิธีใช้งาน

#### 1. ใช้ Browser (Postman, Thunder Client, etc.)

```http
GET http://localhost:3002/api/products/test-shopee
Authorization: Bearer YOUR_AUTH_TOKEN
```

#### 2. ใช้ cURL

```bash
curl -X GET "http://localhost:3002/api/products/test-shopee" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

#### 3. ใช้ JavaScript/Fetch

```javascript
const response = await fetch('http://localhost:3002/api/products/test-shopee', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${yourAuthToken}`
  }
});

const data = await response.json();
console.log(data);
```

### Response ตัวอย่าง

#### ✅ Success (Credentials ถูกต้อง)
```json
{
  "success": true,
  "data": {
    "data": {
      "productOfferV2": {
        "total": 1234
      }
    }
  },
  "credentials": {
    "APP_ID": "***HIDDEN***",
    "APP_SECRET_LENGTH": 32
  }
}
```

#### ❌ Error (Credentials ไม่ถูกต้องหรือ API ไม่ทำงาน)
```json
{
  "success": false,
  "error": "HTTP error! status: 401, body: ..."
}
```

#### ❌ Missing Credentials
```json
{
  "success": false,
  "error": "Missing credentials",
  "APP_ID": false,
  "APP_SECRET": false
}
```

#### ❌ Production Mode
```json
{
  "success": false,
  "message": "Test endpoint is not available in production"
}
```

---

## 🗄️ Endpoint 2: `/api/products/test-db`

### วัตถุประสงค์
ทดสอบการเชื่อมต่อกับ Database และตรวจสอบว่า table ต่างๆ มีอยู่หรือไม่

### ใช้เมื่อไหร่?
- ✅ ตรวจสอบ database connection
- ✅ ตรวจสอบว่า table `shopee_products` มีอยู่หรือไม่
- ✅ Debug ปัญหาเกี่ยวกับ database
- ✅ ทดสอบหลังจาก setup database ใหม่

### ข้อกำหนด
- ✅ ต้อง login (มี authentication token)
- ✅ ต้องอยู่ใน development mode (`NODE_ENV !== "production"`)

### วิธีใช้งาน

#### 1. ใช้ Browser (Postman, Thunder Client, etc.)

```http
GET http://localhost:3002/api/products/test-db
Authorization: Bearer YOUR_AUTH_TOKEN
```

#### 2. ใช้ cURL

```bash
curl -X GET "http://localhost:3002/api/products/test-db" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

#### 3. ใช้ JavaScript/Fetch

```javascript
const response = await fetch('http://localhost:3002/api/products/test-db', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${yourAuthToken}`
  }
});

const data = await response.json();
console.log(data);
```

### Response ตัวอย่าง

#### ✅ Success (Database เชื่อมต่อได้)
```json
{
  "success": true,
  "data": {
    "basicQuery": {
      "success": true,
      "data": [
        {
          "test": 1
        }
      ]
    },
    "tableExists": {
      "success": true,
      "data": [
        {
          "Tables_in_shopee_affiliate (shopee_products)": "shopee_products"
        }
      ]
    },
    "message": "Database connection successful"
  }
}
```

#### ❌ Error (Database ไม่เชื่อมต่อ)
```json
{
  "success": false,
  "error": "Database connection failed"
}
```

#### ❌ Production Mode
```json
{
  "success": false,
  "message": "Test endpoint is not available in production"
}
```

---

## 🔑 วิธีได้ Authentication Token

### 1. Login ผ่าน API

```bash
curl -X POST "http://localhost:3002/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your_password"
  }'
```

### Response:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "username": "admin",
      ...
    },
    "token": "your_auth_token_here"
  },
  "message": "Login successful"
}
```

### 2. ใช้ Token ใน Header

```http
Authorization: Bearer your_auth_token_here
```

---

## 📝 Step-by-Step Testing

### Test Shopee API

1. **ตั้งค่า Environment**
   ```bash
   # ตรวจสอบว่า NODE_ENV ไม่ใช่ production
   echo $NODE_ENV  # ควรเป็น development หรือ undefined
   ```

2. **Login เพื่อได้ Token**
   ```bash
   curl -X POST "http://localhost:3002/api/auth/login" \
     -H "Content-Type: application/json" \
     -d '{"username": "admin", "password": "admin123"}'
   ```

3. **ทดสอบ Shopee API**
   ```bash
   curl -X GET "http://localhost:3002/api/products/test-shopee" \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

### Test Database

1. **Login เพื่อได้ Token** (เหมือนด้านบน)

2. **ทดสอบ Database**
   ```bash
   curl -X GET "http://localhost:3002/api/products/test-db" \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

---

## 🛠️ ตัวอย่างการใช้งานจริง

### Scenario 1: ตรวจสอบ Shopee API หลังตั้งค่าใหม่

```bash
# 1. Login
TOKEN=$(curl -s -X POST "http://localhost:3002/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}' \
  | jq -r '.data.token')

# 2. Test Shopee API
curl -X GET "http://localhost:3002/api/products/test-shopee" \
  -H "Authorization: Bearer $TOKEN" \
  | jq
```

### Scenario 2: ตรวจสอบ Database หลัง Setup

```bash
# 1. Login
TOKEN=$(curl -s -X POST "http://localhost:3002/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}' \
  | jq -r '.data.token')

# 2. Test Database
curl -X GET "http://localhost:3002/api/products/test-db" \
  -H "Authorization: Bearer $TOKEN" \
  | jq
```

---

## ⚠️ ข้อควรระวัง

### 1. Production Mode
- ❌ **ไม่สามารถใช้ได้ใน production**
- ✅ ใช้ได้เฉพาะใน development mode เท่านั้น

### 2. Authentication
- ❌ **ต้อง login ก่อน** ถึงจะใช้ได้
- ✅ ใช้ token จาก `/api/auth/login`

### 3. Security
- ✅ APP_ID ถูกซ่อนแล้ว (`***HIDDEN***`)
- ✅ Table structure ไม่ถูกส่งออกมาแล้ว
- ✅ ใช้ได้เฉพาะใน development

---

## 🔍 Troubleshooting

### Problem: "Test endpoint is not available in production"
**Solution**: ตรวจสอบว่า `NODE_ENV` ไม่ใช่ `production`
```bash
# ใน .env หรือ environment
NODE_ENV=development  # หรือไม่ต้องตั้งเลย
```

### Problem: "Authentication required"
**Solution**: Login เพื่อได้ token ก่อน
```bash
curl -X POST "http://localhost:3002/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your_password"}'
```

### Problem: "Missing credentials" (test-shopee)
**Solution**: ตรวจสอบว่า `.env` มี `SHOPEE_APP_ID` และ `SHOPEE_APP_SECRET`
```env
SHOPEE_APP_ID=your_app_id
SHOPEE_APP_SECRET=your_app_secret
```

### Problem: Database connection failed (test-db)
**Solution**: ตรวจสอบ database credentials ใน `.env`
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=shopee_affiliate
DB_PORT=3306
```

---

## 📊 เปรียบเทียบกับ Health Check Endpoints

| Endpoint | Auth Required | Production | Purpose |
|----------|---------------|------------|---------|
| `/health` | ❌ No | ✅ Yes | Basic server health |
| `/api/health/db` | ❌ No | ✅ Yes | Database connection check |
| `/api/products/test-shopee` | ✅ Yes | ❌ No | Detailed Shopee API test |
| `/api/products/test-db` | ✅ Yes | ❌ No | Detailed database test |

---

## ✅ สรุป

### `/api/products/test-shopee`
- **ใช้เมื่อ**: ต้องการทดสอบ Shopee API connection
- **ต้อง**: Login + Development mode
- **ได้**: ผลการทดสอบ Shopee API

### `/api/products/test-db`
- **ใช้เมื่อ**: ต้องการทดสอบ Database connection
- **ต้อง**: Login + Development mode
- **ได้**: ผลการทดสอบ Database

**ทั้งสอง endpoints ใช้สำหรับ development และ debugging เท่านั้น!**

