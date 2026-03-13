const express = require('express');
const router = express.Router();
const {
  getRoles, getRole, createRole, updateRole, deleteRole,
} = require('../controllers/roleController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

/**
 * @swagger
 * tags:
 *   name: Roles
 *   description: Role management with flexible permissions object
 */

/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: List all roles
 *     tags: [Roles]
 *     responses:
 *       200:
 *         description: List of roles
 *   post:
 *     summary: Create a role
 *     tags: [Roles]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Role'
 *     responses:
 *       201:
 *         description: Role created
 *
 * /api/roles/{id}:
 *   get:
 *     summary: Get role by ID
 *     tags: [Roles]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role data
 *   put:
 *     summary: Update role + permissions
 *     tags: [Roles]
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
 *             $ref: '#/components/schemas/Role'
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     summary: Delete a role
 *     tags: [Roles]
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
router.use(protect, requirePermission('can_manage_roles'));
router.get('/', getRoles);
router.post('/', createRole);
router.get('/:id', getRole);
router.put('/:id', updateRole);
router.delete('/:id', deleteRole);

module.exports = router;
