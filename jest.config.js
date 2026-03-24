module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/setEnv.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config/**',
    '!src/server.js',
    '!**/node_modules/**',
    '!**/coverage/**',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  testTimeout: 15000,
};
