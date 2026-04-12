const express = require('express');
const {
  importExcelData,
  upsertAdminWeeklyData,
  getStoreReportTable,
  getStoreReportDashboardAnalytics,
} = require('../controllers/storeReportController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

const router = express.Router();

router.post('/import-excel', protect, requirePermission('can_manage_rotas'), importExcelData);
router.post('/admin-weekly', protect, requirePermission('can_manage_rotas'), upsertAdminWeeklyData);
router.get('/table', protect, requirePermission('can_view_all_staff'), getStoreReportTable);
router.get(
  '/analytics/dashboard',
  protect,
  requirePermission('can_view_all_staff'),
  getStoreReportDashboardAnalytics
);

module.exports = router;
