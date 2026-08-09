const express = require('express');
const router = express.Router();
const { register, login, cambiarCredenciales, listarEmpresasSelector, loginEmpresa, obtenerFeatures, loginCajeroPin } = require('../controllers/authController');
const verifyToken = require('../middleware/auth');
// POST /auth/register
router.post('/register', register);
// POST /auth/login
router.post('/login', login);
// GET /auth/empresas-selector - lista empresas para el selector
router.get('/empresas-selector', verifyToken, listarEmpresasSelector);
// POST /auth/login-cajero-pin - login de cajero con usuario del tenant + PIN
router.post('/login-cajero-pin', loginCajeroPin);
// POST /auth/login-empresa - login con credenciales de la empresa seleccionada
router.post('/login-empresa', loginEmpresa);
// GET /auth/features - features del tenant en tiempo real
router.get('/features', verifyToken, obtenerFeatures);
// POST /auth/cambiar-credenciales (forzar cambio en primer login)
router.post('/cambiar-credenciales', verifyToken, cambiarCredenciales);
module.exports = router;