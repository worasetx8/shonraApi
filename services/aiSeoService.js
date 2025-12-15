/**
 * AI SEO Service using Google Gemini API
 * Provides AI-powered SEO features:
 * - Meta description generation
 * - Keyword suggestions
 * - Image alt text generation
 * - Content optimization
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { executeQuery } from '../config/database.js';
import Logger from '../utils/logger.js';

let genAI = null;
let cachedApiKey = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get Gemini API Key from database
 * @returns {Promise<string|null>} API key or null if not found/disabled
 */
async function getGeminiApiKey() {
  try {
    // Check cache first
    const now = Date.now();
    if (cachedApiKey !== null && (now - lastCacheTime) < CACHE_DURATION) {
      return cachedApiKey;
    }

    // Fetch from database
    // First check if columns exist, if not return null (columns will be added by migration)
    try {
      // Check if columns exist first
      const checkColumns = await executeQuery(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'settings' 
        AND COLUMN_NAME IN ('enable_ai_seo', 'gemini_api_key')
      `);
      
      // Handle both lowercase and uppercase column names (MySQL version differences)
      const existingColumns = new Set(
        (checkColumns.data || []).map(c => {
          const colName = c.COLUMN_NAME || c.column_name;
          return colName ? colName.toLowerCase() : null;
        }).filter(Boolean)
      );
      
      // If columns don't exist, return null (migration will add them)
      if (!existingColumns.has('enable_ai_seo') || !existingColumns.has('gemini_api_key')) {
        cachedApiKey = null;
        lastCacheTime = now;
        return null;
      }
      
      // Columns exist, proceed with query
      const result = await executeQuery(`
        SELECT enable_ai_seo, gemini_api_key 
        FROM settings 
        WHERE id = 1
      `);

      if (result.success && result.data && result.data.length > 0) {
        const settings = result.data[0];
        
        // Check if AI SEO is enabled
        if (!settings.enable_ai_seo) {
          cachedApiKey = null;
          lastCacheTime = now;
          return null;
        }

        // Return API key if available
        const apiKey = settings.gemini_api_key || null;
        cachedApiKey = apiKey;
        lastCacheTime = now;
        return apiKey;
      }
      
      // No settings found
      cachedApiKey = null;
      lastCacheTime = now;
      return null;
    } catch (error) {
      // If any error occurs (including column not found), return null
      // Migration will add columns later
      if (error.code === 'ER_BAD_FIELD_ERROR' || 
          error.message.includes('Unknown column') ||
          error.code === 'ER_NO_SUCH_TABLE') {
        cachedApiKey = null;
        lastCacheTime = now;
        return null;
      }
      // Re-throw other errors
      throw error;
    }

    return null;
  } catch (error) {
    Logger.error('Failed to get Gemini API Key from database:', error);
    return null;
  }
}

/**
 * Initialize or reinitialize Gemini AI client
 */
async function initializeGeminiAI() {
  const apiKey = await getGeminiApiKey();
  
  if (!apiKey) {
    genAI = null;
    return false;
  }

  try {
    genAI = new GoogleGenerativeAI(apiKey);
    return true;
  } catch (error) {
    Logger.error('Failed to initialize Gemini AI:', error);
    genAI = null;
    return false;
  }
}

// Initialize on module load
initializeGeminiAI();

/**
 * Generate SEO meta description using AI
 * @param {Object} params - Parameters for meta description generation
 * @param {string} params.content - Main content or product information
 * @param {string} params.type - Type of content (product, page, category, etc.)
 * @param {string} params.language - Language code (th, en)
 * @returns {Promise<string>} Generated meta description
 */
export async function generateMetaDescription({ content, type = 'page', language = 'th' }) {
  // Ensure Gemini AI is initialized
  if (!genAI) {
    const initialized = await initializeGeminiAI();
    if (!initialized) {
      return null;
    }
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = language === 'th' 
      ? `สร้าง meta description สำหรับ SEO ที่น่าสนใจและดึงดูดสำหรับ ${type} ต่อไปนี้:
      
เนื้อหา: ${content}

ข้อกำหนด:
- ความยาว 120-160 ตัวอักษร
- ใช้คำหลักที่เกี่ยวข้อง
- กระตุ้นให้คลิก
- เขียนเป็นภาษาไทย
- ไม่ใช้เครื่องหมายคำพูดหรืออัญประกาศ

ตอบกลับเฉพาะ meta description เท่านั้น ไม่มีคำอธิบายเพิ่มเติม:`
      : `Generate an engaging SEO meta description for ${type}:
      
Content: ${content}

Requirements:
- 120-160 characters
- Include relevant keywords
- Call-to-action
- English language
- No quotes or brackets

Return only the meta description, no additional text:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text().trim();

    // Clean up the response
    text = text.replace(/^["']|["']$/g, ''); // Remove quotes
    text = text.replace(/\n/g, ' '); // Remove newlines
    text = text.trim();

    // Ensure length is within limits
    if (text.length > 160) {
      text = text.substring(0, 157) + '...';
    }

    return text || null;
  } catch (error) {
    Logger.error('Error generating meta description:', error);
    return null;
  }
}

/**
 * Generate keyword suggestions using AI
 * @param {Object} params - Parameters for keyword generation
 * @param {string} params.content - Main content or product information
 * @param {string} params.language - Language code (th, en)
 * @param {number} params.count - Number of keywords to generate (default: 10)
 * @returns {Promise<string[]>} Array of suggested keywords
 */
export async function generateKeywords({ content, language = 'th', count = 10 }) {
  // Ensure Gemini AI is initialized
  if (!genAI) {
    const initialized = await initializeGeminiAI();
    if (!initialized) {
      return [];
    }
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = language === 'th'
      ? `สร้างคำหลัก (keywords) สำหรับ SEO จำนวน ${count} คำ สำหรับเนื้อหาต่อไปนี้:
      
เนื้อหา: ${content}

ข้อกำหนด:
- คำหลักที่เกี่ยวข้องและเป็นที่นิยม
- รวมทั้งภาษาไทยและภาษาอังกฤษ
- แยกด้วยเครื่องหมายจุลภาค
- ไม่มีหมายเลขหรือ bullet points

ตอบกลับเฉพาะคำหลักเท่านั้น แยกด้วยเครื่องหมายจุลภาค:`
      : `Generate ${count} SEO keywords for the following content:
      
Content: ${content}

Requirements:
- Relevant and popular keywords
- Mix of short and long-tail keywords
- Comma-separated
- No numbers or bullet points

Return only keywords, comma-separated:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text().trim();

    // Parse keywords
    const keywords = text
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0)
      .slice(0, count);

    return keywords;
  } catch (error) {
    Logger.error('Error generating keywords:', error);
    return [];
  }
}

/**
 * Generate image alt text using AI
 * @param {Object} params - Parameters for alt text generation
 * @param {string} params.imageUrl - URL of the image
 * @param {string} params.context - Context about the image (product name, category, etc.)
 * @param {string} params.language - Language code (th, en)
 * @returns {Promise<string>} Generated alt text
 */
export async function generateImageAltText({ imageUrl, context = '', language = 'th' }) {
  // Ensure Gemini AI is initialized
  if (!genAI) {
    const initialized = await initializeGeminiAI();
    if (!initialized) {
      return null;
    }
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = language === 'th'
      ? `สร้าง alt text สำหรับภาพ SEO ที่เหมาะสม:
      
บริบท: ${context || 'ภาพสินค้า'}
URL: ${imageUrl}

ข้อกำหนด:
- อธิบายภาพอย่างชัดเจนและกระชับ
- ใช้คำหลักที่เกี่ยวข้อง
- ความยาว 50-125 ตัวอักษร
- เขียนเป็นภาษาไทย
- ไม่ใช้คำว่า "ภาพ" หรือ "รูปภาพ" นำหน้า

ตอบกลับเฉพาะ alt text เท่านั้น:`
      : `Generate appropriate SEO alt text for an image:
      
Context: ${context || 'Product image'}
URL: ${imageUrl}

Requirements:
- Clear and concise description
- Include relevant keywords
- 50-125 characters
- English language
- Don't start with "image of" or "picture of"

Return only the alt text:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text().trim();

    // Clean up the response
    text = text.replace(/^["']|["']$/g, '');
    text = text.replace(/\n/g, ' ');
    text = text.trim();

    // Ensure length is within limits
    if (text.length > 125) {
      text = text.substring(0, 122) + '...';
    }

    return text || null;
  } catch (error) {
    Logger.error('Error generating alt text:', error);
    return null;
  }
}

/**
 * Optimize content for SEO using AI
 * @param {Object} params - Parameters for content optimization
 * @param {string} params.content - Content to optimize
 * @param {string} params.targetKeywords - Target keywords
 * @param {string} params.language - Language code (th, en)
 * @returns {Promise<Object>} Optimized content with suggestions
 */
export async function optimizeContent({ content, targetKeywords = '', language = 'th' }) {
  // Ensure Gemini AI is initialized
  if (!genAI) {
    const initialized = await initializeGeminiAI();
    if (!initialized) {
      return null;
    }
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = language === 'th'
      ? `ปรับปรุงเนื้อหาต่อไปนี้ให้เหมาะสำหรับ SEO:
      
เนื้อหา: ${content}
คำหลักเป้าหมาย: ${targetKeywords || 'ไม่ระบุ'}

ให้คำแนะนำ:
1. วิธีปรับปรุงเนื้อหาให้เหมาะกับ SEO
2. คำหลักที่ควรเพิ่ม
3. โครงสร้างที่ควรปรับปรุง

ตอบกลับเป็น JSON format:
{
  "optimizedContent": "...",
  "suggestions": ["...", "..."],
  "keywordsToAdd": ["...", "..."]
}`
      : `Optimize the following content for SEO:
      
Content: ${content}
Target Keywords: ${targetKeywords || 'Not specified'}

Provide:
1. How to improve content for SEO
2. Keywords to add
3. Structure improvements

Return JSON format:
{
  "optimizedContent": "...",
  "suggestions": ["...", "..."],
  "keywordsToAdd": ["...", "..."]
}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Try to parse JSON
    try {
      // Remove markdown code blocks if present
      const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(jsonText);
    } catch (parseError) {
      // If JSON parsing fails, return as plain text
      return {
        optimizedContent: content,
        suggestions: [text],
        keywordsToAdd: [],
      };
    }
  } catch (error) {
    Logger.error('Error optimizing content:', error);
    return null;
  }
}

