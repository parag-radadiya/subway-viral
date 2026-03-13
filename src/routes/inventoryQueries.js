const express = require('express');
const router = express.Router();
const {
  getQueries, getQuery, createQuery, closeQuery,
} = require('../controllers/inventoryQueryController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

/**
 * @swagger
 * tags:
 *   name: Inventory Queries
 *   description: Issue tickets for damaged/faulty inventory items (Auto-syncs item status)
 */

/**
 * @swagger
 * /api/inventory/queries:
 *   get:
 *     summary: List query tickets
 *     tags: [Inventory Queries]
 *     security:
 *       - BearerAuth: []
 *     description: Retrieves all inventory issue tickets. Requires `can_manage_inventory` permission.
 *     parameters:
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *         description: Filter by shop ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Open, Resolved, Closed]
 *         description: Filter by ticket status
 *       - in: query
 *         name: item_id
 *         schema:
 *           type: string
 *         description: Filter by specific inventory item
 *     responses:
 *       200:
 *         description: List of query tickets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/InventoryQuery' } }
 *   post:
 *     summary: Open a new issue ticket
 *     tags: [Inventory Queries]
 *     security:
 *       - BearerAuth: []
 *     description: |
 *       Creates a new issue ticket for a damaged item.
 *       **Auto-Sync Logic**: Opening a query automatically sets the corresponding `InventoryItem.status` to 'Damaged'.
 *       Requires `can_manage_inventory` permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateQueryRequest'
 *     responses:
 *       201:
 *         description: Ticket opened and item marked Damaged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/InventoryQuery' }
 *
 * /api/inventory/queries/{id}:
 *   get:
 *     summary: Get query ticket by ID
 *     tags: [Inventory Queries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ticket ID
 *     responses:
 *       200:
 *         description: Ticket details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/InventoryQuery' }
 *
 * /api/inventory/queries/{id}/close:
 *   put:
 *     summary: Close a query ticket
 *     tags: [Inventory Queries]
 *     security:
 *       - BearerAuth: []
 *     description: |
 *       Records resolution notes and repair costs, and closes the ticket.
 *       **Auto-Sync Logic**: Closing a query automatically reverts the corresponding `InventoryItem.status` back to 'Good'.
 *       Requires `can_manage_inventory` permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Query ticket ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CloseQueryRequest'
 *     responses:
 *       200:
 *         description: Ticket closed, item status reverted to Good
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/InventoryQuery' }
 *       400:
 *         description: Query already closed or invalid data
 */
router.use(protect, requirePermission('can_manage_inventory'));
router.get('/', getQueries);
router.post('/', createQuery);
router.get('/:id', getQuery);
router.put('/:id/close', closeQuery);

module.exports = router;
