const express = require('express');
const router = express.Router();
const {
  verifyLocation,
  punchIn,
  punchOut,
  manualPunchIn,
  getAttendance,
  getAttendanceByDateRange,
  getAttendanceSummaryByUser,
  getEligibleRotas,
  reconcileAllOverdue,
  reconcileSelfOverdue,
  previewClosedAttendanceAdjustment,
  applyClosedAttendanceAdjustment,
  bulkAdjustClosedAttendanceByShop,
  getUnchangedUsersForRange,
  getWeeklyPayrollReport,
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
 *          If no device is registered yet, call `PUT /api/users/me/device` after login first.
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
 * /api/attendance/eligible-rotas:
 *   get:
 *     summary: Fetch rotas eligible for immediate punch-in (current user)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: shop_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Shop where user wants to punch in
 *     responses:
 *       200:
 *         description: Eligible rota list
 */
router.get('/eligible-rotas', protect, getEligibleRotas);

/**
 * @swagger
 * /api/attendance/reconcile-overdue:
 *   post:
 *     summary: Admin/manager trigger to reconcile overdue auto punch-outs for all users
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Reconciliation completed
 */
router.post(
  '/reconcile-overdue',
  protect,
  requirePermission('can_view_all_staff'),
  reconcileAllOverdue
);

/**
 * @swagger
 * /api/attendance/reconcile-self:
 *   post:
 *     summary: Reconcile overdue auto punch-outs for current user only
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Self reconciliation completed
 */
router.post('/reconcile-self', protect, reconcileSelfOverdue);

/**
 * @swagger
 * /api/attendance/adjust-hours/preview:
 *   post:
 *     summary: Preview effective-hours adjustment for one user in a date range
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Preview generated
 */

router.post(
  '/adjust-hours/preview',
  protect,
  requirePermission('can_adjust_attendance_hours'),
  previewClosedAttendanceAdjustment
);

/**
 * @swagger
 * /api/attendance/adjust-hours/apply:
 *   post:
 *     summary: Apply effective-hours adjustment for one user in a date range
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Adjustment applied
 */

router.post(
  '/adjust-hours/apply',
  protect,
  requirePermission('can_adjust_attendance_hours'),
  applyClosedAttendanceAdjustment
);

/**
 * @swagger
 * /api/attendance/adjust-hours/bulk-by-shop:
 *   post:
 *     summary: Bulk-apply effective-hours adjustments for selected users in one shop/date range
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Bulk adjustment applied
 */

router.post(
  '/adjust-hours/bulk-by-shop',
  protect,
  requirePermission('can_adjust_attendance_hours'),
  bulkAdjustClosedAttendanceByShop
);

/**
 * @swagger
 * /api/attendance/adjust-hours/unchanged-users:
 *   get:
 *     summary: List users in the selected shop/date range not yet included in adjustment selection
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: shop_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from_date
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: to_date
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
 *         description: Unchanged users list
 */

router.get(
  '/adjust-hours/unchanged-users',
  protect,
  requirePermission('can_adjust_attendance_hours'),
  getUnchangedUsersForRange
);

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
 * /api/attendance/summary-by-user:
 *   get:
 *     summary: Group attendance by user with total work hours
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: from_date
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to_date
 *         schema:
 *           type: string
 *           format: date-time
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
 *           enum: [total_work_hours, name]
 *       - in: query
 *         name: sort_dir
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Grouped attendance summary by user
 */
router.get('/summary-by-user', protect, getAttendanceSummaryByUser);

/**
 * @swagger
 * /api/attendance/range:
 *   get:
 *     summary: List attendance by required date range with pagination and total hours summary
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     description: |
 *       Returns attendance records in the selected date range with pagination.
 *       Also returns range-level `total_work_hours` and `total_actual_hours`.
 *       `from_date` and `to_date` are required.
 *     parameters:
 *       - in: query
 *         name: from_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (inclusive)
 *       - in: query
 *         name: to_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (inclusive)
 *       - in: query
 *         name: shop_id
 *         schema:
 *           type: string
 *         description: Optional shop filter (subject to role/shop scope)
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Optional user filter (ignored for self-scope users)
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
 *           enum: [punch_in, punch_out, createdAt, updatedAt]
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Attendance range records fetched successfully
 *       400:
 *         description: Missing/invalid date range
 */

router.get('/range', protect, getAttendanceByDateRange);

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
 *       - in: query
 *         name: from_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to_date
 *         schema:
 *           type: string
 *           format: date
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
 *         description: List of attendance records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Attendance' } }
 */
router.get('/', protect, getAttendance);

/**
 * @swagger
 * /api/attendance/weekly-payroll-report:
 *   get:
 *     summary: Get structured Weekly Payroll Report exactly matching the printer PDF
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: shop_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Structured payroll report matching the PDF layout
 */
router.get(
  '/weekly-payroll-report',
  protect,
  requirePermission('can_view_all_staff'),
  getWeeklyPayrollReport
);

module.exports = router;
