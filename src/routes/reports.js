const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Reporte de ventas por período
router.get('/ventas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desde, hasta } = req.query;

    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_facturas,
        COUNT(CASE WHEN estado = 'emitida' THEN 1 END) as emitidas,
        COUNT(CASE WHEN estado = 'pagada' THEN 1 END) as pagadas,
        COUNT(CASE WHEN estado = 'anulada' THEN 1 END) as anuladas,
        COALESCE(SUM(CASE WHEN estado != 'anulada' THEN subtotal END), 0) as total_subtotal,
        COALESCE(SUM(CASE WHEN estado != 'anulada' THEN itbis END), 0) as total_itbis,
        COALESCE(SUM(CASE WHEN estado != 'anulada' THEN total END), 0) as total_ventas
       FROM invoices
       WHERE tenant_id = $1
       AND ($2::date IS NULL OR fecha_emision >= $2::date)
       AND ($3::date IS NULL OR fecha_emision <= $3::date + INTERVAL '1 day')`,
      [tenant_id, desde || null, hasta || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Reporte de ITBIS
router.get('/itbis', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desde, hasta } = req.query;

    const result = await pool.query(
      `SELECT 
        DATE_TRUNC('month', fecha_emision) as mes,
        COUNT(*) as total_facturas,
        COALESCE(SUM(subtotal), 0) as total_subtotal,
        COALESCE(SUM(itbis), 0) as total_itbis,
        COALESCE(SUM(total), 0) as total_con_itbis
       FROM invoices
       WHERE tenant_id = $1
       AND estado != 'anulada'
       AND fecha_emision IS NOT NULL
       AND ($2::date IS NULL OR fecha_emision >= $2::date)
       AND ($3::date IS NULL OR fecha_emision <= $3::date + INTERVAL '1 day')
       GROUP BY DATE_TRUNC('month', fecha_emision)
       ORDER BY mes DESC`,
      [tenant_id, desde || null, hasta || null]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Reporte por cliente
router.get('/clientes', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const result = await pool.query(
      `SELECT 
        c.id,
        c.nombre,
        c.rnc_cedula,
        COUNT(i.id) as total_facturas,
        COALESCE(SUM(CASE WHEN i.estado != 'anulada' THEN i.total END), 0) as total_facturado,
        COALESCE(SUM(CASE WHEN i.estado = 'pagada' THEN i.total END), 0) as total_pagado,
        COALESCE(SUM(CASE WHEN i.estado = 'emitida' THEN i.total END), 0) as total_pendiente
       FROM customers c
       LEFT JOIN invoices i ON c.id = i.customer_id
       WHERE c.tenant_id = $1
       GROUP BY c.id, c.nombre, c.rnc_cedula
       ORDER BY total_facturado DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Dashboard resumen del día y mes
router.get('/dashboard', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    // Resumen del día
    const hoy = await pool.query(
      `SELECT 
        COUNT(*) as facturas_hoy,
        COALESCE(SUM(CASE WHEN estado != 'anulada' THEN total END), 0) as ventas_hoy,
        COALESCE(SUM(CASE WHEN estado = 'pagada' THEN total END), 0) as cobrado_hoy
       FROM invoices
       WHERE tenant_id = $1
       AND DATE(creado_en) = CURRENT_DATE`,
      [tenant_id]
    );

    // Resumen del mes
    const mes = await pool.query(
      `SELECT 
        COUNT(*) as facturas_mes,
        COALESCE(SUM(CASE WHEN estado != 'anulada' THEN total END), 0) as ventas_mes,
        COALESCE(SUM(CASE WHEN estado = 'pagada' THEN total END), 0) as cobrado_mes,
        COALESCE(SUM(CASE WHEN estado = 'emitida' THEN total END), 0) as pendiente_mes
       FROM invoices
       WHERE tenant_id = $1
       AND DATE_TRUNC('month', creado_en) = DATE_TRUNC('month', CURRENT_DATE)`,
      [tenant_id]
    );

    // Últimas 5 facturas
    const ultimas = await pool.query(
      `SELECT i.id, i.ncf, i.estado, i.total, i.creado_en, c.nombre as cliente_nombre
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.tenant_id = $1
       ORDER BY i.creado_en DESC
       LIMIT 5`,
      [tenant_id]
    );

    res.json({
      success: true,
      data: {
        hoy: hoy.rows[0],
        mes: mes.rows[0],
        ultimas_facturas: ultimas.rows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;