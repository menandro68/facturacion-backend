const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');
const { obtenerProximoNCFElectronico } = require('../helpers/ncfElectronico');
const QRCode = require('qrcode');

// GET - Listar items de todas las facturas con comision del producto
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

// GET - Reporte de ventas por producto
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

// GET - Reporte de ventas por rango de fechas
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

// GET - Listar pedidos
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

// POST - Crear pedido
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

// PUT - Editar pedido
router.put('/pedido/:id/editar', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect()
  try {
    const { tenant_id } = req.user
    const { id } = req.params
    const { customer_id, items } = req.body

    await client.query('BEGIN')

    // Verificar que el pedido existe
    const pedido = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 AND estado = 'pedido'`,
      [id, tenant_id]
    )
    if (!pedido.rows[0]) return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado' })

    // Recalcular totales
    let subtotal = 0, itbis_total = 0
    items.forEach(item => {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario)
      subtotal += s
      itbis_total += s * (parseFloat(item.itbis_rate || 0) / 100)
    })
    const total = subtotal + itbis_total

    // Actualizar factura
    await client.query(
      `UPDATE invoices SET customer_id=$1, subtotal=$2, itbis=$3, total=$4, actualizado_en=NOW() WHERE id=$5`,
      [customer_id || null, subtotal, itbis_total, total, id]
    )

    // Eliminar items anteriores
    await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id])

    // Insertar nuevos items
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

// PUT - Convertir pedido a factura
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
    // Asignar NCF
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
    // Descontar inventario
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
    const updated = await client.query(
      `UPDATE invoices SET estado='emitida', ncf=$1, ncf_tipo='B01', fecha_emision=NOW(), actualizado_en=NOW()
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

// GET - Listar notas de crédito
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

// POST - Crear nota de crédito
router.post('/nota-credito', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { factura_id, items, motivo } = req.body;
    if (!factura_id || !items || items.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Datos incompletos' });
    }
    await client.query('BEGIN');

    // Verificar factura original
    const facturaOrig = await client.query(
      `SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2 AND estado='emitida'`,
      [factura_id, tenant_id]
    );
    if (!facturaOrig.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Factura no encontrada o no emitida' });
    }

    // Generar número NC
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

    // Calcular totales de la nota
    let subtotal = 0, itbis = 0;
    for (const item of items) {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      subtotal += s;
      itbis += s * (parseFloat(item.itbis_rate || 0) / 100);
    }
    const total = subtotal + itbis;

    // Crear nota de crédito
    const nota = await client.query(
      `INSERT INTO invoices (tenant_id, customer_id, ncf_tipo, ncf, estado, subtotal, itbis, total, notas, fecha_emision, referencia_id)
       VALUES ($1, $2, 'NC', $3, 'nota_credito', $4, $5, $6, $7, NOW(), $8) RETURNING *`,
      [tenant_id, facturaOrig.rows[0].customer_id, nc_numero, subtotal, itbis, total,
       motivo || `Nota de crédito por factura ${facturaOrig.rows[0].ncf}`, factura_id]
    );
    const nota_id = nota.rows[0].id;

    // Insertar items y revertir inventario
    for (const item of items) {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      const item_itbis = s * (parseFloat(item.itbis_rate || 0) / 100);
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate, itbis_monto, subtotal, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [nota_id, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario,
         item.itbis_rate || 0, item_itbis, s, s + item_itbis]
      );
      // Revertir inventario (devolver stock)
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

    // Detectar si es NCF Electronico (e-CF) o tradicional (B01/B02)
    let ncf;
    let codigo_seguridad = null;
    let fecha_vencimiento_encf = null;

    if (['E31', 'E32', 'E34'].includes(ncf_tipo)) {
      // NCF ELECTRONICO (e-CF) - Facturacion Electronica DGII
      const encfResult = await obtenerProximoNCFElectronico(tenant_id, ncf_tipo);
      ncf = encfResult.ncf;
      codigo_seguridad = encfResult.codigo_seguridad;
      fecha_vencimiento_encf = encfResult.fecha_vencimiento;
    } else {
      // NCF TRADICIONAL (B01, B02, B15) - Logica inteligente de 2 niveles
      const tipoTradicional = ncf_tipo || 'B01';

      // NIVEL 1: Buscar si existe secuencia configurada en tabla NUEVA (Mantenimiento)
      const secuenciaNueva = await client.query(
        `SELECT id FROM ncf_secuencias_electronicas
         WHERE tenant_id = $1 AND tipo_ncf = $2 AND activo = true
           AND secuencia_actual <= secuencia_hasta
         LIMIT 1`,
        [tenant_id, tipoTradicional]
      );

      if (secuenciaNueva.rows.length > 0) {
        // Existe secuencia en tabla nueva - usar helper unificado
        const resultado = await obtenerProximoNCFElectronico(tenant_id, tipoTradicional);
        ncf = resultado.ncf;
        // codigo_seguridad y fecha_vencimiento_encf se quedan null (son solo para e-CF)
      } else {
        // NIVEL 2: No existe en tabla nueva - usar logica VIEJA (sin cambios)
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

    const invoice = await client.query(
      `INSERT INTO invoices (tenant_id, customer_id, ncf_tipo, ncf, estado, subtotal, itbis, total, notas, fecha_vencimiento, fecha_emision, codigo_seguridad, fecha_vencimiento_encf, fecha_firma_digital)
       VALUES ($1, $2, $3, $4, 'emitida', $5, $6, $7, $8, $9, NOW(), $10, $11, $12) RETURNING *`,
      [tenant_id, customer_id || null, ncf_tipo || 'B01', ncf, subtotal, itbis, total, notas || null, fecha_vencimiento || null, codigo_seguridad, fecha_vencimiento_encf, codigo_seguridad ? new Date() : null]
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

// GET - Generar PDF formato Punto de Venta 80mm (termica)
router.get('/:id/pdf-pos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    const invoice = await pool.query(
      `SELECT i.*, c.nombre as cliente_nombre, c.rnc_cedula, c.telefono as cliente_telefono,
              c.direccion as cliente_direccion,
              t.nombre as empresa_nombre, t.rnc as empresa_rnc, t.telefono as empresa_telefono,
              t.direccion as empresa_direccion
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       LEFT JOIN tenants t ON i.tenant_id = t.id
       WHERE i.id=$1 AND i.tenant_id=$2`,
      [id, tenant_id]
    );

    if (invoice.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });
    }

    const items = await pool.query(
      `SELECT * FROM invoice_items WHERE invoice_id=$1`,
      [id]
    );

    const data = invoice.rows[0];
    const PDFDocument = require('pdfkit');
    
    // Punto de Venta: 80mm = 227 puntos de ancho, alto dinamico
    const doc = new PDFDocument({ margin: 8, size: [227, 800] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=ticket-${data.ncf || data.id}.pdf`);
    doc.pipe(res);

    const W = 227;
    let y = 10;

    // ENCABEZADO EMPRESA - Centrado
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(data.empresa_nombre || 'EMPRESA', 0, y, { width: W, align: 'center' });
    y += 14;
    
    doc.font('Helvetica').fontSize(7);
    if (data.empresa_rnc) {
      doc.text(`RNC: ${data.empresa_rnc}`, 0, y, { width: W, align: 'center' });
      y += 9;
    }
    if (data.empresa_telefono) {
      doc.text(`Tel: ${data.empresa_telefono}`, 0, y, { width: W, align: 'center' });
      y += 9;
    }
    if (data.empresa_direccion) {
      doc.text(data.empresa_direccion, 0, y, { width: W, align: 'center' });
      y += 9;
    }
    y += 4;

    // Linea separadora
    doc.moveTo(8, y).lineTo(W - 8, y).stroke();
    y += 5;

    // TIPO DE DOCUMENTO Y NCF
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('FACTURA', 0, y, { width: W, align: 'center' });
    y += 11;
    
    doc.font('Helvetica').fontSize(8);
    if (data.ncf) {
      doc.text(`NCF: ${data.ncf}`, 0, y, { width: W, align: 'center' });
      y += 10;
    }

    // Linea separadora
    doc.moveTo(8, y).lineTo(W - 8, y).stroke();
    y += 5;

    // INFO DE VENTA
    doc.font('Helvetica').fontSize(7);
    const fecha = new Date(data.creado_en).toLocaleString('es-DO');
    doc.text(`Fecha: ${fecha}`, 8, y);
    y += 9;
    doc.text(`Cliente: ${data.cliente_nombre || 'Consumidor Final'}`, 8, y, { width: W - 16 });
    y += 9;
    if (data.rnc_cedula) {
      doc.text(`RNC/Ced: ${data.rnc_cedula}`, 8, y);
      y += 9;
    }
    if (data.cliente_telefono) {
      doc.text(`Tel: ${data.cliente_telefono}`, 8, y);
      y += 9;
    }
    y += 3;

    // Linea separadora
    doc.moveTo(8, y).lineTo(W - 8, y).stroke();
    y += 5;

    // ITEMS - Encabezado de tabla
    doc.font('Helvetica-Bold').fontSize(7);
    doc.text('CANT  DESCRIPCION', 8, y);
    doc.text('TOTAL', 8, y, { width: W - 16, align: 'right' });
    y += 10;

    // Linea separadora
    doc.moveTo(8, y).lineTo(W - 8, y).stroke();
    y += 4;

    // ITEMS - Lista
    doc.font('Helvetica').fontSize(7);
    items.rows.forEach(it => {
      const cant = parseFloat(it.cantidad).toFixed(0);
      const precio = parseFloat(it.precio_unitario);
      const subtotal = cant * precio;
      
      // Linea 1: Cantidad y descripcion
      doc.text(`${cant} ${it.descripcion}`, 8, y, { width: W - 16 });
      y += 9;
      
      // Linea 2: Precio unitario y total alineado a la derecha
      doc.text(`  @ RD$${precio.toLocaleString('es-DO',{minimumFractionDigits:2})}`, 8, y);
      doc.text(`RD$${subtotal.toLocaleString('es-DO',{minimumFractionDigits:2})}`, 8, y, { width: W - 16, align: 'right' });
      y += 11;
    });

    // Linea separadora
    doc.moveTo(8, y).lineTo(W - 8, y).stroke();
    y += 5;

    // TOTALES
    doc.font('Helvetica').fontSize(8);
    doc.text('Subtotal:', 8, y);
    doc.text(`RD$${parseFloat(data.subtotal).toLocaleString('es-DO',{minimumFractionDigits:2})}`, 8, y, { width: W - 16, align: 'right' });
    y += 11;
    
    doc.text('ITBIS (18%):', 8, y);
    doc.text(`RD$${parseFloat(data.itbis).toLocaleString('es-DO',{minimumFractionDigits:2})}`, 8, y, { width: W - 16, align: 'right' });
    y += 11;

    // TOTAL en grande
    doc.font('Helvetica-Bold').fontSize(11);
    doc.moveTo(8, y).lineTo(W - 8, y).stroke();
    y += 5;
    doc.text('TOTAL:', 8, y);
    doc.text(`RD$${parseFloat(data.total).toLocaleString('es-DO',{minimumFractionDigits:2})}`, 8, y, { width: W - 16, align: 'right' });
    y += 16;

    // Linea separadora
    doc.moveTo(8, y).lineTo(W - 8, y).stroke();
    y += 8;

    // FOOTER - Mensaje de agradecimiento
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('GRACIAS POR SU COMPRA', 0, y, { width: W, align: 'center' });
    y += 11;
    
    doc.font('Helvetica').fontSize(6);
    doc.text('Este documento es valido como comprobante fiscal', 0, y, { width: W, align: 'center' });
    y += 8;
    doc.text(`Impreso: ${new Date().toLocaleString('es-DO')}`, 0, y, { width: W, align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Error generando PDF POS:', error);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});


// GET - Generar PDF de factura
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
    // Media carta: 5.5 x 8.5 pulgadas = 396 x 612 puntos
    const doc = new PDFDocument({ margin: 30, size: [396, 612] });

    // Detectar si es e-CF (Factura Electronica DGII)
    const esElectronica = ['E31', 'E32', 'E34'].includes(data.ncf_tipo);
    const tituloDocumento = {
      'E31': 'FACTURA CREDITO FISCAL ELECTRONICA',
      'E32': 'FACTURA CONSUMO ELECTRONICA',
      'E34': 'NOTA DE CREDITO ELECTRONICA'
    }[data.ncf_tipo] || 'FACTURA';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=factura-${data.ncf || data.id}.pdf`);
    doc.pipe(res);

    const W = 396;
    const M = 30;
    const col = W - M * 2;
    const azul = '#1E40AF';
    const gris = '#F1F5F9';
    const negro = '#1E293B';

    // === ENCABEZADO AZUL ===
    doc.rect(0, 0, W, 80).fill(azul);
    doc.fillColor('white').fontSize(15).font('Helvetica-Bold')
       .text(data.empresa_nombre || 'Mi Empresa', M, 15, { width: col });
    doc.fontSize(8).font('Helvetica')
       .text(`RNC: ${data.empresa_rnc || 'N/A'}`, M, 35, { width: col });
    doc.fontSize(8).text(data.empresa_email || '', M, 47, { width: col });

    // Número de factura (derecha)
    doc.fontSize(esElectronica ? 7 : 9).font('Helvetica-Bold').text(tituloDocumento, M, 15, { width: col, align: 'right' });
    doc.fontSize(8).font('Helvetica').text(`NCF: ${data.ncf || 'N/A'}`, M, 28, { width: col, align: 'right' });
    doc.fontSize(7).text(`Estado: ${data.estado.toUpperCase()}`, M, 40, { width: col, align: 'right' });
    doc.fontSize(7).text(`Fecha: ${data.fecha_emision ? new Date(data.fecha_emision).toLocaleDateString('es-DO') : new Date().toLocaleDateString('es-DO')}`, M, 52, { width: col, align: 'right' });

    let y = 90;

    // === BLOQUE CLIENTE ===
    doc.rect(M, y, col, 75).fill(gris).stroke('#E2E8F0');
    doc.fillColor(azul).fontSize(8).font('Helvetica-Bold').text('CLIENTE', M + 6, y + 6);
    doc.fillColor(negro).fontSize(8).font('Helvetica-Bold')
       .text(data.cliente_nombre || 'Consumidor Final', M + 6, y + 17, { width: (col / 2) - 10 });
    doc.fontSize(7).font('Helvetica')
       .text(`RNC/Cédula: ${data.rnc_cedula || 'N/A'}`, M + 6, y + 29)
       .text(`Tel: ${data.cliente_telefono || 'N/A'}`, M + 6, y + 40)
       .text(`Dir: ${data.cliente_direccion || 'N/A'}`, M + 6, y + 51, { width: (col / 2) - 10 });

    // Lado derecho del bloque cliente
    const rx = M + col / 2 + 6;
    doc.fillColor(azul).fontSize(8).font('Helvetica-Bold').text('CONDICIONES', rx, y + 6);
    const condMap = { contado: 'Contado', '7_dias': '7 Días', '15_dias': '15 Días', '30_dias': '30 Días', '45_dias': '45 Días', '60_dias': '60 Días' };
    doc.fillColor(negro).fontSize(7).font('Helvetica')
       .text(condMap[data.cliente_condiciones] || 'Contado', rx, y + 17)
       .text(`Vendedor: ${data.vendedor_nombre || 'N/A'}`, rx, y + 29)
       .text(`Negocio: ${data.cliente_negocio || 'N/A'}`, rx, y + 40, { width: col / 2 - 10 });

    y += 82;

    // === TABLA ENCABEZADO ===
    doc.rect(M, y, col, 16).fill(azul);
    doc.fillColor('white').fontSize(6.5).font('Helvetica-Bold');
    doc.text('DESCRIPCIÓN', M + 4, y + 4, { width: 100 });
    doc.text('CANT', M + 108, y + 4, { width: 28, align: 'right' });
    doc.text('P. UNIT', M + 140, y + 4, { width: 48, align: 'right' });
    doc.text('SUBTOTAL', M + 192, y + 4, { width: 48, align: 'right' });
    doc.text('ITBIS', M + 244, y + 4, { width: 38, align: 'right' });
    doc.text('TOTAL', M + 286, y + 4, { width: 46, align: 'right' });
    y += 16;

    // === ITEMS ===
    doc.fontSize(6.5).font('Helvetica');
    let rowColor = true;
    for (const item of items.rows) {
      const rowH = 14;
      if (rowColor) doc.rect(M, y, col, rowH).fill('#F8FAFC');
      rowColor = !rowColor;
      const subtotalLinea = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      doc.fillColor(negro)
         .text(item.descripcion, M + 4, y + 3, { width: 100 })
         .text(parseFloat(item.cantidad).toFixed(0), M + 108, y + 3, { width: 28, align: 'right' })
         .text(parseFloat(item.precio_unitario).toLocaleString('es-DO', {minimumFractionDigits: 2}), M + 140, y + 3, { width: 48, align: 'right' })
         .text(subtotalLinea.toLocaleString('es-DO', {minimumFractionDigits: 2}), M + 192, y + 3, { width: 48, align: 'right' })
         .text(parseFloat(item.itbis_monto).toLocaleString('es-DO', {minimumFractionDigits: 2}), M + 244, y + 3, { width: 38, align: 'right' })
         .text(parseFloat(item.total).toLocaleString('es-DO', {minimumFractionDigits: 2}), M + 286, y + 3, { width: 46, align: 'right' });
      doc.moveTo(M, y + rowH).lineTo(M + col, y + rowH).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
      y += rowH;
    }

    y += 8;

    // === TOTALES ===
    const tw = 180;
    const tx = M + col - tw;
    doc.rect(tx, y, tw, 14).fill(gris);
    doc.fillColor(negro).fontSize(7).font('Helvetica')
       .text('Subtotal:', tx + 4, y + 3, { width: tw - 60 })
       .text(`RD$${parseFloat(data.subtotal).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 3, { width: tw - 4, align: 'right' });
    y += 14;
    doc.rect(tx, y, tw, 14).fill(gris);
    doc.fillColor(negro).fontSize(7).font('Helvetica')
       .text('ITBIS (18%):', tx + 4, y + 3)
       .text(`RD$${parseFloat(data.itbis).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 3, { width: tw - 4, align: 'right' });
    y += 14;
    doc.rect(tx, y, tw, 18).fill(azul);
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
       .text('TOTAL:', tx + 4, y + 4)
       .text(`RD$${parseFloat(data.total).toLocaleString('es-DO', {minimumFractionDigits: 2})}`, tx, y + 4, { width: tw - 4, align: 'right' });
    y += 26;

    // === BLOQUE e-CF (Solo facturas electronicas DGII) ===
    if (esElectronica) {
      y += 4;

      // Generar QR con datos DGII
      const qrData = `https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=${data.empresa_rnc || ''}&ENCF=${data.ncf || ''}&MontoTotal=${parseFloat(data.total).toFixed(2)}&FechaEmision=${data.fecha_emision ? new Date(data.fecha_emision).toISOString().split('T')[0] : ''}&CodigoSeguridad=${data.codigo_seguridad || ''}`;

      try {
        const qrPng = await QRCode.toBuffer(qrData, { width: 90, margin: 1 });

        // Dibujar QR a la izquierda
        doc.image(qrPng, M, y, { width: 75, height: 75 });

        // Datos DGII a la derecha del QR
        const infoX = M + 85;
        doc.fillColor('#1E40AF').fontSize(7).font('Helvetica-Bold')
           .text('VALIDACION DGII (e-CF)', infoX, y);
        doc.fillColor('#1E293B').fontSize(6).font('Helvetica')
           .text(`eNCF: ${data.ncf || '-'}`, infoX, y + 11)
           .text(`Codigo Seguridad: ${data.codigo_seguridad || '-'}`, infoX, y + 21)
           .text(`Fecha Firma: ${data.fecha_firma_digital ? new Date(data.fecha_firma_digital).toLocaleString('es-DO') : '-'}`, infoX, y + 31)
           .text(`Vence eNCF: ${data.fecha_vencimiento_encf ? new Date(data.fecha_vencimiento_encf).toLocaleDateString('es-DO') : '-'}`, infoX, y + 41)
           .text('Escanee el QR para validar en DGII', infoX, y + 55, { width: col - 90 });

        y += 80;
      } catch (qrError) {
        // Si falla el QR, continuar sin el
        doc.fillColor('#EF4444').fontSize(6).text('Error generando QR', M, y);
        y += 10;
      }

      // Leyenda DGII obligatoria
      doc.fillColor('#475569').fontSize(6).font('Helvetica-Oblique')
         .text('Representacion Impresa del e-CF (Comprobante Fiscal Electronico)', M, y, { width: col, align: 'center' });
      y += 8;
    }

    // === FOOTER ===
    doc.moveTo(M, y).lineTo(M + col, y).strokeColor('#CBD5E1').lineWidth(0.5).stroke();
    y += 6;
    doc.fillColor('#94A3B8').fontSize(6).font('Helvetica')
       .text('Gracias por su preferencia', M, y, { width: col, align: 'center' });

    doc.end();
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;