process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
process.env.LOCATION_TOKEN_SECRET = process.env.LOCATION_TOKEN_SECRET || 'test-location-secret';
process.env.LOCATION_TOKEN_TTL_MINUTES = process.env.LOCATION_TOKEN_TTL_MINUTES || '5';
process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES = process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || '15';
process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || '1000';
