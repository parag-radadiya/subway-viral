const express = require('express');
const multer = require('multer');
const {
  importExcelData,
  importHistoricalWorkbookData,
  upsertAdminWeeklyData,
  getStoreReportTable,
  getStoreReportAnalyticsSummary,
  getStoreReportAnalyticsStoreRanking,
  getStoreReportAnalyticsTrends,
  getStoreReportAnalyticsSalesChart,
  getStoreReportDashboardAnalytics,
  getWeekly2026,
  upsertSingleWeekly2026,
  updateWeekly2026,
  deleteWeekly2026,
  getMonthlySale2026,
  upsertSingleMonthlySale2026,
  updateMonthlySale2026,
  deleteMonthlySale2026,
  exportExcel,
  getAnalyticsV2KpiMatrix,
  getAnalyticsV2ShopCompare,
  getAnalyticsV2PeriodCompare,
  getAnalyticsV2Trend,
  getAnalyticsV2WeeklyReport,
} = require('../controllers/storeReportController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireRoles } = require('../middleware/permMiddleware');

const router = express.Router();

// Financial records + dashboard analytics are Admin/Root only.
// This router-level guard runs before every route below, blocking Manager and
// lower even though they hold can_view_all_staff / can_manage_rotas. The
// per-route permission checks remain as defense-in-depth.
router.use(protect, requireRoles(['Root', 'Admin']));

// Configure multer for file uploads
// Store files in memory for processing
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Only accept Excel files
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

router.post('/import-excel', protect, requirePermission('can_manage_rotas'), importExcelData);
router.post(
  '/import-historical-workbook',
  protect,
  requirePermission('can_manage_rotas'),
  upload.single('file'),
  importHistoricalWorkbookData
);
router.post('/admin-weekly', protect, requirePermission('can_manage_rotas'), upsertAdminWeeklyData);
router.get('/table', protect, requirePermission('can_view_all_staff'), getStoreReportTable);
router.get(
  '/analytics/summary',
  protect,
  requirePermission('can_view_all_staff'),
  getStoreReportAnalyticsSummary
);
router.get(
  '/analytics/store-ranking',
  protect,
  requirePermission('can_view_all_staff'),
  getStoreReportAnalyticsStoreRanking
);
router.get(
  '/analytics/trends',
  protect,
  requirePermission('can_view_all_staff'),
  getStoreReportAnalyticsTrends
);
router.get(
  '/analytics/charts/sales',
  protect,
  requirePermission('can_view_all_staff'),
  getStoreReportAnalyticsSalesChart
);
router.get(
  '/analytics/dashboard',
  protect,
  requirePermission('can_view_all_staff'),
  getStoreReportDashboardAnalytics
);

// Weekly 2026B CRUD
router.get('/weekly', protect, requirePermission('can_view_all_staff'), getWeekly2026);
router.post('/weekly', protect, requirePermission('can_manage_rotas'), upsertSingleWeekly2026);
router.put('/weekly/:id', protect, requirePermission('can_manage_rotas'), updateWeekly2026);
router.delete('/weekly/:id', protect, requirePermission('can_manage_rotas'), deleteWeekly2026);

// Monthly Sale 2026 CRUD
router.get('/monthly-sale', protect, requirePermission('can_view_all_staff'), getMonthlySale2026);
router.post(
  '/monthly-sale',
  protect,
  requirePermission('can_manage_rotas'),
  upsertSingleMonthlySale2026
);
router.put(
  '/monthly-sale/:id',
  protect,
  requirePermission('can_manage_rotas'),
  updateMonthlySale2026
);
router.delete(
  '/monthly-sale/:id',
  protect,
  requirePermission('can_manage_rotas'),
  deleteMonthlySale2026
);

// Export
router.get('/export', protect, requirePermission('can_view_all_staff'), exportExcel);

// todo : here we need to check operation in data.
// ── Analytics v2 — flexible KPI matrix, shop/period compare, trends ──────────
router.get(
  '/analytics/v2/kpi-matrix',
  protect,
  requirePermission('can_view_all_staff'),
  getAnalyticsV2KpiMatrix
);
router.get(
  '/analytics/v2/shop-compare',
  protect,
  requirePermission('can_view_all_staff'),
  getAnalyticsV2ShopCompare
);
router.get(
  '/analytics/v2/period-compare',
  protect,
  requirePermission('can_view_all_staff'),
  getAnalyticsV2PeriodCompare
);
router.get(
  '/analytics/v2/trend',
  protect,
  requirePermission('can_view_all_staff'),
  getAnalyticsV2Trend
);

/**
 * @swagger
 * /api/store-reports/analytics/v2/weekly-report:
 *   get:
 *     summary: Weekly report analytics — by-week totals series (summary, trend, comparison)
 *     tags: [StoreReports]
 *     description: |
 *       Analytics over the by-week TOTALS data (one aggregate row per week across
 *       all shops — not a per-shop breakdown). Returns a period `summary`, a
 *       per-week `trend` series, and, when `compare_from`/`compare_to` are given,
 *       a current-vs-compare `comparison` with per-metric deltas.
 *     parameters:
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: compare_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: compare_to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Weekly report analytics
 */
router.get(
  '/analytics/v2/weekly-report',
  protect,
  requirePermission('can_view_all_staff'),
  getAnalyticsV2WeeklyReport
);

module.exports = router;
