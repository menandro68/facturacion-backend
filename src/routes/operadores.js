const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

const router = express.Router();

// GET /operadores - Listar todos los operadores del tenant
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT id, nombre, username, activo, modulos_permitidos, creado_en, actualizado_en
       FROM operadores
       WHERE tenant_id = $1
       ORDER BY nombre ASC`,
      [tenant_id]
    );
    // Parsear modulos_permitidos de TEXT a array
    const operadores = result.rows.map(op => ({
      ...op,
      modulos_permitidos: JSON.parse(op.modulos_permitidos || '[]')
    }));
    res.json({ success: true, data: operadores });
  } catch (error) {
    console.error('Error al listar operadores:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST /operadores - Crear nuevo operador
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, username, password, modulos_permitidos } = req.body;

    if (!nombre || !username || !password) {
      return res.status(400).json({ success: false, mensaje: 'Nombre, usuario y contraseña son requeridos' });
    }
    if (password.length < 4) {
      return res.status(400).json({ success: false, mensaje: 'La contraseña debe tener al menos 4 caracteres' });
    }
    if (username.length < 3) {
      return res.status(400).json({ success: false, mensaje: 'El usuario debe tener al menos 3 caracteres' });
    }

    // Verificar que el username no exista en este tenant
    const existe = await pool.query(
      `SELECT id FROM operadores WHERE tenant_id = $1 AND username = $2`,
      [tenant_id, username.toLowerCase().trim()]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ success: false, mensaje: 'Ya existe un operador con ese usuario' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const modulosJSON = JSON.stringify(modulos_permitidos || []);

    const result = await pool.query(
      `INSERT INTO operadores (tenant_id, nombre, username, password, modulos_permitidos)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, username, activo, modulos_permitidos, creado_en`,
      [tenant_id, nombre.trim(), username.toLowerCase().trim(), hashedPassword, modulosJSON]
    );

    const operador = result.rows[0];
    operador.modulos_permitidos = JSON.parse(operador.modulos_permitidos || '[]');

    res.status(201).json({ success: true, data: operador });
  } catch (error) {
    console.error('Error al crear operador:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT /operadores/:id - Editar operador (nombre, username, modulos)
router.put('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, username, modulos_permitidos } = req.body;

    if (!nombre || !username) {
      return res.status(400).json({ success: false, mensaje: 'Nombre y usuario son requeridos' });
    }
    if (username.length < 3) {
      return res.status(400).json({ success: false, mensaje: 'El usuario debe tener al menos 3 caracteres' });
    }

    // Verificar que el username no exista en OTRO operador del tenant
    const existe = await pool.query(
      `SELECT id FROM operadores WHERE tenant_id = $1 AND username = $2 AND id != $3`,
      [tenant_id, username.toLowerCase().trim(), id]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ success: false, mensaje: 'Ya existe otro operador con ese usuario' });
    }

    const modulosJSON = JSON.stringify(modulos_permitidos || []);

    const result = await pool.query(
      `UPDATE operadores
       SET nombre = $1, username = $2, modulos_permitidos = $3, actualizado_en = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING id, nombre, username, activo, modulos_permitidos, creado_en, actualizado_en`,
      [nombre.trim(), username.toLowerCase().trim(), modulosJSON, id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Operador no encontrado' });
    }

    const operador = result.rows[0];
    operador.modulos_permitidos = JSON.parse(operador.modulos_permitidos || '[]');

    res.json({ success: true, data: operador });
  } catch (error) {
    console.error('Error al editar operador:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT /operadores/:id/password - Cambiar contraseña
router.put('/:id/password', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 4) {
      return res.status(400).json({ success: false, mensaje: 'La contraseña debe tener al menos 4 caracteres' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `UPDATE operadores
       SET password = $1, actualizado_en = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id`,
      [hashedPassword, id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Operador no encontrado' });
    }

    res.json({ success: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT /operadores/:id/toggle-activo - Activar/Desactivar operador
router.put('/:id/toggle-activo', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE operadores
       SET activo = NOT activo, actualizado_en = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, nombre, username, activo`,
      [id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Operador no encontrado' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE /operadores/:id - Eliminar operador
router.delete('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM operadores WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Operador no encontrado' });
    }

    res.json({ success: true, mensaje: 'Operador eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar operador:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;