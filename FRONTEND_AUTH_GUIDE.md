# Frontend Authentication Guide - Saved Products API

## 🔴 ปัญหาที่พบ

### 1. `/api/products/saved` - 401 Unauthorized
**สาเหตุ:** Endpoint นี้เป็น **protected endpoint** ที่ต้องมี authentication token

### 2. `/api/shopee/saved-products` - 500 Internal Server Error  
**สาเหตุ:** Client route (Next.js API route) ไม่ได้ส่ง auth token ไปยัง backend

## ✅ วิธีแก้ไข

### สำหรับ Frontend (Client-side)

#### 1. ตรวจสอบว่ามี Auth Token หรือไม่

```javascript
// ตรวจสอบ token จาก localStorage หรือ cookie
const token = localStorage.getItem('authToken'); 
// หรือ
const token = getCookie('authToken');
```

#### 2. ส่ง Token ใน Header เมื่อเรียก API

```javascript
// ✅ วิธีที่ถูกต้อง
const response = await fetch('http://localhost:3002/api/products/saved?page=1&limit=10&status=active', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,  // ⚠️ สำคัญ: ต้องมี Bearer prefix
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
```

#### 3. ตรวจสอบ Response Status

```javascript
if (response.status === 401) {
  // Token หมดอายุหรือไม่ถูกต้อง
  // Redirect ไปหน้า login
  window.location.href = '/login';
} else if (response.ok) {
  // Success
  console.log('Data:', data);
}
```

### สำหรับ Next.js API Route (`/api/shopee/saved-products`)

#### 1. สร้าง/แก้ไข API Route

**ไฟล์:** `pages/api/shopee/saved-products.js` หรือ `app/api/shopee/saved-products/route.js`

```javascript
// pages/api/shopee/saved-products.js (Pages Router)
import { getToken } from 'next-auth/jwt'; // ถ้าใช้ NextAuth
// หรือ
import { getSession } from 'next-auth/react';

export default async function handler(req, res) {
  // 1. ตรวจสอบ authentication
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required' 
    });
  }

  // 2. เรียก Backend API พร้อมส่ง token
  try {
    const { page = 1, limit = 10, status = 'all', search = '' } = req.query;
    
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3002';
    const url = `${backendUrl}/api/products/saved?page=${page}&limit=${limit}&status=${status}&search=${search}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,  // ⚠️ ส่ง token ไปยัง backend
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Error calling backend:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}
```

#### 2. สำหรับ App Router (Next.js 13+)

**ไฟล์:** `app/api/shopee/saved-products/route.js`

```javascript
import { NextResponse } from 'next/server';

export async function GET(request) {
  // 1. ตรวจสอบ authentication
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const token = authHeader.replace('Bearer ', '');

  // 2. เรียก Backend API
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '10';
    const status = searchParams.get('status') || 'all';
    const search = searchParams.get('search') || '';

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3002';
    const url = `${backendUrl}/api/products/saved?page=${page}&limit=${limit}&status=${status}&search=${search}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,  // ⚠️ ส่ง token ไปยัง backend
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error calling backend:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

## 📋 Checklist สำหรับ Frontend

### ✅ ตรวจสอบก่อนเรียก API

- [ ] มี auth token เก็บไว้ใน localStorage/cookie/session
- [ ] Token ยังไม่หมดอายุ
- [ ] ส่ง token ใน header: `Authorization: Bearer <token>`
- [ ] ตรวจสอบ response status ก่อนใช้งาน data
- [ ] Handle 401 (Unauthorized) โดย redirect ไปหน้า login

### ✅ สำหรับ Next.js API Route

- [ ] รับ token จาก client request
- [ ] ส่ง token ไปยัง backend ใน header
- [ ] Handle errors (401, 500, etc.)
- [ ] Return response ที่ถูกต้อง

## 🔍 ตัวอย่างการใช้งาน

### Client-side (React Component)

```javascript
import { useState, useEffect } from 'react';

function SavedProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProducts() {
      try {
        // 1. ดึง token
        const token = localStorage.getItem('authToken');
        
        if (!token) {
          // Redirect ไปหน้า login
          window.location.href = '/login';
          return;
        }

        // 2. เรียก API
        const response = await fetch(
          'http://localhost:3002/api/products/saved?page=1&limit=10&status=active',
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );

        // 3. ตรวจสอบ response
        if (response.status === 401) {
          // Token หมดอายุ
          localStorage.removeItem('authToken');
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch products');
        }

        const data = await response.json();
        setProducts(data.data || []);
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchProducts();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      {products.map(product => (
        <div key={product.id}>{product.product_name}</div>
      ))}
    </div>
  );
}
```

### ใช้ผ่าน Next.js API Route

```javascript
// Client-side
const response = await fetch('/api/shopee/saved-products?page=1&limit=10&status=active', {
  headers: {
    'Authorization': `Bearer ${token}`,  // ส่ง token ไปยัง Next.js API route
    'Content-Type': 'application/json'
  }
});
```

## 🎯 สรุป

1. **Backend endpoint `/api/products/saved`** ต้องมี auth token
2. **Frontend** ต้องส่ง token ใน header: `Authorization: Bearer <token>`
3. **Next.js API route** ต้องรับ token จาก client และส่งต่อไปยัง backend
4. **Handle errors** (401, 500) อย่างถูกต้อง

## 📝 หมายเหตุ

- Token format: `Bearer <token>` (ต้องมี "Bearer " prefix)
- Token เก็บไว้ที่ไหนก็ได้ (localStorage, cookie, session) แต่ต้องส่งใน header
- ถ้า token หมดอายุ backend จะ return 401 → frontend ควร redirect ไปหน้า login

