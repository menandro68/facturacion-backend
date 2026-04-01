const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Listar proveedores
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM suppliers WHERE tenant_id = $1 AND estado = 'activo' ORDER BY nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Obtener un proveedor
router.get('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM suppliers WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Proveedor no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear proveedor
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, rnc, email, telefono, direccion, contacto } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    const result = await pool.query(
      `INSERT INTO suppliers (tenant_id, nombre, rnc, email, telefono, direccion, contacto)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tenant_id, nombre, rnc, email, telefono, direccion, contacto]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Actualizar proveedor
router.put('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, rnc, email, telefono, direccion, contacto } = req.body;
    const result = await pool.query(
      `UPDATE suppliers SET nombre=$1, rnc=$2, email=$3, telefono=$4, direccion=$5, contacto=$6, actualizado_en=NOW()
       WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [nombre, rnc, email, telefono, direccion, contacto, id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Proveedor no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE - Eliminar proveedor (soft delete)
router.delete('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await pool.query(
      `UPDATE suppliers SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Proveedor eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;