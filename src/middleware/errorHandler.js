const { sendResponse } = require('../utils/response');
const { recordErrorLog } = require('../utils/observability');
const AppError = require('../utils/AppError');

const notFoundHandler = (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
};

const globalErrorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let data = err.data || {};

  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    data = {
      errors: Object.values(err.errors || {}).map((e) => ({
        field: e.path,
        message: e.message,
      })),
    };
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate value violates unique constraint';
    data = { duplicate: err.keyValue || {} };
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token invalid or expired';
  }

  if (statusCode >= 500) {
    console.error(err);
    if (!(err instanceof AppError)) {
      message = 'Internal server error';
      data = {};
    }
  }

  recordErrorLog({
    req,
    statusCode,
    message,
    stack: err.stack,
  });

  return sendResponse(res, statusCode, message, data);
};

module.exports = {
  notFoundHandler,
  globalErrorHandler,
};
