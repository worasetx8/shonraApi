import swaggerJsdoc from 'swagger-jsdoc';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Shonra Admin Backend API',
      version: '1.0.0',
      description: 'API documentation for Shonra Admin Backend - Shopee Affiliate Management System',
      contact: {
        name: 'API Support',
        email: 'support@shonra.com'
      },
      license: {
        name: 'ISC',
        url: 'https://opensource.org/licenses/ISC'
      }
    },
    servers: [
      {
        url: process.env.BACKEND_URL || 'http://localhost:3002',
        description: 'Development server'
      },
      {
        url: 'https://api.shonra.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your authentication token'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              example: 'Error message'
            },
            error: {
              type: 'string',
              example: 'Detailed error message'
            }
          }
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object'
            },
            message: {
              type: 'string',
              example: 'Operation successful'
            }
          }
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            item_id: { type: 'string' },
            product_name: { type: 'string' },
            shop_name: { type: 'string' },
            shop_id: { type: 'string' },
            price: { type: 'number', format: 'decimal' },
            price_min: { type: 'number', format: 'decimal' },
            price_max: { type: 'number', format: 'decimal' },
            commission_rate: { type: 'number', format: 'decimal' },
            commission_amount: { type: 'number', format: 'decimal' },
            image_url: { type: 'string' },
            product_link: { type: 'string' },
            offer_link: { type: 'string' },
            rating_star: { type: 'number', format: 'decimal' },
            sales_count: { type: 'integer' },
            discount_rate: { type: 'number', format: 'decimal' },
            status: { type: 'string', enum: ['active', 'inactive'] },
            category_id: { type: 'integer' },
            is_flash_sale: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Category: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            is_active: { type: 'boolean' },
            product_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Tag: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            is_active: { type: 'boolean' },
            product_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            username: { type: 'string' },
            full_name: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
            role_id: { type: 'integer' },
            permissions: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: {
              type: 'string',
              example: 'admin'
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'admin123'
            }
          }
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                user: { $ref: '#/components/schemas/User' },
                token: { type: 'string' }
              }
            },
            message: { type: 'string' }
          }
        }
      }
    },
    tags: [
      { name: 'Authentication', description: 'Authentication endpoints' },
      { name: 'Products', description: 'Product management endpoints' },
      { name: 'Categories', description: 'Category management endpoints' },
      { name: 'Tags', description: 'Tag management endpoints' },
      { name: 'Banners', description: 'Banner management endpoints' },
      { name: 'Settings', description: 'Settings management endpoints' },
      { name: 'Roles', description: 'Role and permission management endpoints' },
      { name: 'Admin', description: 'Admin user management endpoints' },
      { name: 'Social Media', description: 'Social media links management' },
      { name: 'Uploads', description: 'File upload endpoints' },
      { name: 'AI SEO', description: 'AI-powered SEO endpoints' }
    ]
  },
  apis: [
    join(__dirname, '../routes/*.js'),
    join(__dirname, '../index.js')
  ]
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;

