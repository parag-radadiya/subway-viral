const express = require('express');
const router = express.Router();
const {
  getRotas, getRota, createRota, updateRota, deleteRota,
  bulkCreate, getWeekView, clearWeek, getDashboard,
} = require('../controllers/rotaController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

/**
 * @swagger
 * tags:
 *   name: Rotas
 *   description: Shift scheduling — single record, bulk weekly, and dashboard views
 */

// ─── Bulk & Dashboard routes (must come before /:id) ─────────────────────────

/**
 * @swagger
 * /api/rotas/bulk:
 *   post:
 *     summary: Bulk-create rotas for multiple employees across multiple days
 *     tags: [Rotas]
 *     description: |
 *       Assigns a list of employees to a shop for selected days within a given ISO week.
 *       - `days`: 0 = Monday, 1 = Tuesday … 6 = Sunday
 *       - `assignments`: list of employees + their shift times — applied to **every selected day**
 *       - Duplicate detection: same user + date + start_time is rejected (split shifts are allowed)
 *       - `replace_existing: true` wipes those users' full week before re-inserting (use for re-publishing)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BulkRotaRequest'
 *           example:
 *             shop_id: "64abc000000000000000001"
 *             week_start: "2026-03-16"
 *             days: [0, 1, 2, 3, 4]
 *             replace_existing: false
 *             assignments:
 *               - user_id: "64abc000000000000000002"
 *                 start_time: "09:00"
 *                 end_time: "17:00"
 *               - user_id: "64abc000000000000000003"
 *                 start_time: "14:00"
 *                 end_time: "22:00"
 *               - user_id: "64abc000000000000000002"
 *                 start_time: "20:00"
 *                 end_time: "23:30"
 *                 note: "Evening split shift"
 *     responses:
 *       201:
 *         description: Bulk result with created count and any conflicts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkRotaResponse'
 *       400:
 *         description: Missing required fields
 */
router.post('/bulk', protect, requirePermission('can_manage_rotas'), bulkCreate);

/**
 * @swagger
 * /api/rotas/week:
 *   get:
 *     summary: Weekly calendar view for a shop
 *     tags: [Rotas]
 *     description: Returns all shifts for the ISO week grouped by day label (Mon–Sun)
 *     parameters:
 *       - in: query
 *         name: week_start
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-03-16"
 *         description: Any date — system snaps to the Monday of that week
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *         description: Filter to a specific shop (optional — omit for all shops)
 *     responses:
 *       200:
 *         description: Calendar grid grouped by day (Mon–Sun)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WeekViewResponse'
 *       400:
 *         description: week_start is required
 *   delete:
 *     summary: Clear an entire week's rotas for a shop
 *     tags: [Rotas]
 *     description: Deletes all rota entries for the given ISO week. Use before re-publishing.
 *     parameters:
 *       - in: query
 *         name: week_start
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-03-16"
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *         description: Limit deletion to one shop (omit to clear all shops that week)
 *     responses:
 *       200:
 *         description: Count of deleted records
 */
router.get('/week', protect, getWeekView);
router.delete('/week', protect, requirePermission('can_manage_rotas'), clearWeek);

/**
 * @swagger
 * /api/rotas/dashboard:
 *   get:
 *     summary: Manager dashboard — store-wise and employee-wise weekly overview
 *     tags: [Rotas]
 *     description: |
 *       Returns a full picture of the week in two views:
 *       - `by_shop`: for each shop, a Mon–Sun grid of who is working and when
 *       - `by_employee`: for each employee, all their shifts that week across all shops
 *     parameters:
 *       - in: query
 *         name: week_start
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-03-16"
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *         description: Focus on a specific shop
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Focus on a specific employee
 *     responses:
 *       200:
 *         description: Dashboard with by_shop and by_employee sections
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponse'
 */
router.get('/dashboard', protect, requirePermission('can_view_all_staff'), getDashboard);

// ─── Standard single-record CRUD ─────────────────────────────────────────────

/**
 * @swagger
 * /api/rotas:
 *   get:
 *     summary: List rotas (filter by ?user_id= ?shop_id= ?date=)
 *     tags: [Rotas]
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         description: "Filter to exact date (YYYY-MM-DD)"
 *     responses:
 *       200:
 *         description: List of rota records
 *   post:
 *     summary: Create a single rota entry (manual override)
 *     tags: [Rotas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RotaInput'
 *     responses:
 *       201:
 *         description: Created
 *       409:
 *         description: Duplicate user/date/start_time
 *
 * /api/rotas/{id}:
 *   get:
 *     summary: Get rota by ID
 *     tags: [Rotas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rota data
 *   put:
 *     summary: Update a rota entry (e.g. change time or note)
 *     tags: [Rotas]
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
 *             $ref: '#/components/schemas/RotaInput'
 *     responses:
 *       200:
 *         description: Updated
 *       409:
 *         description: Conflict with existing entry
 *   delete:
 *     summary: Delete a single rota entry
 *     tags: [Rotas]
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
router.get('/', protect, getRotas);
router.post('/', protect, requirePermission('can_manage_rotas'), createRota);
router.get('/:id', protect, getRota);
router.put('/:id', protect, requirePermission('can_manage_rotas'), updateRota);
router.delete('/:id', protect, requirePermission('can_manage_rotas'), deleteRota);

module.exports = router;
