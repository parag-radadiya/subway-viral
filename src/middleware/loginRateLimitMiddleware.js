const rateLimit = require('express-rate-limit');

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const windowMinutes = toPositiveInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 15);
const maxAttempts = toPositiveInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 5);

const loginRateLimiter = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: maxAttempts,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
  },
});

module.exports = { loginRateLimiter };

