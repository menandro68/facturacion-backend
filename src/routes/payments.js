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
      `INSERT INTO payments (tenant_id, invoice_id, monto, metodo, referencia, notas)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenant_id, invoice_id, monto, metodo || 'efectivo', referencia || null, notas || null]
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

module.exports = router;