const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Listar cuentas por cobrar
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT ar.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono,
              i.ncf as factura_ncf
       FROM accounts_receivable ar
       LEFT JOIN customers c ON ar.customer_id = c.id
       LEFT JOIN invoices i ON ar.invoice_id = i.id
       WHERE ar.tenant_id = $1
       ORDER BY ar.fecha_vencimiento ASC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Resumen de cuentas por cobrar
router.get('/resumen', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT
        COUNT(*) as total_cuentas,
        COALESCE(SUM(monto_total), 0) as total_monto,
        COALESCE(SUM(monto_pagado), 0) as total_pagado,
        COALESCE(SUM(monto_pendiente), 0) as total_pendiente,
        COUNT(CASE WHEN estado = 'vencida' THEN 1 END) as total_vencidas,
        COUNT(CASE WHEN estado = 'pendiente' THEN 1 END) as total_pendientes,
        COUNT(CASE WHEN estado = 'pagada' THEN 1 END) as total_pagadas
       FROM accounts_receivable
       WHERE tenant_id = $1`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear cuenta por cobrar
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { customer_id, invoice_id, descripcion, monto_total, fecha_vencimiento, notas } = req.body;
    if (!descripcion) return res.status(400).json({ success: false, mensaje: 'La descripción es requerida' });
    if (!monto_total) return res.status(400).json({ success: false, mensaje: 'El monto es requerido' });

    const result = await pool.query(
      `INSERT INTO accounts_receivable 
       (tenant_id, customer_id, invoice_id, descripcion, monto_total, monto_pendiente, fecha_vencimiento, notas)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7) RETURNING *`,
      [tenant_id, customer_id || null, invoice_id || null, descripcion, monto_total, fecha_vencimiento || null, notas || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Registrar abono
router.put('/:id/abono', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { monto } = req.body;

    if (!monto) return res.status(400).json({ success: false, mensaje: 'El monto es requerido' });

    await client.query('BEGIN');

    const cuenta = await client.query(
      `SELECT * FROM accounts_receivable WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!cuenta.rows[0]) return res.status(404).json({ success: false, mensaje: 'Cuenta no encontrada' });
    if (cuenta.rows[0].estado === 'pagada') {
      return res.status(400).json({ success: false, mensaje: 'Esta cuenta ya está pagada' });
    }

    const monto_pagado_nuevo = parseFloat(cuenta.rows[0].monto_pagado) + parseFloat(monto)
    const monto_pendiente_nuevo = parseFloat(cuenta.rows[0].monto_total) - monto_pagado_nuevo

    if (monto_pagado_nuevo > parseFloat(cuenta.rows[0].monto_total)) {
      await client.query('ROLLBACK')
      return res.status(400).json({ success: false, mensaje: 'El monto supera el total de la cuenta' })
    }

    const estado = monto_pendiente_nuevo <= 0 ? 'pagada' : 'pendiente'

    const result = await client.query(
      `UPDATE accounts_receivable 
       SET monto_pagado=$1, monto_pendiente=$2, estado=$3, actualizado_en=NOW()
       WHERE id=$4 RETURNING *`,
      [monto_pagado_nuevo, monto_pendiente_nuevo, estado, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// PUT - Marcar como vencida
router.put('/:id/vencer', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE accounts_receivable SET estado='vencida', actualizado_en=NOW()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [id, tenant_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE - Eliminar cuenta
router.delete('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await pool.query(
      `DELETE FROM accounts_receivable WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Cuenta eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;