const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');
const logActividad = require('../utils/logActividad');

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
async function calcularTotalesTurno(tenant_id, fechaApertura) {
  const ventas = await pool.query(
    `SELECT id, notas, total FROM invoices
     WHERE tenant_id = $1
       AND estado IN ('emitida', 'pagada')
       AND notas LIKE 'POS - Pago:%'
       AND fecha_emision >= $2`,
    [tenant_id, fechaApertura]
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

  return {
    total_efectivo,
    total_tarjeta,
    total_transferencia,
    total_ventas: total_efectivo + total_tarjeta + total_transferencia,
    cantidad_facturas: ventas.rows.length
  };
}

// GET /pos/caja/actual - Consultar si hay caja abierta
router.get('/caja/actual', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    console.error('Error consultando caja:', err);
    res.status(500).json({ success: false, mensaje: 'Error consultando caja' });
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
      `SELECT id FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' LIMIT 1`,
      [tenant_id]
    );
    if (abierta.rows.length > 0) {
      return res.status(400).json({ success: false, mensaje: 'Ya existe una caja abierta. Debe cerrarla antes de abrir otra.' });
    }

    const result = await pool.query(
      `INSERT INTO cajas (tenant_id, usuario_nombre, operador_id, monto_apertura, fecha_apertura, estado)
       VALUES ($1, $2, $3, $4, NOW(), 'abierta') RETURNING *`,
      [tenant_id, usuario_nombre || null, req.user.operador_id || null, parseFloat(monto_apertura)]
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
      `SELECT * FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [tenant_id]
    );
    if (caja.rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay caja abierta' });
    }
    const cajaActual = caja.rows[0];

    const { total_efectivo, total_tarjeta, total_transferencia, total_ventas, cantidad_facturas } =
      await calcularTotalesTurno(tenant_id, cajaActual.fecha_apertura);
    const efectivo_esperado = parseFloat(cajaActual.monto_apertura) + total_efectivo;

    res.json({
      success: true,
      data: {
        caja: cajaActual,
        total_efectivo,
        total_tarjeta,
        total_transferencia,
        total_ventas,
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
      `SELECT * FROM cajas WHERE tenant_id = $1 AND estado = 'abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [tenant_id]
    );
    if (caja.rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay caja abierta' });
    }
    const cajaActual = caja.rows[0];

    const { total_efectivo, total_tarjeta, total_transferencia, total_ventas, cantidad_facturas } =
      await calcularTotalesTurno(tenant_id, cajaActual.fecha_apertura);
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

    res.json({ success: true, data: result.rows[0] });
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