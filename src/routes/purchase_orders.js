const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const { verifyToken, tenantGuard } = require('../middleware/auth')

router.use(verifyToken, tenantGuard)

// GET todas las órdenes
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT po.*, s.nombre as proveedor_nombre
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.tenant_id = $1
      ORDER BY po.creado_en DESC
    `, [req.tenantId])
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
      [req.params.id, req.tenantId]
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
  const { supplier_id, fecha_entrega, notas, items } = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const count = await client.query(
      'SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = $1', [req.tenantId]
    )
    const numero = `OC-${String(parseInt(count.rows[0].count) + 1).padStart(4, '0')}`
    const total = items.reduce((sum, i) => sum + (i.cantidad * i.precio_unitario), 0)
    const orden = await client.query(`
      INSERT INTO purchase_orders (tenant_id, numero, supplier_id, fecha_entrega, notas, total)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [req.tenantId, numero, supplier_id || null, fecha_entrega || null, notas || '', total])

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

// PUT cambiar estado
router.put('/:id/estado', async (req, res) => {
  try {
    await pool.query(
      'UPDATE purchase_orders SET estado = $1 WHERE id = $2 AND tenant_id = $3',
      [req.body.estado, req.params.id, req.tenantId]
    )
    res.json({ mensaje: 'Estado actualizado' })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

// DELETE eliminar orden
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM purchase_orders WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    )
    res.json({ mensaje: 'Orden eliminada' })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

module.exports = router