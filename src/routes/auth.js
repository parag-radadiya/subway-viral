const express = require('express');
const router = express.Router();
const { login, refreshAccessToken, logout } = require('../controllers/authController');
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
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many login attempts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login', loginRateLimiter, login);

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     summary: Refresh access token using refresh token (rotates refresh token)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 */
router.post('/refresh-token', refreshAccessToken);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Revoke refresh token and logout session
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 */
router.post('/logout', logout);

module.exports = router;
