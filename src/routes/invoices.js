const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');
const { obtenerProximoNCFElectronico } = require('../helpers/ncfElectronico');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const { obtenerProximoNumeroFactura } = require('../helpers/numeroFactura');

router.get('/items/todos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT ii.invoice_id, ii.product_id, ii.descripcion, ii.cantidad, 
              ii.precio_unitario, ii.subtotal, ii.total,
              COALESCE(p.comision_vendedor, 0) as comision_vendedor
       FROM invoice_items ii
       LEFT JOIN products p ON ii.product_id = p.id
       INNER JOIN invoices i ON ii.invoice_id = i.id
       WHERE i.tenant_id = $1`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

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

router.get('/reporte/productos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { fecha_inicio, fecha_fin, vendedor_id, customer_id, producto } = req.query;
    const result = await pool.query(`
      SELECT 
        ii.descripcion,
        SUM(ii.cantidad) as total_cantidad,
        ii.precio_unitario,
        SUM(ii.subtotal) as total_subtotal,
        SUM(ii.itbis_monto) as total_itbis,
        SUM(ii.total) as total_venta,
        COALESCE(SUM(ii.cantidad * COALESCE(p.costo, 0)), 0) as total_costo,
        SUM(ii.subtotal) - COALESCE(SUM(ii.cantidad * COALESCE(p.costo, 0)), 0) as beneficio
      FROM invoices i
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      LEFT JOIN products p ON p.id = ii.product_id
      LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = $1
        AND i.estado != 'anulada'
        AND ($2::date IS NULL OR i.creado_en::date >= $2::date)
        AND ($3::date IS NULL OR i.creado_en::date <= $3::date)
        AND ($4::uuid IS NULL OR c.vendedor_id = $4::uuid)
        AND ($5::uuid IS NULL OR i.customer_id = $5::uuid)
        AND ($6::text IS NULL OR ii.descripcion ILIKE $6::text)
      GROUP BY ii.descripcion, ii.precio_unitario
      ORDER BY total_venta DESC
    `, [tenant_id, fecha_inicio || null, fecha_fin || null, vendedor_id || null, customer_id || null, producto ? `%${producto}%` : null]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.get('/reporte/resumen', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { fecha_inicio, fecha_fin } = req.query;
    const result = await pool.query(`
      SELECT 
        COALESCE(SUM(i.subtotal), 0) as total_subtotal,
        COALESCE(SUM(i.itbis), 0) as total_itbis,
        COALESCE(SUM(i.total), 0) as total_ventas,
        COALESCE(SUM(ii.cantidad * COALESCE(p.costo, 0)), 0) as total_costo
      FROM invoices i
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE i.tenant_id = $1
        AND i.estado != 'anulada'
        AND ($2::date IS NULL OR i.creado_en::date >= $2::date)
        AND ($3::date IS NULL OR i.creado_en::date <= $3::date)
    `, [tenant_id, fecha_inicio || null, fecha_fin || null]);
    const row = result.rows[0];
    const beneficio = parseFloat(row.total_subtotal) - parseFloat(row.total_costo);
    res.json({ success: true, data: {
      total_subtotal: parseFloat(row.total_subtotal),
      total_itbis: parseFloat(row.total_itbis),
      total_ventas: parseFloat(row.total_ventas),
      total_costo: parseFloat(row.total_costo),
      beneficio_neto: beneficio
    }});
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.get('/pedidos/lista', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { vendedor_id, fecha_inicio, fecha_fin } = req.query;
    let query, params;
    if (vendedor_id) {
      query = `SELECT i.*, c.nombre as cliente_nombre
               FROM invoices i
               INNER JOIN customers c ON i.customer_id = c.id
               WHERE i.tenant_id = $1 AND i.estado = 'pedido'
                 AND c.vendedor_id = $2::uuid
                 AND ($3::date IS NULL OR i.creado_en::date >= $3::date)
                 AND ($4::date IS NULL OR i.creado_en::date <= $4::date)
               ORDER BY i.creado_en DESC`;
      params = [tenant_id, vendedor_id, fecha_inicio || null, fecha_fin || null];
    } else {
      query = `SELECT i.*, c.nombre as cliente_nombre
               FROM invoices i
               LEFT JOIN customers c ON i.customer_id = c.id
               WHERE i.tenant_id = $1 AND i.estado = 'pedido'
                 AND ($2::date IS NULL OR i.creado_en::date >= $2::date)
                 AND ($3::date IS NULL OR i.creado_en::date <= $3::date)
               ORDER BY i.creado_en DESC`;
      params = [tenant_id, fecha_inicio || null, fecha_fin || null];
    }
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.post('/pedido', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { customer_id, items, notas } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'El pedido debe tener al menos un item' });
    }
    await client.query('BEGIN');
    let subtotal = 0, itbis = 0;
    for (const item of items) {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      subtotal += s;
      itbis += s * (parseFloat(item.itbis_rate || 0) / 100);
    }
    const total = subtotal + itbis;
    const pedido = await client.query(
      `INSERT INTO invoices (tenant_id, customer_id, ncf_tipo, estado, subtotal, itbis, total, notas, fecha_emision)
       VALUES ($1, $2, 'B01', 'pedido', $3, $4, $5, $6, NOW()) RETURNING *`,
      [tenant_id, customer_id || null, subtotal, itbis, total, notas || null]
    );
    const pedido_id = pedido.rows[0].id;
    for (const item of items) {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      const item_itbis = s * (parseFloat(item.itbis_rate || 0) / 100);
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate, itbis_monto, subtotal, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [pedido_id, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario,
         item.itbis_rate || 0, item_itbis, s, s + item_itbis]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: pedido.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

router.put('/pedido/:id/editar', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect()
  try {
    const { tenant_id } = req.user
    const { id } = req.params
    const { customer_id, items } = req.body
    await client.query('BEGIN')
    const pedido = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 AND estado = 'pedido'`,
      [id, tenant_id]
    )
    if (!pedido.rows[0]) return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado' })
    let subtotal = 0, itbis_total = 0
    items.forEach(item => {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario)
      subtotal += s
      itbis_total += s * (parseFloat(item.itbis_rate || 0) / 100)
    })
    const total = subtotal + itbis_total
    await client.query(
      `UPDATE invoices SET customer_id=$1, subtotal=$2, itbis=$3, total=$4, actualizado_en=NOW() WHERE id=$5`,
      [customer_id || null, subtotal, itbis_total, total, id]
    )
    await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id])
    for (const item of items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario,
         item.itbis_rate || 0, parseFloat(item.cantidad) * parseFloat(item.precio_unitario)]
      )
    }
    await client.query('COMMIT')
    res.json({ success: true, mensaje: 'Pedido actualizado' })
  } catch (error) {
    await client.query('ROLLBACK')
    res.status(500).json({ success: false, mensaje: error.message })
  } finally {
    client.release()
  }
})

router.put('/pedido/:id/convertir', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await client.query('BEGIN');
    const pedido = await client.query(
      `SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2 AND estado='pedido'`,
      [id, tenant_id]
    );
    if (!pedido.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado' });
    }
    let seq = await client.query(
      `SELECT * FROM ncf_sequences WHERE tenant_id=$1 AND tipo='B01' AND estado='activo'`, [tenant_id]
    );
    if (seq.rows.length === 0) {
      await client.query(
        `INSERT INTO ncf_sequences (tenant_id, tipo, prefijo, secuencia_actual, secuencia_max) VALUES ($1,'B01','B01',0,9999999)`,
        [tenant_id]
      );
      seq = await client.query(`SELECT * FROM ncf_sequences WHERE tenant_id=$1 AND tipo='B01'`, [tenant_id]);
    }
    const nueva_sec = seq.rows[0].secuencia_actual + 1;
    await client.query(`UPDATE ncf_sequences SET secuencia_actual=$1 WHERE id=$2`, [nueva_sec, seq.rows[0].id]);
    const ncf = `B01${String(nueva_sec).padStart(8,'0')}`;
    const items = await client.query(`SELECT * FROM invoice_items WHERE invoice_id=$1`, [id]);
    for (const item of items.rows) {
      if (!item.product_id) continue;
      const inv = await client.query(
        'SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2',
        [item.product_id, tenant_id]
      );
      if (inv.rows.length > 0) {
        const stockNuevo = parseFloat(inv.rows[0].stock_actual) - parseFloat(item.cantidad);
        await client.query('UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2',
          [stockNuevo, inv.rows[0].id]);
        await client.query(
          `INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo)
           VALUES ($1,$2,'salida',$3,$4,$5,$6)`,
          [tenant_id, inv.rows[0].id, item.cantidad, inv.rows[0].stock_actual, stockNuevo, `Factura ${ncf} (Pedido)`]
        );
      }
    }
    const numero_factura = await obtenerProximoNumeroFactura(client, tenant_id);
    const updated = await client.query(
      `UPDATE invoices SET estado='emitida', ncf=$1, ncf_tipo='B01', fecha_emision=NOW(), actualizado_en=NOW(), numero_factura=$3
       WHERE id=$2 RETURNING *`,
      [ncf, id, numero_factura]
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

router.get('/nota-credito/lista', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT i.*, c.nombre as cliente_nombre
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.tenant_id = $1 AND i.estado = 'nota_credito'
       ORDER BY i.creado_en DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.post('/nota-credito', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { factura_id, items, motivo } = req.body;
    if (!factura_id || !items || items.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Datos incompletos' });
    }
    await client.query('BEGIN');
    const facturaOrig = await client.query(
      `SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2 AND estado='emitida'`,
      [factura_id, tenant_id]
    );
    if (!facturaOrig.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Factura no encontrada o no emitida' });
    }
    let seq = await client.query(
      `SELECT * FROM ncf_sequences WHERE tenant_id=$1 AND tipo='NC' AND estado='activo'`, [tenant_id]
    );
    if (seq.rows.length === 0) {
      await client.query(
        `INSERT INTO ncf_sequences (tenant_id, tipo, prefijo, secuencia_actual, secuencia_max) VALUES ($1,'NC','NC',0,9999999)`,
        [tenant_id]
      );
      seq = await client.query(`SELECT * FROM ncf_sequences WHERE tenant_id=$1 AND tipo='NC'`, [tenant_id]);
    }
    const nueva_sec = seq.rows[0].secuencia_actual + 1;
    await client.query(`UPDATE ncf_sequences SET secuencia_actual=$1 WHERE id=$2`, [nueva_sec, seq.rows[0].id]);
    const nc_numero = `NC${String(nueva_sec).padStart(8,'0')}`;
    let subtotal = 0, itbis = 0;
    for (const item of items) {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      subtotal += s;
      itbis += s * (parseFloat(item.itbis_rate || 0) / 100);
    }
    const total = subtotal + itbis;
    const numero_factura = await obtenerProximoNumeroFactura(client, tenant_id);
    const nota = await client.query(
      `INSERT INTO invoices (tenant_id, customer_id, ncf_tipo, ncf, estado, subtotal, itbis, total, notas, fecha_emision, referencia_id, numero_factura)
       VALUES ($1, $2, 'NC', $3, 'nota_credito', $4, $5, $6, $7, NOW(), $8, $9) RETURNING *`,
      [tenant_id, facturaOrig.rows[0].customer_id, nc_numero, subtotal, itbis, total,
       motivo || `Nota de crédito por factura ${facturaOrig.rows[0].ncf}`, factura_id, numero_factura]
    );
    const nota_id = nota.rows[0].id;
    for (const item of items) {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      const item_itbis = s * (parseFloat(item.itbis_rate || 0) / 100);
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate, itbis_monto, subtotal, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [nota_id, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario,
         item.itbis_rate || 0, item_itbis, s, s + item_itbis]
      );
      if (item.product_id) {
        const inv = await client.query(
          'SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2',
          [item.product_id, tenant_id]
        );
        if (inv.rows.length > 0) {
          const stockNuevo = parseFloat(inv.rows[0].stock_actual) + parseFloat(item.cantidad);
          await client.query(
            'UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2',
            [stockNuevo, inv.rows[0].id]
          );
          await client.query(
            `INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo)
             VALUES ($1,$2,'entrada',$3,$4,$5,$6)`,
            [tenant_id, inv.rows[0].id, item.cantidad, inv.rows[0].stock_actual, stockNuevo,
             `Nota de crédito ${nc_numero}`]
          );
        }
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: nota.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

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
    const items = await pool.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [id]);
    res.json({ success: true, data: { ...invoice.rows[0], items: items.rows } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

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
    let ncf;
    let codigo_seguridad = null;
    let fecha_vencimiento_encf = null;
    if (['E31', 'E32', 'E34'].includes(ncf_tipo)) {
      const encfResult = await obtenerProximoNCFElectronico(tenant_id, ncf_tipo);
      ncf = encfResult.ncf;
      codigo_seguridad = encfResult.codigo_seguridad;
      fecha_vencimiento_encf = encfResult.fecha_vencimiento;
    } else {
      const tipoTradicional = ncf_tipo || 'B01';
      const secuenciaNueva = await client.query(
        `SELECT id FROM ncf_secuencias_electronicas
         WHERE tenant_id = $1 AND tipo_ncf = $2 AND activo = true
           AND secuencia_actual <= secuencia_hasta
         LIMIT 1`,
        [tenant_id, tipoTradicional]
      );
      if (secuenciaNueva.rows.length > 0) {
        const resultado = await obtenerProximoNCFElectronico(tenant_id, tipoTradicional);
        ncf = resultado.ncf;
      } else {
        let seq = await client.query(
          `SELECT * FROM ncf_sequences WHERE tenant_id = $1 AND tipo = $2 AND estado = 'activo'`,
          [tenant_id, tipoTradicional]
        );
        if (seq.rows.length === 0) {
          await client.query(
            `INSERT INTO ncf_sequences (tenant_id, tipo, prefijo, secuencia_actual, secuencia_max)
             VALUES ($1, $2, $3, 0, 9999999)`,
            [tenant_id, tipoTradicional, tipoTradicional]
          );
          seq = await client.query(
            `SELECT * FROM ncf_sequences WHERE tenant_id = $1 AND tipo = $2`,
            [tenant_id, tipoTradicional]
          );
        }
        const nueva_secuencia = seq.rows[0].secuencia_actual + 1;
        await client.query(
          `UPDATE ncf_sequences SET secuencia_actual = $1 WHERE id = $2`,
          [nueva_secuencia, seq.rows[0].id]
        );
        ncf = `${tipoTradicional}${String(nueva_secuencia).padStart(8, '0')}`;
      }
    }
    const numero_factura = await obtenerProximoNumeroFactura(client, tenant_id);
    const invoice = await client.query(
      `INSERT INTO invoices (tenant_id, customer_id, ncf_tipo, ncf, estado, subtotal, itbis, total, notas, fecha_vencimiento, fecha_emision, codigo_seguridad, fecha_vencimiento_encf, fecha_firma_digital, numero_factura)
       VALUES ($1, $2, $3, $4, 'emitida', $5, $6, $7, $8, $9, NOW(), $10, $11, $12, $13) RETURNING *`,
      [tenant_id, customer_id || null, ncf_tipo || 'B01', ncf, subtotal, itbis, total, notas || null, fecha_vencimiento || null, codigo_seguridad, fecha_vencimiento_encf, codigo_seguridad ? new Date() : null, numero_factura]
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

// PDF POS - SIN TOCAR
router.get('/:id/pdf-pos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const invoice = await pool.query(
      `SELECT i.*, c.nombre as cliente_nombre, c.rnc_cedula, c.telefono as cliente_telefono,
              c.direccion as cliente_direccion,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.telefono as empresa_telefono,
              t.direccion as empresa_direccion,
              v.nombre as vendedor_nombre
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       LEFT JOIN tenants t ON i.tenant_id = t.id
       LEFT JOIN vendedores v ON c.vendedor_id = v.id
       WHERE i.id=$1 AND i.tenant_id=$2`,
      [id, tenant_id]
    );
    if (invoice.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });
    }
    const items = await pool.query(`SELECT * FROM invoice_items WHERE invoice_id=$1`, [id]);
    const data = invoice.rows[0];
    const PDFDocument = require('pdfkit');
    const esElectronica = ['E31', 'E32', 'E34'].includes(data.ncf_tipo);
    const tituloDocumento = {
      'E31': 'FACTURA CREDITO FISCAL ELECTRONICA',
      'E32': 'FACTURA DE CONSUMO ELECTRONICA',
      'E34': 'NOTA DE CREDITO ELECTRONICA'
    }[data.ncf_tipo] || 'FACTURA';
    const W = 200;
    const M = 8;
    const doc = new PDFDocument({ margin: M, size: [W, 1100] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=ticket-${data.ncf || data.id}.pdf`);
    doc.pipe(res);
    let y = 10;
    const cw = W - (M * 2);
    const centrado = (texto, fontSize, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      doc.text(texto, M, y, { width: cw, align: 'center' });
      y += fontSize + 3;
    };
    const izquierda = (texto, fontSize, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      doc.text(texto, M, y, { width: cw });
      y += fontSize + 3;
    };
    const lineaGuiones = () => {
      doc.font('Helvetica').fontSize(7);
      doc.text('-'.repeat(35), M, y, { width: cw, align: 'center' });
      y += 8;
    };
    const filaLR = (izq, der, fontSize, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      const halfW = cw / 2;
      doc.text(izq, M, y, { width: halfW, align: 'left' });
      doc.text(der, M + halfW, y, { width: halfW, align: 'right' });
      y += fontSize + 4;
    };
    centrado(data.empresa_nombre || 'EMPRESA', 16, true);
    y += 2;
    if (data.empresa_rnc) izquierda(`RNC: ${data.empresa_rnc}`, 8);
    if (data.empresa_telefono) izquierda(`Tel: ${data.empresa_telefono}`, 8);
    if (data.empresa_direccion) izquierda(data.empresa_direccion, 8);
    y += 4;
    lineaGuiones();
    centrado(tituloDocumento, esElectronica ? 8 : 10, true);
    y += 2;
    if (data.ncf) {
      izquierda(`NCF: ${data.ncf}`, 8, true);
    }
    const fecha = new Date(data.creado_en).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
    izquierda(`Fecha: ${fecha}`, 8);
    if (data.vendedor_nombre) {
      izquierda(`Vendedor: ${data.vendedor_nombre}`, 8);
    }
    y += 4;
    lineaGuiones();
    izquierda(`Cliente: ${data.cliente_nombre || 'Consumidor Final'}`, 8, true);
    if (data.rnc_cedula) {
      izquierda(`RNC/Ced: ${data.rnc_cedula}`, 8);
    }
    if (data.cliente_telefono) {
      izquierda(`Tel: ${data.cliente_telefono}`, 8);
    }
    y += 4;
    lineaGuiones();
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPCION', M, y, { width: cw / 2, align: 'left' });
    doc.text('VALOR', M + cw / 2, y, { width: cw / 2, align: 'right' });
    y += 11;
    lineaGuiones();
    items.rows.forEach(it => {
      const cant = parseFloat(it.cantidad);
      const precio = parseFloat(it.precio_unitario);
      const subtotalItem = cant * precio;
      doc.font('Helvetica').fontSize(8);
      doc.text(it.descripcion, M, y, { width: cw });
      y += 11;
      filaLR(
        `${cant.toFixed(2)} x ${precio.toLocaleString('es-DO', {minimumFractionDigits: 2})}`,
        subtotalItem.toLocaleString('es-DO', {minimumFractionDigits: 2}),
        8
      );
      y += 2;
    });
    y += 2;
    lineaGuiones();
    filaLR('SUBTOTAL', parseFloat(data.subtotal).toLocaleString('es-DO', {minimumFractionDigits: 2}), 9);
    filaLR('ITBIS', parseFloat(data.itbis).toLocaleString('es-DO', {minimumFractionDigits: 2}), 9);
    y += 3;
    filaLR('TOTAL A PAGAR', parseFloat(data.total).toLocaleString('es-DO', {minimumFractionDigits: 2}), 11, true);
    y += 5;
    lineaGuiones();
    if (data.numero_factura) {
      y += 2;
      const numeroFormateado = String(data.numero_factura).padStart(8, '0');
      izquierda(`Factura No.: ${numeroFormateado}`, 9, true);
      y += 3;
      lineaGuiones();
    }
    if (esElectronica) {
      y += 4;
      const qrData = `https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=${data.empresa_rnc || ''}&ENCF=${data.ncf || ''}&MontoTotal=${parseFloat(data.total).toFixed(2)}&FechaEmision=${data.fecha_emision ? new Date(data.fecha_emision).toISOString().split('T')[0] : ''}&CodigoSeguridad=${data.codigo_seguridad || ''}`;
      try {
        const qrPng = await QRCode.toBuffer(qrData, { width: 200, margin: 1 });
        const qrSize = 100;
        const qrX = (W - qrSize) / 2;
        doc.image(qrPng, qrX, y, { width: qrSize, height: qrSize });
        y += qrSize + 6;
        if (data.codigo_seguridad) {
          centrado(`Codigo de seguridad: ${data.codigo_seguridad}`, 7);
        }
        if (data.fecha_firma_digital) {
          const fechaFirma = new Date(data.fecha_firma_digital).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
          centrado(`Fecha de firma digital: ${fechaFirma}`, 7);
        }
      } catch (qrError) {
        console.error('Error QR:', qrError.message);
      }
      y += 4;
    }
    if (data.ncf) {
      try {
        const barcodePng = await bwipjs.toBuffer({
          bcid: 'code128',
          text: data.ncf,
          scale: 2,
          height: 10,
          includetext: false,
          textxalign: 'center'
        });
        const bcWidth = cw;
        doc.image(barcodePng, M, y, { width: bcWidth, height: 30 });
        y += 32;
        centrado(data.ncf, 7);
        y += 3;
      } catch (bcError) {
        console.error('Error codigo barras:', bcError.message);
      }
    }
    y += 4;
    lineaGuiones();
    y += 2;
    centrado('GRACIAS POR SU COMPRA', 9, true);
    y += 2;
    centrado('Este documento es valido como', 7);
    centrado('comprobante fiscal', 7);
    y += 3;
    centrado(`Impreso: ${new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })}`, 6);
    doc.end();
  } catch (error) {
    console.error('Error generando PDF POS:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PDF MEDIA CARTA HORIZONTAL - 8.5 x 5.5 (612 x 396) - PAGINA UNICA
router.get('/:id/pdf', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const invoice = await pool.query(
      `SELECT i.*, c.nombre as cliente_nombre, c.rnc_cedula, c.telefono as cliente_telefono,
              c.direccion as cliente_direccion, c.condiciones as cliente_condiciones,
              c.email as cliente_negocio,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.email as empresa_email,
              v.nombre as vendedor_nombre
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       JOIN tenants t ON i.tenant_id = t.id
       LEFT JOIN vendedores v ON c.vendedor_id = v.id
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [id, tenant_id]
    );
    if (!invoice.rows[0]) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });
    const items = await pool.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [id]);
    const data = invoice.rows[0];
    const PDFDocument = require('pdfkit');
    // Media Carta horizontal: 8.5 ancho x 5.5 alto = 612 x 396
    // bufferPages + autoFirstPage para controlar paginas
    const doc = new PDFDocument({ margin: 0, size: [612, 396], bufferPages: true });
    const esElectronica = ['E31', 'E32', 'E34'].includes(data.ncf_tipo);
    const tituloDocumento = {
      'E31': 'FACTURA CREDITO FISCAL ELECTRONICA',
      'E32': 'FACTURA CONSUMO ELECTRONICA',
      'E34': 'NOTA DE CREDITO ELECTRONICA'
    }[data.ncf_tipo] || 'FACTURA';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=factura-${data.ncf || data.id}.pdf`);
    doc.pipe(res);

    // CONFIGURACION
    const W = 612;
    const H = 396;
    const M = 25;
    const col = W - M * 2;  // 562pt utilizables

    // Paleta profesional (igual que Carta Entera)
    const azulOscuro = '#1E3A8A';
    const azulMedio = '#3B82F6';
    const grisClaro = '#F8FAFC';
    const grisFondo = '#F1F5F9';
    const grisBorde = '#CBD5E1';
    const negro = '#0F172A';
    const grisTexto = '#64748B';

    // ENCABEZADO
    doc.rect(0, 0, W, 60).fill(azulOscuro);
    doc.fillColor('white').fontSize(17).font('Helvetica-Bold')
       .text(data.empresa_nombre || 'MI EMPRESA', M, 12, { width: col / 2, lineBreak: false });
    doc.fontSize(8).font('Helvetica')
       .text(`RNC: ${data.empresa_rnc || 'N/A'}`, M, 34, { width: col / 2, lineBreak: false });
    doc.fontSize(8).text(data.empresa_email || '', M, 46, { width: col / 2, lineBreak: false });
    const rightX = M + col / 2;
    const rightW = col / 2;
    doc.fillColor('white').fontSize(esElectronica ? 10 : 13).font('Helvetica-Bold')
       .text(tituloDocumento, rightX, 12, { width: rightW, align: 'right', lineBreak: false });
    doc.fontSize(9).font('Helvetica')
       .text(`NCF: ${data.ncf || 'N/A'}`, rightX, 28, { width: rightW, align: 'right', lineBreak: false });
    doc.fontSize(8).text(`Estado: ${data.estado.toUpperCase()}`, rightX, 40, { width: rightW, align: 'right', lineBreak: false });
    doc.fontSize(8).text(`Fecha: ${data.fecha_emision ? new Date(data.fecha_emision).toLocaleDateString('es-DO') : new Date().toLocaleDateString('es-DO')}`, rightX, 50, { width: rightW, align: 'right', lineBreak: false });

    let y = 66;
    if (data.numero_factura) {
      doc.rect(M, y, col, 16).fill(azulMedio);
      doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
         .text(`FACTURA No.: ${String(data.numero_factura).padStart(8, '0')}`, M + 8, y + 4, { width: col - 16, align: 'right', lineBreak: false });
      y += 22;
    }

    // BLOQUES CLIENTE / CONDICIONES (compactos)
    const blockH = 72;
    const gap = 10;
    const blockW = (col - gap) / 2;

    // Bloque CLIENTE
    doc.rect(M, y, blockW, blockH).fill(grisFondo).stroke(grisBorde);
    doc.rect(M, y, blockW, 16).fill(azulOscuro);
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
       .text('CLIENTE', M + 8, y + 4, { lineBreak: false });
    doc.fillColor(negro).fontSize(10).font('Helvetica-Bold')
       .text(data.cliente_nombre || 'Consumidor Final', M + 8, y + 20, { width: blockW - 16, lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(grisTexto)
       .text('RNC/Cedula:', M + 8, y + 36, { lineBreak: false });
    doc.fillColor(negro)
       .text(data.rnc_cedula || 'N/A', M + 65, y + 36, { lineBreak: false });
    doc.fillColor(grisTexto)
       .text('Telefono:', M + 8, y + 48, { lineBreak: false });
    doc.fillColor(negro)
       .text(data.cliente_telefono || 'N/A', M + 65, y + 48, { lineBreak: false });
    doc.fillColor(grisTexto)
       .text('Direccion:', M + 8, y + 60, { lineBreak: false });
    doc.fillColor(negro)
       .text(data.cliente_direccion || 'N/A', M + 65, y + 60, { width: blockW - 73, lineBreak: false, ellipsis: true });

    // Bloque CONDICIONES
    const cx = M + blockW + gap;
    doc.rect(cx, y, blockW, blockH).fill(grisFondo).stroke(grisBorde);
    doc.rect(cx, y, blockW, 16).fill(azulOscuro);
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
       .text('CONDICIONES DE PAGO', cx + 8, y + 4, { lineBreak: false });
    const condMap = { contado: 'Contado', '7_dias': '7 Dias', '15_dias': '15 Dias', '30_dias': '30 Dias', '45_dias': '45 Dias', '60_dias': '60 Dias' };
    doc.fillColor(negro).fontSize(10).font('Helvetica-Bold')
       .text(condMap[data.cliente_condiciones] || 'Contado', cx + 8, y + 20, { lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(grisTexto)
       .text('Vendedor:', cx + 8, y + 36, { lineBreak: false });
    doc.fillColor(negro)
       .text(data.vendedor_nombre || 'N/A', cx + 65, y + 36, { width: blockW - 73, lineBreak: false, ellipsis: true });
    doc.fillColor(grisTexto)
       .text('Negocio:', cx + 8, y + 48, { lineBreak: false });
    doc.fillColor(negro)
       .text(data.cliente_negocio || 'N/A', cx + 65, y + 48, { width: blockW - 73, lineBreak: false, ellipsis: true });

    y += blockH + 8;

    // TABLA - DISTRIBUCION COMPACTA EN 562pt
    const colDescX = M + 6;
    const colDescW = 200;
    const colCantX = M + 210;
    const colCantW = 35;
    const colPUnitX = M + 250;
    const colPUnitW = 60;
    const colSubX = M + 315;
    const colSubW = 65;
    const colItbisX = M + 385;
    const colItbisW = 55;
    const colTotalX = M + 445;
    const colTotalW = col - (445 - M) - 6;

    doc.rect(M, y, col, 18).fill(azulOscuro);
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPCION', colDescX, y + 5, { width: colDescW, lineBreak: false });
    doc.text('CANT', colCantX, y + 5, { width: colCantW, align: 'right', lineBreak: false });
    doc.text('P. UNIT', colPUnitX, y + 5, { width: colPUnitW, align: 'right', lineBreak: false });
    doc.text('SUBTOTAL', colSubX, y + 5, { width: colSubW, align: 'right', lineBreak: false });
    doc.text('ITBIS', colItbisX, y + 5, { width: colItbisW, align: 'right', lineBreak: false });
    doc.text('TOTAL', colTotalX, y + 5, { width: colTotalW, align: 'right', lineBreak: false });
    y += 18;

    doc.fontSize(9).font('Helvetica');
    let rowColor = true;
    for (const item of items.rows) {
      const rowH = 16;
      if (rowColor) doc.rect(M, y, col, rowH).fill(grisClaro);
      rowColor = !rowColor;
      const subtotalLinea = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      doc.fillColor(negro)
         .text(item.descripcion, colDescX, y + 4, { width: colDescW, lineBreak: false, ellipsis: true })
         .text(parseFloat(item.cantidad).toFixed(0), colCantX, y + 4, { width: colCantW, align: 'right', lineBreak: false })
         .text(parseFloat(item.precio_unitario).toLocaleString('es-DO', {minimumFractionDigits: 2}), colPUnitX, y + 4, { width: colPUnitW, align: 'right', lineBreak: false })
         .text(subtotalLinea.toLocaleString('es-DO', {minimumFractionDigits: 2}), colSubX, y + 4, { width: colSubW, align: 'right', lineBreak: false })
         .text(parseFloat(item.itbis_monto).toLocaleString('es-DO', {minimumFractionDigits: 2}), colItbisX, y + 4, { width: colItbisW, align: 'right', lineBreak: false })
         .text(parseFloat(item.total).toLocaleString('es-DO', {minimumFractionDigits: 2}), colTotalX, y + 4, { width: colTotalW, align: 'right', lineBreak: false });
      doc.moveTo(M, y + rowH).lineTo(M + col, y + rowH).strokeColor(grisBorde).lineWidth(0.5).stroke();
      y += rowH;
    }

    doc.rect(M, y, col, 1.5).fill(azulOscuro);
    y += 8;

    // TOTALES
    const tw = 220;
    const tx = M + col - tw;
    doc.rect(tx, y, tw, 16).fill(grisFondo).stroke(grisBorde);
    doc.fillColor(negro).fontSize(9).font('Helvetica')
       .text('Subtotal:', tx + 10, y + 4, { lineBreak: false });
    doc.font('Helvetica-Bold')
       .text(`RD$ ${parseFloat(data.subtotal).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 4, { width: tw - 10, align: 'right', lineBreak: false });
    y += 16;
    doc.rect(tx, y, tw, 16).fill(grisFondo).stroke(grisBorde);
    doc.fillColor(negro).fontSize(9).font('Helvetica')
       .text('ITBIS (18%):', tx + 10, y + 4, { lineBreak: false });
    doc.font('Helvetica-Bold')
       .text(`RD$ ${parseFloat(data.itbis).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 4, { width: tw - 10, align: 'right', lineBreak: false });
    y += 16;
    doc.rect(tx, y, tw, 24).fill(azulOscuro);
    doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
       .text('TOTAL:', tx + 10, y + 7, { lineBreak: false });
    doc.fontSize(12)
       .text(`RD$ ${parseFloat(data.total).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 6, { width: tw - 10, align: 'right', lineBreak: false });

    // FOOTER (en posicion fija al fondo)
    const footerY = 378;
    doc.fillColor(azulOscuro).fontSize(9).font('Helvetica-Bold')
       .text('Gracias por su preferencia', M, footerY, { width: col, align: 'center', lineBreak: false });

    doc.end();
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});


// PDF CARTA ENTERA - DISEÑO COMPACTO PROFESIONAL
router.get('/:id/pdf-carta', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const invoice = await pool.query(
      `SELECT i.*, c.nombre as cliente_nombre, c.rnc_cedula, c.telefono as cliente_telefono,
              c.direccion as cliente_direccion, c.condiciones as cliente_condiciones,
              c.email as cliente_negocio,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.email as empresa_email,
              v.nombre as vendedor_nombre
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       JOIN tenants t ON i.tenant_id = t.id
       LEFT JOIN vendedores v ON c.vendedor_id = v.id
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [id, tenant_id]
    );
    if (!invoice.rows[0]) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });
    const items = await pool.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [id]);
    const data = invoice.rows[0];
    const PDFDocument = require('pdfkit');
    // Carta Entera con margen amplio: 60pt cada lado = 21mm
    const doc = new PDFDocument({ margin: 60, size: [612, 792] });
    const esElectronica = ['E31', 'E32', 'E34'].includes(data.ncf_tipo);
    const tituloDocumento = {
      'E31': 'FACTURA CREDITO FISCAL ELECTRONICA',
      'E32': 'FACTURA CONSUMO ELECTRONICA',
      'E34': 'NOTA DE CREDITO ELECTRONICA'
    }[data.ncf_tipo] || 'FACTURA';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=factura-carta-${data.ncf || data.id}.pdf`);
    doc.pipe(res);

    // CONFIGURACION COMPACTA
    const W = 612;
    const M = 60;
    const col = W - M * 2;  // 492pt utilizables

    // Paleta profesional
    const azulOscuro = '#1E3A8A';
    const azulMedio = '#3B82F6';
    const grisClaro = '#F8FAFC';
    const grisFondo = '#F1F5F9';
    const grisBorde = '#CBD5E1';
    const negro = '#0F172A';
    const grisTexto = '#64748B';

    // ENCABEZADO
    doc.rect(0, 0, W, 95).fill(azulOscuro);
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
       .text(data.empresa_nombre || 'MI EMPRESA', M, 25, { width: col / 2 });
    doc.fontSize(9).font('Helvetica')
       .text(`RNC: ${data.empresa_rnc || 'N/A'}`, M, 56, { width: col / 2 });
    doc.fontSize(9).text(data.empresa_email || '', M, 70, { width: col / 2 });
    const rightX = M + col / 2;
    const rightW = col / 2;
    doc.fillColor('white').fontSize(esElectronica ? 11 : 14).font('Helvetica-Bold')
       .text(tituloDocumento, rightX, 25, { width: rightW, align: 'right' });
    doc.fontSize(10).font('Helvetica')
       .text(`NCF: ${data.ncf || 'N/A'}`, rightX, 46, { width: rightW, align: 'right' });
    doc.fontSize(9).text(`Estado: ${data.estado.toUpperCase()}`, rightX, 60, { width: rightW, align: 'right' });
    doc.fontSize(9).text(`Fecha: ${data.fecha_emision ? new Date(data.fecha_emision).toLocaleDateString('es-DO') : new Date().toLocaleDateString('es-DO')}`, rightX, 74, { width: rightW, align: 'right' });

    let y = 105;
    if (data.numero_factura) {
      doc.rect(M, y, col, 22).fill(azulMedio);
      doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
         .text(`FACTURA No.: ${String(data.numero_factura).padStart(8, '0')}`, M + 10, y + 7, { width: col - 20, align: 'right' });
      y += 32;
    } else {
      y = 115;
    }

    // BLOQUES CLIENTE / CONDICIONES
    const blockH = 100;
    const gap = 12;
    const blockW = (col - gap) / 2;

    doc.rect(M, y, blockW, blockH).fill(grisFondo).stroke(grisBorde);
    doc.rect(M, y, blockW, 22).fill(azulOscuro);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
       .text('CLIENTE', M + 10, y + 7);
    doc.fillColor(negro).fontSize(11).font('Helvetica-Bold')
       .text(data.cliente_nombre || 'Consumidor Final', M + 10, y + 30, { width: blockW - 20 });
    doc.fontSize(9).font('Helvetica').fillColor(grisTexto)
       .text('RNC/Cedula:', M + 10, y + 50);
    doc.fillColor(negro)
       .text(data.rnc_cedula || 'N/A', M + 70, y + 50);
    doc.fillColor(grisTexto)
       .text('Telefono:', M + 10, y + 65);
    doc.fillColor(negro)
       .text(data.cliente_telefono || 'N/A', M + 70, y + 65);
    doc.fillColor(grisTexto)
       .text('Direccion:', M + 10, y + 80);
    doc.fillColor(negro)
       .text(data.cliente_direccion || 'N/A', M + 70, y + 80, { width: blockW - 80 });

    const cx = M + blockW + gap;
    doc.rect(cx, y, blockW, blockH).fill(grisFondo).stroke(grisBorde);
    doc.rect(cx, y, blockW, 22).fill(azulOscuro);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
       .text('CONDICIONES DE PAGO', cx + 10, y + 7);
    const condMap = { contado: 'Contado', '7_dias': '7 Dias', '15_dias': '15 Dias', '30_dias': '30 Dias', '45_dias': '45 Dias', '60_dias': '60 Dias' };
    doc.fillColor(negro).fontSize(11).font('Helvetica-Bold')
       .text(condMap[data.cliente_condiciones] || 'Contado', cx + 10, y + 30);
    doc.fontSize(9).font('Helvetica').fillColor(grisTexto)
       .text('Vendedor:', cx + 10, y + 50);
    doc.fillColor(negro)
       .text(data.vendedor_nombre || 'N/A', cx + 70, y + 50, { width: blockW - 80 });
    doc.fillColor(grisTexto)
       .text('Negocio:', cx + 10, y + 65);
    doc.fillColor(negro)
       .text(data.cliente_negocio || 'N/A', cx + 70, y + 65, { width: blockW - 80 });

    y += blockH + 18;

    // TABLA - DISTRIBUCION COMPACTA EN 492pt
    const colDescX = M + 8;
    const colDescW = 170;
    const colCantX = M + 188;
    const colCantW = 35;
    const colPUnitX = M + 230;
    const colPUnitW = 55;
    const colSubX = M + 290;
    const colSubW = 55;
    const colItbisX = M + 350;
    const colItbisW = 45;
    const colTotalX = M + 400;
    const colTotalW = 80;

    doc.rect(M, y, col, 24).fill(azulOscuro);
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPCION', colDescX, y + 8, { width: colDescW });
    doc.text('CANT', colCantX, y + 8, { width: colCantW, align: 'right' });
    doc.text('P. UNIT', colPUnitX, y + 8, { width: colPUnitW, align: 'right' });
    doc.text('SUBTOTAL', colSubX, y + 8, { width: colSubW, align: 'right' });
    doc.text('ITBIS', colItbisX, y + 8, { width: colItbisW, align: 'right' });
    doc.text('TOTAL', colTotalX, y + 8, { width: colTotalW, align: 'right' });
    y += 24;

    doc.fontSize(9).font('Helvetica');
    let rowColor = true;
    for (const item of items.rows) {
      const rowH = 22;
      if (rowColor) doc.rect(M, y, col, rowH).fill(grisClaro);
      rowColor = !rowColor;
      const subtotalLinea = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      doc.fillColor(negro)
         .text(item.descripcion, colDescX, y + 7, { width: colDescW })
         .text(parseFloat(item.cantidad).toFixed(0), colCantX, y + 7, { width: colCantW, align: 'right' })
         .text(parseFloat(item.precio_unitario).toLocaleString('es-DO', {minimumFractionDigits: 2}), colPUnitX, y + 7, { width: colPUnitW, align: 'right' })
         .text(subtotalLinea.toLocaleString('es-DO', {minimumFractionDigits: 2}), colSubX, y + 7, { width: colSubW, align: 'right' })
         .text(parseFloat(item.itbis_monto).toLocaleString('es-DO', {minimumFractionDigits: 2}), colItbisX, y + 7, { width: colItbisW, align: 'right' })
         .text(parseFloat(item.total).toLocaleString('es-DO', {minimumFractionDigits: 2}), colTotalX, y + 7, { width: colTotalW, align: 'right' });
      doc.moveTo(M, y + rowH).lineTo(M + col, y + rowH).strokeColor(grisBorde).lineWidth(0.5).stroke();
      y += rowH;
    }

    doc.rect(M, y, col, 1.5).fill(azulOscuro);
    y += 18;

    // TOTALES
    const tw = 220;
    const tx = M + col - tw;
    doc.rect(tx, y, tw, 22).fill(grisFondo).stroke(grisBorde);
    doc.fillColor(negro).fontSize(10).font('Helvetica')
       .text('Subtotal:', tx + 12, y + 7);
    doc.font('Helvetica-Bold')
       .text(`RD$ ${parseFloat(data.subtotal).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 7, { width: tw - 12, align: 'right' });
    y += 22;
    doc.rect(tx, y, tw, 22).fill(grisFondo).stroke(grisBorde);
    doc.fillColor(negro).fontSize(10).font('Helvetica')
       .text('ITBIS (18%):', tx + 12, y + 7);
    doc.font('Helvetica-Bold')
       .text(`RD$ ${parseFloat(data.itbis).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 7, { width: tw - 12, align: 'right' });
    y += 22;
    doc.rect(tx, y, tw, 32).fill(azulOscuro);
    doc.fillColor('white').fontSize(13).font('Helvetica-Bold')
       .text('TOTAL:', tx + 12, y + 9);
    doc.fontSize(14)
       .text(`RD$ ${parseFloat(data.total).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 9, { width: tw - 12, align: 'right' });
    y += 42;

    // E-CF
    if (esElectronica) {
      y += 8;
      const qrData = `https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=${data.empresa_rnc || ''}&ENCF=${data.ncf || ''}&MontoTotal=${parseFloat(data.total).toFixed(2)}&FechaEmision=${data.fecha_emision ? new Date(data.fecha_emision).toISOString().split('T')[0] : ''}&CodigoSeguridad=${data.codigo_seguridad || ''}`;
      try {
        const qrPng = await QRCode.toBuffer(qrData, { width: 130, margin: 1 });
        doc.rect(M, y, col, 130).fill(grisFondo).stroke(grisBorde);
        doc.image(qrPng, M + 10, y + 10, { width: 110, height: 110 });
        const infoX = M + 135;
        doc.fillColor(azulOscuro).fontSize(11).font('Helvetica-Bold')
           .text('VALIDACION DGII (e-CF)', infoX, y + 12);
        doc.fillColor(negro).fontSize(9).font('Helvetica')
           .text(`eNCF: ${data.ncf || '-'}`, infoX, y + 32)
           .text(`Codigo Seguridad: ${data.codigo_seguridad || '-'}`, infoX, y + 48)
           .text(`Fecha Firma: ${data.fecha_firma_digital ? new Date(data.fecha_firma_digital).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' }) : '-'}`, infoX, y + 64)
           .text(`Vence eNCF: ${data.fecha_vencimiento_encf ? new Date(data.fecha_vencimiento_encf).toLocaleDateString('es-DO') : '-'}`, infoX, y + 80);
        doc.fillColor(grisTexto).fontSize(8).font('Helvetica-Oblique')
           .text('Escanee el QR para validar en DGII', infoX, y + 105, { width: col - 145 });
        y += 140;
      } catch (qrError) {
        doc.fillColor('#EF4444').fontSize(9).text('Error generando QR', M, y);
        y += 14;
      }
      doc.fillColor(grisTexto).fontSize(9).font('Helvetica-Oblique')
         .text('Representacion Impresa del e-CF (Comprobante Fiscal Electronico)', M, y, { width: col, align: 'center' });
      y += 16;
    }

    // FOOTER
    doc.moveTo(M, y).lineTo(M + col, y).strokeColor(grisBorde).lineWidth(0.5).stroke();
    y += 12;
    doc.fillColor(azulOscuro).fontSize(11).font('Helvetica-Bold')
       .text('Gracias por su preferencia', M, y, { width: col, align: 'center' });
    y += 16;
    doc.fillColor(grisTexto).fontSize(8).font('Helvetica')
       .text('Este documento es valido como comprobante fiscal', M, y, { width: col, align: 'center' });

    doc.end();
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;