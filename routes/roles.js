import express from 'express';
import { executeQuery } from '../config/database.js';
import pool from '../config/database.js';
import Logger from '../utils/logger.js';
import { handleError } from '../utils/errorHandler.js';
import { requireAuth } from './auth.js';

const router = express.Router();

// Middleware to check admin role
function requireAdmin(req, res, next) {
  const role = req.user?.role?.toLowerCase();
  if (!req.user || !["admin", "super admin"].includes(role)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
}

/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: Get all roles
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Roles retrieved successfully
 *       401:
 *         description: Unauthorized
 */
// Get all roles (requires authentication)
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT id, name, description, created_at, updated_at
      FROM roles 
      ORDER BY id ASC
    `);
    if (result.success) {
      res.json({ success: true, data: result.data });
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleError(error, res, "Failed to retrieve roles", 500);
  }
});

/**
 * @swagger
 * /api/roles:
 *   post:
 *     summary: Create new role (admin only)
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Role created successfully
 *       400:
 *         description: Role name is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       409:
 *         description: Role name already exists
 */
// Create new role (requires admin)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, message: 'Role name is required' });
  }

  try {
    const result = await executeQuery(
      'INSERT INTO roles (name, description) VALUES (?, ?)',
      [name, description || '']
    );
    
    if (result.success) {
      res.json({ success: true, data: { id: result.data.insertId, name, description } });
    } else {
      if (result.error.includes('Duplicate entry')) {
        return res.status(409).json({ success: false, message: 'Role name already exists' });
      }
      throw new Error(result.error);
    }
  } catch (error) {
    return handleError(error, res, "Failed to create role", 500);
  }
});

// Update role (requires admin)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  if (id === '1') { // Assuming 1 is Super Admin
      return res.status(403).json({ success: false, message: 'Cannot modify Super Admin role' });
  }

  try {
    const result = await executeQuery(
      'UPDATE roles SET name = ?, description = ? WHERE id = ?',
      [name, description, id]
    );
    
    if (result.success) {
      res.json({ success: true, message: 'Role updated successfully' });
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleError(error, res, "Failed to update role", 500);
  }
});

// Delete role (requires admin)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (id === '1') {
      return res.status(403).json({ success: false, message: 'Cannot delete Super Admin role' });
  }

  try {
    // Check if role is assigned to any users
    const userCheck = await executeQuery('SELECT COUNT(*) as count FROM admin_users WHERE role_id = ?', [id]);
    if (userCheck.success && userCheck.data[0].count > 0) {
        return res.status(400).json({ success: false, message: 'Cannot delete role because it is assigned to users.' });
    }

    const result = await executeQuery('DELETE FROM roles WHERE id = ?', [id]);
    
    if (result.success) {
      res.json({ success: true, message: 'Role deleted successfully' });
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    return handleError(error, res, "Failed to delete role", 500);
  }
});

// Get all permissions (requires authentication)
router.get('/permissions', requireAuth, async (req, res) => {
    try {
        const result = await executeQuery(`
          SELECT id, name, slug, description, group_name, created_at
          FROM permissions 
          ORDER BY group_name, name
        `);
        if (result.success) {
            // Group permissions
            const grouped = result.data.reduce((acc, perm) => {
                if (!acc[perm.group_name]) acc[perm.group_name] = [];
                acc[perm.group_name].push(perm);
                return acc;
            }, {});
            res.json({ success: true, data: grouped });
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        return handleError(error, res, "Failed to retrieve permissions", 500);
    }
});

// Get role permissions (requires authentication)
router.get('/:id/permissions', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await executeQuery('SELECT permission_id FROM role_permissions WHERE role_id = ?', [id]);
        if (result.success) {
            const permissionIds = result.data.map(r => r.permission_id);
            res.json({ success: true, data: permissionIds });
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        return handleError(error, res, "Failed to retrieve role permissions", 500);
    }
});

// Update role permissions (requires admin)
router.post('/:id/permissions', requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { permissionIds } = req.body;

    Logger.debug(`[Roles] Updating permissions for role ${id}. Permissions:`, permissionIds);

    if (id === '1') {
        return res.status(403).json({ success: false, message: 'Cannot modify Super Admin permissions' });
    }

    // Allow empty array (clearing all permissions)
    if (!Array.isArray(permissionIds)) {
        return res.status(400).json({ success: false, message: 'permissionIds must be an array' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Clear existing permissions
        Logger.debug(`[Roles] Clearing permissions for role ${id}`);
        await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
        
        // 2. Insert new permissions
        if (permissionIds.length > 0) {
            Logger.debug(`[Roles] Inserting ${permissionIds.length} permissions for role ${id}`);
            // Sanitize/Validate IDs to be safe numbers
            const safeIds = permissionIds.map(pid => parseInt(pid)).filter(pid => !isNaN(pid));
            
            if (safeIds.length > 0) {
                // Bulk insert is more efficient than loop
                // Construct values string: (?, ?), (?, ?), ...
                const placeholders = safeIds.map(() => '(?, ?)').join(',');
                const values = [];
                safeIds.forEach(pid => {
                    values.push(parseInt(id));
                    values.push(pid);
                });

                const insertQuery = `INSERT INTO role_permissions (role_id, permission_id) VALUES ${placeholders}`;
                await connection.execute(insertQuery, values);
            }
        }

        await connection.commit();
        Logger.success(`[Roles] Transaction committed successfully for role ${id}`);
        res.json({ success: true, message: 'Permissions updated successfully' });

    } catch (error) {
        if (connection) {
            await connection.rollback();
            Logger.error(`[Roles] Transaction rolled back due to error:`, error);
        }
        return handleError(error, res, "Failed to update role permissions", 500);
    } finally {
        if (connection) connection.release();
    }
});

export default router;
