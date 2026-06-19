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

// PUT /tenant/sub-empresa/:id - Editar datos de una sub-empresa propia
router.put('/sub-empresa/:id', async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ success: false, mensaje: 'Solo el admin puede editar empresas' });
    }
const { id } = req.params;
    const { nombre, rnc, email, telefono, direccion, admin_username, admin_password, admin_nombre } = req.body;
    if (!nombre || !email) {
      return res.status(400).json({ success: false, mensaje: 'Nombre y email son obligatorios' });
    }
    // Validar que la empresa sea hija del usuario actual
    const check = await pool.query(
      `SELECT id FROM tenants WHERE id = $1 AND parent_tenant_id = $2`,
      [id, req.user.tenant_id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Empresa no encontrada o no tiene permiso' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Actualizar datos de la empresa
      const result = await client.query(
        `UPDATE tenants SET nombre = $1, rnc = $2, email = $3, telefono = $4, direccion = $5
         WHERE id = $6 RETURNING *`,
        [nombre, rnc || null, email, telefono || null, direccion || null, id]
      );
      // Si envia credenciales, actualizar el admin de esa empresa
      if (admin_username || admin_password || admin_nombre) {
        // Buscar el admin principal de esa empresa
        const adminRes = await client.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND rol = 'admin' ORDER BY creado_en ASC LIMIT 1`,
          [id]
        );
        if (adminRes.rows.length > 0) {
          const adminId = adminRes.rows[0].id;
          // Construir update dinamico segun lo que se envie
          if (admin_username) {
            const usuarioLimpio = admin_username.toLowerCase().replace(/[^a-z0-9]/g, '');
            const emailInterno = usuarioLimpio + '@empresa.local';
            await client.query(`UPDATE users SET email = $1 WHERE id = $2`, [emailInterno, adminId]);
          }
          if (admin_password) {
            const hashed = await bcrypt.hash(admin_password, 10);
            await client.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, adminId]);
          }
          if (admin_nombre) {
            await client.query(`UPDATE users SET nombre = $1 WHERE id = $2`, [admin_nombre, adminId]);
          }
        }
      }
      await client.query('COMMIT');
      res.json({ success: true, data: result.rows[0] });
    } catch (errTx) {
      await client.query('ROLLBACK');
      throw errTx;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE /tenant/sub-empresa/:id - Eliminar una sub-empresa propia SOLO si esta vacia
router.delete('/sub-empresa/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ success: false, mensaje: 'Solo el admin puede eliminar empresas' });
    }
    const { id } = req.params;
    // Validar que la empresa sea hija del usuario actual
    const check = await pool.query(
      `SELECT id FROM tenants WHERE id = $1 AND parent_tenant_id = $2`,
      [id, req.user.tenant_id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Empresa no encontrada o no tiene permiso' });
    }
    // Verificar que este vacia (sin facturas, clientes ni productos)
    const facturas = await pool.query(`SELECT COUNT(*) as t FROM invoices WHERE tenant_id = $1`, [id]);
    const clientes = await pool.query(`SELECT COUNT(*) as t FROM customers WHERE tenant_id = $1`, [id]);
    const productos = await pool.query(`SELECT COUNT(*) as t FROM products WHERE tenant_id = $1`, [id]);
    if (parseInt(facturas.rows[0].t) > 0 || parseInt(clientes.rows[0].t) > 0 || parseInt(productos.rows[0].t) > 0) {
      return res.status(400).json({ success: false, mensaje: 'No se puede eliminar: la empresa tiene datos (facturas, clientes o productos). Solo se pueden eliminar empresas vacias.' });
    }
    await client.query('BEGIN');
    // Borrar usuarios de la empresa y luego la empresa
    await client.query(`DELETE FROM users WHERE tenant_id = $1`, [id]);
    await client.query(`DELETE FROM operadores WHERE tenant_id = $1`, [id]);
    await client.query(`DELETE FROM vendedores WHERE tenant_id = $1`, [id]);
    await client.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    await client.query('COMMIT');
    res.json({ success: true, mensaje: 'Empresa eliminada' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;