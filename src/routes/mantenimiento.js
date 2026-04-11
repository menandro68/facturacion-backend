const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// ==========================================
// ZONAS
// ==========================================
router.get('/zonas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM zonas WHERE tenant_id = $1 AND estado = 'activo' ORDER BY nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.post('/zonas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    const result = await pool.query(
      `INSERT INTO zonas (tenant_id, nombre, descripcion) VALUES ($1, $2, $3) RETURNING *`,
      [tenant_id, nombre, descripcion || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.put('/zonas/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, descripcion } = req.body;
    const result = await pool.query(
      `UPDATE zonas SET nombre=$1, descripcion=$2, actualizado_en=NOW() WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [nombre, descripcion, id, tenant_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.delete('/zonas/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await pool.query(
      `UPDATE zonas SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Zona eliminada' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// VENDEDORES
// ==========================================
router.get('/vendedores', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT v.*, z.nombre as zona_nombre 
       FROM vendedores v
       LEFT JOIN zonas z ON v.zona_id = z.id
       WHERE v.tenant_id = $1 AND v.estado = 'activo' ORDER BY v.nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.post('/vendedores', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, cedula, email, telefono, zona_id, comision_pct, usuario, password } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });

    let password_hash = null;
    if (password) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      password_hash = await bcrypt.hash(password, salt);
    }

    const result = await pool.query(
      `INSERT INTO vendedores (tenant_id, nombre, cedula, email, telefono, zona_id, comision_pct, usuario, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tenant_id, nombre, cedula || null, email || null, telefono || null, zona_id || null, comision_pct || 0, usuario || null, password_hash]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.put('/vendedores/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, cedula, email, telefono, zona_id, comision_pct, usuario, password } = req.body;

    let password_hash_update = '';
    let params = [nombre, cedula, email, telefono, zona_id || null, comision_pct, usuario || null];

    if (password) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      password_hash_update = ', password_hash=$8';
      params.push(hash, id, tenant_id);
    } else {
      params.push(id, tenant_id);
    }

    const result = await pool.query(
      `UPDATE vendedores SET nombre=$1, cedula=$2, email=$3, telefono=$4, zona_id=$5, comision_pct=$6, usuario=$7${password_hash_update}, actualizado_en=NOW()
       WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.delete('/vendedores/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await pool.query(
      `UPDATE vendedores SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Vendedor eliminado' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// CHOFERES
// ==========================================
router.get('/choferes', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM choferes WHERE tenant_id = $1 AND estado = 'activo' ORDER BY nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.post('/choferes', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, cedula, licencia, telefono, email, vehiculo, placa } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    const result = await pool.query(
      `INSERT INTO choferes (tenant_id, nombre, cedula, licencia, telefono, email, vehiculo, placa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenant_id, nombre, cedula || null, licencia || null, telefono || null, email || null, vehiculo || null, placa || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.put('/choferes/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, cedula, licencia, telefono, email, vehiculo, placa } = req.body;
    const result = await pool.query(
      `UPDATE choferes SET nombre=$1, cedula=$2, licencia=$3, telefono=$4, email=$5, vehiculo=$6, placa=$7, actualizado_en=NOW()
       WHERE id=$8 AND tenant_id=$9 RETURNING *`,
      [nombre, cedula, licencia, telefono, email, vehiculo, placa, id, tenant_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.delete('/choferes/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await pool.query(
      `UPDATE choferes SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Chofer eliminado' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;