const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');
const QRCode = require('qrcode');

// Helper: generar QR con la ubicacion del cliente (link a Google Maps)
async function generarQRUbicacion(direccion) {
  try {
    if (!direccion || !direccion.trim()) return null;
    const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(direccion.trim());
    return await QRCode.toBuffer(url, { margin: 1, width: 150 });
  } catch (e) {
    return null;
  }
}

// GET /conduces - Listar conduces del tenant
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT co.*, c.nombre as cliente_nombre, ch.nombre as chofer_nombre
       FROM conduces co
       LEFT JOIN customers c ON co.customer_id = c.id
       LEFT JOIN choferes ch ON co.chofer_id = ch.id
       WHERE co.tenant_id = $1
       ORDER BY co.creado_en DESC
       LIMIT 200`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET /conduces/:id/items - Items de un conduce
router.get('/:id/items', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const conduce = await pool.query(
      `SELECT id FROM conduces WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (conduce.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' });
    }
    const items = await pool.query(
      `SELECT * FROM conduce_items WHERE conduce_id = $1`,
      [id]
    );
    res.json({ success: true, data: items.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST /conduces - Crear conduce (rebaja inventario igual que factura)
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id, operador_id } = req.user;
    const { customer_id, chofer_id, notas, items } = req.body;

    if (!customer_id) {
      return res.status(400).json({ success: false, mensaje: 'El cliente es requerido' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Debe agregar al menos un articulo' });
    }

    await client.query('BEGIN');

    // Numero secuencial por tenant
    const seq = await client.query(
      `SELECT COALESCE(MAX(numero_conduce), 0) + 1 as siguiente
       FROM conduces WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numero_conduce = seq.rows[0].siguiente;

    // Crear conduce
    const conduce = await client.query(
      `INSERT INTO conduces (tenant_id, numero_conduce, customer_id, chofer_id, notas, operador_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenant_id, numero_conduce, customer_id, chofer_id || null, notas || null, operador_id || null]
    );
    const conduce_id = conduce.rows[0].id;

    // Insertar items
    for (const item of items) {
      await client.query(
        `INSERT INTO conduce_items (conduce_id, product_id, descripcion, cantidad)
         VALUES ($1, $2, $3, $4)`,
        [conduce_id, item.product_id || null, item.descripcion, item.cantidad]
      );
    }

    // Rebajar inventario (mismo patron que facturas)
    for (const item of items) {
      if (!item.product_id) continue;
      const inv = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND tenant_id = $2',
        [item.product_id, tenant_id]
      );
      if (inv.rows.length > 0) {
        const stockAnterior = parseFloat(inv.rows[0].stock_actual);
        const stockNuevo = stockAnterior - parseFloat(item.cantidad);
        await client.query(
          'UPDATE inventory SET stock_actual = $1, actualizado_en = NOW() WHERE id = $2',
          [stockNuevo, inv.rows[0].id]
        );
        await client.query(
          `INSERT INTO inventory_movements
          (tenant_id, inventory_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
          VALUES ($1, $2, 'salida', $3, $4, $5, $6)`,
          [tenant_id, inv.rows[0].id, item.cantidad, stockAnterior, stockNuevo,
           `Conduce CON-${String(numero_conduce).padStart(8, '0')}`]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: conduce.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// PUT /conduces/:id/anular - Anular conduce (devuelve inventario)
router.put('/:id/anular', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    await client.query('BEGIN');

    const conduce = await client.query(
      `SELECT * FROM conduces WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (conduce.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' });
    }
    if (conduce.rows[0].estado === 'anulado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, mensaje: 'El conduce ya esta anulado' });
    }

    const items = await client.query(
      `SELECT * FROM conduce_items WHERE conduce_id = $1`,
      [id]
    );

    // Devolver inventario
    for (const item of items.rows) {
      if (!item.product_id) continue;
      const inv = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND tenant_id = $2',
        [item.product_id, tenant_id]
      );
      if (inv.rows.length > 0) {
        const stockAnterior = parseFloat(inv.rows[0].stock_actual);
        const stockNuevo = stockAnterior + parseFloat(item.cantidad);
        await client.query(
          'UPDATE inventory SET stock_actual = $1, actualizado_en = NOW() WHERE id = $2',
          [stockNuevo, inv.rows[0].id]
        );
        await client.query(
          `INSERT INTO inventory_movements
          (tenant_id, inventory_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
          VALUES ($1, $2, 'entrada', $3, $4, $5, $6)`,
          [tenant_id, inv.rows[0].id, item.cantidad, stockAnterior, stockNuevo,
           `Anulacion Conduce CON-${String(conduce.rows[0].numero_conduce).padStart(8, '0')}`]
        );
      }
    }

    await client.query(
      `UPDATE conduces SET estado = 'anulado' WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ success: true, mensaje: 'Conduce anulado correctamente' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// GET /conduces/:id/pdf - PDF del conduce (media carta, sin precios)
router.get('/:id/pdf', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    const conduce = await pool.query(
      `SELECT co.*, c.nombre as cliente_nombre, c.rnc_cedula, c.telefono as cliente_telefono,
              c.direccion as cliente_direccion,
              ch.nombre as chofer_nombre, ch.vehiculo as chofer_vehiculo, ch.placa as chofer_placa,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.email as empresa_email,
              t.telefono as empresa_telefono, t.direccion as empresa_direccion
       FROM conduces co
       LEFT JOIN customers c ON co.customer_id = c.id
       LEFT JOIN choferes ch ON co.chofer_id = ch.id
       JOIN tenants t ON co.tenant_id = t.id
       WHERE co.id = $1 AND co.tenant_id = $2`,
      [id, tenant_id]
    );
    if (!conduce.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' });
    }
    const data = conduce.rows[0];

    const items = await pool.query(
      `SELECT * FROM conduce_items WHERE conduce_id = $1`,
      [id]
    );

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=conduce-${data.numero_conduce}.pdf`);
    doc.pipe(res);

    const M = 30;
    const col = 612 - (M * 2);
    const azulOscuro = '#1E3A8A';
    const negro = '#111827';
    const grisFondo = '#F1F5F9';
    const grisBorde = '#CBD5E1';
    const grisClaro = '#F8FAFC';
    const grisTexto = '#64748B';
    let y = 25;

    // Encabezado empresa
    doc.fillColor(azulOscuro).fontSize(16).font('Helvetica-Bold')
       .text(data.empresa_nombre || 'Mi Empresa', M, y);
    y += 20;
    doc.fillColor(grisTexto).fontSize(8).font('Helvetica');
    if (data.empresa_rnc) { doc.text(`RNC: ${data.empresa_rnc}`, M, y); y += 11; }
    if (data.empresa_direccion) { doc.text(data.empresa_direccion, M, y); y += 11; }
    if (data.empresa_telefono) { doc.text(`Tel: ${data.empresa_telefono}`, M, y); y += 11; }

    // Titulo CONDUCE
    doc.fillColor(azulOscuro).fontSize(18).font('Helvetica-Bold')
       .text('CONDUCE', M, 25, { width: col, align: 'right' });
    doc.fillColor(negro).fontSize(10).font('Helvetica-Bold')
       .text(`No. CON-${String(data.numero_conduce).padStart(8, '0')}`, M, 48, { width: col, align: 'right' });
    doc.fillColor(grisTexto).fontSize(8).font('Helvetica')
       .text(`Fecha: ${new Date(data.creado_en).toLocaleDateString('es-DO')}`, M, 62, { width: col, align: 'right' });
 

    y = Math.max(y, 95);

    // Bloque cliente
    doc.rect(M, y, col, 64).fill(grisFondo).stroke(grisBorde);
    doc.fillColor(azulOscuro).fontSize(9).font('Helvetica-Bold').text('ENTREGAR A:', M + 10, y + 8);
    doc.fillColor(negro).fontSize(10).font('Helvetica-Bold').text(data.cliente_nombre || 'N/A', M + 10, y + 20);
    doc.fontSize(8).font('Helvetica')
       .text(`Tel: ${data.cliente_telefono || 'N/A'}`, M + 10, y + 34)
       .text(`Direccion: ${data.cliente_direccion || 'N/A'}`, M + 10, y + 46, { width: col - 220 });

    // Bloque chofer (a la derecha)
    if (data.chofer_nombre) {
      doc.fillColor(azulOscuro).fontSize(9).font('Helvetica-Bold').text('CHOFER:', M + col - 190, y + 8);
      doc.fillColor(negro).fontSize(8).font('Helvetica')
         .text(data.chofer_nombre, M + col - 190, y + 20)
         .text(`Vehiculo: ${data.chofer_vehiculo || 'N/A'}`, M + col - 190, y + 32)
         .text(`Placa: ${data.chofer_placa || 'N/A'}`, M + col - 190, y + 44);
    }
    y += 74;

    // Tabla items (SIN precios)
    doc.rect(M, y, col, 22).fill(azulOscuro);
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPCION', M + 10, y + 7, { width: col - 120 });
    doc.text('CANTIDAD', M + col - 100, y + 7, { width: 90, align: 'right' });
    y += 22;

    doc.fontSize(9).font('Helvetica');
    let rowColor = true;
    for (const item of items.rows) {
      const rowH = 20;
      if (rowColor) doc.rect(M, y, col, rowH).fill(grisClaro);
      rowColor = !rowColor;
      doc.fillColor(negro)
         .text(item.descripcion, M + 10, y + 6, { width: col - 120 })
         .text(parseFloat(item.cantidad).toFixed(0), M + col - 100, y + 6, { width: 90, align: 'right' });
      doc.moveTo(M, y + rowH).lineTo(M + col, y + rowH).strokeColor(grisBorde).lineWidth(0.5).stroke();
      y += rowH;
    }

    doc.rect(M, y, col, 1.5).fill(azulOscuro);
    y += 12;

    // QR de ubicacion del cliente
    const qrUbicacion = await generarQRUbicacion(data.cliente_direccion);
    if (qrUbicacion) {
      doc.image(qrUbicacion, M, y, { width: 70 });
      doc.fillColor(negro).fontSize(6).font('Helvetica')
         .text('Escanee para ubicacion', M, y + 72, { width: 70, align: 'center' });
    }

    // Notas
    if (data.notas) {
      doc.fillColor(azulOscuro).fontSize(9).font('Helvetica-Bold').text('NOTAS:', M + 90, y);
      doc.fillColor(negro).fontSize(8).font('Helvetica').text(data.notas, M + 90, y + 14, { width: col - 300 });
    }

    y += 95;

    // Firmas
    const firmaW = 180;
    doc.moveTo(M + 20, y + 30).lineTo(M + 20 + firmaW, y + 30).strokeColor(negro).lineWidth(0.8).stroke();
    doc.fillColor(grisTexto).fontSize(8).font('Helvetica')
       .text('Despachado por', M + 20, y + 35, { width: firmaW, align: 'center' });

    doc.moveTo(M + col - firmaW - 20, y + 30).lineTo(M + col - 20, y + 30).strokeColor(negro).lineWidth(0.8).stroke();
    doc.fillColor(grisTexto).fontSize(8).font('Helvetica')
       .text('Recibido por (firma y cedula)', M + col - firmaW - 20, y + 35, { width: firmaW, align: 'center' });

    y += 60;

    // Footer
    doc.moveTo(M, y).lineTo(M + col, y).strokeColor(grisBorde).lineWidth(0.5).stroke();
    y += 8;
    doc.fillColor(grisTexto).fontSize(8).font('Helvetica')
       .text('Este documento es un comprobante de entrega de mercancia y no tiene valor fiscal', M, y, { width: col, align: 'center' });

    doc.end();
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;