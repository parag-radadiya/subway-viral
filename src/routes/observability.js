const express = require('express');
const router = express.Router();

const { getOverview, getErrorLogs } = require('../controllers/observabilityController');
const { protect } = require('../middleware/authMiddleware');
const { requireRoot } = require('../middleware/permMiddleware');

router.use(protect, requireRoot());
router.get('/overview', getOverview);
router.get('/errors', getErrorLogs);

module.exports = router;
