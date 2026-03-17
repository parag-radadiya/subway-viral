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
router.get('/', protect, requirePermission('can_view_all_staff'), getUsers);
router.post('/', protect, requirePermission('can_create_users'), createUser);

router.get('/assigned-shops/staff-summary', protect, getAssignedShopsStaffSummary);

/**
 * @swagger
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
router.get('/:id', protect, requirePermission('can_view_all_staff'), getUser);
router.put('/:id', protect, requirePermission('can_create_users'), updateUser);
router.delete('/:id', protect, requirePermission('can_create_users'), deleteUser);

module.exports = router;
