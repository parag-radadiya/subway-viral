const express = require('express');
const {
  listNotifications,
  getUnreadCount,
  getSummary,
  markRead,
  markAllRead,
  archiveNotification,
  listCategories,
  runScan,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permMiddleware');

const router = express.Router();

// All notification endpoints require login
router.use(protect);

// Read / browse — any authenticated user can see their own notifications
router.get('/', listNotifications);
router.get('/unread-count', getUnreadCount);
router.get('/summary', getSummary);
router.get('/categories', listCategories);

// Mark read / archive
router.post('/mark-all-read', markAllRead);
router.patch('/:id/read', markRead);
router.delete('/:id', archiveNotification);

// Trigger background scans (admin / cron). Requires staff-view permission;
// in production this could be tightened to a dedicated permission.
router.post('/scan', requirePermission('can_view_all_staff'), runScan);

module.exports = router;
