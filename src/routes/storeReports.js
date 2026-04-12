const express = require('express');
const {
  importExcelData,
  upsertAdminWeeklyData,
  getStoreReportTable,
  getStoreReportAnalyticsSummary,
  getStoreReportAnalyticsStoreRanking,
  getStoreReportAnalyticsTrends,
  getStoreReportAnalyticsSalesChart,
  getStoreReportDashboardAnalytics,
} = require('../controllers/storeReportController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

const router = express.Router();

router.post('/import-excel', protect, requirePermission('can_manage_rotas'), importExcelData);
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

module.exports = router;
