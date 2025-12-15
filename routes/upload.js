import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { formatResponse } from "../utils/helpers.js";
import { requireAuth } from "./auth.js";
import { executeQuery } from "../config/database.js";
import Logger from "../utils/logger.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base uploads directory
// In Docker: /app/uploads (mounted volume)
// In development: ../uploads (relative to routes folder, which is inside server folder)
// __dirname = server/routes, so ../uploads = server/uploads
const uploadsBaseDir = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");

// Log the uploads directory path for debugging
Logger.info("Uploads directory:", {
  __dirname,
  uploadsBaseDir,
  absolutePath: path.resolve(uploadsBaseDir)
});

// Create uploads directories if they don't exist
const bannersDir = path.join(uploadsBaseDir, "banners");
const imagesDir = path.join(uploadsBaseDir, "images");
if (!fs.existsSync(bannersDir)) {
  fs.mkdirSync(bannersDir, { recursive: true });
  Logger.info("Created banners directory:", bannersDir);
}
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
  Logger.info("Created images directory:", imagesDir);
}

// Configure multer for banner uploads
const bannerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, bannersDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// Configure multer for image uploads (logos, etc.)
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// File filter: only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error("Only image files are allowed (jpeg, jpg, png, gif, webp)"));
  }
};

const uploadBanner = multer({
  storage: bannerStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

const uploadImage = multer({
  storage: imageStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

const router = express.Router();

// Upload banner image
router.post("/banner", requireAuth, uploadBanner.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(formatResponse(false, null, "No image file provided"));
    }

    // Log file upload details for debugging
    Logger.info("Banner uploaded:", {
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      destination: req.file.destination,
      size: req.file.size,
      bannersDir: bannersDir,
      fileExists: fs.existsSync(req.file.path)
    });

    // Compress image if sharp is available (optional, won't break if not installed)
    try {
      const { compressImage } = await import('../middleware/imageCompression.js');
      await compressImage(req.file.path);
    } catch (compressionError) {
      // Sharp not installed or compression failed, continue without compression
      Logger.debug('Image compression skipped:', compressionError.message);
    }

    // Return the file path relative to the server
    // Frontend will access via /api/uploads/banners/filename
    const fileUrl = `/api/uploads/banners/${req.file.filename}`;
    
    res.json(formatResponse(true, {
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path // Include path for debugging (remove in production)
    }, "Image uploaded successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to upload file", 500, formatResponse);
  }
});

// Upload logo/image
router.post("/image", requireAuth, uploadImage.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(formatResponse(false, null, "No image file provided"));
    }

    // Compress image if sharp is available (optional, won't break if not installed)
    try {
      const { compressImage } = await import('../middleware/imageCompression.js');
      await compressImage(req.file.path);
    } catch (compressionError) {
      // Sharp not installed or compression failed, continue without compression
      Logger.debug('Image compression skipped:', compressionError.message);
    }

    // Return the file path relative to the server
    // Frontend will access via /api/uploads/images/filename
    const fileUrl = `/api/uploads/images/${req.file.filename}`;
    
    res.json(formatResponse(true, {
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    }, "Image uploaded successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to upload file", 500, formatResponse);
  }
});

// Serve uploaded banner images
router.get("/banners/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(bannersDir, filename);

    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(path.normalize(bannersDir))) {
      return res.status(403).json(formatResponse(false, null, "Access denied"));
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json(formatResponse(false, null, "Image not found"));
    }

    // Determine content type based on file extension
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const contentType = contentTypes[ext] || 'image/jpeg';

    // Set headers and send file
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Cache for 1 year
    res.sendFile(filePath);
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to serve image", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to serve image", error.message));
  }
});

// Serve uploaded logo/images
router.get("/images/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(imagesDir, filename);

    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(path.normalize(imagesDir))) {
      return res.status(403).json(formatResponse(false, null, "Access denied"));
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json(formatResponse(false, null, "Image not found"));
    }

    // Determine content type based on file extension
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const contentType = contentTypes[ext] || 'image/jpeg';

    // Set headers and send file
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Cache for 1 year
    res.sendFile(filePath);
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to serve image", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to serve image", error.message));
  }
});

// List all uploaded banner images
router.get("/banners", requireAuth, async (req, res) => {
  try {
    // Log directory path for debugging
    Logger.info("Listing banners from:", {
      bannersDir,
      absolutePath: path.resolve(bannersDir),
      exists: fs.existsSync(bannersDir)
    });

    // Get all files in uploads directory
    if (!fs.existsSync(bannersDir)) {
      Logger.warn("Banners directory does not exist:", bannersDir);
      return res.json(formatResponse(true, [], "No images found"));
    }

    const files = fs.readdirSync(bannersDir);
    Logger.info("Found files in banners directory:", {
      count: files.length,
      files: files.slice(0, 5) // Log first 5 files
    });
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    });

    // Get file info and check if used in database
    const fileList = await Promise.all(imageFiles.map(async (filename) => {
      const filePath = path.join(bannersDir, filename);
      const stats = fs.statSync(filePath);
      const fileUrl = `/api/uploads/banners/${filename}`;

      // Check if file is used in banners table
      const checkQuery = `SELECT id, position_id FROM banners WHERE image_url = ? OR image_url LIKE ? LIMIT 1`;
      const result = await executeQuery(checkQuery, [fileUrl, `%${filename}%`]);

      return {
        filename,
        url: fileUrl,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isUsed: result.success && result.data && result.data.length > 0,
        usedIn: result.success && result.data && result.data.length > 0 ? result.data[0] : null
      };
    }));

    // Sort by modified date (newest first)
    fileList.sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json(formatResponse(true, fileList, "Images retrieved successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to list images", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to list images", error.message));
  }
});

// Check if image is used
router.get("/banners/:filename/check", requireAuth, async (req, res) => {
  try {
    const filename = req.params.filename;
    const fileUrl = `/api/uploads/banners/${filename}`;

    // Check if file is used in banners table
    const checkQuery = `SELECT id, position_id, image_url FROM banners WHERE image_url = ? OR image_url LIKE ?`;
    const result = await executeQuery(checkQuery, [fileUrl, `%${filename}%`]);

    const isUsed = result.success && result.data && result.data.length > 0;

    res.json(formatResponse(true, {
      filename,
      isUsed,
      usedIn: isUsed ? result.data : []
    }, isUsed ? "Image is in use" : "Image is not in use"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to check image usage", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to check image usage", error.message));
  }
});

// Delete uploaded banner image
router.delete("/banners/:filename", requireAuth, async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(bannersDir, filename);

    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(path.normalize(bannersDir))) {
      return res.status(403).json(formatResponse(false, null, "Access denied"));
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json(formatResponse(false, null, "Image not found"));
    }

    // Check if file is used in database
    const fileUrl = `/api/uploads/banners/${filename}`;
    const checkQuery = `SELECT id, position_id FROM banners WHERE image_url = ? OR image_url LIKE ? LIMIT 1`;
    const checkResult = await executeQuery(checkQuery, [fileUrl, `%${filename}%`]);

    if (checkResult.success && checkResult.data && checkResult.data.length > 0) {
      return res.status(400).json(formatResponse(false, null, 
        `Cannot delete image: Image is currently used in banner ID ${checkResult.data[0].id}`));
    }

    // Delete file
    fs.unlinkSync(filePath);
    res.json(formatResponse(true, null, "Image deleted successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete image", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to delete image", error.message));
  }
});

// List all images from all directories under uploads
router.get("/all", requireAuth, async (req, res) => {
  try {
    const allImages = [];

    // Helper function to get images from a directory
    const getImagesFromDir = async (dir, baseUrl, folderName) => {
      if (!fs.existsSync(dir)) {
        return [];
      }

      const files = fs.readdirSync(dir);
      const imageFiles = files.filter(file => {
        const filePath = path.join(dir, file);
        // Only process files, not directories
        if (!fs.statSync(filePath).isFile()) {
          return false;
        }
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
      });

      const fileList = await Promise.all(imageFiles.map(async (filename) => {
        const filePath = path.join(dir, filename);
        const stats = fs.statSync(filePath);
        const fileUrl = `${baseUrl}/${filename}`;

        // Check if used in banners
        const bannerCheckQuery = `SELECT id, position_id FROM banners WHERE image_url = ? OR image_url LIKE ? LIMIT 1`;
        const bannerResult = await executeQuery(bannerCheckQuery, [fileUrl, `%${filename}%`]);
        const isUsedInBanner = bannerResult.success && bannerResult.data && bannerResult.data.length > 0;

        // Check if used in settings (logo_backend_url, logo_client_url)
        const settingsCheckQuery = `SELECT id FROM settings WHERE logo_backend_url = ? OR logo_backend_url LIKE ? OR logo_client_url = ? OR logo_client_url LIKE ? LIMIT 1`;
        const settingsResult = await executeQuery(settingsCheckQuery, [fileUrl, `%${filename}%`, fileUrl, `%${filename}%`]);
        const isUsedInSettings = settingsResult.success && settingsResult.data && settingsResult.data.length > 0;

        const isUsed = isUsedInBanner || isUsedInSettings;
        let usedIn = null;
        let usedInType = null;

        if (isUsedInBanner) {
          usedIn = bannerResult.data[0];
          usedInType = 'banner';
        } else if (isUsedInSettings) {
          usedIn = { id: 1 }; // Settings always has id = 1
          usedInType = 'settings';
        }

        return {
          filename,
          url: fileUrl,
          folder: folderName,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          isUsed,
          usedIn,
          usedInType
        };
      }));

      return fileList;
    };

    // Scan all directories under uploads
    if (!fs.existsSync(uploadsBaseDir)) {
      return res.json(formatResponse(true, [], "No uploads directory found"));
    }

    const folders = fs.readdirSync(uploadsBaseDir).filter(item => {
      const itemPath = path.join(uploadsBaseDir, item);
      return fs.statSync(itemPath).isDirectory();
    });

    // Get images from all folders
    const imagePromises = folders.map(async (folderName) => {
      const folderDir = path.join(uploadsBaseDir, folderName);
      const baseUrl = `/api/uploads/${folderName}`;
      return await getImagesFromDir(folderDir, baseUrl, folderName);
    });

    const imageArrays = await Promise.all(imagePromises);
    
    // Flatten and combine all images
    imageArrays.forEach(images => {
      allImages.push(...images);
    });

    // Sort by modified date (newest first)
    allImages.sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json(formatResponse(true, allImages, "All images retrieved successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to list images", 500, formatResponse);
  }
});

// Delete image from any folder under uploads
router.delete("/:folder/:filename", requireAuth, async (req, res) => {
  try {
    const { folder, filename } = req.params;

    // Construct target directory path
    const targetDir = path.join(uploadsBaseDir, folder);
    const filePath = path.join(targetDir, filename);

    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    const normalizedBaseDir = path.normalize(uploadsBaseDir);
    const normalizedTargetDir = path.normalize(targetDir);
    
    // Ensure the folder is actually a subdirectory of uploads
    if (!normalizedTargetDir.startsWith(normalizedBaseDir)) {
      return res.status(403).json(formatResponse(false, null, "Access denied: Invalid folder"));
    }
    
    // Ensure the file path is within the target directory
    if (!normalizedPath.startsWith(normalizedTargetDir)) {
      return res.status(403).json(formatResponse(false, null, "Access denied: Invalid file path"));
    }

    // Check if target directory exists
    if (!fs.existsSync(targetDir)) {
      return res.status(404).json(formatResponse(false, null, "Folder not found"));
    }

    // Check if it's a directory (not a file)
    if (fs.statSync(targetDir).isFile()) {
      return res.status(400).json(formatResponse(false, null, "Invalid folder path"));
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json(formatResponse(false, null, "Image not found"));
    }

    const fileUrl = `/api/uploads/${folder}/${filename}`;

    // Check if used in banners
    const bannerCheckQuery = `SELECT id, position_id FROM banners WHERE image_url = ? OR image_url LIKE ? LIMIT 1`;
    const bannerResult = await executeQuery(bannerCheckQuery, [fileUrl, `%${filename}%`]);
    if (bannerResult.success && bannerResult.data && bannerResult.data.length > 0) {
      return res.status(400).json(formatResponse(false, null, 
        `Cannot delete image: Image is currently used in banner ID ${bannerResult.data[0].id}`));
    }

    // Check if used in settings
    const settingsCheckQuery = `SELECT id FROM settings WHERE logo_backend_url = ? OR logo_backend_url LIKE ? OR logo_client_url = ? OR logo_client_url LIKE ? LIMIT 1`;
    const settingsResult = await executeQuery(settingsCheckQuery, [fileUrl, `%${filename}%`, fileUrl, `%${filename}%`]);
    if (settingsResult.success && settingsResult.data && settingsResult.data.length > 0) {
      return res.status(400).json(formatResponse(false, null, 
        `Cannot delete image: Image is currently used in settings`));
    }

    // Delete file
    fs.unlinkSync(filePath);
    res.json(formatResponse(true, null, "Image deleted successfully"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to delete image", 500, formatResponse);
    res.status(500).json(formatResponse(false, null, "Failed to delete image", error.message));
  }
});

export default router;

