const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');
const logActividad = require('../utils/logActividad');

// CAMBIO DE MERCANCIA (F8): documento interno, sin valor fiscal
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cambios_pos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        numero VARCHAR(20),
        numero_cambio INTEGER,
        invoice_id UUID,
        factura_ncf VARCHAR(20),
        cliente_nombre VARCHAR(150),
        total_devuelto DECIMAL(12,2) DEFAULT 0,
        total_nuevo DECIMAL(12,2) DEFAULT 0,
        diferencia DECIMAL(12,2) DEFAULT 0,
        metodo_pago VARCHAR(30),
        caja_id UUID,
        operador_id UUID,
        autorizado_por VARCHAR(150),
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cambios_pos_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cambio_id UUID NOT NULL,
        tipo VARCHAR(10) NOT NULL,
        product_id UUID,
        descripcion VARCHAR(255),
        cantidad DECIMAL(12,2) DEFAULT 1,
        precio_unitario DECIMAL(12,2) DEFAULT 0,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cambios_pos_tenant ON cambios_pos(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cambios_pos_items_cambio ON cambios_pos_items(cambio_id)`);
    console.log('Tablas de cambios POS listas');
  } catch (e) {
    console.error('Error creando tablas cambios_pos:', e.message);
  }
})();

// Crear tabla cajas si no existe (al cargar el módulo)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cajas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        usuario_nombre VARCHAR(150),
        operador_id UUID,
        monto_apertura DECIMAL(12,2) NOT NULL DEFAULT 0,
        fecha_apertura TIMESTAMP NOT NULL DEFAULT NOW(),
        fecha_cierre TIMESTAMP,
        total_efectivo DECIMAL(12,2),
        total_tarjeta DECIMAL(12,2),
        total_transferencia DECIMAL(12,2),
        total_ventas DECIMAL(12,2),
        cantidad_facturas INTEGER,
        efectivo_esperado DECIMAL(12,2),
        estado VARCHAR(20) NOT NULL DEFAULT 'abierta'
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pos_pagos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        invoice_id UUID NOT NULL,
        metodo VARCHAR(20) NOT NULL,
        monto DECIMAL(12,2) NOT NULL,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_pagos_invoice ON pos_pagos(invoice_id)`);
    await pool.query(`ALTER TABLE cajas ADD COLUMN IF NOT EXISTS desglose_efectivo JSONB`);
    await pool.query(`ALTER TABLE cajas ADD COLUMN IF NOT EXISTS efectivo_contado DECIMAL(12,2)`);
    await pool.query(`ALTER TABLE cajas ADD COLUMN IF NOT EXISTS diferencia DECIMAL(12,2)`);
    console.log('✅ Tabla cajas lista');
  } catch (err) {
    console.error('Error creando tabla cajas:', err.message);
  }
})();

// Calcula los totales del turno. Usa pos_pagos (desglose real, soporta pago mixto).
// Si una factura no tiene desglose (ventas anteriores a esta función), cae al método de `notas`.
// Identifica al cajero/usuario logueado para que cada uno tenga su propia caja
function idCajero(req) {
  return req.user.cajero_id || req.user.operador_id || req.user.id || null;
}

async function calcularTotalesTurno(tenant_id, fechaApertura, cajaId) {
  const ventas = await pool.query(
    cajaId
      ? `SELECT id, notas, total FROM invoices
         WHERE tenant_id = $1
           AND estado IN ('emitida', 'pagada')
           AND notas LIKE 'POS - Pago:%'
           AND caja_id = $2`
      : `SELECT id, notas, total FROM invoices
         WHERE tenant_id = $1
           AND estado IN ('emitida', 'pagada')
           AND notas LIKE 'POS - Pago:%'
           AND fecha_emision >= $2`,
    [tenant_id, cajaId || fechaApertura]
  );

  const ids = ventas.rows.map(v => v.id);
  const porFactura = {};
  if (ids.length > 0) {
    const pg = await pool.query(
      `SELECT invoice_id, metodo, monto FROM pos_pagos WHERE tenant_id = $1 AND invoice_id = ANY($2::uuid[])`,
      [tenant_id, ids]
    );
    for (const p of pg.rows) {
      if (!porFactura[p.invoice_id]) porFactura[p.invoice_id] = [];
      porFactura[p.invoice_id].push(p);
    }
  }

  let total_efectivo = 0, total_tarjeta = 0, total_transferencia = 0;
  for (const v of ventas.rows) {
    const detalle = porFactura[v.id];
    if (detalle && detalle.length > 0) {
      for (const d of detalle) {
        const m = parseFloat(d.monto) || 0;
        if (d.metodo === 'efectivo') total_efectivo += m;
        else if (d.metodo === 'tarjeta') total_tarjeta += m;
        else if (d.metodo === 'transferencia') total_transferencia += m;
      }
    } else {
      const t = parseFloat(v.total) || 0;
      if (v.notas.includes('Efectivo')) total_efectivo += t;
      else if (v.notas.includes('Tarjeta')) total_tarjeta += t;
      else if (v.notas.includes('Transferencia')) total_transferencia += t;
    }
  }

// CAMBIOS DE MERCANCIA: la diferencia cobrada tambien entra a caja
  const camb = await pool.query(
    `SELECT metodo_pago, COALESCE(SUM(diferencia),0) as total
     FROM cambios_pos
     WHERE tenant_id = $1 AND diferencia > 0 ${cajaId ? 'AND caja_id = $2' : 'AND creado_en >= $2'}
     GROUP BY metodo_pago`,
    [tenant_id, cajaId || fechaApertura]
  );
let total_cambios = 0;
  for (const c of camb.rows) {
    const m = parseFloat(c.total) || 0;
    total_cambios += m;
    if (c.metodo_pago === 'efectivo') total_efectivo += m;
    else if (c.metodo_pago === 'tarjeta') total_tarjeta += m;
    else if (c.metodo_pago === 'transferencia') total_transferencia += m;
  }
  return {
    total_efectivo,
    total_tarjeta,
    total_transferencia,
    total_cambios,
    total_ventas: total_efectivo + total_tarjeta + total_transferencia,
    cantidad_facturas: ventas.rows.length
  };
}

// POST /pos/cambio - Registrar cambio de mercancia (documento interno, sin NCF)
router.post('/cambio', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { invoice_id, items_devueltos, items_nuevos, metodo_pago, autorizado_por } = req.body;
    if (!invoice_id) return res.status(400).json({ success: false, mensaje: 'Falta la factura original' });
    if (!Array.isArray(items_devueltos) || items_devueltos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Seleccione al menos un articulo a devolver' });
    }
    if (!Array.isArray(items_nuevos) || items_nuevos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Agregue al menos un articulo nuevo' });
    }
    await client.query('BEGIN');
    const facQ = await client.query(
      `SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2`,
      [invoice_id, tenant_id]
    );
    if (!facQ.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' }); }
    const fac = facQ.rows[0];
    if (fac.estado === 'anulada') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, mensaje: 'La factura esta anulada' }); }
    const dias = Math.floor((Date.now() - new Date(fac.creado_en).getTime()) / 86400000);
    if (dias > 5) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, mensaje: `El plazo para cambios es de 5 dias. Esta factura tiene ${dias} dias.` }); }
    let totalDev = 0, totalNue = 0;
    for (const it of items_devueltos) totalDev += (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0);
    for (const it of items_nuevos) totalNue += (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0);
    if (totalNue < totalDev - 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, mensaje: 'La mercancia nueva debe costar igual o mas que la devuelta.' });
    }
    const diferencia = totalNue - totalDev;
        const cajaQ = await client.query(`SELECT id FROM cajas WHERE tenant_id=$1 AND estado='abierta' AND operador_id IS NOT DISTINCT FROM $2 LIMIT 1`, [tenant_id, idCajero(req)]);
    const cajaId = cajaQ.rows[0]?.id || null;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || '-cambio'))`, [tenant_id]);
    const maxQ = await client.query(`SELECT COALESCE(MAX(numero_cambio),0) as maximo FROM cambios_pos WHERE tenant_id=$1`, [tenant_id]);
    const numCambio = parseInt(maxQ.rows[0].maximo) + 1;
    const numTexto = 'CB-' + String(numCambio).padStart(4, '0');
    const cambio = await client.query(
      `INSERT INTO cambios_pos (tenant_id, numero, numero_cambio, invoice_id, factura_ncf, cliente_nombre,
        total_devuelto, total_nuevo, diferencia, metodo_pago, caja_id, operador_id, autorizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [tenant_id, numTexto, numCambio, invoice_id, fac.ncf || null, fac.cliente_nombre || 'Consumidor Final',
       totalDev, totalNue, diferencia, diferencia > 0 ? (metodo_pago || 'efectivo') : null,
       cajaId, req.user.operador_id || null, autorizado_por || null]
    );
    const cambioId = cambio.rows[0].id;
    for (const it of items_devueltos) {
      const cant = parseFloat(it.cantidad) || 0;
      await client.query(
        `INSERT INTO cambios_pos_items (cambio_id, tipo, product_id, descripcion, cantidad, precio_unitario)
         VALUES ($1,'devuelto',$2,$3,$4,$5)`,
        [cambioId, it.product_id || null, it.descripcion || '', cant, parseFloat(it.precio_unitario) || 0]
      );
      if (it.product_id) {
        const empD = await client.query('SELECT articulo_padre_id, factor_empaque FROM products WHERE id=$1 AND tenant_id=$2', [it.product_id, tenant_id]);
        const prodD = empD.rows[0]?.articulo_padre_id || it.product_id;
        const fD = parseFloat(empD.rows[0]?.factor_empaque);
        const baseD = cant * (fD > 0 ? fD : 1);
        const invD = await client.query('SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2', [prodD, tenant_id]);
        if (invD.rows.length > 0) {
          const antD = parseFloat(invD.rows[0].stock_actual);
          const nuevoD = antD + baseD;
          await client.query('UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2', [nuevoD, invD.rows[0].id]);
          await client.query(
            `INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo)
             VALUES ($1,$2,'entrada',$3,$4,$5,$6)`,
            [tenant_id, invD.rows[0].id, baseD, antD, nuevoD, `Cambio ${numTexto} (devuelto)`]
          );
        }
      }
    }
    for (const it of items_nuevos) {
      const cant = parseFloat(it.cantidad) || 0;
      await client.query(
        `INSERT INTO cambios_pos_items (cambio_id, tipo, product_id, descripcion, cantidad, precio_unitario)
         VALUES ($1,'nuevo',$2,$3,$4,$5)`,
        [cambioId, it.product_id || null, it.descripcion || '', cant, parseFloat(it.precio_unitario) || 0]
      );
      if (it.product_id) {
        const empN = await client.query('SELECT articulo_padre_id, factor_empaque FROM products WHERE id=$1 AND tenant_id=$2', [it.product_id, tenant_id]);
        const prodN = empN.rows[0]?.articulo_padre_id || it.product_id;
        const fN = parseFloat(empN.rows[0]?.factor_empaque);
        const baseN = cant * (fN > 0 ? fN : 1);
        const invN = await client.query('SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2', [prodN, tenant_id]);
        if (invN.rows.length > 0) {
          const antN = parseFloat(invN.rows[0].stock_actual);
          const nuevoN = antN - baseN;
          await client.query('UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2', [nuevoN, invN.rows[0].id]);
          await client.query(
            `INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo)
             VALUES ($1,$2,'salida',$3,$4,$5,$6)`,
            [tenant_id, invN.rows[0].id, baseN, antN, nuevoN, `Cambio ${numTexto} (entregado)`]
          );
        }
      }
    }
    await client.query('COMMIT');
    logActividad(req, 'pos', 'cambio', `Cambio ${numTexto} sobre ${fac.ncf || ''} - Diferencia RD$${diferencia.toFixed(2)}`, cambioId);
    res.status(201).json({ success: true, data: { ...cambio.rows[0], total_devuelto: totalDev, total_nuevo: totalNue, diferencia } });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// GET /pos/cambio/:id/ticket - Ticket 80mm del cambio de mercancia
router.get('/cambio/:id/ticket', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const camQ = await pool.query(
      `SELECT c.*, t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.telefono as empresa_telefono, t.direccion as empresa_direccion
       FROM cambios_pos c LEFT JOIN tenants t ON c.tenant_id = t.id
       WHERE c.id=$1 AND c.tenant_id=$2`, [id, tenant_id]);
    if (camQ.rows.length === 0) return res.status(404).json({ success: false, mensaje: 'Cambio no encontrado' });
    const cam = camQ.rows[0];
    const itemsQ = await pool.query(`SELECT * FROM cambios_pos_items WHERE cambio_id=$1 ORDER BY tipo DESC`, [id]);
    const devueltos = itemsQ.rows.filter(i => i.tipo === 'devuelto');
    const nuevos = itemsQ.rows.filter(i => i.tipo === 'nuevo');
    const PDFDocument = require('pdfkit');
    const W = 196, M = 6;
    const doc = new PDFDocument({ margin: M, size: [W, 800] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=cambio-${cam.numero}.pdf`);
    doc.pipe(res);
    let y = 10;
    const fmtN = (n) => parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const centrado = (txt, size, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).text(txt, M, y, { width: W - M * 2, align: 'center' });
      y += size + 2;
    };
    const izquierda = (txt, size, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).text(txt, M, y, { width: W - M * 2, align: 'left' });
      y += size + 2;
    };
    const filaLR = (izq, der, size, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      doc.text(izq, M, y, { width: (W - M * 2) / 2, align: 'left' });
      doc.text(der, M + (W - M * 2) / 2, y, { width: (W - M * 2) / 2, align: 'right' });
      y += size + 2;
    };
    const lineaGuiones = () => {
      doc.font('Helvetica').fontSize(7).text('-'.repeat(46), M, y, { width: W - M * 2, align: 'center' });
      y += 8;
    };
    centrado(cam.empresa_nombre || '', 11, true);
    if (cam.empresa_rnc) izquierda(`RNC: ${cam.empresa_rnc}`, 7);
    if (cam.empresa_telefono) izquierda(`Tel: ${cam.empresa_telefono}`, 7);
    if (cam.empresa_direccion) izquierda(cam.empresa_direccion, 7);
    y += 3;
    lineaGuiones();
    centrado('CAMBIO DE MERCANCIA', 10, true);
    izquierda(`No.: ${cam.numero}`, 8, true);
    izquierda(`Factura: ${cam.factura_ncf || '-'}`, 8);
    izquierda(`Fecha: ${new Date(cam.creado_en).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })}`, 7);
    izquierda(`Cliente: ${cam.cliente_nombre || 'Consumidor Final'}`, 8);
    y += 3;
    lineaGuiones();
    izquierda('DEVUELVE:', 8, true);
    for (const it of devueltos) {
      izquierda(it.descripcion || '', 7);
      filaLR(`  ${fmtN(it.cantidad)} x ${fmtN(it.precio_unitario)}`, fmtN(it.cantidad * it.precio_unitario), 7);
    }
    y += 2;
    izquierda('SE LLEVA:', 8, true);
    for (const it of nuevos) {
      izquierda(it.descripcion || '', 7);
      filaLR(`  ${fmtN(it.cantidad)} x ${fmtN(it.precio_unitario)}`, fmtN(it.cantidad * it.precio_unitario), 7);
    }
    y += 3;
    lineaGuiones();
    filaLR('TOTAL DEVUELTO', fmtN(cam.total_devuelto), 8);
    filaLR('TOTAL NUEVO', fmtN(cam.total_nuevo), 8);
      filaLR('DIFERENCIA', fmtN(cam.diferencia), 10, true);
    y += 4;
    if (parseFloat(cam.diferencia) > 0) {
      filaLR('FORMA DE PAGO', (cam.metodo_pago || 'efectivo').toUpperCase(), 8);
      y += 2;
    }
    y += 3;
    lineaGuiones();
    if (cam.autorizado_por) izquierda(`AUTORIZADO POR: ${cam.autorizado_por}`, 7);
    y += 4;
    centrado('DOCUMENTO INTERNO', 8, true);
    centrado('Sin valor fiscal', 7);
    y += 4;
    centrado('GRACIAS POR SU COMPRA', 9, true);
    doc.end();
  } catch (error) {
    console.error('Error ticket cambio:', error);
    res.status(500).json({ success: false, mensaje: 'Error generando ticket' });
  }
});

// GET /pos/caja/actual - Consultar si hay caja abierta
router.get('/caja/actual', verifyToken, tenantGuard, async (req, res) => {
  try {
     const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' AND operador_id IS NOT DISTINCT FROM $2 ORDER BY fecha_apertura DESC LIMIT 1`,
      [tenant_id, idCajero(req)]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    console.error('Error consultando caja:', err);
    res.status(500).json({ success: false, mensaje: 'Error consultando caja' });
  }
});

// GET /pos/ultima-factura - Ultima factura emitida en la caja abierta
router.get('/ultima-factura', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const caja = await pool.query(
      `SELECT fecha_apertura FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [tenant_id]
    );
    if (caja.rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    const result = await pool.query(
      `SELECT id, ncf, numero_factura, total FROM invoices
       WHERE tenant_id = $1 AND fecha_emision >= $2 AND estado != 'anulada'
       AND notas LIKE 'POS - Pago:%'
       ORDER BY fecha_emision DESC LIMIT 1`,
      [tenant_id, caja.rows[0].fecha_apertura]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    console.error('Error consultando ultima factura:', err);
    res.status(500).json({ success: false, mensaje: 'Error consultando ultima factura' });
  }
});

// POST /pos/caja/abrir - Abrir caja con monto inicial
router.post('/caja/abrir', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { monto_apertura, usuario_nombre } = req.body;

    if (monto_apertura === undefined || monto_apertura === null || isNaN(parseFloat(monto_apertura)) || parseFloat(monto_apertura) < 0) {
      return res.status(400).json({ success: false, mensaje: 'El monto de apertura es requerido y debe ser 0 o mayor' });
    }

    // Verificar que no haya otra caja abierta
    const abierta = await pool.query(
          `SELECT id FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' AND operador_id IS NOT DISTINCT FROM $2 LIMIT 1`,
      [tenant_id, idCajero(req)]
    );
    if (abierta.rows.length > 0) {
      return res.status(400).json({ success: false, mensaje: 'Ya existe una caja abierta. Debe cerrarla antes de abrir otra.' });
    }

    const result = await pool.query(
      `INSERT INTO cajas (tenant_id, usuario_nombre, operador_id, monto_apertura, fecha_apertura, estado)
       VALUES ($1, $2, $3, $4, NOW(), 'abierta') RETURNING *`,
           [tenant_id, usuario_nombre || null, idCajero(req), parseFloat(monto_apertura)]
    );

    logActividad(req, 'pos', 'abrir_caja', `Abrió caja con RD$ ${parseFloat(monto_apertura).toFixed(2)}`, result.rows[0].id);

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Error abriendo caja:', err);
    res.status(500).json({ success: false, mensaje: 'Error abriendo caja' });
  }
});

// GET /pos/caja/resumen - Resumen del turno actual (para pantalla de cierre)
router.get('/caja/resumen', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const caja = await pool.query(
            `SELECT * FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' AND operador_id IS NOT DISTINCT FROM $2 ORDER BY fecha_apertura DESC LIMIT 1`,
      [tenant_id, idCajero(req)]
    );
    if (caja.rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay caja abierta' });
    }
    const cajaActual = caja.rows[0];

    const { total_efectivo, total_tarjeta, total_transferencia, total_ventas, cantidad_facturas, total_cambios } =
            await calcularTotalesTurno(tenant_id, cajaActual.fecha_apertura, cajaActual.id);
    const efectivo_esperado = parseFloat(cajaActual.monto_apertura) + total_efectivo;

    res.json({
      success: true,
      data: {
        caja: cajaActual,
        total_efectivo,
        total_tarjeta,
        total_transferencia,
        total_ventas,
total_ventas,
        total_cambios,
        cantidad_facturas,
        efectivo_esperado
      }
    });
  } catch (err) {
    console.error('Error en resumen de caja:', err);
    res.status(500).json({ success: false, mensaje: 'Error consultando resumen de caja' });
  }
});

// POST /pos/caja/cerrar - Cerrar caja con cuadre
router.post('/caja/cerrar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desglose_efectivo, efectivo_contado } = req.body;

    const caja = await pool.query(
              `SELECT * FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' AND operador_id IS NOT DISTINCT FROM $2 ORDER BY fecha_apertura DESC LIMIT 1`,
      [tenant_id, idCajero(req)]
    );
    if (caja.rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay caja abierta' });
    }
    const cajaActual = caja.rows[0];

  const { total_efectivo, total_tarjeta, total_transferencia, total_ventas, cantidad_facturas, total_cambios } =
           await calcularTotalesTurno(tenant_id, cajaActual.fecha_apertura, cajaActual.id);
    const efectivo_esperado = parseFloat(cajaActual.monto_apertura) + total_efectivo;

    // Cuadre de efectivo: lo que el cajero contó físicamente vs lo esperado
    const contado = (efectivo_contado === undefined || efectivo_contado === null || isNaN(parseFloat(efectivo_contado)))
      ? null
      : parseFloat(efectivo_contado);
    const diferencia = contado === null ? null : (contado - efectivo_esperado);

    const result = await pool.query(
      `UPDATE cajas SET
        fecha_cierre = NOW(),
        total_efectivo = $1,
        total_tarjeta = $2,
        total_transferencia = $3,
        total_ventas = $4,
        cantidad_facturas = $5,
        efectivo_esperado = $6,
        desglose_efectivo = $7,
        efectivo_contado = $8,
        diferencia = $9,
        estado = 'cerrada'
       WHERE id = $10 RETURNING *`,
      [total_efectivo, total_tarjeta, total_transferencia, total_ventas, cantidad_facturas, efectivo_esperado,
       desglose_efectivo ? JSON.stringify(desglose_efectivo) : null, contado, diferencia, cajaActual.id]
    );

    logActividad(req, 'pos', 'cerrar_caja', `Cerró caja. Ventas: RD$ ${total_ventas.toFixed(2)} (${cantidad_facturas} facturas)`, cajaActual.id);

 res.json({ success: true, data: { ...result.rows[0], total_cambios } });
  } catch (err) {
    console.error('Error cerrando caja:', err);
    res.status(500).json({ success: false, mensaje: 'Error cerrando caja' });
  }
});

// POST /pos/pagos - Registrar el desglose de pago de una factura (mixto o simple)
router.post('/pagos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { invoice_id, pagos } = req.body;

    if (!invoice_id) {
      return res.status(400).json({ success: false, mensaje: 'invoice_id es requerido' });
    }
    if (!Array.isArray(pagos) || pagos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Debe enviar al menos un pago' });
    }

    const VALIDOS = ['efectivo', 'tarjeta', 'transferencia'];
    for (const p of pagos) {
      if (!VALIDOS.includes(p.metodo)) {
        return res.status(400).json({ success: false, mensaje: `Método de pago inválido: ${p.metodo}` });
      }
      if (isNaN(parseFloat(p.monto)) || parseFloat(p.monto) <= 0) {
        return res.status(400).json({ success: false, mensaje: 'Los montos deben ser mayores a 0' });
      }
    }

    // Idempotencia: si ya existen pagos de esa factura, se reemplazan
    await pool.query(`DELETE FROM pos_pagos WHERE invoice_id = $1 AND tenant_id = $2`, [invoice_id, tenant_id]);

    for (const p of pagos) {
      await pool.query(
        `INSERT INTO pos_pagos (tenant_id, invoice_id, metodo, monto) VALUES ($1, $2, $3, $4)`,
        [tenant_id, invoice_id, p.metodo, parseFloat(p.monto)]
      );
    }

    res.json({ success: true, mensaje: 'Pagos registrados' });
  } catch (err) {
    console.error('Error registrando pagos POS:', err);
    res.status(500).json({ success: false, mensaje: 'Error registrando pagos' });
  }
});

// GET /pos/caja/historial - Historial de cajas cerradas del tenant
router.get('/caja/historial', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM cajas
       WHERE tenant_id = $1 AND estado = 'cerrada'
       ORDER BY fecha_cierre DESC
       LIMIT 50`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Error consultando historial de cajas:', err);
    res.status(500).json({ success: false, mensaje: 'Error consultando historial de cajas' });
  }
});

// GET /pos/consulta-rnc/:rnc - Consultar RNC/Cédula en el padrón LOCAL de la DGII
router.get('/consulta-rnc/:rnc', verifyToken, tenantGuard, async (req, res) => {
  try {
    const rnc = String(req.params.rnc || '').replace(/\D/g, '');
    if (rnc.length !== 9 && rnc.length !== 11) {
      return res.status(400).json({ success: false, mensaje: 'El RNC debe tener 9 dígitos o la cédula 11 dígitos' });
    }

    const result = await pool.query(
      `SELECT rnc, nombre, nombre_comercial, estado FROM padron_rnc WHERE rnc = $1 LIMIT 1`,
      [rnc]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null, mensaje: 'RNC no encontrado en el padrón de la DGII' });
    }

    const c = result.rows[0];
    res.json({
      success: true,
      data: {
        rnc: c.rnc,
        nombre: c.nombre || '',
        nombre_comercial: c.nombre_comercial || '',
        estado: c.estado || '',
        categoria: ''
      }
    });
  } catch (err) {
    console.error('Error consultando padrón RNC:', err.message);
    res.status(500).json({ success: false, mensaje: 'Error consultando el padrón' });
  }
});

module.exports = router;