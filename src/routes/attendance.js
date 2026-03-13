const express = require('express');
const router = express.Router();
const {
  verifyLocation, punchIn, punchOut, manualPunchIn, getAttendance,
} = require('../controllers/attendanceController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');
const { validateGeofence } = require('../middleware/geoMiddleware');

/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: Punch-in/out flows (GPS + Biometric or Manual)
 */

/**
 * @swagger
 * /api/attendance/verify-location:
 *   post:
 *     summary: "Step 1 — GPS geofence check → returns location_token (5 min TTL)"
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     description: |
 *       Verifies the user's GPS coordinates against the shop's geofence radius.
 *       If valid, returns a short-lived `location_token` required for the actual punch-in.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyLocationRequest'
 *     responses:
 *       200:
 *         description: Location verified — returns location_token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 location_token:
 *                   type: string
 *       403:
 *         description: Outside geofence radius
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/verify-location', protect, validateGeofence, verifyLocation);

/**
 * @swagger
 * /api/attendance/punch-in:
 *   post:
 *     summary: "Step 2+3 — Biometric + location_token + device_id → creates Attendance"
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     description: |
 *       Finalizes the punch-in process.
 *       Requires:
 *       1. `x-device-id` header matching the user's registered device.
 *       2. `location_token` from previous step.
 *       3. `biometric_verified: true` flag from frontend.
 *     parameters:
 *       - in: header
 *         name: x-device-id
 *         required: true
 *         schema:
 *           type: string
 *         description: Registered device ID of the employee
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PunchInRequest'
 *     responses:
 *       201:
 *         description: Punched in successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Attendance' }
 *       403:
 *         description: Biometric failed / token invalid / device mismatch
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/punch-in', protect, punchIn);

/**
 * @swagger
 * /api/attendance/manual-punch-in:
 *   post:
 *     summary: Sub-Manager manual punch-in (exception flow — no GPS/biometric)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     description: |
 *       Allows a Sub-Manager (or higher) with `can_manual_punch` permission to manually clock in another user.
 *       This bypasses GPS and biometric checks but records `manual_by` for accountability.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ManualPunchInRequest'
 *     responses:
 *       201:
 *         description: Manual punch-in recorded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Attendance' }
 *       403:
 *         description: Missing can_manual_punch permission
 */
router.post('/manual-punch-in', protect, requirePermission('can_manual_punch'), manualPunchIn);

/**
 * @swagger
 * /api/attendance/{id}/punch-out:
 *   put:
 *     summary: Record punch-out time
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Attendance record ID
 *     responses:
 *       200:
 *         description: Punch-out recorded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Attendance record not found
 */
router.put('/:id/punch-out', protect, punchOut);

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     summary: List all attendance records (Admin/Manager)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     description: Retrieves attendance history with optional filters. Requires `can_view_all_staff` permission.
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Filter by staff user ID
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *         description: Filter by shop ID
 *     responses:
 *       200:
 *         description: List of attendance records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Attendance' } }
 */
router.get('/', protect, requirePermission('can_view_all_staff'), getAttendance);

module.exports = router;
