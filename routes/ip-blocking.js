/**
 * IP Blocking Management Routes
 * Admin endpoints for managing IP blocking
 */

import express from "express";
import { requireAuth, requireAdmin } from "./auth.js";
import { formatResponse } from "../utils/helpers.js";
import { handleErrorWithFormat } from "../utils/errorHandler.js";
import {
  getBlockedIPs,
  getWhitelistedIPs,
  blockIP,
  unblockIP,
  whitelistIP,
  removeWhitelist,
  isBlocked,
  getClientIP
} from "../middleware/ipBlocking.js";
import Logger from "../utils/logger.js";

const router = express.Router();

/**
 * @swagger
 * /api/ip-blocking/status:
 *   get:
 *     summary: Get IP blocking status for current IP
 *     tags: [IP Blocking]
 *     responses:
 *       200:
 *         description: IP blocking status
 */
router.get("/status", (req, res) => {
  try {
    const clientIP = getClientIP(req);
    const blockStatus = isBlocked(clientIP);
    
    return res.json(formatResponse(true, {
      ip: clientIP,
      isBlocked: blockStatus.isBlocked,
      blockedUntil: blockStatus.blockedUntil ? new Date(blockStatus.blockedUntil).toISOString() : null,
      reason: blockStatus.reason,
      violations: blockStatus.violations || 0
    }, "IP blocking status retrieved"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to get IP blocking status", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/ip-blocking/blocked:
 *   get:
 *     summary: Get all blocked IPs (Admin only)
 *     tags: [IP Blocking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of blocked IPs
 */
router.get("/blocked", requireAuth, requireAdmin, (req, res) => {
  try {
    const blockedIPs = getBlockedIPs();
    
    return res.json(formatResponse(true, {
      blockedIPs: blockedIPs.map(ip => ({
        ...ip,
        blockedUntil: new Date(ip.blockedUntil).toISOString(),
        blockedAt: ip.blockedAt ? new Date(ip.blockedAt).toISOString() : null
      })),
      count: blockedIPs.length
    }, "Blocked IPs retrieved"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to get blocked IPs", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/ip-blocking/whitelisted:
 *   get:
 *     summary: Get all whitelisted IPs (Admin only)
 *     tags: [IP Blocking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of whitelisted IPs
 */
router.get("/whitelisted", requireAuth, requireAdmin, (req, res) => {
  try {
    const whitelistedIPs = getWhitelistedIPs();
    
    return res.json(formatResponse(true, {
      whitelistedIPs,
      count: whitelistedIPs.length
    }, "Whitelisted IPs retrieved"));
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to get whitelisted IPs", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/ip-blocking/block:
 *   post:
 *     summary: Block an IP address (Admin only)
 *     tags: [IP Blocking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ip
 *             properties:
 *               ip:
 *                 type: string
 *                 description: IP address to block
 *               durationMs:
 *                 type: integer
 *                 description: "Block duration in milliseconds (default: 1 hour)"
 *               reason:
 *                 type: string
 *                 description: Reason for blocking
 *     responses:
 *       200:
 *         description: IP blocked successfully
 */
router.post("/block", requireAuth, requireAdmin, (req, res) => {
  try {
    const { ip, durationMs, reason } = req.body;
    
    if (!ip) {
      return res.status(400).json(formatResponse(false, null, "IP address is required"));
    }
    
    const success = blockIP(ip, durationMs, reason || "Manual block by admin");
    
    if (success) {
      return res.json(formatResponse(true, null, `IP ${ip} blocked successfully`));
    } else {
      return res.status(400).json(formatResponse(false, null, `Failed to block IP ${ip} (may be whitelisted)`));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to block IP", 500, formatResponse);
  }
});

/**
 * @swagger
 * /api/ip-blocking/unblock:
 *   post:
 *     summary: Unblock an IP address (Admin only)
 *     tags: [IP Blocking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ip
 *             properties:
 *               ip:
 *                 type: string
 *                 description: IP address to unblock
 *     responses:
 *       200:
 *         description: IP unblocked successfully
 */
router.post("/unblock", requireAuth, requireAdmin, (req, res) => {
  try {
    const { ip } = req.body;
    
    if (!ip) {
      return res.status(400).json(formatResponse(false, null, "IP address is required"));
    }
    
    const success = unblockIP(ip);
    
    if (success) {
      return res.json(formatResponse(true, null, `IP ${ip} unblocked successfully`));
    } else {
      return res.status(404).json(formatResponse(false, null, `IP ${ip} is not currently blocked`));
    }
  } catch (error) {
    return handleErrorWithFormat(error, res, "Failed to unblock IP", 500, formatResponse);
  }
});

export default router;


