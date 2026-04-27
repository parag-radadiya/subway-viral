class AppError extends Error {
  constructor(message, statusCode = 500, data = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.data = data && typeof data === 'object' ? data : {};
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
