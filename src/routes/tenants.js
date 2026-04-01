const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');
const { getProfile, updateProfile, getUsers } = require('../controllers/tenantController');

// Todas las rutas requieren JWT válido
router.use(verifyToken);
router.use(tenantGuard);

// GET /tenant/profile
router.get('/profile', getProfile);

// PUT /tenant/profile
router.put('/profile', updateProfile);

// GET /tenant/users
router.get('/users', getUsers);

module.exports = router;