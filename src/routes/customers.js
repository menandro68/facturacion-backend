const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Listar clientes
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM customers WHERE tenant_id = $1 AND estado = 'activo' ORDER BY nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Obtener un cliente
router.get('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM customers WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear cliente
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, rnc_cedula, email, telefono, direccion, tipo, vendedor_id, zona_id, condiciones } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS vendedor_id UUID`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS zona_id UUID`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS condiciones VARCHAR(50)`);
    const result = await pool.query(
      `INSERT INTO customers (tenant_id, nombre, rnc_cedula, email, telefono, direccion, tipo, vendedor_id, zona_id, condiciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tenant_id, nombre, rnc_cedula, email, telefono, direccion, tipo || 'consumidor_final',
       vendedor_id || null, zona_id || null, condiciones || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Actualizar cliente
router.put('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, rnc_cedula, email, telefono, direccion, tipo, vendedor_id, zona_id, condiciones } = req.body;
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS vendedor_id UUID`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS zona_id UUID`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS condiciones VARCHAR(50)`);
    const result = await pool.query(
      `UPDATE customers SET nombre=$1, rnc_cedula=$2, email=$3, telefono=$4, direccion=$5, tipo=$6,
       vendedor_id=$7, zona_id=$8, condiciones=$9, actualizado_en=NOW()
       WHERE id=$10 AND tenant_id=$11 RETURNING *`,
      [nombre, rnc_cedula, email, telefono, direccion, tipo,
       vendedor_id || null, zona_id || null, condiciones || null, id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE - Eliminar cliente (soft delete) - VALIDA QUE NO TENGA DEUDAS PENDIENTES
router.delete('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    // 1. Verificar que el cliente existe
    const clienteResult = await pool.query(
      `SELECT nombre FROM customers WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (clienteResult.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
    }
    const nombreCliente = clienteResult.rows[0].nombre;

    // 2. Verificar si tiene deudas pendientes en cuentas por cobrar
    const deudaResult = await pool.query(
      `SELECT 
         COALESCE(SUM(monto_pendiente), 0) as deuda_total,
         COUNT(*) as facturas_pendientes
       FROM accounts_receivable 
       WHERE customer_id = $1 
         AND tenant_id = $2 
         AND monto_pendiente > 0
         AND estado != 'anulada'`,
      [id, tenant_id]
    );

    const deudaTotal = parseFloat(deudaResult.rows[0].deuda_total);
    const facturasPendientes = parseInt(deudaResult.rows[0].facturas_pendientes);

    // 3. Si tiene deuda, rechazar la eliminacion
    if (deudaTotal > 0) {
      return res.status(400).json({
        success: false,
        mensaje: `No se puede eliminar al cliente "${nombreCliente}". Tiene ${facturasPendientes} factura(s) con deuda pendiente por RD$${deudaTotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}. Debe liquidar las deudas antes de eliminar.`,
        deuda_total: deudaTotal,
        facturas_pendientes: facturasPendientes
      });
    }

    // 4. Si no tiene deuda, eliminar (soft delete)
    await pool.query(
      `UPDATE customers SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Cliente eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;