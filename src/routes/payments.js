const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Listar pagos
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT p.*, i.ncf, i.total as invoice_total, c.nombre as cliente_nombre
       FROM payments p
       JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE p.tenant_id = $1
       ORDER BY p.creado_en DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Pagos de una factura
router.get('/invoice/:invoice_id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { invoice_id } = req.params;
    const result = await pool.query(
      `SELECT * FROM payments WHERE invoice_id = $1 AND tenant_id = $2 ORDER BY creado_en DESC`,
      [invoice_id, tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Registrar pago
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { invoice_id, monto, metodo, referencia, notas } = req.body;
    const vendedor_nombre = req.user?.nombre || null;

    if (!invoice_id) return res.status(400).json({ success: false, mensaje: 'invoice_id es requerido' });
    if (!monto) return res.status(400).json({ success: false, mensaje: 'El monto es requerido' });

    await client.query('BEGIN');

    // Verificar que la factura existe y está emitida
    const invoice = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [invoice_id, tenant_id]
    );
    if (!invoice.rows[0]) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });
    if (invoice.rows[0].estado === 'anulada') {
      return res.status(400).json({ success: false, mensaje: 'No se puede pagar una factura anulada' });
    }
    if (invoice.rows[0].estado === 'pagada') {
      return res.status(400).json({ success: false, mensaje: 'La factura ya está pagada' });
    }

    // Registrar pago
    const payment = await client.query(
      `INSERT INTO payments (tenant_id, invoice_id, monto, metodo, referencia, notas, vendedor_nombre, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente') RETURNING *`,
      [tenant_id, invoice_id, monto, metodo || 'efectivo', referencia || null, notas || null, vendedor_nombre]
    );

    // Verificar si el pago cubre el total
    const pagos = await client.query(
      `SELECT COALESCE(SUM(monto), 0) as total_pagado FROM payments WHERE invoice_id = $1`,
      [invoice_id]
    );
    const total_pagado = parseFloat(pagos.rows[0].total_pagado);
    const total_factura = parseFloat(invoice.rows[0].total);

    // Actualizar estado de factura si está pagada
    if (total_pagado >= total_factura) {
      await client.query(
        `UPDATE invoices SET estado='pagada', actualizado_en=NOW() WHERE id=$1`,
        [invoice_id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      data: payment.rows[0],
      estado_factura: total_pagado >= total_factura ? 'pagada' : 'emitida',
      total_pagado,
      total_factura
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// GET - Pagos pendientes por confirmar
router.get('/pendientes', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { fecha_inicio, fecha_fin, vendedor } = req.query;

    let query = `
      SELECT p.*, i.ncf, i.total as invoice_total, c.nombre as cliente_nombre
      FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE p.tenant_id = $1 AND (p.estado = 'pendiente' OR p.estado IS NULL)
    `;
    const params = [tenant_id];

    if (fecha_inicio) {
      params.push(fecha_inicio);
      query += ` AND DATE(p.creado_en) >= $${params.length}`;
    }
    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND DATE(p.creado_en) <= $${params.length}`;
    }
    if (vendedor) {
      params.push(`%${vendedor}%`);
      query += ` AND p.vendedor_nombre ILIKE $${params.length}`;
    }

    query += ` ORDER BY p.creado_en DESC`;

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Recibo de pago PDF
router.get('/:id/recibo', async (req, res) => {
  try {
    const { id } = req.params
    const { token } = req.query
    if (!token) return res.status(401).json({ mensaje: 'Token requerido' })

    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const tenant_id = decoded.tenant_id

    const result = await pool.query(
      `SELECT p.*, i.ncf, i.total as invoice_total, c.nombre as cliente_nombre, c.rnc_cedula,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.telefono as empresa_tel, t.direccion as empresa_dir
       FROM payments p
       JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN customers c ON i.customer_id = c.id
       LEFT JOIN tenants t ON p.tenant_id = t.id
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [id, tenant_id]
    )
    if (!result.rows[0]) return res.status(404).json({ mensaje: 'Pago no encontrado' })
    const p = result.rows[0]

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Recibo de Pago</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#1e293b;max-width:400px;margin:0 auto}
      .header{text-align:center;border-bottom:2px solid #1e40af;padding-bottom:16px;margin-bottom:16px}
      .empresa{font-size:18px;font-weight:bold;color:#1e40af}
      .titulo{font-size:14px;color:#64748b;margin-top:4px}
      .fila{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
      .label{color:#64748b}
      .valor{font-weight:500}
      .total{font-size:18px;font-weight:bold;color:#16a34a;text-align:center;margin-top:16px;padding:12px;background:#f0fdf4;border-radius:8px}
      .footer{text-align:center;margin-top:20px;font-size:11px;color:#94a3b8}
      @media print{button{display:none}}
    </style></head><body>
    <div class="header">
      <div class="empresa">${p.empresa_nombre || 'Sistema de Facturación'}</div>
      <div class="titulo">RECIBO DE PAGO</div>
      ${p.empresa_rnc ? `<div style="font-size:12px;color:#64748b">RNC: ${p.empresa_rnc}</div>` : ''}
      ${p.empresa_tel ? `<div style="font-size:12px;color:#64748b">Tel: ${p.empresa_tel}</div>` : ''}
    </div>
    <div class="fila"><span class="label">Fecha:</span><span class="valor">${new Date(p.creado_en).toLocaleDateString('es-DO')}</span></div>
    <div class="fila"><span class="label">NCF Factura:</span><span class="valor">${p.ncf || 'N/A'}</span></div>
    <div class="fila"><span class="label">Cliente:</span><span class="valor">${p.cliente_nombre || 'Consumidor Final'}</span></div>
    ${p.rnc_cedula ? `<div class="fila"><span class="label">RNC/Cédula:</span><span class="valor">${p.rnc_cedula}</span></div>` : ''}
    <div class="fila"><span class="label">Método:</span><span class="valor">${p.metodo?.toUpperCase()}</span></div>
    ${p.referencia ? `<div class="fila"><span class="label">Referencia:</span><span class="valor">${p.referencia}</span></div>` : ''}
    ${p.notas ? `<div class="fila"><span class="label">Notas:</span><span class="valor">${p.notas}</span></div>` : ''}
    <div class="total">Total Pagado: RD$${parseFloat(p.monto).toLocaleString('es-DO',{minimumFractionDigits:2})}</div>
    <div class="footer">Gracias por su pago</div>
    <script>window.onload=()=>window.print()</script>
    </body></html>`

    res.send(html)
  } catch (error) {
    res.status(500).json({ mensaje: error.message })
  }
})

// PUT - Confirmar pago
router.put('/:id/confirmar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE payments SET estado='confirmado', confirmado_en=NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Pago no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;