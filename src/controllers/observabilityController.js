const RequestMetric = require('../models/RequestMetric');
const ErrorLog = require('../models/ErrorLog');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');

const getDays = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 7;
  return Math.max(1, Math.min(parsed, 90));
};

const sinceDate = (days) => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() - (days - 1));
  return now;
};

const getOverview = asyncHandler(async (req, res) => {
  const days = getDays(req.query.days);
  const since = sinceDate(days);

  const [totals, statusBreakdown, topErrorRoutes, daily, recentErrors] = await Promise.all([
    RequestMetric.aggregate([
      { $match: { day: { $gte: since } } },
      {
        $group: {
          _id: null,
          requests: { $sum: '$count' },
          errors: {
            $sum: {
              $cond: [{ $gte: ['$status_code', 400] }, '$count', 0],
            },
          },
          total_latency_ms: { $sum: '$total_response_ms' },
        },
      },
    ]),
    RequestMetric.aggregate([
      { $match: { day: { $gte: since } } },
      { $group: { _id: '$status_code', count: { $sum: '$count' } } },
      { $sort: { _id: 1 } },
    ]),
    RequestMetric.aggregate([
      { $match: { day: { $gte: since }, status_code: { $gte: 400 } } },
      {
        $group: {
          _id: { route: '$route', method: '$method' },
          count: { $sum: '$count' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    RequestMetric.aggregate([
      { $match: { day: { $gte: since } } },
      {
        $group: {
          _id: '$day',
          requests: { $sum: '$count' },
          errors: {
            $sum: {
              $cond: [{ $gte: ['$status_code', 400] }, '$count', 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    ErrorLog.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('status_code message path method createdAt'),
  ]);

  const totalRequests = totals[0]?.requests || 0;
  const totalErrors = totals[0]?.errors || 0;
  const avgResponseMs =
    totalRequests > 0 ? Number((totals[0].total_latency_ms / totalRequests).toFixed(2)) : 0;

  return sendSuccess(res, 'Observability overview fetched successfully', {
    range_days: days,
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      error_rate_pct:
        totalRequests > 0 ? Number(((totalErrors / totalRequests) * 100).toFixed(2)) : 0,
      avg_response_ms: avgResponseMs,
    },
    status_breakdown: statusBreakdown.map((row) => ({
      status_code: row._id,
      count: row.count,
    })),
    top_error_routes: topErrorRoutes.map((row) => ({
      route: row._id.route,
      method: row._id.method,
      count: row.count,
    })),
    daily: daily.map((row) => ({
      day: row._id,
      requests: row.requests,
      errors: row.errors,
    })),
    recent_errors: recentErrors,
  });
});

const getErrorLogs = asyncHandler(async (req, res) => {
  const days = getDays(req.query.days);
  const { page, limit, skip, sort } = parsePagination(req.query, {
    defaultLimit: 50,
    maxLimit: 200,
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt', 'status_code', 'path', 'method'],
  });
  const since = sinceDate(days);

  const filter = { createdAt: { $gte: since } };
  if (req.query.status_code) {
    filter.status_code = Number.parseInt(req.query.status_code, 10);
  }
  if (req.query.path) {
    filter.path = { $regex: req.query.path, $options: 'i' };
  }

  const [total, logs] = await Promise.all([
    ErrorLog.countDocuments(filter),
    ErrorLog.find(filter).sort(sort).skip(skip).limit(limit).populate('user_id', 'name email'),
  ]);

  return sendSuccess(res, 'Error logs fetched successfully', {
    ...toPageMeta(total, page, limit, logs.length),
    logs,
  });
});

module.exports = {
  getOverview,
  getErrorLogs,
};
