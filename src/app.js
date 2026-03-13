require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const connectDB = require('./config/db');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const shopRoutes = require('./routes/shops');
const rotaRoutes = require('./routes/rotas');
const attendanceRoutes = require('./routes/attendance');
const inventoryItemRoutes = require('./routes/inventoryItems');
const inventoryQueryRoutes = require('./routes/inventoryQueries');

// Connect to MongoDB
connectDB();

const app = express();

// Security & parsing middleware
// contentSecurityPolicy disabled — Swagger UI uses inline scripts that CSP blocks
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// Swagger UI — http://localhost:5000/api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Staff & Inventory API Docs',
  swaggerOptions: { persistAuthorization: true },
}));
// Raw OpenAPI JSON — useful for Postman import
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/rotas', rotaRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/inventory/items', inventoryItemRoutes);
app.use('/api/inventory/queries', inventoryQueryRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
