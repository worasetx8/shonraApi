# Production Setup Guide

## ✅ สิ่งที่ทำไปแล้ว (พร้อมใช้งาน)

1. **Database Indexes** - สร้างอัตโนมัติเมื่อ server เริ่มทำงาน
2. **Connection Pool** - ตั้งค่าแล้ว (20 connections สำหรับ production)
3. **Response Caching** - In-memory cache (เหมาะสำหรับ server เดียว)
4. **Compression** - ตั้งค่าแล้วสำหรับ production

## 🔧 Environment Variables ที่ต้องตั้งค่า

สร้างไฟล์ `.env` หรือตั้งค่าใน production environment:

```env
# Required
NODE_ENV=production
DB_HOST=your_db_host
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=shopee_affiliate
DB_PORT=3306

# Optional (มี default values)
DB_CONNECTION_LIMIT=20  # Default: 20 for production
SERVER_PORT=3002

# URLs
CLIENT_URL=https://your-frontend-domain.com
BACKEND_URL=https://your-backend-domain.com

# Shopee API (ถ้าใช้)
SHOPEE_APP_ID=your_app_id
SHOPEE_APP_SECRET=your_app_secret
```

## 🚀 การเริ่มต้น Server

```bash
# Development
npm run dev

# Production
NODE_ENV=production npm start
```

## 📊 Performance Monitoring

### ตรวจสอบ Cache Hit Rate
ดู header `X-Cache` ใน response:
- `X-Cache: HIT` = ใช้ cache (เร็วมาก)
- `X-Cache: MISS` = ไม่มี cache (query database)

### ตรวจสอบ Database Indexes
```sql
SHOW INDEXES FROM shopee_products;
```

ควรเห็น indexes ที่สร้างไว้:
- `idx_products_status_category_updated`
- `idx_products_status_updated`
- `idx_products_flash_sale_status`
- `idx_products_category_status`
- `idx_products_updated_at`
- `idx_products_period_time`

### ตรวจสอบ Connection Pool
```sql
SHOW PROCESSLIST;
```

## ⚠️ หมายเหตุสำคัญ

1. **In-Memory Cache**: ใช้ได้ดีสำหรับ server เดียว แต่ถ้า restart server cache จะหาย
2. **Database Indexes**: จะสร้างอัตโนมัติเมื่อ server เริ่มทำงานครั้งแรก
3. **Connection Pool**: ตั้งค่าไว้ที่ 20 connections สำหรับ production (ปรับได้ตาม load)

## 🎯 Expected Performance

- **Query Time**: 10-50ms (จาก 50-150ms)
- **Public Endpoints**: 5-50ms (จาก 100-300ms) เมื่อมี cache
- **Cache Hit Rate**: ควร > 80% สำหรับ public endpoints

## 🔄 Cache Management (ถ้าต้องการ)

```javascript
// ในโค้ด (ถ้าต้องการ clear cache เมื่อข้อมูลเปลี่ยน)
import { clearCache } from "./middleware/responseCache.js";

// Clear all cache
clearCache();

// Clear specific cache
clearCache("/api/products");
```

## ✅ Checklist สำหรับ Production

- [ ] ตั้งค่า `NODE_ENV=production`
- [ ] ตั้งค่า database credentials
- [ ] ตั้งค่า CLIENT_URL และ BACKEND_URL
- [ ] ตรวจสอบว่า indexes ถูกสร้างแล้ว (ดูใน logs)
- [ ] ทดสอบ public endpoints และดู X-Cache header
- [ ] Monitor database connections
- [ ] ตั้งค่า SSL/HTTPS (ถ้ายังไม่มี)

## 🎉 พร้อมใช้งาน!

ทุกอย่างตั้งค่าไว้แล้ว เพียงแค่:
1. ตั้งค่า environment variables
2. รัน `NODE_ENV=production npm start`
3. Server จะสร้าง indexes อัตโนมัติและพร้อมใช้งาน!

