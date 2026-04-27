const express = require('express');
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
  getMonthlySale2026,
  upsertSingleMonthlySale2026,
  exportExcel,
} = require('../controllers/storeReportController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

const router = express.Router();

router.post('/import-excel', protect, requirePermission('can_manage_rotas'), importExcelData);
router.post(
  '/import-historical-workbook',
  protect,
  requirePermission('can_manage_rotas'),
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

// Monthly Sale 2026 CRUD
router.get('/monthly-sale', protect, requirePermission('can_view_all_staff'), getMonthlySale2026);
router.post(
  '/monthly-sale',
  protect,
  requirePermission('can_manage_rotas'),
  upsertSingleMonthlySale2026
);

// Export
router.get('/export', protect, requirePermission('can_view_all_staff'), exportExcel);

module.exports = router;
