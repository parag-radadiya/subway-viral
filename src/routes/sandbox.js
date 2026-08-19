const express = require('express');
const router = express.Router();
const { cloneToSandbox } = require('../controllers/sandboxController');
const { protect } = require('../middleware/authMiddleware');
const { requireRoot } = require('../middleware/permMiddleware');

/**
 * @swagger
 * tags:
 *   name: Sandbox
 *   description: Sandbox environment tooling (Root only)
 */

/**
 * @swagger
 * /api/sandbox/clone:
 *   post:
 *     summary: Clone the production database into the sandbox database (Root only)
 *     description: >
 *       Overwrites the sandbox database with an exact snapshot of production so new
 *       features can be tested against real-shaped data. Sandbox collections are
 *       dropped and rebuilt. Target is a sibling database on the same cluster
 *       (SANDBOX_DB_NAME, default "<prod>_sandbox") or a separate cluster
 *       (SANDBOX_MONGO_URI). Requires the Root role.
 *     tags: [Sandbox]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirm]
 *             properties:
 *               confirm:
 *                 type: boolean
 *                 description: Must be true to proceed (overwrites the sandbox database).
 *                 example: true
 *               batch_size:
 *                 type: integer
 *                 description: Documents copied per bulk insert (default 1000).
 *                 example: 1000
 *     responses:
 *       200:
 *         description: Clone completed; summary of collections and document counts.
 *       400:
 *         description: Missing confirmation or invalid sandbox target.
 *       401:
 *         description: Not authenticated.
 *       403:
 *         description: Root access required.
 *       503:
 *         description: Database not connected.
 */
router.post('/clone', protect, requireRoot(), cloneToSandbox);

module.exports = router;
