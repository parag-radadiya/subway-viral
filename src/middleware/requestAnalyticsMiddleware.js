const { recordRequestMetric, recordErrorLog } = require('../utils/observability');

const shouldSkipPath = (path) => {
  if (!path) return false;
  return path.startsWith('/api-docs');
};

const requestAnalytics = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (shouldSkipPath(req.originalUrl || req.url)) return;

    const endedAt = process.hrtime.bigint();
    const responseMs = Number(endedAt - startedAt) / 1e6;
    const statusCode = res.statusCode;

    recordRequestMetric({ req, statusCode, responseMs });

    if (statusCode >= 400 && !res.locals.errorLogged) {
      recordErrorLog({
        req,
        statusCode,
        message: `HTTP ${statusCode} response`,
      });
    }
  });

  next();
};

module.exports = { requestAnalytics };

