const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');
const QRCode = require('qrcode');

// ==========================================
// Crear tablas si no existen
// ==========================================
(async () => {
  try {
    // Crear tablas si no existen (instalacion limpia)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conduces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        numero VARCHAR(20),
        customer_id UUID,
        cliente_nombre VARCHAR(255),
        chofer_id UUID,
        chofer_nombre VARCHAR(255),
        notas TEXT,
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        anulado_en TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conduces_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conduce_id UUID NOT NULL,
        product_id UUID,
        descripcion VARCHAR(255),
        cantidad NUMERIC(12,2) DEFAULT 1
      )
    `);

    // Auto-reparacion: asegurar columnas en tabla conduces existente (idempotente)
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS numero VARCHAR(20)`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS customer_id UUID`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS cliente_nombre VARCHAR(255)`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS chofer_id UUID`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS chofer_nombre VARCHAR(255)`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS notas TEXT`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'activo'`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMP`);

    // Auto-reparacion: asegurar columnas en tabla conduces_items existente
    await pool.query(`ALTER TABLE conduces_items ADD COLUMN IF NOT EXISTS product_id UUID`);
    await pool.query(`ALTER TABLE conduces_items ADD COLUMN IF NOT EXISTS descripcion VARCHAR(255)`);
    await pool.query(`ALTER TABLE conduces_items ADD COLUMN IF NOT EXISTS cantidad NUMERIC(12,2) DEFAULT 1`);

    console.log('✅ Tablas conduces verificadas/reparadas');
  } catch (e) {
    console.error('Error creando/reparando tablas conduces:', e.message);
  }
})();
// ==========================================
// GET - Listar conduces
// ==========================================
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT c.*,
              COALESCE(c.cliente_nombre, cu.nombre) as cliente_nombre,
              COALESCE(c.chofer_nombre, ch.nombre) as chofer_nombre
       FROM conduces c
       LEFT JOIN customers cu ON c.customer_id = cu.id
       LEFT JOIN choferes ch ON c.chofer_id = ch.id
       WHERE c.tenant_id = $1
       ORDER BY c.creado_en DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - Detalle de un conduce
// ==========================================
router.get('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const conduce = await pool.query(
      `SELECT c.*,
              COALESCE(c.cliente_nombre, cu.nombre) as cliente_nombre,
              COALESCE(c.chofer_nombre, ch.nombre) as chofer_nombre
       FROM conduces c
       LEFT JOIN customers cu ON c.customer_id = cu.id
       LEFT JOIN choferes ch ON c.chofer_id = ch.id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, tenant_id]
    );
    if (!conduce.rows[0]) return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' });
    const items = await pool.query(`SELECT * FROM conduces_items WHERE conduce_id = $1`, [id]);
    res.json({ success: true, data: { ...conduce.rows[0], items: items.rows } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// POST - Crear conduce
// ==========================================
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { customer_id, chofer_id, notas, items } = req.body;

    if (!customer_id) return res.status(400).json({ success: false, mensaje: 'El cliente es requerido' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Agregue al menos un articulo' });
    }

    await client.query('BEGIN');

    // Datos de cliente y chofer (snapshot del nombre)
    const cli = await client.query(`SELECT nombre FROM customers WHERE id = $1 AND tenant_id = $2`, [customer_id, tenant_id]);
    const clienteNombre = cli.rows[0]?.nombre || null;

    let choferNombre = null;
    if (chofer_id) {
      const cho = await client.query(`SELECT nombre FROM choferes WHERE id = $1 AND tenant_id = $2`, [chofer_id, tenant_id]);
      choferNombre = cho.rows[0]?.nombre || null;
    }
// Numero correlativo por tenant (entero, basado en numero_conduce existente)
    const maxNum = await client.query(
      `SELECT COALESCE(MAX(numero_conduce), 0) + 1 AS siguiente FROM conduces WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numeroConduce = parseInt(maxNum.rows[0].siguiente);
    const numeroTexto = 'CD-' + String(numeroConduce).padStart(4, '0');

    const conduce = await client.query(
      `INSERT INTO conduces (tenant_id, numero_conduce, numero, customer_id, cliente_nombre, chofer_id, chofer_nombre, notas, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'emitido') RETURNING *`,
      [tenant_id, numeroConduce, numeroTexto, customer_id, clienteNombre, chofer_id || null, choferNombre, notas || null]
    );

    const conduceId = conduce.rows[0].id;

    for (const it of items) {
      await client.query(
        `INSERT INTO conduces_items (conduce_id, product_id, descripcion, cantidad)
         VALUES ($1, $2, $3, $4)`,
        [conduceId, it.product_id || null, it.descripcion || '', parseFloat(it.cantidad) || 0]
      );
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

// ==========================================
// PUT - Anular conduce
// ==========================================
router.put('/:id/anular', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE conduces SET estado = 'anulado', anulado_en = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - PDF del conduce (token por query, lo valida verifyToken)
// ==========================================
router.get('/:id/pdf', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    const conduceQ = await pool.query(
      `SELECT c.*,
              COALESCE(c.cliente_nombre, cu.nombre) as cliente_nombre,
              cu.rnc_cedula, cu.telefono as cliente_telefono, cu.direccion as cliente_direccion,
              COALESCE(c.chofer_nombre, ch.nombre) as chofer_nombre, ch.placa as chofer_placa,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.telefono as empresa_tel, t.direccion as empresa_dir
       FROM conduces c
       LEFT JOIN customers cu ON c.customer_id = cu.id
       LEFT JOIN choferes ch ON c.chofer_id = ch.id
       JOIN tenants t ON c.tenant_id = t.id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, tenant_id]
    );
    if (!conduceQ.rows[0]) return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' });
    const d = conduceQ.rows[0];
    const itemsQ = await pool.query(`SELECT * FROM conduces_items WHERE conduce_id = $1`, [id]);
    const items = itemsQ.rows;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: [612, 792] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=conduce-${d.numero || d.id}.pdf`);
    doc.pipe(res);

    const W = 612;
    const M = 50;
    const azul = '#1e40af';

    // Encabezado empresa
    doc.fontSize(18).fillColor(azul).font('Helvetica-Bold')
      .text(d.empresa_nombre || 'Sistema de Facturacion', M, M, { width: W - M * 2, align: 'left' });
    let y = doc.y + 2;
    doc.fontSize(9).fillColor('#475569').font('Helvetica');
    if (d.empresa_rnc) { doc.text(`RNC: ${d.empresa_rnc}`, M, y); y = doc.y; }
    if (d.empresa_tel) { doc.text(`Tel: ${d.empresa_tel}`, M, y); y = doc.y; }
    if (d.empresa_dir) { doc.text(`${d.empresa_dir}`, M, y); y = doc.y; }

    // Titulo documento
    doc.fontSize(15).fillColor('#0f172a').font('Helvetica-Bold')
      .text('CONDUCE / NOTA DE ENTREGA', M, M, { width: W - M * 2, align: 'right' });
    doc.fontSize(11).fillColor(azul).font('Helvetica-Bold')
      .text(`No. ${d.numero || ''}`, M, doc.y, { width: W - M * 2, align: 'right' });
    doc.fontSize(9).fillColor('#64748b').font('Helvetica')
      .text(`Fecha: ${new Date(d.creado_en).toLocaleDateString('es-DO')}`, M, doc.y, { width: W - M * 2, align: 'right' });
    if (d.estado === 'anulado') {
      doc.fontSize(11).fillColor('#dc2626').font('Helvetica-Bold')
        .text('** ANULADO **', M, doc.y, { width: W - M * 2, align: 'right' });
    }

    // Linea separadora
    y = Math.max(y, doc.y) + 12;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#cbd5e1').lineWidth(1).stroke();
    y += 14;

    // Datos del cliente
    doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('CLIENTE', M, y);
    y = doc.y + 2;
    doc.fontSize(10).fillColor('#334155').font('Helvetica');
    doc.text(`${d.cliente_nombre || 'Consumidor Final'}`, M, y); y = doc.y;
    if (d.rnc_cedula) { doc.text(`RNC/Cedula: ${d.rnc_cedula}`, M, y); y = doc.y; }
    if (d.cliente_telefono) { doc.text(`Tel: ${d.cliente_telefono}`, M, y); y = doc.y; }
    if (d.cliente_direccion) { doc.text(`Direccion: ${d.cliente_direccion}`, M, y); y = doc.y; }
    if (d.chofer_nombre) { doc.text(`Chofer: ${d.chofer_nombre}${d.chofer_placa ? ' (' + d.chofer_placa + ')' : ''}`, M, y); y = doc.y; }

    y += 14;

    // Tabla de articulos - encabezado
    const colDescX = M;
    const colCantX = W - M - 90;
    doc.rect(M, y, W - M * 2, 22).fill(azul);
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
    doc.text('DESCRIPCION', colDescX + 8, y + 6);
    doc.text('CANTIDAD', colCantX, y + 6, { width: 82, align: 'right' });
    y += 22;

    // Filas
    doc.font('Helvetica').fontSize(10);
    items.forEach((it, i) => {
      const rowH = 20;
      if (i % 2 === 1) {
        doc.rect(M, y, W - M * 2, rowH).fill('#f1f5f9');
      }
      doc.fillColor('#1e293b');
      doc.text(it.descripcion || '', colDescX + 8, y + 5, { width: colCantX - colDescX - 16 });
      doc.text(parseFloat(it.cantidad).toFixed(2), colCantX, y + 5, { width: 82, align: 'right' });
      y += rowH;
    });

    // Linea cierre tabla
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#cbd5e1').lineWidth(1).stroke();
    y += 16;

    // Notas
    if (d.notas) {
      doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('NOTAS:', M, y);
      y = doc.y;
      doc.fontSize(10).fillColor('#334155').font('Helvetica').text(d.notas, M, y, { width: W - M * 2 });
      y = doc.y + 10;
    }

    // QR con datos del conduce
    try {
      const qrData = `CONDUCE:${d.numero}|CLIENTE:${d.cliente_nombre || ''}|FECHA:${new Date(d.creado_en).toLocaleDateString('es-DO')}`;
      const qrPng = await QRCode.toBuffer(qrData, { width: 110, margin: 1 });
      doc.image(qrPng, M, y + 10, { width: 90 });
    } catch (e) { /* si falla el QR, continuar sin el */ }

    // Firma
    const firmaY = y + 70;
    doc.moveTo(W - M - 200, firmaY).lineTo(W - M, firmaY).strokeColor('#94a3b8').lineWidth(1).stroke();
    doc.fontSize(9).fillColor('#64748b').font('Helvetica')
      .text('Recibido conforme', W - M - 200, firmaY + 4, { width: 200, align: 'center' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;