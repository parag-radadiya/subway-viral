const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  updatePassword,
  updateOwnDevice,
  getAssignedShopsStaffSummary,
  getUsersByShopExcludingRootAdmin,
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User management (Admin creates — no public signup)
 */

/**
 * @swagger
 * /api/users/me/password:
 *   put:
 *     summary: Change your own password
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PasswordUpdateRequest'
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       401:
 *         description: Current password incorrect
 */
router.put('/me/password', protect, updatePassword);

/**
 * @swagger
 * /api/users/me/device:
 *   put:
 *     summary: Register or update your own device ID
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device_id]
 *             properties:
 *               device_id:
 *                 type: string
 *                 example: staff-device-001
 *     responses:
 *       200:
 *         description: Device registered successfully
 */
router.put('/me/device', protect, updateOwnDevice);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List all active users
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: search
 *         description: Case-insensitive partial match on user name or email.
 *         schema:
 *           type: string
 *       - in: query
 *         name: role_id
 *         description: Filter by role. A single role id or a comma-separated list of role ids.
 *         schema:
 *           type: string
 *       - in: query
 *         name: shop_id
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
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of users
 *   post:
 *     summary: Create a new user (Admin only)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserRequest'
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Email already in use
 */
router.get('/', protect, getUsers);
router.post('/', protect, requirePermission('can_create_users'), createUser);
router.get('/assigned-shops/staff-summary', protect, getAssignedShopsStaffSummary);
/**
 * @swagger
 * /api/users/by-shop/{shopId}/staff:
 *   get:
 *     summary: List shop users excluding Root/Admin roles
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: shopId
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
 *       - in: query
 *         name: include_assigned
 *         description: When true, also return users who have this shop in assigned_shop_ids (not only users whose active shop is this shop).
 *         schema:
 *           type: boolean
 *           default: false
 *     responses:
 *       200:
 *         description: >
 *           Shop users list. Each user carries `shop_membership`: `active` when
 *           this shop is the user's active shop, `assigned` when it is only in
 *           their assigned_shop_ids (returned only with include_assigned=true).
 */
router.get('/by-shop/:shopId/staff', protect, getUsersByShopExcludingRootAdmin);

/**
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User data
 *       404:
 *         description: Not found
 *   put:
 *     summary: Update user details
 *     tags: [Users]
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
 *             $ref: '#/components/schemas/CreateUserRequest'
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     summary: Soft-delete (deactivate) a user
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deactivated
 */
router.get('/:id', protect, getUser);
router.put('/:id', protect, requirePermission('can_create_users'), updateUser);
router.delete('/:id', protect, requirePermission('can_delete_staff'), deleteUser);

module.exports = router;
