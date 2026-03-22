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
const { sendSuccess } = require('./utils/response');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');
const { requestAnalytics } = require('./middleware/requestAnalyticsMiddleware');

const app = express();

// Security & parsing middleware
// contentSecurityPolicy disabled — Swagger UI uses inline scripts that CSP blocks
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(requestAnalytics);

// Health check
app.get('/health', (req, res) => sendSuccess(res, 'Service is healthy', {
  timestamp: new Date().toISOString(),
}));

// Swagger UI — http://localhost:5000/api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Staff & Inventory API Docs',
  swaggerOptions: { persistAuthorization: true },
}));
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

// 404 + global error handlers
app.use(notFoundHandler);
app.use(globalErrorHandler);


module.exports = app;
