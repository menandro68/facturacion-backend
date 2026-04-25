const express = require('express');
const router = express.Router();
const { register, login, cambiarCredenciales } = require('../controllers/authController');
const verifyToken = require('../middleware/auth');

// POST /auth/register
router.post('/register', register);

// POST /auth/login
router.post('/login', login);

// POST /auth/cambiar-credenciales (forzar cambio en primer login)
router.post('/cambiar-credenciales', verifyToken, cambiarCredenciales);

module.exports = router;