/**
 * File Content Validator
 * Validates file content using magic bytes (file signatures) to detect actual file type
 * This prevents malicious files from bypassing extension/MIME type checks
 */

import fs from 'fs';
import Logger from './logger.js';

/**
 * File signature (magic bytes) mappings
 * Format: [signature bytes, offset, mime type, extension]
 */
const FILE_SIGNATURES = {
  // JPEG: FF D8 FF
  jpeg: [
    { signature: [0xFF, 0xD8, 0xFF], offset: 0, mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] }
  ],
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  png: [
    { signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0, mime: 'image/png', extensions: ['png'] }
  ],
  // GIF: 47 49 46 38 (GIF8)
  gif: [
    { signature: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], offset: 0, mime: 'image/gif', extensions: ['gif'] }, // GIF87a
    { signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], offset: 0, mime: 'image/gif', extensions: ['gif'] }  // GIF89a
  ],
  // WebP: RIFF...WEBP
  webp: [
    { signature: [0x52, 0x49, 0x46, 0x46], offset: 0, mime: 'image/webp', extensions: ['webp'], checkWebP: true }
  ]
};

/**
 * Check if buffer matches signature at offset
 * @param {Buffer} buffer - File buffer
 * @param {Array<number>} signature - Signature bytes to match
 * @param {number} offset - Offset in buffer
 * @returns {boolean} True if signature matches
 */
function matchesSignature(buffer, signature, offset = 0) {
  if (buffer.length < offset + signature.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i++) {
    if (buffer[offset + i] !== signature[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Check if buffer is a WebP file
 * WebP files have RIFF header followed by WEBP chunk
 * @param {Buffer} buffer - File buffer
 * @returns {boolean} True if WebP
 */
function isWebP(buffer) {
  // Check RIFF header
  if (!matchesSignature(buffer, [0x52, 0x49, 0x46, 0x46], 0)) {
    return false;
  }

  // Check for WEBP chunk (at offset 8)
  if (buffer.length < 12) {
    return false;
  }

  const webpChunk = buffer.slice(8, 12).toString('ascii');
  return webpChunk === 'WEBP';
}

/**
 * Validate file content using magic bytes
 * @param {Buffer|string} fileInput - File buffer or file path
 * @param {Array<string>} allowedMimeTypes - Allowed MIME types
 * @returns {Object} Validation result
 */
export async function validateFileContent(fileInput, allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
  try {
    let buffer;

    // If fileInput is a path, read the file
    if (typeof fileInput === 'string') {
      if (!fs.existsSync(fileInput)) {
        return {
          isValid: false,
          error: 'File not found',
          detectedType: null
        };
      }
      buffer = fs.readFileSync(fileInput);
    } else if (Buffer.isBuffer(fileInput)) {
      buffer = fileInput;
    } else {
      return {
        isValid: false,
        error: 'Invalid file input. Expected Buffer or file path',
        detectedType: null
      };
    }

    // Check minimum file size (at least 4 bytes for smallest signature)
    if (buffer.length < 4) {
      return {
        isValid: false,
        error: 'File too small to determine type',
        detectedType: null
      };
    }

    // Check each file type signature
    for (const [type, signatures] of Object.entries(FILE_SIGNATURES)) {
      for (const sig of signatures) {
        if (sig.checkWebP && type === 'webp') {
          // Special handling for WebP
          if (isWebP(buffer)) {
            const isValidMime = allowedMimeTypes.includes(sig.mime);
            return {
              isValid: isValidMime,
              error: isValidMime ? null : `File type ${sig.mime} not allowed`,
              detectedType: sig.mime,
              extension: sig.extensions[0]
            };
          }
        } else {
          // Standard signature check
          if (matchesSignature(buffer, sig.signature, sig.offset)) {
            const isValidMime = allowedMimeTypes.includes(sig.mime);
            return {
              isValid: isValidMime,
              error: isValidMime ? null : `File type ${sig.mime} not allowed`,
              detectedType: sig.mime,
              extension: sig.extensions[0]
            };
          }
        }
      }
    }

    // No matching signature found
    return {
      isValid: false,
      error: 'File type could not be determined or is not allowed',
      detectedType: null
    };

  } catch (error) {
    Logger.error('[FileValidator] Error validating file content:', error);
    return {
      isValid: false,
      error: `Validation error: ${error.message}`,
      detectedType: null
    };
  }
}

/**
 * Validate file from multer upload
 * @param {Object} file - Multer file object
 * @param {Array<string>} allowedMimeTypes - Allowed MIME types
 * @returns {Object} Validation result
 */
export async function validateUploadedFile(file, allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
  if (!file || !file.path) {
    return {
      isValid: false,
      error: 'No file provided'
    };
  }

  const result = await validateFileContent(file.path, allowedMimeTypes);

  // Also verify that detected MIME type matches declared MIME type
  if (result.isValid && file.mimetype) {
    if (result.detectedType !== file.mimetype) {
      Logger.warn(`[FileValidator] MIME type mismatch: declared=${file.mimetype}, detected=${result.detectedType}`);
      // In production, this might be suspicious, but we'll allow it for now
      // You can make this stricter by returning isValid: false
    }
  }

  return result;
}

/**
 * Get allowed file types
 * @returns {Object} Allowed file types with signatures
 */
export function getAllowedFileTypes() {
  return {
    jpeg: { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
    png: { mime: 'image/png', extensions: ['png'] },
    gif: { mime: 'image/gif', extensions: ['gif'] },
    webp: { mime: 'image/webp', extensions: ['webp'] }
  };
}


