module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/setEnv.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  clearMocks: true,
};

