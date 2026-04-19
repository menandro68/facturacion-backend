const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const verifyToken = require('../middleware/auth')
const tenantGuard = require('../middleware/tenantGuard')

router.use(verifyToken, tenantGuard)

// GET ultimo precio de compra por producto
router.get('/ultimo-precio/:product_id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT poi.precio_unitario, po.creado_en
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.order_id = po.id
      WHERE poi.product_id = $1 AND po.tenant_id = $2
      ORDER BY po.creado_en DESC
      LIMIT 1
    `, [req.params.product_id, req.user.tenant_id])
    if (result.rows.length > 0) {
      res.json({ data: { precio: result.rows[0].precio_unitario, fecha: result.rows[0].creado_en } })
    } else {
      res.json({ data: null })
    }
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

// GET todas las órdenes
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT po.*, s.nombre as proveedor_nombre
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.tenant_id = $1
      ORDER BY po.creado_en DESC
    `, [req.user.tenant_id])
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

// GET una orden con sus items
router.get('/:id', async (req, res) => {
  try {
    const orden = await pool.query(
      'SELECT po.*, s.nombre as proveedor_nombre FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id WHERE po.id = $1 AND po.tenant_id = $2',
      [req.params.id, req.user.tenant_id]
    )
    const items = await pool.query(
      'SELECT poi.*, p.nombre as producto_nombre FROM purchase_order_items poi LEFT JOIN products p ON poi.product_id = p.id WHERE poi.order_id = $1',
      [req.params.id]
    )
    res.json({ data: { ...orden.rows[0], items: items.rows } })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

// POST crear orden
router.post('/', async (req, res) => {
  const { supplier_id, fecha_entrega, fecha_vencimiento_pago, notas, items } = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const count = await client.query(
      'SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = $1', [req.user.tenant_id]
    )
    const numero = `OC-${String(parseInt(count.rows[0].count) + 1).padStart(4, '0')}`
    const total = items.reduce((sum, i) => sum + (i.cantidad * i.precio_unitario), 0)
    const orden = await client.query(`
      INSERT INTO purchase_orders (tenant_id, numero, supplier_id, fecha_entrega, fecha_vencimiento_pago, notas, total)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [req.user.tenant_id, numero, supplier_id || null, fecha_entrega || null, fecha_vencimiento_pago || null, notas || '', total])

    for (const item of items) {
      const subtotal = item.cantidad * item.precio_unitario
      await client.query(`
        INSERT INTO purchase_order_items (order_id, product_id, descripcion, cantidad, precio_unitario, subtotal)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [orden.rows[0].id, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario, subtotal])
    }
    await client.query('COMMIT')
    res.json({ mensaje: 'Orden creada', data: orden.rows[0] })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ mensaje: err.message })
  } finally {
    client.release()
  }
})

// PUT editar orden
router.put('/:id/editar', async (req, res) => {
  const { supplier_id, fecha_entrega, fecha_vencimiento_pago, notas, items } = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const total = items ? items.reduce((sum, i) => sum + (i.cantidad * i.precio_unitario), 0) : 0
    await client.query(
      'UPDATE purchase_orders SET supplier_id = $1, fecha_entrega = $2, fecha_vencimiento_pago = $3, notas = $4, total = $5 WHERE id = $6 AND tenant_id = $7',
      [supplier_id || null, fecha_entrega || null, fecha_vencimiento_pago || null, notas || '', total, req.params.id, req.user.tenant_id]
    )
    if (items && items.length > 0) {
      await client.query('DELETE FROM purchase_order_items WHERE order_id = $1', [req.params.id])
      for (const item of items) {
        const subtotal = item.cantidad * item.precio_unitario
        await client.query(
          'INSERT INTO purchase_order_items (order_id, product_id, descripcion, cantidad, precio_unitario, subtotal) VALUES ($1, $2, $3, $4, $5, $6)',
          [req.params.id, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario, subtotal]
        )
      }
    }
    await client.query('COMMIT')
    res.json({ mensaje: 'Orden actualizada' })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ mensaje: err.message })
  } finally {
    client.release()
  }
})

// PUT cambiar estado
router.put('/:id/estado', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { estado } = req.body
    const tenant_id = req.user.tenant_id
    const id = req.params.id

    // Verificar estado anterior
    const ordenActual = await client.query(
      'SELECT estado FROM purchase_orders WHERE id=$1 AND tenant_id=$2', [id, tenant_id]
    )
    if (!ordenActual.rows[0]) return res.status(404).json({ mensaje: 'Orden no encontrada' })

    await client.query(
      'UPDATE purchase_orders SET estado=$1 WHERE id=$2 AND tenant_id=$3',
      [estado, id, tenant_id]
    )

    // Si se marca como recibida, actualizar inventario
    if (estado === 'recibida' && ordenActual.rows[0].estado !== 'recibida') {
      const items = await client.query(
        'SELECT * FROM purchase_order_items WHERE order_id=$1', [id]
      )
      for (const item of items.rows) {
        if (!item.product_id) continue
        const inv = await client.query(
          'SELECT * FROM inventory WHERE product_id=$1 AND tenant_id=$2',
          [item.product_id, tenant_id]
        )
        if (inv.rows.length > 0) {
          const stockAnterior = parseFloat(inv.rows[0].stock_actual)
          const stockNuevo = stockAnterior + parseFloat(item.cantidad)
          await client.query(
            'UPDATE inventory SET stock_actual=$1, actualizado_en=NOW() WHERE id=$2',
            [stockNuevo, inv.rows[0].id]
          )
          await client.query(
            `INSERT INTO inventory_movements (tenant_id,inventory_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo)
             VALUES ($1,$2,'entrada',$3,$4,$5,$6)`,
            [tenant_id, inv.rows[0].id, item.cantidad, stockAnterior, stockNuevo, `Orden de Compra recibida`]
          )
        } else {
          // Crear nuevo inventario
          const newInv = await client.query(
            `INSERT INTO inventory (tenant_id, product_id, stock_actual, unidad)
            VALUES ($1, $2, $3, 'unidad') RETURNING *`,
            [tenant_id, item.product_id, item.cantidad]
          )
          // Registrar movimiento
          await client.query(
            `INSERT INTO inventory_movements 
            (tenant_id, inventory_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
            VALUES ($1, $2, 'entrada', $3, 0, $4, $5)`,
            [tenant_id, newInv.rows[0].id, item.cantidad, item.cantidad,
             `Orden de Compra recibida`]
          )
        }
      }
    }

    await client.query('COMMIT')
    res.json({ mensaje: 'Estado actualizado' })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ mensaje: err.message })
  } finally {
    client.release()
  }
})

// PUT pagar orden de compra
router.put('/:id/pagar', async (req, res) => {
  const client = await pool.connect()
  try {
    const { monto, metodo, notas } = req.body
    const { tenant_id } = req.user
    const { id } = req.params

    const orden = await client.query(
      'SELECT * FROM purchase_orders WHERE id=$1 AND tenant_id=$2',
      [id, tenant_id]
    )
    if (!orden.rows[0]) return res.status(404).json({ mensaje: 'Orden no encontrada' })

    const o = orden.rows[0]
    const nuevoPagado = parseFloat(o.monto_pagado || 0) + parseFloat(monto)
    const total = parseFloat(o.total)
    const estadoPago = nuevoPagado >= total ? 'pagada' : 'parcial'

    await client.query(
      'UPDATE purchase_orders SET monto_pagado=$1, estado_pago=$2 WHERE id=$3 AND tenant_id=$4',
      [nuevoPagado, estadoPago, id, tenant_id]
    )

    res.json({ success: true, mensaje: 'Pago registrado', monto_pagado: nuevoPagado, estado_pago: estadoPago })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  } finally {
    client.release()
  }
})

// DELETE eliminar orden
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM purchase_orders WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenant_id]
    )
    res.json({ mensaje: 'Orden eliminada' })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

module.exports = router