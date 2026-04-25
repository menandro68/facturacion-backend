const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_admin_squid_2026';

// Middleware para verificar super-admin
const verifySuperAdmin = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, mensaje: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.superAdmin) return res.status(403).json({ success: false, mensaje: 'Acceso denegado' });
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, mensaje: 'Token inválido' });
  }
};

// POST - Login super-admin
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, mensaje: 'Usuario y contraseña requeridos' });
    }
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, mensaje: 'Credenciales inválidas' });
    }
    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match) {
      return res.status(401).json({ success: false, mensaje: 'Credenciales inválidas' });
    }
    const token = jwt.sign({ id: admin.id, username: admin.username, superAdmin: true }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ success: true, token, admin: { id: admin.id, username: admin.username, nombre: admin.nombre } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Listar todos los tenants
router.get('/tenants', verifySuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, 
        (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as total_usuarios,
        (SELECT COUNT(*) FROM invoices WHERE tenant_id = t.id) as total_facturas
      FROM tenants t
      ORDER BY t.creado_en DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear nuevo tenant (con su usuario admin)
router.post('/tenants', verifySuperAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { nombre, rnc, email, telefono, direccion, admin_username, admin_password, admin_nombre } = req.body;
    if (!nombre || !email || !admin_username || !admin_password) {
      return res.status(400).json({ success: false, mensaje: 'Datos incompletos' });
    }
    await client.query('BEGIN');

    // Crear tenant
    const tenant = await client.query(
      `INSERT INTO tenants (nombre, rnc, email, telefono, direccion, estado)
       VALUES ($1, $2, $3, $4, $5, 'activo') RETURNING *`,
      [nombre, rnc || null, email, telefono || null, direccion || null]
    );

    // Convertir el usuario simple en formato email interno (oculto al admin)
    const usuarioLimpio = admin_username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const emailInterno = usuarioLimpio + '@empresa.local';

 // Crear usuario admin del tenant (con primer_login = true para forzar cambio de credenciales)
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

// PUT - Activar/Suspender tenant
router.put('/tenants/:id/estado', verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    if (!['activo', 'suspendido'].includes(estado)) {
      return res.status(400).json({ success: false, mensaje: 'Estado inválido' });
    }
    const result = await pool.query(
      `UPDATE tenants SET estado = $1 WHERE id = $2 RETURNING *`,
      [estado, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Editar datos del tenant
router.put('/tenants/:id', verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, rnc, email, telefono, direccion } = req.body;
    const result = await pool.query(
      `UPDATE tenants SET nombre=$1, rnc=$2, email=$3, telefono=$4, direccion=$5
       WHERE id=$6 RETURNING *`,
      [nombre, rnc || null, email, telefono || null, direccion || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE - Eliminar tenant (con todos sus datos)
router.delete('/tenants/:id', verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM tenants WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });
    }
    res.json({ success: true, mensaje: 'Empresa eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;