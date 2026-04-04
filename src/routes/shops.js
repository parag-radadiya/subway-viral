const express = require('express');
const router = express.Router();
const {
  getShops,
  getShop,
  createShop,
  updateShop,
  updateShopHours,
  getShopHoursHistory,
  deleteShop,
} = require('../controllers/shopController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

/**
 * @swagger
 * tags:
 *   name: Shops
 *   description: Shop management (with per-shop geofence radius)
 */

/**
 * @swagger
 * /api/shops:
 *   get:
 *     summary: List all shops
 *     tags: [Shops]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of shops
 *   post:
 *     summary: Create a new shop (Admin)
 *     tags: [Shops]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShopInput'
 *     responses:
 *       201:
 *         description: Shop created
 */
router.get('/', protect, getShops);
router.post('/', protect, requirePermission('can_manage_shops'), createShop);

/**
 * @swagger
 * /api/shops/{id}:
 *   get:
 *     summary: Get shop by ID
 *     tags: [Shops]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shop data
 *   put:
 *     summary: Update shop (including geofence_radius_m)
 *     tags: [Shops]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShopInput'
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     summary: Delete a shop
 *     tags: [Shops]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 */
router.get('/:id', protect, getShop);
/**
 * @swagger
 * /api/shops/{id}/hours:
 *   put:
 *     summary: Update shop opening and closing time
 *     tags: [Shops]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shop hours updated
 */
/**
 * @swagger
 * /api/shops/{id}/hours-history:
 *   get:
 *     summary: Get paginated shop-hours change history
 *     tags: [Shops]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Shop hours history
 */
router.get(
  '/:id/hours-history',
  protect,
  requirePermission('can_manage_shops'),
  getShopHoursHistory
);
router.put('/:id/hours', protect, requirePermission('can_manage_shops'), updateShopHours);
router.put('/:id', protect, requirePermission('can_manage_shops'), updateShop);
router.delete('/:id', protect, requirePermission('can_manage_shops'), deleteShop);

module.exports = router;
