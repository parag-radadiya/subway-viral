const RequestMetric = require('../models/RequestMetric');
const ErrorLog = require('../models/ErrorLog');

const toDayStart = (date = new Date()) => {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
};

const normalizePath = (req) => {
  if (req?.route?.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }
  const original = req?.originalUrl || req?.url || '/';
  const path = original.split('?')[0];
  return path || '/';
};

const safeRun = (job) => {
  Promise.resolve(job()).catch((error) => {
    if (process.env.NODE_ENV === 'test' && /client was closed/i.test(error.message || '')) {
      return;
    }
    console.error('Observability write failed:', error.message);
  });
};

const recordRequestMetric = ({ req, statusCode, responseMs }) =>
  safeRun(async () => {
    const day = toDayStart();
    const route = normalizePath(req);
    const method = (req?.method || 'GET').toUpperCase();
    const duration = Math.max(0, Number(responseMs || 0));

    await RequestMetric.updateOne(
      { day, route, method, status_code: statusCode },
      {
        $inc: { count: 1, total_response_ms: duration },
        $max: { max_response_ms: duration },
        $min: { min_response_ms: duration },
        $setOnInsert: { day, route, method, status_code: statusCode },
      },
      { upsert: true }
    );
  });

const recordErrorLog = ({ req, statusCode, message, stack, meta = {} }) =>
  safeRun(async () => {
    const forwardedFor = req?.headers?.['x-forwarded-for'];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : (forwardedFor || req?.ip || req?.socket?.remoteAddress || null);

    await ErrorLog.create({
      status_code: statusCode,
      message: message || 'Unknown error',
      path: normalizePath(req),
      method: (req?.method || 'GET').toUpperCase(),
      user_id: req?.user?._id || null,
      ip,
      user_agent: req?.headers?.['user-agent'] || null,
      stack: stack || null,
      meta,
    });
  });

module.exports = {
  recordRequestMetric,
  recordErrorLog,
};



