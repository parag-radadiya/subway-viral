const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/inventoryAuditController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

/**
 * @swagger
 * tags:
 *   name: Inventory Audit
 *   description: Traceability logs for inventory and inventory query changes
 */

/**
 * @swagger
 * /api/inventory/audit-logs:
 *   get:
 *     summary: List inventory audit logs
 *     tags: [Inventory Audit]
 *     security:
 *       - BearerAuth: []
 *     description: Requires `can_manage_inventory` permission. Scope is role/shop based.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [createdAt, action]
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [ITEM_CREATED, ITEM_UPDATED, ITEM_DELETED, QUERY_OPENED, QUERY_CLOSED]
 *     responses:
 *       200:
 *         description: Paginated audit logs
 */
router.use(protect, requirePermission('can_manage_inventory'));
router.get('/', getAuditLogs);

module.exports = router;

