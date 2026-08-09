const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Reporte de ventas por período
router.get('/ventas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desde, hasta } = req.query;

    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_facturas,
        COUNT(CASE WHEN estado = 'emitida' THEN 1 END) as emitidas,
        COUNT(CASE WHEN estado = 'pagada' THEN 1 END) as pagadas,
        COUNT(CASE WHEN estado = 'anulada' THEN 1 END) as anuladas,
        COALESCE(SUM(subtotal - COALESCE((SELECT SUM(nc.subtotal) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0)), 0) as total_subtotal,
        COALESCE(SUM(itbis - COALESCE((SELECT SUM(nc.itbis) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0)), 0) as total_itbis,
        COALESCE(SUM(total - COALESCE((SELECT SUM(nc.total) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0)), 0) as total_ventas
       FROM invoices i
       WHERE tenant_id = $1
       AND estado IN ('emitida', 'pagada')
       AND ($2::date IS NULL OR (fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $2::date)
       AND ($3::date IS NULL OR (fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $3::date)`,
      [tenant_id, desde || null, hasta || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Reporte de ITBIS
router.get('/itbis', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desde, hasta } = req.query;

    const result = await pool.query(
      `SELECT 
       DATE_TRUNC('month', fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo') as mes,
        COUNT(*) as total_facturas,
        COALESCE(SUM(subtotal - COALESCE((SELECT SUM(nc.subtotal) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0)), 0) as total_subtotal,
        COALESCE(SUM(itbis - COALESCE((SELECT SUM(nc.itbis) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0)), 0) as total_itbis,
        COALESCE(SUM(total - COALESCE((SELECT SUM(nc.total) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0)), 0) as total_con_itbis
       FROM invoices i
       WHERE tenant_id = $1
       AND estado IN ('emitida', 'pagada')
       AND fecha_emision IS NOT NULL
       AND ($2::date IS NULL OR (fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date >= $2::date)
       AND ($3::date IS NULL OR (fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')::date <= $3::date)
       GROUP BY DATE_TRUNC('month', fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')
       ORDER BY mes DESC`,
      [tenant_id, desde || null, hasta || null]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Reporte por cliente
router.get('/clientes', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const result = await pool.query(
      `SELECT 
        c.id,
        c.nombre,
        c.rnc_cedula,
        COUNT(i.id) as total_facturas,
        COALESCE(SUM(CASE WHEN i.estado != 'anulada' THEN i.total END), 0) as total_facturado,
        COALESCE(SUM(CASE WHEN i.estado = 'pagada' THEN i.total END), 0) as total_pagado,
        COALESCE(SUM(CASE WHEN i.estado = 'emitida' THEN i.total END), 0) as total_pendiente
     FROM customers c
       LEFT JOIN invoices i ON c.id = i.customer_id AND i.estado IN ('emitida', 'pagada')
       WHERE c.tenant_id = $1
       GROUP BY c.id, c.nombre, c.rnc_cedula
       ORDER BY total_facturado DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Reporte 607 - Ventas del mes con NCF (formato DGII)
router.get('/reporte-607', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { mes, anio } = req.query;
    if (!mes || !anio) return res.status(400).json({ success: false, mensaje: 'Mes y año son requeridos' });

    const result = await pool.query(
      `SELECT i.id, i.ncf, i.estado, i.subtotal, i.itbis, i.total, i.fecha_emision, i.creado_en,
              i.numero_factura,
              c.nombre as cliente_nombre, c.rnc_cedula,
              fm.ncf as ncf_modificado
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       LEFT JOIN invoices fm ON i.referencia_id = fm.id
       WHERE i.tenant_id = $1
       AND i.estado IN ('emitida', 'pagada', 'anulada', 'nota_credito')
       AND EXTRACT(MONTH FROM COALESCE(i.fecha_emision, i.creado_en) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo') = $2
       AND EXTRACT(YEAR FROM COALESCE(i.fecha_emision, i.creado_en) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo') = $3
       ORDER BY COALESCE(i.fecha_emision, i.creado_en) ASC`,
      [tenant_id, parseInt(mes), parseInt(anio)]
    );

    const incluidas = result.rows.filter(f => f.ncf);
    const sin_ncf = result.rows.filter(f => !f.ncf && f.estado !== 'anulada');
    res.json({ success: true, data: { incluidas, sin_ncf } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Dashboard resumen del día y mes
router.get('/dashboard', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    // Resumen del día
const hoy = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE estado NOT IN ('nota_credito', 'cotizacion', 'borrador', 'anulada', 'pedido')) as facturas_hoy,
        COALESCE(SUM(CASE WHEN estado NOT IN ('anulada', 'nota_credito', 'cotizacion', 'borrador', 'pedido') THEN total - COALESCE((SELECT SUM(nc.total) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0) END), 0) as ventas_hoy
  FROM invoices i
       WHERE tenant_id = $1
       AND DATE(creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo') = DATE(NOW() AT TIME ZONE 'America/Santo_Domingo')`,
      [tenant_id]
    );
    // Conduces emitidos hoy (no facturados)
    const conducesHoy = await pool.query(
      `SELECT COUNT(*) as cantidad, COALESCE(SUM(total), 0) as total_conduces
       FROM conduces
       WHERE tenant_id = $1
         AND estado = 'emitido'
         AND COALESCE(facturado, false) = false
         AND DATE(creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo') = DATE(NOW() AT TIME ZONE 'America/Santo_Domingo')`,
      [tenant_id]
    );
    hoy.rows[0].facturas_hoy = parseInt(hoy.rows[0].facturas_hoy || 0) + parseInt(conducesHoy.rows[0].cantidad || 0);
    hoy.rows[0].ventas_hoy = parseFloat(hoy.rows[0].ventas_hoy || 0) + parseFloat(conducesHoy.rows[0].total_conduces || 0);
    // Cobrado hoy desde payments (pagos confirmados de hoy, hora RD)
    const cobradoHoy = await pool.query(
  `SELECT COALESCE(SUM(monto), 0) as cobrado_hoy
       FROM payments
       WHERE tenant_id = $1
       AND estado = 'confirmado'
       AND DATE(creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo') = DATE(NOW() AT TIME ZONE 'America/Santo_Domingo')`,
      [tenant_id]
    );
    // Cobrado hoy desde el Punto de Venta (tabla pos_pagos)
    const cobradoPosHoy = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) as cobrado_pos
       FROM pos_pagos
       WHERE tenant_id = $1
       AND DATE(creado_en AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo') = DATE(NOW() AT TIME ZONE 'America/Santo_Domingo')`,
      [tenant_id]
    );
    cobradoHoy.rows[0].cobrado_hoy = parseFloat(cobradoHoy.rows[0].cobrado_hoy || 0) + parseFloat(cobradoPosHoy.rows[0].cobrado_pos || 0);

    // Resumen del mes
    const mes = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE estado NOT IN ('nota_credito', 'cotizacion', 'borrador', 'anulada', 'pedido')) as facturas_mes,
        COALESCE(SUM(CASE WHEN estado NOT IN ('anulada', 'nota_credito', 'cotizacion', 'borrador', 'pedido') THEN total - COALESCE((SELECT SUM(nc.total) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0) END), 0) as ventas_mes,
        COALESCE(SUM(CASE WHEN estado = 'pagada' THEN total - COALESCE((SELECT SUM(nc.total) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0) END), 0) as cobrado_mes,
        COALESCE(SUM(CASE WHEN estado NOT IN ('anulada', 'nota_credito', 'cotizacion', 'borrador', 'pedido') THEN total - COALESCE((SELECT SUM(nc.total) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0) END), 0) - COALESCE(SUM(CASE WHEN estado = 'pagada' THEN total - COALESCE((SELECT SUM(nc.total) FROM invoices nc WHERE nc.referencia_id = i.id AND nc.estado = 'nota_credito' AND nc.tenant_id = i.tenant_id), 0) END), 0) as pendiente_mes
    FROM invoices i
       WHERE tenant_id = $1
       AND DATE_TRUNC('month', creado_en) = DATE_TRUNC('month', CURRENT_DATE)`,
      [tenant_id]
    );
    // Conduces del mes (emitidos, no facturados) + pagos confirmados de conduces
    const conducesMes = await pool.query(
      `SELECT COUNT(*) as cantidad,
              COALESCE(SUM(cd.total), 0) as total_conduces,
              COALESCE((SELECT SUM(p.monto) FROM payments p
                        JOIN conduces c2 ON c2.id = p.conduce_id
                        WHERE c2.tenant_id = $1 AND p.estado = 'confirmado'
                          AND DATE_TRUNC('month', c2.creado_en) = DATE_TRUNC('month', CURRENT_DATE)), 0) as cobrado_conduces
       FROM conduces cd
       WHERE cd.tenant_id = $1
         AND cd.estado = 'emitido'
         AND COALESCE(cd.facturado, false) = false
         AND DATE_TRUNC('month', cd.creado_en) = DATE_TRUNC('month', CURRENT_DATE)`,
      [tenant_id]
    );
mes.rows[0].facturas_mes = parseInt(mes.rows[0].facturas_mes || 0) + parseInt(conducesMes.rows[0].cantidad || 0);
    mes.rows[0].ventas_mes = parseFloat(mes.rows[0].ventas_mes || 0) + parseFloat(conducesMes.rows[0].total_conduces || 0);
    mes.rows[0].cobrado_mes = parseFloat(mes.rows[0].cobrado_mes || 0) + parseFloat(conducesMes.rows[0].cobrado_conduces || 0);
    // Sumar cobros POS solo si no estan ya contados como factura pagada
    const cobradoPosNoDuplicado = await pool.query(
      `SELECT COALESCE(SUM(pp.monto), 0) as monto
       FROM pos_pagos pp
       JOIN invoices i2 ON i2.id = pp.invoice_id
       WHERE pp.tenant_id = $1
         AND i2.estado NOT IN ('anulada', 'nota_credito', 'cotizacion', 'borrador', 'pedido', 'pagada')
         AND DATE_TRUNC('month', pp.creado_en) = DATE_TRUNC('month', CURRENT_DATE)`,
      [tenant_id]
    );
    mes.rows[0].cobrado_mes = parseFloat(mes.rows[0].cobrado_mes) + parseFloat(cobradoPosNoDuplicado.rows[0].monto || 0);
    mes.rows[0].pendiente_mes = parseFloat(mes.rows[0].ventas_mes) - parseFloat(mes.rows[0].cobrado_mes);
    // Últimas 5 facturas
    const ultimas = await pool.query(
      `SELECT i.id, i.ncf, i.estado, i.total, i.creado_en, c.nombre as cliente_nombre
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.tenant_id = $1
       AND i.estado NOT IN ('nota_credito', 'cotizacion', 'borrador', 'pedido')
       ORDER BY i.creado_en DESC
       LIMIT 5`,
      [tenant_id]
    );

res.json({
      success: true,
      data: {
        hoy: { ...hoy.rows[0], cobrado_hoy: cobradoHoy.rows[0].cobrado_hoy },
        mes: mes.rows[0],
        ultimas_facturas: ultimas.rows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;