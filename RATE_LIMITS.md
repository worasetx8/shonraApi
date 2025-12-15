# Rate Limits Summary

## 📊 Rate Limit Configuration ทั้งหมด

### 1. **Default Rate Limiter** (ถ้าไม่ระบุ)
- **Window**: 1 นาที (60,000 ms)
- **Max Requests**: 60 requests per minute
- **ใช้กับ**: Endpoints ที่ไม่ได้ระบุ rate limit

### 2. **Strict Rate Limit** (สำหรับ sensitive endpoints)
- **Window**: 15 นาที (900,000 ms)
- **Max Requests**: 20 requests per 15 minutes
- **ใช้กับ**: 
  - `POST /api/auth/login` - Login endpoint

### 3. **Public Endpoints** (30 requests/minute)
- **Window**: 1 นาที (60,000 ms)
- **Max Requests**: 30 requests per minute
- **ใช้กับ**:
  - `GET /api/categories/public` - Get categories
  - `GET /api/tags/public` - Get tags
  - `GET /api/banners/public` - Get banners
  - `GET /api/settings` - Get settings

## 📋 ตารางสรุป

| Endpoint | Rate Limit | Window | Type |
|----------|-----------|--------|------|
| `POST /api/auth/login` | 20 requests | 15 minutes | Strict |
| `GET /api/categories/public` | 30 requests | 1 minute | Public |
| `GET /api/tags/public` | 30 requests | 1 minute | Public |
| `GET /api/banners/public` | 30 requests | 1 minute | Public |
| `GET /api/settings` | 30 requests | 1 minute | Public |
| **อื่นๆ** | 60 requests | 1 minute | Default |

## 🔧 Implementation Details

### Rate Limiter Middleware
- **Location**: `middleware/rateLimiter.js`
- **Type**: In-memory (Map-based)
- **Identifier**: IP address (`req.ip`)
- **Cleanup**: ทุก 5 นาที

### Response เมื่อเกิน Rate Limit
```json
{
  "success": false,
  "error": "Too many requests, please try again later",
  "retryAfter": 45  // seconds until retry
}
```
- **HTTP Status**: 429 (Too Many Requests)

## 📝 Code Examples

### Default Rate Limiter
```javascript
import { rateLimiter } from "../middleware/rateLimiter.js";

router.get("/endpoint", rateLimiter(), handler);
// หรือ
router.get("/endpoint", rateLimiter({ 
  windowMs: 60 * 1000, 
  maxRequests: 60 
}), handler);
```

### Strict Rate Limit
```javascript
import { strictRateLimit } from "../middleware/rateLimiter.js";

router.post("/login", strictRateLimit(), handler);
```

### Custom Rate Limit
```javascript
router.get("/custom", rateLimiter({ 
  windowMs: 5 * 60 * 1000,  // 5 minutes
  maxRequests: 100,           // 100 requests
  message: "Custom error message"
}), handler);
```

## ⚠️ หมายเหตุ

1. **In-Memory**: Rate limit ใช้ in-memory storage (Map)
   - เหมาะสำหรับ server เดียว
   - ถ้า restart server rate limit จะ reset
   - สำหรับ multiple servers ควรใช้ Redis

2. **IP-based**: ใช้ IP address เป็น identifier
   - ถ้าใช้ proxy/load balancer ต้องตั้ง `trust proxy` (ตั้งไว้แล้วใน `index.js`)

3. **Cleanup**: ระบบจะลบ entries ที่หมดอายุทุก 5 นาที

4. **Development vs Production**: 
   - Strict rate limit: เหมือนกันทั้ง dev และ production (20 requests/15 min)

## 🔄 การปรับแต่ง Rate Limit

### เปลี่ยน Default Rate Limit
แก้ไขใน `middleware/rateLimiter.js`:
```javascript
export const rateLimiter = (options = {}) => {
  const {
    windowMs = 60 * 1000,      // เปลี่ยน default window
    maxRequests = 60,           // เปลี่ยน default max requests
    message = "Too many requests, please try again later"
  } = options;
  // ...
};
```

### เปลี่ยน Strict Rate Limit
แก้ไขใน `middleware/rateLimiter.js`:
```javascript
export const strictRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,  // เปลี่ยน window
    maxRequests = 20,            // เปลี่ยน max requests
    message = "Too many login attempts. Please try again later."
  } = options;
  // ...
};
```

### เปลี่ยน Public Endpoints Rate Limit
แก้ไขในแต่ละ route file:
- `routes/categories.js` - line 27
- `routes/tags.js` - line 25
- `routes/banners.js` - line 244
- `routes/settings.js` - line 36

## 📊 Monitoring

Rate limit violations จะถูก log ใน:
```
Logger.warn(`Rate limit exceeded for ${clientId}`, {
  ip: clientId,
  count,
  maxRequests,
  resetTime: new Date(resetTime).toISOString()
});
```

## 🎯 Best Practices

1. **Login Endpoints**: ใช้ strict rate limit (20/15min) เพื่อป้องกัน brute force
2. **Public APIs**: ใช้ moderate rate limit (30/min) เพื่อป้องกัน abuse
3. **Internal APIs**: ใช้ default (60/min) หรือไม่ใช้ rate limit
4. **Heavy Operations**: ใช้ stricter rate limit สำหรับ operations ที่ใช้ resource มาก

