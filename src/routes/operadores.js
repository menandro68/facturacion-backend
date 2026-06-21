const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET /operadores - Listar todos los operadores del tenant
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT id, nombre, username, activo, modulos_permitidos, creado_en, actualizado_en
       FROM operadores
       WHERE tenant_id = $1
       ORDER BY creado_en DESC`,
      [tenant_id]
    );

    // Parsear modulos_permitidos de TEXT a array
    const operadores = result.rows.map(op => ({
      ...op,
      modulos_permitidos: typeof op.modulos_permitidos === 'string'
        ? JSON.parse(op.modulos_permitidos)
        : op.modulos_permitidos
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
      return res.status(400).json({
        success: false,
        mensaje: 'Nombre, username y contraseña son requeridos'
      });
    }

    if (!Array.isArray(modulos_permitidos)) {
      return res.status(400).json({
        success: false,
        mensaje: 'modulos_permitidos debe ser un array'
      });
    }

// Normalizar username a minusculas (el login busca en minusculas)
    const usernameNormalizado = username.toLowerCase().trim();

    // Verificar que el username no exista para este tenant
    const existe = await pool.query(
      `SELECT id FROM operadores WHERE tenant_id = $1 AND username = $2`,
      [tenant_id, usernameNormalizado]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({
        success: false,
        mensaje: 'Ya existe un operador con ese username'
      });
    }

    // Verificar que el username no este ocupado por un vendedor activo
    const existeVendedor = await pool.query(
      `SELECT id FROM vendedores WHERE tenant_id = $1 AND LOWER(usuario) = $2 AND estado = 'activo'`,
      [tenant_id, usernameNormalizado]
    );
    if (existeVendedor.rows.length > 0) {
      return res.status(400).json({
        success: false,
        mensaje: 'Ese usuario ya está ocupado por un vendedor'
      });
    }

    // Hash de contraseña
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO operadores (tenant_id, nombre, username, password, modulos_permitidos)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, username, activo, modulos_permitidos, creado_en`,
    [tenant_id, nombre, usernameNormalizado, passwordHash, JSON.stringify(modulos_permitidos)]
    );

    const operador = result.rows[0];
    operador.modulos_permitidos = typeof operador.modulos_permitidos === 'string'
      ? JSON.parse(operador.modulos_permitidos)
      : operador.modulos_permitidos;

    res.status(201).json({ success: true, data: operador });
  } catch (error) {
    console.error('Error al crear operador:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT /operadores/:id - Actualizar operador
router.put('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, username, modulos_permitidos } = req.body;

    if (!nombre || !username) {
      return res.status(400).json({
        success: false,
        mensaje: 'Nombre y username son requeridos'
      });
    }

    if (!Array.isArray(modulos_permitidos)) {
      return res.status(400).json({
        success: false,
        mensaje: 'modulos_permitidos debe ser un array'
      });
    }

  // Normalizar username a minusculas (el login busca en minusculas)
    const usernameNormalizado = username.toLowerCase().trim();

    // Verificar que no haya otro operador con el mismo username
    const conflicto = await pool.query(
      `SELECT id FROM operadores WHERE tenant_id = $1 AND username = $2 AND id != $3`,
      [tenant_id, usernameNormalizado, id]
    );
    if (conflicto.rows.length > 0) {
      return res.status(400).json({
        success: false,
        mensaje: 'Ya existe otro operador con ese username'
      });
    }

    const result = await pool.query(
      `UPDATE operadores
       SET nombre = $1, username = $2, modulos_permitidos = $3, actualizado_en = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING id, nombre, username, activo, modulos_permitidos, creado_en, actualizado_en`,
    [nombre, usernameNormalizado, JSON.stringify(modulos_permitidos), id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Operador no encontrado' });
    }

    const operador = result.rows[0];
    operador.modulos_permitidos = typeof operador.modulos_permitidos === 'string'
      ? JSON.parse(operador.modulos_permitidos)
      : operador.modulos_permitidos;

    res.json({ success: true, data: operador });
  } catch (error) {
    console.error('Error al actualizar operador:', error);
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
      return res.status(400).json({
        success: false,
        mensaje: 'La contraseña debe tener al menos 4 caracteres'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `UPDATE operadores
       SET password = $1, actualizado_en = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id`,
      [passwordHash, id, tenant_id]
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
       RETURNING id, activo`,
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

// GET /operadores/reporte/actividad - Reporte de actividad por operador
router.get('/reporte/actividad', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { operador_id, desde, hasta } = req.query;

    if (!operador_id) {
      return res.status(400).json({ success: false, mensaje: 'operador_id es requerido' });
    }

    const fechaDesde = desde || null;
    const fechaHasta = hasta || null;

    // 1. KPIs - Facturas emitidas creadas por este operador
    const facturas = await pool.query(`
      SELECT COUNT(*)::int as cantidad, COALESCE(SUM(total), 0)::numeric as monto
      FROM invoices
      WHERE tenant_id = $1
        AND operador_id = $2
        AND estado = 'emitida'
        AND ($3::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $3::date)
        AND ($4::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $4::date)
    `, [tenant_id, operador_id, fechaDesde, fechaHasta]);

    // 2. KPIs - Pedidos creados
    const pedidos = await pool.query(`
      SELECT COUNT(*)::int as cantidad, COALESCE(SUM(total), 0)::numeric as monto
      FROM invoices
      WHERE tenant_id = $1
        AND operador_id = $2
        AND estado = 'pedido'
        AND ($3::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $3::date)
        AND ($4::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $4::date)
    `, [tenant_id, operador_id, fechaDesde, fechaHasta]);

    // 3. KPIs - Cotizaciones creadas
    const cotizaciones = await pool.query(`
      SELECT COUNT(*)::int as cantidad, COALESCE(SUM(total), 0)::numeric as monto
      FROM invoices
      WHERE tenant_id = $1
        AND operador_id = $2
        AND estado = 'cotizacion'
        AND ($3::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $3::date)
        AND ($4::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $4::date)
    `, [tenant_id, operador_id, fechaDesde, fechaHasta]);

    // 4. KPIs - Notas de crédito creadas
    const notasCredito = await pool.query(`
      SELECT COUNT(*)::int as cantidad, COALESCE(SUM(total), 0)::numeric as monto
      FROM invoices
      WHERE tenant_id = $1
        AND operador_id = $2
        AND estado = 'nota_credito'
        AND ($3::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $3::date)
        AND ($4::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $4::date)
    `, [tenant_id, operador_id, fechaDesde, fechaHasta]);

    // 5. KPIs - Facturas anuladas por este operador
    const anuladas = await pool.query(`
      SELECT COUNT(*)::int as cantidad, COALESCE(SUM(total), 0)::numeric as monto
      FROM invoices
      WHERE tenant_id = $1
        AND anulado_por = $2
        AND estado = 'anulada'
        AND ($3::date IS NULL OR (anulado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $3::date)
        AND ($4::date IS NULL OR (anulado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $4::date)
    `, [tenant_id, operador_id, fechaDesde, fechaHasta]);

    // 6. KPIs - Pagos recibidos
    const pagos = await pool.query(`
      SELECT COUNT(*)::int as cantidad, COALESCE(SUM(monto), 0)::numeric as monto
      FROM payments
      WHERE tenant_id = $1
        AND operador_id = $2
        AND ($3::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $3::date)
        AND ($4::date IS NULL OR (creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $4::date)
    `, [tenant_id, operador_id, fechaDesde, fechaHasta]);

    // 7. Detalle - Lista de transacciones (facturas, pedidos, etc.)
    const detalleFacturas = await pool.query(`
      SELECT
        i.id,
        i.ncf,
        i.estado,
        i.total,
        i.creado_en,
        c.nombre as cliente_nombre,
        CASE
          WHEN i.estado = 'emitida' THEN 'Factura'
          WHEN i.estado = 'pedido' THEN 'Pedido'
          WHEN i.estado = 'cotizacion' THEN 'Cotizacion'
          WHEN i.estado = 'nota_credito' THEN 'Nota Credito'
          WHEN i.estado = 'anulada' THEN 'Anulacion'
          ELSE i.estado
        END as tipo
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE i.tenant_id = $1
        AND (i.operador_id = $2 OR i.anulado_por = $2)
        AND ($3::date IS NULL OR (i.creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $3::date)
        AND ($4::date IS NULL OR (i.creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $4::date)
      ORDER BY i.creado_en DESC
      LIMIT 200
    `, [tenant_id, operador_id, fechaDesde, fechaHasta]);

    // 8. Detalle - Lista de pagos
    const detallePagos = await pool.query(`
      SELECT
        p.id,
        p.monto,
        p.metodo,
        p.estado,
        p.creado_en,
        i.ncf,
        c.nombre as cliente_nombre
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE p.tenant_id = $1
        AND p.operador_id = $2
        AND ($3::date IS NULL OR (p.creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $3::date)
        AND ($4::date IS NULL OR (p.creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $4::date)
      ORDER BY p.creado_en DESC
      LIMIT 200
    `, [tenant_id, operador_id, fechaDesde, fechaHasta]);

    res.json({
      success: true,
      data: {
        kpis: {
          facturas: {
            cantidad: facturas.rows[0].cantidad,
            monto: parseFloat(facturas.rows[0].monto)
          },
          pedidos: {
            cantidad: pedidos.rows[0].cantidad,
            monto: parseFloat(pedidos.rows[0].monto)
          },
          cotizaciones: {
            cantidad: cotizaciones.rows[0].cantidad,
            monto: parseFloat(cotizaciones.rows[0].monto)
          },
          notas_credito: {
            cantidad: notasCredito.rows[0].cantidad,
            monto: parseFloat(notasCredito.rows[0].monto)
          },
          anuladas: {
            cantidad: anuladas.rows[0].cantidad,
            monto: parseFloat(anuladas.rows[0].monto)
          },
          pagos: {
            cantidad: pagos.rows[0].cantidad,
            monto: parseFloat(pagos.rows[0].monto)
          }
        },
        detalle_facturas: detalleFacturas.rows,
        detalle_pagos: detallePagos.rows
      }
    });
  } catch (error) {
    console.error('Error al obtener reporte de operador:', error);
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