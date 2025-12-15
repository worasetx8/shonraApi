# Client ไม่มี Login - วิธีแก้ไข

## 🔴 ปัญหา
Client ไม่มีการ login แล้วจะเอา auth token มาจากไหน?

## ✅ วิธีแก้ไข

### วิธีที่ 1: ใช้ Public Endpoint ที่มีอยู่แล้ว (แนะนำ)

**Endpoint:** `/api/products/public`

```javascript
// Client-side
const response = await fetch(
  'http://localhost:3002/api/products/public?page=1&limit=10&category_id=all&tag_id=1&search=test',
  {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  }
);

const data = await response.json();
```

**Features:**
- ✅ ไม่ต้อง auth token
- ✅ Filter โดย category, tag, search
- ✅ Pagination (page, limit)
- ✅ Filter เฉพาะ active products เท่านั้น

**ข้อจำกัด:**
- ❌ ไม่สามารถ filter `status=all/inactive/flash-sale` ได้
- ❌ ไม่มี sort options (date, commission, sales, price)
- ❌ ไม่มี pagination count (total)

### วิธีที่ 2: ใช้ Public Endpoint ใหม่ (✅ สร้างแล้ว!)

**Endpoint:** `/api/products/saved-public` (ใหม่!)

**Features:**
- ✅ ไม่ต้อง auth token
- ✅ Filter เฉพาะ active products (เพื่อความปลอดภัย)
- ✅ รองรับ sort options (date, commission, sales, price)
- ✅ มี pagination count (total, totalPages)
- ✅ รองรับ category, tag, search filters

**URL:**
```
GET /api/products/saved-public?page=1&limit=10&category_id=all&tag_id=all&search=test&sort_by=date&sort_order=desc
```

## 📋 เปรียบเทียบ Endpoints

| Feature | `/api/products/public` | `/api/products/saved` | `/api/products/saved-public` ✅ |
|---------|----------------------|----------------------|-----------------------------------|
| **Auth** | ❌ ไม่ต้อง | ✅ ต้อง | ❌ ไม่ต้อง |
| **Status Filter** | `active` เท่านั้น | `all/active/inactive/flash-sale` | `active` เท่านั้น |
| **Category Filter** | ✅ | ✅ | ✅ |
| **Tag Filter** | ✅ | ✅ | ✅ |
| **Search** | ✅ | ✅ | ✅ |
| **Sort Options** | ❌ | ✅ | ✅ |
| **Pagination Count** | ❌ | ✅ | ✅ |
| **Rate Limit** | 30/min | 60/min | 30/min |
| **Cache** | 3 min | - | 2 min |

## 🎯 คำแนะนำ

### ถ้า Client ต้องการ:
- **ดูเฉพาะ active products + features พื้นฐาน** → ใช้ `/api/products/public` ✅
- **Features เพิ่มเติม (sort, pagination count)** → ใช้ `/api/products/saved-public` ✅ (สร้างแล้ว!)

## 💡 ตัวอย่างการใช้งาน

### ใช้ `/api/products/saved-public` (แนะนำ - มี features ครบ)

```javascript
// Client-side - ไม่ต้อง auth
async function getProducts(page = 1, limit = 10, categoryId = 'all', tagId = 'all', search = '', sortBy = 'date', sortOrder = 'desc') {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    category_id: categoryId,
    tag_id: tagId,
    search: search,
    sort_by: sortBy,
    sort_order: sortOrder
  });

  const response = await fetch(
    `http://localhost:3002/api/products/saved-public?${params}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch products');
  }

  const data = await response.json();
  return {
    products: data.data.products, // Array of products
    pagination: data.data.pagination // { page, limit, total, totalPages, hasNext, hasPrev }
  };
}
```

### ใช้ `/api/products/public` (ถ้าต้องการแบบง่าย)

```javascript
// Client-side - ไม่ต้อง auth
async function getProducts(page = 1, limit = 10, categoryId = 'all', tagId = 'all', search = '') {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    category_id: categoryId,
    tag_id: tagId,
    search: search
  });

  const response = await fetch(
    `http://localhost:3002/api/products/public?${params}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch products');
  }

  const data = await response.json();
  return data.data; // Array of products
}
```

### ใช้ Next.js API Route (ถ้าต้องการ)

```javascript
// pages/api/shopee/saved-products.js
export default async function handler(req, res) {
  const { page = 1, limit = 10, category_id = 'all', tag_id = 'all', search = '' } = req.query;

  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3002';
  const url = `${backendUrl}/api/products/public?page=${page}&limit=${limit}&category_id=${category_id}&tag_id=${tag_id}&search=${search}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}
```

## 🎉 สรุป

**Client ไม่มี login → ใช้ `/api/products/saved-public` แทน `/api/products/saved`**

- ✅ ไม่ต้อง auth token
- ✅ Filter เฉพาะ active products (ปลอดภัย)
- ✅ รองรับ category, tag, search, pagination
- ✅ รองรับ sort options (date, commission, sales, price)
- ✅ มี pagination count (total, totalPages)

**URL:**
```
GET http://localhost:3002/api/products/saved-public?page=1&limit=10&status=active&category_id=all&tag_id=all&search=test&sort_by=date&sort_order=desc
```

