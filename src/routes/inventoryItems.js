const express = require('express');
const router = express.Router();
const {
  getItems, getItem, createItem, updateItem, deleteItem,
} = require('../controllers/inventoryItemController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

/**
 * @swagger
 * tags:
 *   name: Inventory Items
 *   description: Shop inventory management
 */

/**
 * @swagger
 * /api/inventory/items:
 *   get:
 *     summary: List inventory items
 *     tags: [Inventory Items]
 *     security:
 *       - BearerAuth: []
 *     description: Requires `can_manage_inventory` permission.
 *     parameters:
 *       - in: query
 *         name: shop_id
 *         description: Filter by shop ID
 *         schema:
 *           type: string
 *         example: "64abc000000000000000001"
 *       - in: query
 *         name: status
 *         description: Filter by item condition status
 *         schema:
 *           type: string
 *           enum: [Good, Damaged, In Repair]
 *         example: Good
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
 *           enum: [createdAt, updatedAt, item_name, status, purchase_date, expiry_date]
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Inventory item list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/InventoryItem'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden (missing permission)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   post:
 *     summary: Create inventory item
 *     tags: [Inventory Items]
 *     security:
 *       - BearerAuth: []
 *     description: Requires `can_manage_inventory` permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryItemInput'
 *           example:
 *             shop_id: "64abc000000000000000001"
 *             item_name: "POS Terminal"
 *             purchase_date: "2026-03-01"
 *             expiry_date: "2028-03-01"
 *             status: Good
 *     responses:
 *       201:
 *         description: Item created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/InventoryItem'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden (missing permission)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/inventory/items/{id}:
 *   get:
 *     summary: Get item by ID
 *     tags: [Inventory Items]
 *     security:
 *       - BearerAuth: []
 *     description: Requires `can_manage_inventory` permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Inventory item ID
 *         schema:
 *           type: string
 *         example: "64abc000000000000000099"
 *     responses:
 *       200:
 *         description: Item details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/InventoryItem'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden (missing permission)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Item not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   put:
 *     summary: Update item
 *     tags: [Inventory Items]
 *     security:
 *       - BearerAuth: []
 *     description: Requires `can_manage_inventory` permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Inventory item ID
 *         schema:
 *           type: string
 *         example: "64abc000000000000000099"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryItemInput'
 *           example:
 *             item_name: "POS Terminal - Front Desk"
 *             status: "In Repair"
 *     responses:
 *       200:
 *         description: Item updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/InventoryItem'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden (missing permission)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Item not found
 *   delete:
 *     summary: Delete item
 *     tags: [Inventory Items]
 *     security:
 *       - BearerAuth: []
 *     description: Requires `can_manage_inventory` permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Inventory item ID
 *         schema:
 *           type: string
 *         example: "64abc000000000000000099"
 *     responses:
 *       200:
 *         description: Item deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden (missing permission)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Item not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Cannot delete item when linked inventory queries exist
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.use(protect, requirePermission('can_manage_inventory'));
router.get('/', getItems);
router.post('/', createItem);
router.get('/:id', getItem);
router.put('/:id', updateItem);
router.delete('/:id', deleteItem);

module.exports = router;
