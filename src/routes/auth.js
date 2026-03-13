const express = require('express');
const router = express.Router();
const { login } = require('../controllers/authController');
const { loginRateLimiter } = require('../middleware/loginRateLimitMiddleware');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication (login only — no public signup)
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login and receive a JWT token
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: JWT token + user info
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */
router.post('/login', loginRateLimiter, login);

module.exports = router;
