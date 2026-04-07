const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Listar facturas
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT i.*, c.nombre as cliente_nombre
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.tenant_id = $1
       ORDER BY i.creado_en DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Obtener una factura con sus items
router.get('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const invoice = await pool.query(
      `SELECT i.*, c.nombre as cliente_nombre, c.rnc_cedula
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [id, tenant_id]
    );
    if (!invoice.rows[0]) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });
    const items = await pool.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1`,
      [id]
    );
    res.json({ success: true, data: { ...invoice.rows[0], items: items.rows } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear factura borrador
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { customer_id, ncf_tipo, notas, fecha_vencimiento, items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'La factura debe tener al menos un item' });
    }

    await client.query('BEGIN');

    let subtotal = 0;
    let itbis = 0;
    for (const item of items) {
      const item_subtotal = item.cantidad * item.precio_unitario;
      const item_itbis = item_subtotal * (item.itbis_rate / 100);
      subtotal += item_subtotal;
      itbis += item_itbis;
    }
    const total = subtotal + itbis;

    // Asignar NCF automáticamente
    let seq = await client.query(
      `SELECT * FROM ncf_sequences WHERE tenant_id = $1 AND tipo = $2 AND estado = 'activo'`,
      [tenant_id, ncf_tipo || 'B01']
    );
    if (seq.rows.length === 0) {
      await client.query(
        `INSERT INTO ncf_sequences (tenant_id, tipo, prefijo, secuencia_actual, secuencia_max)
         VALUES ($1, $2, $3, 0, 9999999)`,
        [tenant_id, ncf_tipo || 'B01', ncf_tipo || 'B01']
      );
      seq = await client.query(
        `SELECT * FROM ncf_sequences WHERE tenant_id = $1 AND tipo = $2`,
        [tenant_id, ncf_tipo || 'B01']
      );
    }
    const nueva_secuencia = seq.rows[0].secuencia_actual + 1;
    await client.query(
      `UPDATE ncf_sequences SET secuencia_actual = $1 WHERE id = $2`,
      [nueva_secuencia, seq.rows[0].id]
    );
    const ncf = `${ncf_tipo || 'B01'}${String(nueva_secuencia).padStart(8, '0')}`;

    const invoice = await client.query(
      `INSERT INTO invoices (tenant_id, customer_id, ncf_tipo, ncf, estado, subtotal, itbis, total, notas, fecha_vencimiento, fecha_emision) 
       VALUES ($1, $2, $3, $4, 'emitida', $5, $6, $7, $8, $9, NOW()) RETURNING *`,
      [tenant_id, customer_id || null, ncf_tipo || 'B01', ncf, subtotal, itbis, total, notas || null, fecha_vencimiento || null]
    );
    const invoice_id = invoice.rows[0].id;

    for (const item of items) {
      const item_subtotal = item.cantidad * item.precio_unitario;
      const item_itbis = item_subtotal * (item.itbis_rate / 100);
      const item_total = item_subtotal + item_itbis;
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate, itbis_monto, subtotal, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [invoice_id, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario, item.itbis_rate || 18, item_itbis, item_subtotal, item_total]
      );
    }

    // Actualizar inventario automáticamente al emitir factura
    for (const item of items) {
      if (!item.product_id) continue
      const inv = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND tenant_id = $2',
        [item.product_id, tenant_id]
      )
      if (inv.rows.length > 0) {
        const stockAnterior = parseFloat(inv.rows[0].stock_actual)
        const stockNuevo = stockAnterior - parseFloat(item.cantidad)
        await client.query(
          'UPDATE inventory SET stock_actual = $1, actualizado_en = NOW() WHERE id = $2',
          [stockNuevo, inv.rows[0].id]
        )
        await client.query(
          `INSERT INTO inventory_movements 
          (tenant_id, inventory_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
          VALUES ($1, $2, 'salida', $3, $4, $5, $6)`,
          [tenant_id, inv.rows[0].id, item.cantidad, stockAnterior, stockNuevo,
           `Factura ${ncf}`]
        )
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: invoice.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// PUT - Emitir factura (asigna NCF)
router.put('/:id/emitir', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    await client.query('BEGIN');

    const invoice = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!invoice.rows[0]) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });
    if (invoice.rows[0].estado !== 'borrador') {
      return res.status(400).json({ success: false, mensaje: 'Solo se pueden emitir facturas en borrador' });
    }

    const ncf_tipo = invoice.rows[0].ncf_tipo;

    let seq = await client.query(
      `SELECT * FROM ncf_sequences WHERE tenant_id = $1 AND tipo = $2 AND estado = 'activo'`,
      [tenant_id, ncf_tipo]
    );
    if (seq.rows.length === 0) {
      await client.query(
        `INSERT INTO ncf_sequences (tenant_id, tipo, prefijo, secuencia_actual, secuencia_max)
         VALUES ($1, $2, $3, 0, 1000)`,
        [tenant_id, ncf_tipo, ncf_tipo]
      );
      seq = await client.query(
        `SELECT * FROM ncf_sequences WHERE tenant_id = $1 AND tipo = $2`,
        [tenant_id, ncf_tipo]
      );
    }

    const nueva_secuencia = seq.rows[0].secuencia_actual + 1;
    await client.query(
      `UPDATE ncf_sequences SET secuencia_actual = $1 WHERE id = $2`,
      [nueva_secuencia, seq.rows[0].id]
    );

    const ncf = `${ncf_tipo}${String(nueva_secuencia).padStart(8, '0')}`;

    const updated = await client.query(
      `UPDATE invoices SET estado='emitida', ncf=$1, fecha_emision=NOW(), actualizado_en=NOW()
       WHERE id=$2 RETURNING *`,
      [ncf, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// PUT - Anular factura
router.put('/:id/anular', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const invoice = await pool.query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!invoice.rows[0]) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });
    if (invoice.rows[0].estado === 'anulada') {
      return res.status(400).json({ success: false, mensaje: 'La factura ya está anulada' });
    }
    const updated = await pool.query(
      `UPDATE invoices SET estado='anulada', actualizado_en=NOW() WHERE id=$1 RETURNING *`,
      [id]
    );
    res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Generar PDF de factura
router.get('/:id/pdf', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    const invoice = await pool.query(
      `SELECT i.*, c.nombre as cliente_nombre, c.rnc_cedula, c.email as cliente_email,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.email as empresa_email
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       JOIN tenants t ON i.tenant_id = t.id
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [id, tenant_id]
    );
    if (!invoice.rows[0]) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });

    const items = await pool.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1`,
      [id]
    );

    const data = invoice.rows[0];
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=factura-${data.ncf || data.id}.pdf`);
    doc.pipe(res);

    // Encabezado
    doc.fontSize(20).font('Helvetica-Bold').text(data.empresa_nombre || 'Mi Empresa', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(`RNC: ${data.empresa_rnc || 'N/A'}`, { align: 'center' });
    doc.moveDown();

    // Info factura
    doc.fontSize(14).font('Helvetica-Bold').text(`FACTURA`, { align: 'center' });
    doc.fontSize(10).font('Helvetica');
    doc.text(`NCF: ${data.ncf || 'BORRADOR'}`, { align: 'center' });
    doc.text(`Estado: ${data.estado.toUpperCase()}`, { align: 'center' });
    doc.text(`Fecha: ${data.fecha_emision ? new Date(data.fecha_emision).toLocaleDateString() : new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown();

    // Cliente
    doc.fontSize(11).font('Helvetica-Bold').text('CLIENTE:');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Nombre: ${data.cliente_nombre || 'Consumidor Final'}`);
    doc.text(`RNC/Cédula: ${data.rnc_cedula || 'N/A'}`);
    doc.moveDown();

    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    // Encabezado tabla items
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Descripción', 50, doc.y, { width: 200 });
    doc.text('Cant.', 260, doc.y - 12, { width: 60 });
    doc.text('Precio', 320, doc.y - 12, { width: 80 });
    doc.text('ITBIS', 400, doc.y - 12, { width: 60 });
    doc.text('Total', 470, doc.y - 12, { width: 80 });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    // Items
    doc.font('Helvetica').fontSize(10);
    for (const item of items.rows) {
      const y = doc.y;
      doc.text(item.descripcion, 50, y, { width: 200 });
      doc.text(item.cantidad, 260, y, { width: 60 });
      doc.text(`RD$${parseFloat(item.precio_unitario).toFixed(2)}`, 320, y, { width: 80 });
      doc.text(`RD$${parseFloat(item.itbis_monto).toFixed(2)}`, 400, y, { width: 60 });
      doc.text(`RD$${parseFloat(item.total).toFixed(2)}`, 470, y, { width: 80 });
      doc.moveDown();
    }

    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    // Totales
    doc.fontSize(10).font('Helvetica');
    doc.text(`Subtotal: RD$${parseFloat(data.subtotal).toFixed(2)}`, { align: 'right' });
    doc.text(`ITBIS (18%): RD$${parseFloat(data.itbis).toFixed(2)}`, { align: 'right' });
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text(`TOTAL: RD$${parseFloat(data.total).toFixed(2)}`, { align: 'right' });

    doc.end();
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;