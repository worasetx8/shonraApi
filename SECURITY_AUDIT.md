# Security Audit Report - API Endpoints

## 🔴 Critical Security Issues (ต้องแก้ไขทันที)

### 1. **Test Endpoints - เปิดเผยข้อมูลสำคัญ**

#### `GET /api/products/test-shopee` ❌
**ปัญหา**: ไม่ต้อง auth, ส่ง APP_ID ออกไป
```javascript
res.json({
  credentials: {
    APP_ID: APP_ID,  // ⚠️ เปิดเผย API credentials!
    APP_SECRET_LENGTH: APP_SECRET.length
  }
});
```
**ความเสี่ยง**: เปิดเผย Shopee API credentials
**แก้ไข**: 
- เพิ่ม `requireAuth` หรือ
- ลบ endpoint นี้ใน production หรือ
- ตรวจสอบ `NODE_ENV !== "production"` ก่อน

#### `GET /api/products/test-db` ❌
**ปัญหา**: ไม่ต้อง auth, ส่ง database structure ออกไป
```javascript
res.json({
  tableStructure: structureResult  // ⚠️ เปิดเผย database schema!
});
```
**ความเสี่ยง**: เปิดเผย database structure, ช่วยให้ attacker รู้ schema
**แก้ไข**: 
- เพิ่ม `requireAuth` หรือ
- ลบ endpoint นี้ใน production หรือ
- ตรวจสอบ `NODE_ENV !== "production"` ก่อน

---

### 2. **Settings API - เปิดเผย API Keys**

#### `GET /api/settings` ❌
**ปัญหา**: ส่ง sensitive data ออกไป
```javascript
SELECT 
  ...
  maintenance_bypass_token,  // ⚠️ Security token!
  google_verification_code,   // ⚠️ Verification code!
  bing_verification_code,     // ⚠️ Verification code!
  gemini_api_key,             // ⚠️ API key!
  ...
FROM settings
```
**ความเสี่ยง**: 
- `maintenance_bypass_token` - ใช้ bypass maintenance mode
- `google_verification_code` - สำหรับ Google Search Console
- `bing_verification_code` - สำหรับ Bing Webmaster
- `gemini_api_key` - API key สำหรับ AI service

**แก้ไข**: 
- ไม่ส่ง sensitive fields ออกไปใน public endpoint
- สร้าง separate endpoint สำหรับ admin ที่ต้องการดูทั้งหมด

#### `PUT /api/settings` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้ใครก็ได้แก้ settings
**ความเสี่ยง**: ใครก็ได้สามารถแก้ settings, API keys, maintenance mode
**แก้ไข**: เพิ่ม `requireAuth` และ `requireAdmin`

---

### 3. **Roles API - ไม่มี Authentication**

#### `GET /api/roles` ⚠️
**ปัญหา**: ไม่ต้อง auth, ส่ง roles ทั้งหมดออกไป
**ความเสี่ยง**: เปิดเผย role structure
**แก้ไข**: เพิ่ม `requireAuth`

#### `POST /api/roles` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้ใครก็ได้สร้าง role
**ความเสี่ยง**: ใครก็ได้สามารถสร้าง role ใหม่
**แก้ไข**: เพิ่ม `requireAuth` และ `requireAdmin`

#### `PUT /api/roles/:id` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้แก้ role
**ความเสี่ยง**: ใครก็ได้สามารถแก้ role (แม้จะป้องกัน Super Admin)
**แก้ไข**: เพิ่ม `requireAuth` และ `requireAdmin`

#### `DELETE /api/roles/:id` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้ลบ role
**ความเสี่ยง**: ใครก็ได้สามารถลบ role
**แก้ไข**: เพิ่ม `requireAuth` และ `requireAdmin`

#### `GET /api/roles/permissions` ⚠️
**ปัญหา**: ไม่ต้อง auth, ส่ง permissions ทั้งหมดออกไป
**ความเสี่ยง**: เปิดเผย permission structure
**แก้ไข**: เพิ่ม `requireAuth`

#### `GET /api/roles/:id/permissions` ⚠️
**ปัญหา**: ไม่ต้อง auth, ส่ง role permissions ออกไป
**ความเสี่ยง**: เปิดเผย role permissions
**แก้ไข**: เพิ่ม `requireAuth`

#### `POST /api/roles/:id/permissions` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้แก้ role permissions
**ความเสี่ยง**: ใครก็ได้สามารถแก้ permissions ของ role
**แก้ไข**: เพิ่ม `requireAuth` และ `requireAdmin`

---

### 4. **Social Media API - ไม่มี Authentication**

#### `POST /api/socials` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้ใครก็ได้สร้าง social link
**ความเสี่ยง**: ใครก็ได้สามารถเพิ่ม social media links
**แก้ไข**: เพิ่ม `requireAuth`

#### `PUT /api/socials/:id` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้แก้ social link
**ความเสี่ยง**: ใครก็ได้สามารถแก้ social links
**แก้ไข**: เพิ่ม `requireAuth`

#### `DELETE /api/socials/:id` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้ลบ social link
**ความเสี่ยง**: ใครก็ได้สามารถลบ social links
**แก้ไข**: เพิ่ม `requireAuth`

#### `PATCH /api/socials/:id/status` ❌
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้ toggle status
**ความเสี่ยง**: ใครก็ได้สามารถเปิด/ปิด social links
**แก้ไข**: เพิ่ม `requireAuth`

---

### 5. **Products API - Public Write Access**

#### `POST /api/products/save-from-frontend` ⚠️
**ปัญหา**: ไม่ต้อง auth, อนุญาตให้ใครก็ได้ save product
**ความเสี่ยง**: 
- ใครก็ได้สามารถเพิ่ม/แก้ไข products
- อาจเกิด spam หรือ data pollution
- ไม่มี rate limiting

**แก้ไข**: 
- เพิ่ม rate limiting
- เพิ่ม validation ที่เข้มงวดขึ้น
- พิจารณาเพิ่ม authentication หรือ API key

---

### 6. **AI SEO API - ไม่มี Authentication**

#### `POST /api/ai-seo/*` ⚠️
**ปัญหา**: ไม่ต้อง auth, ใช้ AI service (อาจมี cost)
**ความเสี่ยง**: 
- ใครก็ได้สามารถใช้ AI service (อาจมีค่าใช้จ่าย)
- อาจเกิด abuse หรือ cost overrun

**แก้ไข**: 
- เพิ่ม `requireAuth` หรือ
- เพิ่ม rate limiting ที่เข้มงวด
- เพิ่ม API key validation

---

## ⚠️ Medium Risk Issues

### 1. **Error Messages - เปิดเผยข้อมูลมากเกินไป**

#### Development Mode Error Messages
**ปัญหา**: ใน development mode ส่ง error stack trace ออกไป
```javascript
const isDevelopment = process.env.NODE_ENV === "development";
...(isDevelopment && { stack: error.stack })
```
**ความเสี่ยง**: เปิดเผย code structure, file paths
**แก้ไข**: ตรวจสอบว่า production ไม่ส่ง stack trace

### 2. **Public Endpoints - ข้อมูลที่ส่งออก**

#### `GET /api/products/public`
**ข้อมูลที่ส่ง**: 
- `p.id` - Internal database ID (อาจไม่จำเป็น)
- `p.category_id` - Internal category ID (OK)
- `p.shop_id` - Shop ID (OK)
- `p.status` - Status (อาจไม่จำเป็น)

**แนะนำ**: ลบ `p.id` และ `p.status` ออก (ใช้ `item_id` แทน)

#### `GET /api/products/flash-sale`
**ข้อมูลที่ส่ง**: 
- `p.id` - Internal database ID
- `p.status` - Status
- `p.period_start_time`, `p.period_end_time` - Timestamps

**แนะนำ**: ลบ `p.id` และ `p.status` ออก

---

## ✅ Safe Public Endpoints (OK)

### 1. **Read-only Public APIs** (มี rate limiting และ validation)
- `GET /api/categories/public` ✅
- `GET /api/tags/public` ✅
- `GET /api/banners/public/:positionName` ✅
- `GET /api/products/search` ✅ (Shopee API search)
- `GET /api/products/flash-sale` ✅ (แต่ควรลบ internal IDs)
- `GET /api/products/public` ✅ (แต่ควรลบ internal IDs)

### 2. **File Serving**
- `GET /api/uploads/banners/:filename` ✅
- `GET /api/uploads/images/:filename` ✅

### 3. **Auth Endpoints**
- `POST /api/auth/login` ✅ (มี rate limiting)
- `POST /api/auth/logout` ✅
- `GET /api/auth/me` ✅ (ต้องมี token)

---

## 📋 Summary Table

| Endpoint | Method | Auth Required? | Risk Level | Action Needed |
|----------|--------|----------------|------------|---------------|
| `/api/products/test-shopee` | GET | ❌ | 🔴 Critical | Add auth or remove |
| `/api/products/test-db` | GET | ❌ | 🔴 Critical | Add auth or remove |
| `/api/settings` | GET | ❌ | 🔴 Critical | Remove sensitive fields |
| `/api/settings` | PUT | ❌ | 🔴 Critical | Add auth + admin |
| `/api/roles` | GET | ❌ | ⚠️ Medium | Add auth |
| `/api/roles` | POST | ❌ | 🔴 Critical | Add auth + admin |
| `/api/roles/:id` | PUT | ❌ | 🔴 Critical | Add auth + admin |
| `/api/roles/:id` | DELETE | ❌ | 🔴 Critical | Add auth + admin |
| `/api/roles/permissions` | GET | ❌ | ⚠️ Medium | Add auth |
| `/api/roles/:id/permissions` | GET | ❌ | ⚠️ Medium | Add auth |
| `/api/roles/:id/permissions` | POST | ❌ | 🔴 Critical | Add auth + admin |
| `/api/socials` | POST | ❌ | 🔴 Critical | Add auth |
| `/api/socials/:id` | PUT | ❌ | 🔴 Critical | Add auth |
| `/api/socials/:id` | DELETE | ❌ | 🔴 Critical | Add auth |
| `/api/socials/:id/status` | PATCH | ❌ | 🔴 Critical | Add auth |
| `/api/products/save-from-frontend` | POST | ❌ | ⚠️ Medium | Add rate limit + validation |
| `/api/ai-seo/*` | POST | ❌ | ⚠️ Medium | Add auth or rate limit |

---

## 🔧 Recommended Fixes Priority

### Priority 1 (Critical - แก้ไขทันที)
1. ✅ เพิ่ม auth ให้ `/api/settings` PUT
2. ✅ ลบ sensitive fields จาก `/api/settings` GET
3. ✅ เพิ่ม auth ให้ `/api/roles` POST/PUT/DELETE
4. ✅ เพิ่ม auth ให้ `/api/roles/:id/permissions` POST
5. ✅ เพิ่ม auth ให้ `/api/socials` POST/PUT/DELETE/PATCH
6. ✅ ลบหรือเพิ่ม auth ให้ `/api/products/test-*`

### Priority 2 (High - แก้ไขเร็วๆ นี้)
1. ✅ เพิ่ม auth ให้ `/api/roles` GET
2. ✅ เพิ่ม auth ให้ `/api/roles/permissions` GET
3. ✅ เพิ่ม rate limit ให้ `/api/products/save-from-frontend`
4. ✅ เพิ่ม auth หรือ rate limit ให้ `/api/ai-seo/*`

### Priority 3 (Medium - ปรับปรุง)
1. ✅ ลบ internal IDs (`p.id`, `p.status`) จาก public product endpoints
2. ✅ ตรวจสอบ error messages ใน production

---

## 📝 Notes

- **Test Endpoints**: ควรลบหรือเพิ่ม environment check (`NODE_ENV !== "production"`)
- **Settings API**: แยกเป็น 2 endpoints:
  - Public: `/api/settings` (ไม่มี sensitive fields)
  - Admin: `/api/admin/settings` (มีทุก fields)
- **Roles & Permissions**: ควรมี authentication และ admin check
- **Social Media**: ควรมี authentication สำหรับ write operations
- **Product Save**: พิจารณาเพิ่ม API key หรือ authentication

