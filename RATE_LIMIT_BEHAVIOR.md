# Rate Limit Behavior - สิ่งที่เกิดขึ้นเมื่อถึง Limit

## 🔴 สิ่งที่เกิดขึ้นกับผู้ใช้ (Client)

### 1. **Response ที่ได้รับ**
```json
{
  "success": false,
  "error": "Too many requests, please try again later",
  "retryAfter": 45  // วินาทีที่ต้องรอก่อน retry
}
```

- **HTTP Status Code**: `429 Too Many Requests`
- **Response Body**: JSON error message พร้อม `retryAfter` (วินาทีที่ต้องรอ)

### 2. **Request ถูก Block**
- ❌ Request **ไม่ถูกประมวลผล** (ไม่ถึง handler function)
- ❌ **ไม่มีการ query database**
- ❌ **ไม่มีการประมวลผล business logic**
- ✅ Response ถูกส่งกลับทันที (เร็วมาก - ไม่ใช้ resource)

### 3. **การทำงานของ Client**
- Client ควรแสดง error message ให้ผู้ใช้เห็น
- Client ควรรอตาม `retryAfter` ก่อน retry
- ถ้า retry ทันที → จะได้ 429 อีก (จนกว่าจะถึง reset time)

### 4. **Timeline ตัวอย่าง**

**Scenario: Public API (30 requests/minute)**

```
00:00 - Request #1-30: ✅ ผ่าน (200 OK)
00:45 - Request #31:   ❌ 429 (retryAfter: 15 seconds)
00:46 - Request #32:   ❌ 429 (retryAfter: 14 seconds)
...
01:00 - Request #33:  ✅ ผ่าน (reset window, count = 1)
```

**Scenario: Login (20 requests/15 minutes)**

```
00:00 - Login attempt #1-20: ✅ ผ่าน (200 OK หรือ 401)
00:30 - Login attempt #21:    ❌ 429 (retryAfter: 870 seconds = 14.5 minutes)
00:31 - Login attempt #22:   ❌ 429 (retryAfter: 869 seconds)
...
15:00 - Login attempt #23:   ✅ ผ่าน (reset window, count = 1)
```

---

## 🖥️ สิ่งที่เกิดขึ้นกับระบบ (Server)

### 1. **Request Processing Flow**

```
Request เข้ามา
    ↓
Rate Limiter Middleware ตรวจสอบ
    ↓
ถ้าเกิน limit:
    ├─ ❌ Return 429 ทันที (ไม่ผ่านไปยัง route handler)
    ├─ 📝 Log warning
    └─ 💾 Update counter (แต่ไม่ increment เพราะถูก block)
    
ถ้ายังไม่เกิน:
    ├─ ✅ ผ่านไปยัง route handler
    ├─ 📝 Increment counter
    └─ 🔄 ประมวลผลตามปกติ
```

### 2. **Resource Usage**

#### ✅ **ประหยัด Resource**
- **ไม่ query database** - ประหยัด DB connections
- **ไม่ประมวลผล business logic** - ประหยัด CPU
- **Response เร็วมาก** - ใช้เวลา < 1ms

#### 📝 **Logging**
```javascript
Logger.warn(`Rate limit exceeded for ${clientId}`, {
  ip: clientId,
  count,
  maxRequests,
  resetTime: new Date(resetTime).toISOString()
});
```

- Log ถูกเขียนทุกครั้งที่เกิน limit
- เก็บ IP address, count, และ reset time
- ใช้สำหรับ monitoring และ security analysis

### 3. **Memory Usage**

#### In-Memory Storage
```javascript
const requestCounts = new Map();
// Key: IP address
// Value: { count: number, resetTime: timestamp }
```

- **Storage**: เก็บใน memory (Map)
- **Cleanup**: ลบ entries ที่หมดอายุทุก 5 นาที
- **Memory Impact**: น้อยมาก (ประมาณ 100 bytes ต่อ IP)

### 4. **Counter Behavior**

#### เมื่อถึง Limit
```javascript
if (count >= maxRequests) {
  // Block request
  return res.status(429).json(...);
  // ⚠️ Counter ไม่ถูก increment
}
```

- **Counter ไม่เพิ่ม** เมื่อ request ถูก block
- **Counter จะ reset** เมื่อถึง reset time
- **Counter จะ reset** เมื่อ window หมดอายุ

### 5. **System Protection**

#### ✅ **ป้องกัน**
- **DDoS attacks** - จำกัด requests ต่อ IP
- **Brute force attacks** - จำกัด login attempts
- **Resource exhaustion** - ป้องกัน database overload
- **API abuse** - ป้องกันการใช้งานเกินควร

#### ⚠️ **ข้อจำกัด**
- **In-memory**: ถ้า restart server → rate limit reset
- **IP-based**: ถ้าใช้ VPN/proxy → อาจ bypass ได้
- **Single server**: ไม่ share rate limit ระหว่าง servers

---

## 📊 ตัวอย่างการทำงาน

### Case 1: Public API (30 requests/minute)

**Request Timeline:**
```
00:00:00 - Request #1  → ✅ 200 OK (count: 1)
00:00:01 - Request #2  → ✅ 200 OK (count: 2)
...
00:00:29 - Request #30 → ✅ 200 OK (count: 30)
00:00:30 - Request #31 → ❌ 429 (count: 30, retryAfter: 30s)
00:00:31 - Request #32 → ❌ 429 (count: 30, retryAfter: 29s)
...
00:01:00 - Window reset
00:01:01 - Request #33 → ✅ 200 OK (count: 1, new window)
```

**Server Behavior:**
- Requests #31-32: Block ทันที, ไม่ query DB, log warning
- Request #33: ผ่านปกติ, query DB, ประมวลผล

### Case 2: Login (20 requests/15 minutes)

**Login Attempts:**
```
00:00:00 - Attempt #1-20  → ✅ 200/401 (count: 20)
00:00:30 - Attempt #21   → ❌ 429 (retryAfter: 870s = 14.5 min)
00:15:00 - Window reset
00:15:01 - Attempt #22   → ✅ 200/401 (count: 1, new window)
```

**Server Behavior:**
- Attempt #21: Block ทันที, ไม่ query DB, log warning
- Attempt #22: ผ่านปกติ, query DB, verify password

---

## 🔄 Auto-Reset Mechanism

### 1. **Window Reset**
- เมื่อถึง `resetTime` → counter reset เป็น 1
- Request ถัดไปจะเริ่ม window ใหม่

### 2. **Cleanup Process**
```javascript
setInterval(() => {
  // ลบ entries ที่หมดอายุทุก 5 นาที
  for (const [clientId, { resetTime }] of requestCounts.entries()) {
    if (now > resetTime) {
      requestCounts.delete(clientId);
    }
  }
}, 5 * 60 * 1000);
```

- ลบ entries ที่หมดอายุแล้ว
- ประหยัด memory
- รันทุก 5 นาที

---

## 🎯 Best Practices สำหรับ Client

### 1. **Handle 429 Response**
```javascript
try {
  const response = await fetch('/api/endpoint');
  if (response.status === 429) {
    const data = await response.json();
    const retryAfter = data.retryAfter; // seconds
    console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return fetch('/api/endpoint'); // Retry
  }
} catch (error) {
  // Handle error
}
```

### 2. **Exponential Backoff**
```javascript
let retryDelay = 1000; // Start with 1 second
while (retries < maxRetries) {
  const response = await fetch('/api/endpoint');
  if (response.status === 429) {
    const data = await response.json();
    retryDelay = data.retryAfter * 1000;
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    retries++;
  } else {
    break;
  }
}
```

### 3. **User Feedback**
```javascript
if (response.status === 429) {
  const data = await response.json();
  showError(`Too many requests. Please wait ${data.retryAfter} seconds.`);
  // Disable button or show countdown
}
```

---

## 📈 Monitoring & Analytics

### Logs ที่ควร Monitor
- Rate limit violations (frequency)
- IP addresses ที่ถูก block บ่อย
- Patterns ของ abuse attempts
- Peak usage times

### Metrics ที่ควร Track
- Rate limit hit rate
- Average retryAfter time
- Most blocked endpoints
- IP distribution

---

## ⚠️ ข้อควรระวัง

### 1. **False Positives**
- ผู้ใช้ปกติที่ใช้งานมาก → อาจถูก block
- **Solution**: ปรับ rate limit ให้เหมาะสม

### 2. **Shared IP**
- ผู้ใช้หลายคนใช้ IP เดียวกัน (office, school) → อาจถูก block ร่วมกัน
- **Solution**: ใช้ user-based rate limiting สำหรับ authenticated users

### 3. **Server Restart**
- Rate limit reset เมื่อ restart server
- **Solution**: ใช้ Redis สำหรับ persistent rate limiting

---

## ✅ สรุป

### ผู้ใช้:
- ❌ Request ถูก block
- 📨 ได้รับ 429 response พร้อม retryAfter
- ⏳ ต้องรอตาม retryAfter ก่อน retry

### ระบบ:
- ✅ ประหยัด resource (ไม่ query DB, ไม่ประมวลผล)
- 📝 Log warning สำหรับ monitoring
- 🔒 ป้องกัน abuse และ DDoS
- 💾 ใช้ memory น้อย (cleanup อัตโนมัติ)

### ผลลัพธ์:
- **ระบบปลอดภัย** - ป้องกัน abuse
- **Performance ดี** - ไม่ใช้ resource ฟุ่มเฟือย
- **User Experience** - ผู้ใช้รู้ว่าต้องรอเท่าไหร่

