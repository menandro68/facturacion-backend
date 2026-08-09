const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');
const QRCode = require('qrcode');
const { tipoNcfDesdeCliente } = require('../helpers/tipoComprobante');

// ==========================================
// Crear/reparar tablas
// ==========================================
(async () => {
  try {
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

    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS numero_conduce INTEGER`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS numero VARCHAR(20)`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS customer_id UUID`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS cliente_nombre VARCHAR(255)`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS chofer_id UUID`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS chofer_nombre VARCHAR(255)`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS notas TEXT`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'activo'`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS operador_id UUID`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMP`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS inventario_rebajado BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS facturado BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE conduces ADD COLUMN IF NOT EXISTS factura_id UUID`);

    await pool.query(`ALTER TABLE conduces_items ADD COLUMN IF NOT EXISTS product_id UUID`);
    await pool.query(`ALTER TABLE conduces_items ADD COLUMN IF NOT EXISTS descripcion VARCHAR(255)`);
    await pool.query(`ALTER TABLE conduces_items ADD COLUMN IF NOT EXISTS cantidad NUMERIC(12,2) DEFAULT 1`);
    await pool.query(`ALTER TABLE conduces_items ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE conduces_items ADD COLUMN IF NOT EXISTS itbis_rate NUMERIC(5,2) DEFAULT 0`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conduces_nc (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        conduce_id UUID NOT NULL,
        numero_nc INTEGER,
        numero VARCHAR(20),
        customer_id UUID,
        cliente_nombre VARCHAR(255),
        motivo TEXT,
        total NUMERIC(12,2) DEFAULT 0,
        estado VARCHAR(20) DEFAULT 'emitida',
        operador_id UUID,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla conduces_nc lista');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conduces_nc_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nc_id UUID NOT NULL,
        product_id UUID,
        descripcion VARCHAR(255),
        cantidad NUMERIC(12,2) DEFAULT 1,
        precio_unitario NUMERIC(12,2) DEFAULT 0,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla conduces_nc_items lista');

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
// GET - Lista de Notas de Credito de conduces
// (DEBE ir ANTES de GET /:id para que Express no confunda "nc" con un id)
// ==========================================
router.get('/nc/lista', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT n.*, c.numero as conduce_numero FROM conduces_nc n
       LEFT JOIN conduces c ON n.conduce_id = c.id
       WHERE n.tenant_id = $1 ORDER BY n.creado_en DESC`,
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

    const cli = await client.query(`SELECT nombre FROM customers WHERE id = $1 AND tenant_id = $2`, [customer_id, tenant_id]);
    const clienteNombre = cli.rows[0]?.nombre || null;

    let choferNombre = null;
    if (chofer_id) {
      const cho = await client.query(`SELECT nombre FROM choferes WHERE id = $1 AND tenant_id = $2`, [chofer_id, tenant_id]);
      choferNombre = cho.rows[0]?.nombre || null;
    }

    const maxNum = await client.query(
      `SELECT COALESCE(MAX(numero_conduce), 0) + 1 AS siguiente FROM conduces WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numeroConduce = parseInt(maxNum.rows[0].siguiente);
    const numeroTexto = 'CD-' + String(numeroConduce).padStart(4, '0');

    // Descuento global por porcentaje (se prorratea en el precio de cada item)
    const pctDescCd = Math.min(Math.max(parseFloat(req.body.descuento_pct) || 0, 0), 100);

    const conduce = await client.query(
      `INSERT INTO conduces (tenant_id, numero_conduce, numero, customer_id, cliente_nombre, chofer_id, chofer_nombre, notas, estado, operador_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'emitido', $9) RETURNING *`,
      [tenant_id, numeroConduce, numeroTexto, customer_id, clienteNombre, chofer_id || null, choferNombre, notas || null, req.user.operador_id || null]
    );

    const conduceId = conduce.rows[0].id;
    let totalConduce = 0;
    let totalBrutoCd = 0;

    for (const it of items) {
      let precioUnit = 0;
      let itbisRate = 0;
      if (it.product_id) {
        const prod = await client.query(
          `SELECT precio, itbis_rate FROM products WHERE id = $1 AND tenant_id = $2`,
          [it.product_id, tenant_id]
        );
        if (prod.rows[0]) {
          precioUnit = parseFloat(prod.rows[0].precio) || 0;
          itbisRate = parseFloat(prod.rows[0].itbis_rate) || 0;
        }
      }
      const cantidad = parseFloat(it.cantidad) || 0;
      totalBrutoCd += precioUnit * cantidad;
      if (pctDescCd > 0) precioUnit = precioUnit * (1 - pctDescCd / 100);
      totalConduce += precioUnit * cantidad;

      await client.query(
        `INSERT INTO conduces_items (conduce_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [conduceId, it.product_id || null, it.descripcion || '', cantidad, precioUnit, itbisRate]
      );

      if (it.product_id) {
        const inv = await client.query(
          'SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2',
          [it.product_id, tenant_id]
        );
        if (inv.rows.length > 0) {
          const stockNuevo = parseFloat(inv.rows[0].stock_actual) - cantidad;
          await client.query('UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2',
            [stockNuevo, inv.rows[0].id]);
          await client.query(
            `INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo)
             VALUES ($1,$2,'salida',$3,$4,$5,$6)`,
            [tenant_id, inv.rows[0].id, cantidad, inv.rows[0].stock_actual, stockNuevo, `Conduce ${numeroTexto}`]
          );
        }
      }
    }

    if (pctDescCd > 0) {
      const montoDescCd = totalBrutoCd - totalConduce;
      const notaDescCd = `Descuento: RD$${montoDescCd.toFixed(2)} (${pctDescCd}%)`;
      const notasFinalCd = notas ? `${notas} | ${notaDescCd}` : notaDescCd;
      await client.query(`UPDATE conduces SET total = $1, inventario_rebajado = true, notas = $3 WHERE id = $2`, [totalConduce, conduceId, notasFinalCd]);
    } else {
      await client.query(`UPDATE conduces SET total = $1, inventario_rebajado = true WHERE id = $2`, [totalConduce, conduceId]);
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
// PUT - Convertir conduce en factura (con ITBIS y NCF)
// NCF ATOMICO: usa ncf_secuencias_electronicas con FOR UPDATE (imposible duplicar)
// ==========================================
router.put('/:id/convertir', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    await client.query('BEGIN');

    // 1. Buscar el conduce
    const conduceQ = await client.query(
      `SELECT * FROM conduces WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!conduceQ.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' });
    }
    const conduce = conduceQ.rows[0];

    // 2. Validaciones
    if (conduce.estado === 'anulado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, mensaje: 'No se puede facturar un conduce anulado' });
    }
    if (conduce.facturado) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, mensaje: 'Este conduce ya fue convertido en factura' });
    }

    // 3. Items del conduce
    const itemsQ = await client.query(`SELECT * FROM conduces_items WHERE conduce_id = $1`, [id]);
    const items = itemsQ.rows;
    if (items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, mensaje: 'El conduce no tiene articulos' });
    }

  // 4. Determinar tipo de NCF segun el tipo del cliente
    let tipoNcf = 'B02';
    if (conduce.customer_id) {
      const cliQ = await client.query(
        `SELECT tipo FROM customers WHERE id = $1 AND tenant_id = $2`,
        [conduce.customer_id, tenant_id]
      );
      if (cliQ.rows[0]) {
        tipoNcf = tipoNcfDesdeCliente(cliQ.rows[0].tipo);
      }
    }

    // Generar NCF ATOMICO desde ncf_secuencias_electronicas (con lock FOR UPDATE)
    const seqQ = await client.query(
      `SELECT id, prefijo, secuencia_desde, secuencia_hasta, secuencia_actual
       FROM ncf_secuencias_electronicas
       WHERE tenant_id = $1 AND tipo_ncf = $2 AND activo = true
         AND secuencia_actual <= secuencia_hasta
       ORDER BY creado_en ASC
       LIMIT 1
       FOR UPDATE`,
      [tenant_id, tipoNcf]
    );
    if (seqQ.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, mensaje: `No hay secuencia NCF ${tipoNcf} disponible para este cliente. Cree la secuencia en Mantenimiento > Secuencias NCF` });
    }
    const secuencia = seqQ.rows[0];
    const numeroActual = parseInt(secuencia.secuencia_actual);
    const ncf = `${secuencia.prefijo}${String(numeroActual).padStart(8, '0')}`;
    await client.query(
      `UPDATE ncf_secuencias_electronicas
       SET secuencia_actual = secuencia_actual + 1, actualizado_en = NOW()
       WHERE id = $1`,
      [secuencia.id]
    );

    // 5. Numero de factura correlativo
    const numQuery = await client.query(
      `SELECT COALESCE(MAX(numero_factura), 0) + 1 as siguiente FROM invoices WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numero_factura = numQuery.rows[0].siguiente;

// 6. Calcular totales (precio con ITBIS incluido)
    let subtotal = 0;
    let itbis = 0;
    for (const it of items) {
      const cant = parseFloat(it.cantidad) || 0;
      const precio = parseFloat(it.precio_unitario) || 0;
      const rate = parseFloat(it.itbis_rate) || 0;
      const bruto = cant * precio;
      const base = bruto / (1 + (rate / 100));
      subtotal += base;
      itbis += bruto - base;
    }
    const total = subtotal + itbis;

    // 7. Crear la factura (estado emitida)
const invoice = await client.query(
      `INSERT INTO invoices (tenant_id, customer_id, ncf_tipo, ncf, estado, subtotal, itbis, total, notas, fecha_emision, numero_factura, chofer_id, operador_id)
       VALUES ($1, $2, $11, $3, 'emitida', $4, $5, $6, $7, NOW(), $8, $9, $10) RETURNING *`,
      [tenant_id, conduce.customer_id || null, ncf, subtotal, itbis, total,
       `Generada desde conduce ${conduce.numero || ''}`, numero_factura, conduce.chofer_id || null, req.user.operador_id || null, tipoNcf]
    );
    const invoice_id = invoice.rows[0].id;
// 8. Crear los items de la factura (precio con ITBIS incluido)
    for (const it of items) {
      const cant = parseFloat(it.cantidad) || 0;
      const precio = parseFloat(it.precio_unitario) || 0;
      const rate = parseFloat(it.itbis_rate) || 0;
      const item_bruto = cant * precio;
      const item_base = item_bruto / (1 + (rate / 100));
      const item_itbis = item_bruto - item_base;
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate, itbis_monto, subtotal, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [invoice_id, it.product_id || null, it.descripcion || '', cant, precio, rate, item_itbis, item_base, item_bruto]
      );
    }

    // 9. NO rebajar inventario: el conduce ya lo hizo (inventario_rebajado = true)

    // 10. Marcar el conduce como facturado
    await client.query(
      `UPDATE conduces SET facturado = true, factura_id = $1 WHERE id = $2`,
      [invoice_id, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: invoice.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// GET - PDF del conduce
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

    doc.fontSize(18).fillColor(azul).font('Helvetica-Bold')
      .text(d.empresa_nombre || 'Sistema de Facturacion', M, M, { width: W - M * 2, align: 'left' });
    let y = doc.y + 2;
    doc.fontSize(9).fillColor('#475569').font('Helvetica');
    if (d.empresa_rnc) { doc.text(`RNC: ${d.empresa_rnc}`, M, y); y = doc.y; }
    if (d.empresa_tel) { doc.text(`Tel: ${d.empresa_tel}`, M, y); y = doc.y; }
    if (d.empresa_dir) { doc.text(`${d.empresa_dir}`, M, y); y = doc.y; }

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

    y = Math.max(y, doc.y) + 12;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#cbd5e1').lineWidth(1).stroke();
    y += 14;

    doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('CLIENTE', M, y);
    y = doc.y + 2;
    doc.fontSize(10).fillColor('#334155').font('Helvetica');
    doc.text(`${d.cliente_nombre || 'Consumidor Final'}`, M, y); y = doc.y;
    if (d.rnc_cedula) { doc.text(`RNC/Cedula: ${d.rnc_cedula}`, M, y); y = doc.y; }
    if (d.cliente_telefono) { doc.text(`Tel: ${d.cliente_telefono}`, M, y); y = doc.y; }
    if (d.cliente_direccion) { doc.text(`Direccion: ${d.cliente_direccion}`, M, y); y = doc.y; }
    if (d.chofer_nombre) { doc.text(`Chofer: ${d.chofer_nombre}${d.chofer_placa ? ' (' + d.chofer_placa + ')' : ''}`, M, y); y = doc.y; }

    y += 14;

    const colDescX = M;
    const colCantX = M + 245;
    const colPrecioX = M + 330;
    const colSubX = W - M - 95;
    doc.rect(M, y, W - M * 2, 22).fill(azul);
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
    doc.text('DESCRIPCION', colDescX + 8, y + 6);
    doc.text('CANT.', colCantX, y + 6, { width: 70, align: 'right' });
    doc.text('PRECIO', colPrecioX, y + 6, { width: 80, align: 'right' });
    doc.text('SUBTOTAL', colSubX, y + 6, { width: 87, align: 'right' });
    y += 22;

    doc.font('Helvetica').fontSize(10);
    let totalDoc = 0;
    items.forEach((it, i) => {
      const rowH = 20;
      if (i % 2 === 1) {
        doc.rect(M, y, W - M * 2, rowH).fill('#f1f5f9');
      }
      const cant = parseFloat(it.cantidad) || 0;
      const precio = parseFloat(it.precio_unitario) || 0;
      const sub = cant * precio;
      totalDoc += sub;
      doc.fillColor('#1e293b');
      doc.text(it.descripcion || '', colDescX + 8, y + 5, { width: colCantX - colDescX - 16 });
      doc.text(cant.toFixed(2), colCantX, y + 5, { width: 70, align: 'right' });
      doc.text('RD$' + precio.toLocaleString('es-DO', { minimumFractionDigits: 2 }), colPrecioX, y + 5, { width: 80, align: 'right' });
      doc.text('RD$' + sub.toLocaleString('es-DO', { minimumFractionDigits: 2 }), colSubX, y + 5, { width: 87, align: 'right' });
      y += rowH;
    });

    doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#cbd5e1').lineWidth(1).stroke();
    y += 12;

  // ESTRUCTURA FISCAL: Total Bruto -> Descuento -> Sub-Total -> ITBIS -> Neto
    let itbisCond = 0;
    items.forEach(it => {
      const c = parseFloat(it.cantidad) || 0;
      const p = parseFloat(it.precio_unitario) || 0;
      const r = parseFloat(it.itbis_rate) || 0;
      const bruto = c * p;
      itbisCond += bruto - (bruto / (1 + (r / 100)));
    });
    const subNetoCond = totalDoc - itbisCond;
    let descCond = 0;
    if (d.notas) {
      const mDescCd = String(d.notas).match(/Descuento:\s*RD\$\s*([\d.,]+)/i);
      if (mDescCd) descCond = parseFloat(String(mDescCd[1]).replace(/,/g, '')) || 0;
    }
    const fmtCond = (n) => 'RD$' + parseFloat(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const filasCond = [
      ['TOTAL BRUTO', subNetoCond + descCond],
      ['TOTAL DESC.', descCond],
      ['SUB-TOTAL', subNetoCond],
      ['TOTAL ITBIS', itbisCond]
    ];
    doc.fontSize(10).fillColor('#0f172a').font('Helvetica');
    filasCond.forEach(([etq, val]) => {
      doc.font('Helvetica').text(etq, M, y, { width: W - M * 2 - 110, align: 'right' });
      doc.font('Helvetica-Bold').text(fmtCond(val), M, y, { width: W - M * 2, align: 'right' });
      y += 15;
    });
    y += 4;
    doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold')
      .text('NETO RD$: ' + fmtCond(totalDoc), M, y, { width: W - M * 2, align: 'right' });
    y += 24;

    if (d.notas) {
      doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text('NOTAS:', M, y);
      y = doc.y;
      doc.fontSize(10).fillColor('#334155').font('Helvetica').text(d.notas, M, y, { width: W - M * 2 });
      y = doc.y + 10;
    }

    try {
      const qrData = `CONDUCE:${d.numero}|CLIENTE:${d.cliente_nombre || ''}|FECHA:${new Date(d.creado_en).toLocaleDateString('es-DO')}`;
      const qrPng = await QRCode.toBuffer(qrData, { width: 110, margin: 1 });
      doc.image(qrPng, M, y + 10, { width: 90 });
    } catch (e) { /* si falla el QR, continuar sin el */ }

    const firmaY = y + 70;
    doc.moveTo(W - M - 200, firmaY).lineTo(W - M, firmaY).strokeColor('#94a3b8').lineWidth(1).stroke();
    doc.fontSize(9).fillColor('#64748b').font('Helvetica')
      .text('Recibido conforme', W - M - 200, firmaY + 4, { width: 200, align: 'center' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear Nota de Credito de un conduce (sin valor fiscal)
router.post('/:id/nota-credito', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { motivo, items } = req.body;

    if (!items || !items.length) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, mensaje: 'Agregue al menos un articulo' }); }

    const conduce = await client.query(`SELECT * FROM conduces WHERE id = $1 AND tenant_id = $2`, [id, tenant_id]);
    if (!conduce.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' }); }
    if (conduce.rows[0].estado === 'anulado') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, mensaje: 'No se puede hacer NC a un conduce anulado' }); }
    if (conduce.rows[0].facturado) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, mensaje: 'Este conduce fue convertido en factura. Haga la NC a la factura.' }); }

    // Validar cantidades contra el conduce (menos NC previas)
    const itemsConduce = await client.query(`SELECT * FROM conduces_items WHERE conduce_id = $1`, [id]);
    const ncPrevias = await client.query(
      `SELECT ni.product_id, ni.descripcion, COALESCE(SUM(ni.cantidad),0) as cant_nc
       FROM conduces_nc_items ni JOIN conduces_nc n ON ni.nc_id = n.id
       WHERE n.conduce_id = $1 AND n.estado = 'emitida' GROUP BY ni.product_id, ni.descripcion`,
      [id]
    );
    for (const item of items) {
      const orig = itemsConduce.rows.find(ic => (ic.product_id && ic.product_id === item.product_id) || ic.descripcion === item.descripcion);
      if (!orig) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, mensaje: `El articulo "${item.descripcion}" no pertenece a este conduce` }); }
      const previa = ncPrevias.rows.find(np => (np.product_id && np.product_id === item.product_id) || np.descripcion === item.descripcion);
      const disponible = parseFloat(orig.cantidad) - parseFloat(previa?.cant_nc || 0);
      if (parseFloat(item.cantidad) > disponible) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, mensaje: `La cantidad de "${item.descripcion}" excede lo disponible (${disponible})` });
      }
    }

    // Numero correlativo NCC-XXXX
    const maxNum = await client.query(`SELECT COALESCE(MAX(numero_nc), 0) + 1 AS siguiente FROM conduces_nc WHERE tenant_id = $1`, [tenant_id]);
    const numeroNc = parseInt(maxNum.rows[0].siguiente);
    const numeroTextoNc = 'NCC-' + String(numeroNc).padStart(4, '0');

    // Total de la NC
    let totalNc = 0;
    for (const item of items) totalNc += parseFloat(item.cantidad) * parseFloat(item.precio_unitario || 0);

    const nc = await client.query(
      `INSERT INTO conduces_nc (tenant_id, conduce_id, numero_nc, numero, customer_id, cliente_nombre, motivo, total, estado, operador_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'emitida', $9) RETURNING *`,
      [tenant_id, id, numeroNc, numeroTextoNc, conduce.rows[0].customer_id, conduce.rows[0].cliente_nombre,
       motivo || `Nota de credito por conduce ${conduce.rows[0].numero}`, totalNc, req.user.operador_id || null]
    );
    const ncId = nc.rows[0].id;

    // Items + devolver inventario (tabla inventory, igual que el conduce pero en entrada)
    for (const item of items) {
      await client.query(
        `INSERT INTO conduces_nc_items (nc_id, product_id, descripcion, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4, $5)`,
        [ncId, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario || 0]
      );
      if (item.product_id) {
        const inv = await client.query(
          'SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2',
          [item.product_id, tenant_id]
        );
        if (inv.rows.length > 0) {
          const stockActual = parseFloat(inv.rows[0].stock_actual);
          const cantidad = parseFloat(item.cantidad);
          const stockNuevo = stockActual + cantidad;
          await client.query('UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2',
            [stockNuevo, inv.rows[0].id]);
          await client.query(
            `INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo)
             VALUES ($1,$2,'entrada',$3,$4,$5,$6)`,
            [tenant_id, inv.rows[0].id, cantidad, stockActual, stockNuevo, `NC Conduce ${numeroTextoNc} (${conduce.rows[0].numero})`]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: nc.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// GET - Impresion de Nota de Credito de conduce (HTML imprimible)
router.get('/nc/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params
    const { token } = req.query
    if (!token) return res.status(401).json({ mensaje: 'Token requerido' })

    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const tenant_id = decoded.tenant_id

    const result = await pool.query(
      `SELECT n.*, c.numero as conduce_numero,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.telefono as empresa_tel, t.direccion as empresa_dir
       FROM conduces_nc n
       LEFT JOIN conduces c ON n.conduce_id = c.id
       LEFT JOIN tenants t ON n.tenant_id = t.id
       WHERE n.id = $1 AND n.tenant_id = $2`,
      [id, tenant_id]
    )
    if (!result.rows[0]) return res.status(404).json({ mensaje: 'Nota de credito no encontrada' })
    const n = result.rows[0]
    const itemsQ = await pool.query(`SELECT * FROM conduces_nc_items WHERE nc_id = $1`, [id])

    const filasItems = itemsQ.rows.map(it => `
      <tr>
        <td>${it.descripcion}</td>
        <td style="text-align:right">${parseFloat(it.cantidad).toLocaleString('es-DO')}</td>
        <td style="text-align:right">RD$${parseFloat(it.precio_unitario).toLocaleString('es-DO',{minimumFractionDigits:2})}</td>
        <td style="text-align:right">RD$${(parseFloat(it.cantidad) * parseFloat(it.precio_unitario)).toLocaleString('es-DO',{minimumFractionDigits:2})}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Nota de Credito ${n.numero}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#1e293b;max-width:600px;margin:0 auto}
      .header{text-align:center;border-bottom:2px solid #b91c1c;padding-bottom:16px;margin-bottom:16px}
      .empresa{font-size:18px;font-weight:bold;color:#1e40af}
      .titulo{font-size:15px;color:#b91c1c;margin-top:4px;font-weight:bold}
      .fila{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
      .label{color:#64748b}
      .valor{font-weight:500}
      table{width:100%;border-collapse:collapse;font-size:13px;margin:16px 0}
      th{background:#b91c1c;color:white;padding:8px;text-align:left}
      th:nth-child(2),th:nth-child(3),th:nth-child(4){text-align:right}
      td{padding:7px 8px;border-bottom:1px solid #e2e8f0}
      .total{font-size:18px;font-weight:bold;color:#b91c1c;text-align:right;margin-top:16px}
      .footer{text-align:center;margin-top:20px;font-size:11px;color:#94a3b8}
      @media print{button{display:none}}
    </style></head><body>
    <div class="header">
      <div class="empresa">${n.empresa_nombre || 'Sistema de Facturación'}</div>
      <div class="titulo">NOTA DE CRÉDITO ${n.numero}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">Documento sin valor fiscal</div>
      ${n.empresa_rnc ? `<div style="font-size:12px;color:#64748b">RNC: ${n.empresa_rnc}</div>` : ''}
      ${n.empresa_tel ? `<div style="font-size:12px;color:#64748b">Tel: ${n.empresa_tel}</div>` : ''}
    </div>
    <div class="fila"><span class="label">Fecha:</span><span class="valor">${new Date(n.creado_en).toLocaleDateString('es-DO')}</span></div>
    <div class="fila"><span class="label">Conduce Original:</span><span class="valor">${n.conduce_numero || '-'}</span></div>
    <div class="fila"><span class="label">Cliente:</span><span class="valor">${n.cliente_nombre || 'Consumidor Final'}</span></div>
    ${n.motivo ? `<div class="fila"><span class="label">Motivo:</span><span class="valor">${n.motivo}</span></div>` : ''}
    <table>
      <thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Importe</th></tr></thead>
      <tbody>${filasItems}</tbody>
    </table>
    <div class="total">Total NC: RD$${parseFloat(n.total).toLocaleString('es-DO',{minimumFractionDigits:2})}</div>
    <div class="footer">Documento interno sin valor fiscal</div>
    <script>window.onload=()=>window.print()</script>
    </body></html>`

    res.send(html)
  } catch (error) {
    res.status(500).json({ mensaje: error.message })
  }
})

// PUT - Asignar chofer a un conduce
router.put('/:id/asignar-chofer', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { chofer_id } = req.body;
    let choferNombre = null;
    if (chofer_id) {
      const cho = await pool.query(`SELECT nombre FROM choferes WHERE id = $1 AND tenant_id = $2`, [chofer_id, tenant_id]);
      if (cho.rows[0]) choferNombre = cho.rows[0].nombre;
    }
    const result = await pool.query(
      `UPDATE conduces SET chofer_id = $1, chofer_nombre = $2 WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [chofer_id || null, choferNombre, id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Editar conduce (solo si no esta facturado ni anulado)
router.put('/:id/editar', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { customer_id, notas, items } = req.body;
    const pctDescEd = Math.min(Math.max(parseFloat(req.body.descuento_pct) || 0, 0), 100);
    if (!items || items.length === 0) return res.status(400).json({ success: false, mensaje: 'Debe incluir al menos un articulo' });
    await client.query('BEGIN');
    const cdQ = await client.query(`SELECT * FROM conduces WHERE id = $1 AND tenant_id = $2`, [id, tenant_id]);
    if (!cdQ.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, mensaje: 'Conduce no encontrado' }); }
    const cd = cdQ.rows[0];
    if (cd.facturado) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, mensaje: 'No se puede editar un conduce ya facturado' }); }
    if (cd.estado === 'anulado') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, mensaje: 'No se puede editar un conduce anulado' }); }
    const itemsViejos = await client.query(`SELECT * FROM conduces_items WHERE conduce_id = $1`, [id]);
    for (const iv of itemsViejos.rows) {
      if (!iv.product_id) continue;
      const invV = await client.query('SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2', [iv.product_id, tenant_id]);
      if (invV.rows.length > 0) {
        const stockAntV = parseFloat(invV.rows[0].stock_actual);
        const stockNuevoV = stockAntV + parseFloat(iv.cantidad);
        await client.query('UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2', [stockNuevoV, invV.rows[0].id]);
        await client.query(`INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo) VALUES ($1,$2,'entrada',$3,$4,$5,$6)`, [tenant_id, invV.rows[0].id, parseFloat(iv.cantidad), stockAntV, stockNuevoV, `Reversion por edicion de conduce ${cd.numero}`]);
      }
    }
    await client.query(`DELETE FROM conduces_items WHERE conduce_id = $1`, [id]);
    let clienteNombreEd = cd.cliente_nombre;
    if (customer_id && customer_id !== cd.customer_id) {
      const cliEd = await client.query(`SELECT nombre FROM customers WHERE id = $1 AND tenant_id = $2`, [customer_id, tenant_id]);
      if (cliEd.rows[0]) clienteNombreEd = cliEd.rows[0].nombre;
    }
    let totalEd = 0, totalBrutoEd = 0;
    for (const it of items) {
      let precioUnitEd = 0, itbisRateEd = 0;
      if (it.product_id) {
        const prodEd = await client.query(`SELECT precio, itbis_rate FROM products WHERE id = $1 AND tenant_id = $2`, [it.product_id, tenant_id]);
        if (prodEd.rows[0]) {
          precioUnitEd = parseFloat(prodEd.rows[0].precio) || 0;
          itbisRateEd = parseFloat(prodEd.rows[0].itbis_rate) || 0;
        }
      }
      const cantEd = parseFloat(it.cantidad) || 0;
      totalBrutoEd += precioUnitEd * cantEd;
      if (pctDescEd > 0) precioUnitEd = precioUnitEd * (1 - pctDescEd / 100);
      totalEd += precioUnitEd * cantEd;
      await client.query(`INSERT INTO conduces_items (conduce_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate) VALUES ($1, $2, $3, $4, $5, $6)`, [id, it.product_id || null, it.descripcion || '', cantEd, precioUnitEd, itbisRateEd]);
      if (it.product_id) {
        const invEd = await client.query('SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2', [it.product_id, tenant_id]);
        if (invEd.rows.length > 0) {
          const stockAntEd = parseFloat(invEd.rows[0].stock_actual);
          const stockNuevoEd = stockAntEd - cantEd;
          await client.query('UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2', [stockNuevoEd, invEd.rows[0].id]);
          await client.query(`INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo) VALUES ($1,$2,'salida',$3,$4,$5,$6)`, [tenant_id, invEd.rows[0].id, cantEd, stockAntEd, stockNuevoEd, `Conduce ${cd.numero} (editado)`]);
        }
      }
    }
    let notasFinalEd = notas || null;
    if (pctDescEd > 0) {
      const montoDescEd = totalBrutoEd - totalEd;
      const notaDescEd = `Descuento: RD${montoDescEd.toFixed(2)} (${pctDescEd}%)`;
      notasFinalEd = notas ? `${notas} | ${notaDescEd}` : notaDescEd;
    }
    const upd = await client.query(`UPDATE conduces SET customer_id = $1, cliente_nombre = $2, notas = $3, total = $4, inventario_rebajado = true WHERE id = $5 AND tenant_id = $6 RETURNING *`, [customer_id || cd.customer_id, clienteNombreEd, notasFinalEd, totalEd, id, tenant_id]);
    await client.query('COMMIT');
    res.json({ success: true, data: upd.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
