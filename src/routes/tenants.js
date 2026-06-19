const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
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

// POST /tenant/sub-empresa - Crear una empresa hija bajo la empresa actual
router.post('/sub-empresa', async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ success: false, mensaje: 'Solo el admin puede crear empresas' });
    }
    const { nombre, rnc, email, telefono, direccion, admin_username, admin_password, admin_nombre } = req.body;
    if (!nombre || !email || !admin_username || !admin_password) {
      return res.status(400).json({ success: false, mensaje: 'Datos incompletos' });
    }
    await client.query('BEGIN');
    // Crear tenant hijo (parent = empresa del usuario actual)
    const tenant = await client.query(
      `INSERT INTO tenants (nombre, rnc, email, telefono, direccion, estado, parent_tenant_id, creado_por_usuario_id)
       VALUES ($1, $2, $3, $4, $5, 'activo', $6, $7) RETURNING *`,
      [nombre, rnc || null, email, telefono || null, direccion || null, req.user.tenant_id, req.user.id]
    );
    // Usuario admin de la sub-empresa (email interno oculto)
    const usuarioLimpio = admin_username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const emailInterno = usuarioLimpio + '@empresa.local';
    const hashed = await bcrypt.hash(admin_password, 10);
    await client.query(
      `INSERT INTO users (tenant_id, nombre, email, password, rol, verificado, primer_login)
       VALUES ($1, $2, $3, $4, 'admin', true, true)`,
      [tenant.rows[0].id, admin_nombre || nombre, emailInterno, hashed]
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: tenant.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// GET /tenant/mis-empresas - Lista las empresas creadas bajo la empresa actual
router.get('/mis-empresas', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.nombre, t.rnc, t.email, t.telefono, t.estado, t.creado_en,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as total_usuarios,
              (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id = t.id AND i.estado IN ('emitida','pagada')) as total_facturas
       FROM tenants t
       WHERE t.parent_tenant_id = $1
       ORDER BY t.creado_en DESC`,
      [req.user.tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;