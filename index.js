import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { testConnection, initializeDatabase } from "./config/database.js";
import { cleanupExpiredSessions, getSessionTimeoutHours } from "./utils/auth.js";
import { validateEnv } from "./config/env.js";
import compression from "compression";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";

// Import middleware
import { ipBlockingMiddleware } from "./middleware/ipBlocking.js";

// Import routes
import productRoutes from "./routes/products.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import categoryRoutes from "./routes/categories.js";
import categoryKeywordRoutes from "./routes/category-keywords.js";
import tagRoutes from "./routes/tags.js";
import bannerPositionRoutes from "./routes/banner-positions.js";
import bannerCampaignRoutes from "./routes/banner-campaigns.js";
import bannerRoutes from "./routes/banners.js";
import settingsRoutes from "./routes/settings.js";
import socialRoutes from "./routes/socials.js";
import roleRoutes from "./routes/roles.js";
import uploadRoutes from "./routes/upload.js";
import aiSeoRoutes from "./routes/ai-seo.js";
import ipBlockingRoutes from "./routes/ip-blocking.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file in current directory
dotenv.config({ path: path.join(__dirname, ".env") });

// Also try loading from parent directory (for development)
if (!process.env.DB_HOST && !process.env.DB_PASSWORD) {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}

// Set timezone to Thailand
process.env.TZ = "Asia/Bangkok";

const app = express();
const port = process.env.SERVER_PORT || 3002;

// HTTPS Redirect (Production only)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // Check if request is already HTTPS (via proxy)
    const isHttps = req.header('x-forwarded-proto') === 'https' || 
                     req.secure || 
                     req.header('x-forwarded-ssl') === 'on';
    
    if (!isHttps && req.method === 'GET') {
      const host = req.header('host') || req.hostname;
      return res.redirect(301, `https://${host}${req.url}`);
    }
    
    next();
  });
}

// Import logger (must be after port definition)
import Logger from "./utils/logger.js";

// Validate environment variables
try {
  validateEnv();
} catch (error) {
  Logger.error("Environment validation failed:", error.message);
  process.exit(1);
}

// Debug logging (only in development)
const isDevelopment = process.env.NODE_ENV !== "production";
if (isDevelopment) {
  Logger.info("Environment Variables:", {
    SERVER_PORT: process.env.SERVER_PORT,
    NODE_ENV: process.env.NODE_ENV,
    CLIENT_URL: process.env.CLIENT_URL,
    BACKEND_URL: process.env.BACKEND_URL,
    UsingPort: port
  });
}

// Middleware
// CORS: Allow both Next.js client and Backend Admin UI
const allowedOrigins = [];
if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL);
}
if (process.env.BACKEND_URL) {
  allowedOrigins.push(process.env.BACKEND_URL);
}
// Always allow localhost for development
allowedOrigins.push("http://localhost:3000", "http://localhost:5173");

// If no production URLs configured, use defaults for development
if (allowedOrigins.length === 2) {
  Logger.warn("No CLIENT_URL or BACKEND_URL configured. Using localhost only.");
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Check if origin is in allowed list
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        // In production, reject unknown origins; in development, allow all
        if (isDevelopment) {
          callback(null, true); // Allow all for development
        } else {
          Logger.warn(`CORS blocked origin: ${origin}. Allowed origins: ${allowedOrigins.join(", ")}`);
          callback(new Error("Not allowed by CORS"), false); // Reject in production
        }
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    // Additional security headers
    exposedHeaders: [],
    maxAge: 86400 // Cache preflight requests for 24 hours
  })
);

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set("trust proxy", 1);

// Security: Reduce request size limits to prevent DoS
app.use(express.json({ limit: "1mb" })); // Reduced from 10mb
app.use(express.urlencoded({ extended: true, limit: "1mb" })); // Reduced from 10mb

// Security headers middleware
import { securityHeaders } from "./middleware/securityHeaders.js";
app.use(securityHeaders);

// Compression middleware - compress responses to reduce bandwidth
app.use(
  compression({
    level: process.env.NODE_ENV === "production" ? 6 : 4, // Higher compression in production
    threshold: 512, // Compress responses larger than 512 bytes (lower threshold for better performance)
    filter: (req, res) => {
      // Don't compress if client doesn't support it
      if (req.headers["x-no-compression"]) {
        return false;
      }
      // Don't compress already compressed formats
      if (req.path.startsWith("/api/uploads")) {
        return false;
      }
      return compression.filter(req, res);
    }
  })
);

// Helmet.js - Set various HTTP headers for security
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Tightened CSP: Remove 'unsafe-inline' for scripts in production
        styleSrc: process.env.NODE_ENV === "production" 
          ? ["'self'"] // Production: No inline styles (requires refactoring)
          : ["'self'", "'unsafe-inline'"], // Development: Allow inline styles for React
        scriptSrc: process.env.NODE_ENV === "production"
          ? ["'self'"] // Production: No inline scripts
          : ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Development: Allow for React dev mode
        imgSrc: ["'self'", "data:", "https:"], // Allow images from any HTTPS source
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"], // Block all object/embed/embed tags
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"], // Block all iframes
        baseUri: ["'self'"], // Restrict base tag
        formAction: ["'self'"], // Restrict form submissions
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null // Upgrade HTTP to HTTPS in production
      }
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    crossOriginEmbedderPolicy: false, // Disable for API server
    crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin resources
  })
);

// Request timeout middleware (30 seconds)
app.use((req, res, next) => {
  const timeout = 30000; // 30 seconds
  req.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        message: "Request timeout. Please try again."
      });
    }
  });
  next();
});

// IP Blocking Middleware (apply before routes)
app.use(ipBlockingMiddleware);

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Shonra API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true
  }
}));

// Health check endpoint
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 service:
 *                   type: string
 *                   example: Shonra Admin Backend
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Shonra Admin Backend"
  });
});

// Database health check endpoint
/**
 * @swagger
 * /api/health/db:
 *   get:
 *     summary: Database health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database is connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: connected
 *                 database:
 *                   type: string
 *                 host:
 *                   type: string
 *                 port:
 *                   type: integer
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Database connection failed
 */
app.get("/api/health/db", async (req, res) => {
  try {
    const conn = await testConnection();
    if (conn) {
      res.status(200).json({
        status: "connected",
        database: process.env.DB_NAME,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        status: "disconnected",
        database: process.env.DB_NAME,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
      database: process.env.DB_NAME,
      timestamp: new Date().toISOString()
    });
  }
});

// Request logging middleware (for production monitoring)
app.use((req, res, next) => {
  // Log API requests (skip health check and static files)
  if (req.path !== "/health" && req.path.startsWith("/api")) {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      Logger.info(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
  }
  next();
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/category-keywords", categoryKeywordRoutes);
app.use("/api/tags", tagRoutes);
app.use("/api/banner-positions", bannerPositionRoutes);
app.use("/api/banner-campaigns", bannerCampaignRoutes);
app.use("/api/banners", bannerRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/socials", socialRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/ai-seo", aiSeoRoutes);
app.use("/api/ip-blocking", ipBlockingRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
    path: req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  // Use the isDevelopment variable declared above

  // Log full error details (server-side only)
  Logger.error("Server Error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Return sanitized error to client
  res.status(err.status || 500).json({
    success: false,
    message: "Internal server error",
    ...(isDevelopment && {
      error: err.message,
      stack: err.stack
    })
  });
});

// Function to kill processes using a specific port
async function killProcessOnPort(port) {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Use PowerShell to kill processes on Windows
    const command = `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`;
    await execAsync(command);
    return true;
  } catch (error) {
    return false;
  }
}

async function startServer() {
  try {
    // Kill any existing processes on the port (for nodemon auto-restart)
    const existingProcesses = await killProcessOnPort(port);
    if (existingProcesses) {
      // Wait a moment for port to be released
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      Logger.error("Cannot connect to database. Server startup aborted.");
      Logger.warn("Please check:");
      Logger.info("   1. MySQL server is running");
      Logger.info("   2. Database credentials in .env file");
      Logger.info("   3. Database 'shopee_affiliate' exists");
      process.exit(1);
    }

    // Initialize database tables
    await initializeDatabase();

    // Start server with error handling for port conflicts
    const server = app.listen(port, () => {
      Logger.success(`
🚀 Shonra Admin Backend Server Started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Server: http://localhost:${port}
🔍 Health: http://localhost:${port}/health
💾 Database: Connected ✅
🔐 Session Timeout: ${getSessionTimeoutHours()} hours (${getSessionTimeoutHours() / 24} days)
⏰ Started: ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `);
    });

    // Handle server errors (like port already in use)
    server.on("error", async (error) => {
      if (error.code === "EADDRINUSE") {
        Logger.error(`Port ${port} is already in use!`);
        Logger.warn("Attempting to kill existing process...");

        const killed = await killProcessOnPort(port);
        if (killed) {
          Logger.success("Attempted to kill existing process.");
          Logger.info("Nodemon will auto-restart in a moment...");
        } else {
          Logger.warn("Could not auto-kill process. Please kill manually:");
          Logger.info(
            `Get-NetTCPConnection -LocalPort ${port} | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }`
          );
          Logger.info(`Or: .\\kill-port.ps1 ${port} -Force`);
        }
        // Don't exit - let nodemon handle restart
      } else {
        Logger.error("Server error:", error);
        process.exit(1);
      }
    });

    // Cleanup expired sessions every hour
    setInterval(async () => {
      await cleanupExpiredSessions();
    }, 60 * 60 * 1000); // Every hour
  } catch (error) {
    Logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  Logger.info("SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  Logger.info("SIGINT received, shutting down gracefully...");
  process.exit(0);
});

startServer();
