require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const shopRoutes = require('./routes/shops');
const rotaRoutes = require('./routes/rotas');
const attendanceRoutes = require('./routes/attendance');
const inventoryItemRoutes = require('./routes/inventoryItems');
const inventoryQueryRoutes = require('./routes/inventoryQueries');
const inventoryAuditRoutes = require('./routes/inventoryAudit');
const observabilityRoutes = require('./routes/observability');
const storeReportRoutes = require('./routes/storeReports');
const { sendSuccess } = require('./utils/response');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');
const { requestAnalytics } = require('./middleware/requestAnalyticsMiddleware');

const app = express();

const normalizeOrigin = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const configuredOrigins = [
  ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(normalizeOrigin).filter(Boolean),
  normalizeOrigin(process.env.VERCEL_URL),
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
].filter(Boolean);

const allowedOrigins = new Set(configuredOrigins);

const corsOptions = {
  origin(origin, callback) {
    // Non-browser requests (no Origin header) should still be allowed.
    if (!origin) return callback(null, true);

    if (allowedOrigins.size === 0 || allowedOrigins.has(normalizeOrigin(origin))) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id'],
  optionsSuccessStatus: 200,
};

// Security & parsing middleware
// contentSecurityPolicy disabled — Swagger UI uses inline scripts that CSP blocks
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());
app.use(requestAnalytics);

// Health check
app.get('/health', (req, res) =>
  sendSuccess(res, 'Service is healthy', {
    timestamp: new Date().toISOString(),
  })
);

// Swagger UI — http://localhost:5000/api-docs
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Staff & Inventory API Docs',
    swaggerOptions: { persistAuthorization: true },
  })
);
// Raw OpenAPI JSON — useful for Postman import
app.get('/api-docs.json', (req, res) => sendSuccess(res, 'OpenAPI spec fetched', swaggerSpec));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/rotas', rotaRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/inventory/items', inventoryItemRoutes);
app.use('/api/inventory/queries', inventoryQueryRoutes);
app.use('/api/inventory/audit-logs', inventoryAuditRoutes);
app.use('/api/observability', observabilityRoutes);
app.use('/api/store-reports', storeReportRoutes);

// 404 + global error handlers
app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = app;
