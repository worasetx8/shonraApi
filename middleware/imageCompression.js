import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import Logger from '../utils/logger.js';

/**
 * Image compression middleware
 * Compresses images before saving to reduce file size
 */
export async function compressImage(filePath, maxWidth = 1920, maxHeight = 1080, quality = 85) {
  try {
    const stats = await fs.promises.stat(filePath);
    const originalSize = stats.size;

    // Only compress if file is larger than 500KB
    if (originalSize < 500 * 1024) {
      Logger.debug(`Image ${path.basename(filePath)} is already small (${(originalSize / 1024).toFixed(2)}KB), skipping compression`);
      return filePath;
    }

    const ext = path.extname(filePath).toLowerCase();
    const supportedFormats = ['.jpg', '.jpeg', '.png', '.webp'];

    if (!supportedFormats.includes(ext)) {
      Logger.debug(`Image format ${ext} not supported for compression, skipping`);
      return filePath;
    }

    // Create temporary file path
    const tempPath = filePath + '.compressed';

    // Compress image
    let sharpInstance = sharp(filePath)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });

    // Apply format-specific compression
    if (ext === '.png') {
      sharpInstance = sharpInstance.png({ quality, compressionLevel: 9 });
    } else if (ext === '.webp') {
      sharpInstance = sharpInstance.webp({ quality });
    } else {
      // JPEG
      sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });
    }

    await sharpInstance.toFile(tempPath);

    // Check if compression was successful and file is smaller
    const compressedStats = await fs.promises.stat(tempPath);
    const compressedSize = compressedStats.size;

    if (compressedSize < originalSize) {
      // Replace original with compressed version
      await fs.promises.rename(tempPath, filePath);
      const savedBytes = originalSize - compressedSize;
      const savedPercent = ((savedBytes / originalSize) * 100).toFixed(1);
      Logger.success(`Image compressed: ${path.basename(filePath)} - ${(originalSize / 1024).toFixed(2)}KB → ${(compressedSize / 1024).toFixed(2)}KB (saved ${savedPercent}%)`);
      return filePath;
    } else {
      // Compression didn't help, remove temp file
      await fs.promises.unlink(tempPath);
      Logger.debug(`Image ${path.basename(filePath)} compression didn't reduce size, keeping original`);
      return filePath;
    }
  } catch (error) {
    Logger.error('Image compression error:', error);
    // Return original file path if compression fails
    return filePath;
  }
}

