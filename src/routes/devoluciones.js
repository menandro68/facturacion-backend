const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const verifyToken = require('../middleware/auth')
const tenantGuard = require('../middleware/tenantGuard')

router.use(verifyToken, tenantGuard)

// GET todas las devoluciones
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, i.ncf as factura_ncf_real, c.nombre as cliente_nombre_real
      FROM devoluciones d
      LEFT JOIN invoices i ON d.factura_id = i.id
      LEFT JOIN customers c ON d.customer_id = c.id
      WHERE d.tenant_id = $1
      ORDER BY d.creado_en DESC
    `, [req.user.tenant_id])
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

// GET una devolucion con sus items
router.get('/:id', async (req, res) => {
  try {
    const dev = await pool.query(`
      SELECT d.*, i.ncf as factura_ncf_real, c.nombre as cliente_nombre_real
      FROM devoluciones d
      LEFT JOIN invoices i ON d.factura_id = i.id
      LEFT JOIN customers c ON d.customer_id = c.id
      WHERE d.id = $1 AND d.tenant_id = $2
    `, [req.params.id, req.user.tenant_id])
    if (!dev.rows[0]) return res.status(404).json({ mensaje: 'Devolucion no encontrada' })
    const items = await pool.query(`
      SELECT di.*, p.nombre as producto_nombre
      FROM devoluciones_items di
      LEFT JOIN products p ON di.product_id = p.id
      WHERE di.devolucion_id = $1
    `, [req.params.id])
    res.json({ data: { ...dev.rows[0], items: items.rows } })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

// POST crear devolucion (almacen registra)
router.post('/', async (req, res) => {
  const { factura_id, factura_ncf, customer_id, cliente_nombre, motivo, items, creado_por } = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!factura_id) {
      await client.query('ROLLBACK')
      return res.status(400).json({ mensaje: 'La devolucion debe estar asociada a una factura' })
    }
    if (!items || items.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ mensaje: 'Debes incluir al menos un producto a devolver' })
    }

    // Generar numero consecutivo DEV-0001
    const count = await client.query(
      'SELECT COUNT(*) FROM devoluciones WHERE tenant_id = $1', [req.user.tenant_id]
    )
    const numero = `DEV-${String(parseInt(count.rows[0].count) + 1).padStart(4, '0')}`

    // Calcular totales
    let subtotal = 0, itbis = 0
    items.forEach(i => {
      const s = parseFloat(i.cantidad) * parseFloat(i.precio_unitario)
      subtotal += s
      itbis += s * (parseFloat(i.itbis_rate || 0) / 100)
    })
    const total = subtotal + itbis

    // Insertar devolucion
    const dev = await client.query(`
      INSERT INTO devoluciones (tenant_id, numero, factura_id, factura_ncf, customer_id, cliente_nombre, motivo, estado, subtotal, itbis, total, creado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', $8, $9, $10, $11) RETURNING *
    `, [req.user.tenant_id, numero, factura_id, factura_ncf || null, customer_id || null, cliente_nombre || null, motivo || '', subtotal, itbis, total, creado_por || null])

    // Insertar items
    for (const item of items) {
      const s = parseFloat(item.cantidad) * parseFloat(item.precio_unitario)
      await client.query(`
        INSERT INTO devoluciones_items (devolucion_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate, subtotal)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [dev.rows[0].id, item.product_id || null, item.descripcion, item.cantidad, item.precio_unitario, item.itbis_rate || 18, s])
    }

    await client.query('COMMIT')
    res.json({ mensaje: 'Devolucion registrada', data: dev.rows[0] })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ mensaje: err.message })
  } finally {
    client.release()
  }
})

// PUT aprobar devolucion (contabilidad aprueba + devuelve al inventario)
router.put('/:id/aprobar', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { aprobada_por } = req.body
    const { tenant_id } = req.user
    const { id } = req.params

    const dev = await client.query(
      'SELECT * FROM devoluciones WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id]
    )
    if (!dev.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ mensaje: 'Devolucion no encontrada' })
    }
    if (dev.rows[0].estado !== 'pendiente') {
      await client.query('ROLLBACK')
      return res.status(400).json({ mensaje: 'Solo se pueden aprobar devoluciones en estado pendiente' })
    }

    // Devolver productos al inventario
    const items = await client.query(
      'SELECT * FROM devoluciones_items WHERE devolucion_id = $1', [id]
    )
    for (const item of items.rows) {
      if (!item.product_id) continue
      const inv = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND tenant_id = $2',
        [item.product_id, tenant_id]
      )
      if (inv.rows.length > 0) {
        const stockAnterior = parseFloat(inv.rows[0].stock_actual)
        const stockNuevo = stockAnterior + parseFloat(item.cantidad)
        await client.query(
          'UPDATE inventory SET stock_actual = $1, actualizado_en = NOW() WHERE id = $2',
          [stockNuevo, inv.rows[0].id]
        )
        await client.query(
          `INSERT INTO inventory_movements (tenant_id, inventory_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
           VALUES ($1, $2, 'entrada', $3, $4, $5, $6)`,
          [tenant_id, inv.rows[0].id, item.cantidad, stockAnterior, stockNuevo, `Devolucion aprobada ${dev.rows[0].numero}`]
        )
      } else {
        // Crear inventario si no existe
        const newInv = await client.query(
          `INSERT INTO inventory (tenant_id, product_id, stock_actual, unidad)
           VALUES ($1, $2, $3, 'unidad') RETURNING *`,
          [tenant_id, item.product_id, item.cantidad]
        )
        await client.query(
          `INSERT INTO inventory_movements (tenant_id, inventory_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
           VALUES ($1, $2, 'entrada', $3, 0, $4, $5)`,
          [tenant_id, newInv.rows[0].id, item.cantidad, item.cantidad, `Devolucion aprobada ${dev.rows[0].numero}`]
        )
      }
    }

    // Cambiar estado a aprobada
    await client.query(
      `UPDATE devoluciones SET estado = 'aprobada', aprobada_por = $1, aprobada_en = NOW() WHERE id = $2 AND tenant_id = $3`,
      [aprobada_por || null, id, tenant_id]
    )

    await client.query('COMMIT')
    res.json({ mensaje: 'Devolucion aprobada e inventario actualizado' })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ mensaje: err.message })
  } finally {
    client.release()
  }
})

// PUT procesar devolucion (genera NC automatica)
router.put('/:id/procesar', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { procesada_por } = req.body
    const { tenant_id } = req.user
    const { id } = req.params

    const dev = await client.query(
      'SELECT * FROM devoluciones WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id]
    )
    if (!dev.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ mensaje: 'Devolucion no encontrada' })
    }
    if (dev.rows[0].estado !== 'aprobada') {
      await client.query('ROLLBACK')
      return res.status(400).json({ mensaje: 'Solo se pueden procesar devoluciones aprobadas' })
    }

    const d = dev.rows[0]
    const items = await client.query('SELECT * FROM devoluciones_items WHERE devolucion_id = $1', [id])

    // Generar NCF tipo B04 (Nota de Credito)
    let ncfNC = null
    const seq = await client.query(
      `SELECT * FROM ncf_sequences WHERE tenant_id = $1 AND tipo = 'B04' AND estado = 'activo' LIMIT 1`,
      [tenant_id]
    )
    if (seq.rows[0]) {
      const nuevaSec = parseInt(seq.rows[0].secuencia_actual) + 1
      ncfNC = `${seq.rows[0].prefijo}${String(nuevaSec).padStart(8, '0')}`
      await client.query(
        `UPDATE ncf_sequences SET secuencia_actual = $1 WHERE id = $2`,
        [nuevaSec, seq.rows[0].id]
      )
    } else {
      ncfNC = `NC${String(Date.now()).slice(-8)}`
    }

    // Crear NC (registro en invoices con tipo nota_credito)
    const nc = await client.query(`
      INSERT INTO invoices (tenant_id, customer_id, ncf, ncf_tipo, estado, subtotal, itbis, total, notas, fecha_emision)
      VALUES ($1, $2, $3, 'B04', 'nota_credito', $4, $5, $6, $7, NOW()) RETURNING *
    `, [tenant_id, d.customer_id, ncfNC, d.subtotal, d.itbis, d.total, `Nota de credito generada desde devolucion ${d.numero}. Factura original NCF: ${d.factura_ncf}. Motivo: ${d.motivo}`])

    // Crear items de la NC
    for (const item of items.rows) {
      const itbisMonto = parseFloat(item.subtotal) * (parseFloat(item.itbis_rate) / 100)
      const totalItem = parseFloat(item.subtotal) + itbisMonto
      await client.query(`
        INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, itbis_rate, itbis_monto, subtotal, total)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [nc.rows[0].id, item.product_id, item.descripcion, item.cantidad, item.precio_unitario, item.itbis_rate, itbisMonto, item.subtotal, totalItem])
    }

    // Actualizar devolucion: procesada + vincular NC
    await client.query(
      `UPDATE devoluciones SET estado = 'procesada', nota_credito_id = $1, procesada_por = $2, procesada_en = NOW() WHERE id = $3 AND tenant_id = $4`,
      [nc.rows[0].id, procesada_por || null, id, tenant_id]
    )

    await client.query('COMMIT')
    res.json({ mensaje: 'Devolucion procesada y NC generada', data: { devolucion_id: id, nota_credito_id: nc.rows[0].id, ncf: ncfNC } })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ mensaje: err.message })
  } finally {
    client.release()
  }
})

// PUT cancelar devolucion
router.put('/:id/cancelar', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { cancelada_por } = req.body
    const { tenant_id } = req.user
    const { id } = req.params

    const dev = await client.query(
      'SELECT * FROM devoluciones WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id]
    )
    if (!dev.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ mensaje: 'Devolucion no encontrada' })
    }
    if (dev.rows[0].estado === 'procesada') {
      await client.query('ROLLBACK')
      return res.status(400).json({ mensaje: 'No se puede cancelar una devolucion ya procesada' })
    }

    // Si estaba aprobada, revertir inventario
    if (dev.rows[0].estado === 'aprobada') {
      const items = await client.query('SELECT * FROM devoluciones_items WHERE devolucion_id = $1', [id])
      for (const item of items.rows) {
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
            `INSERT INTO inventory_movements (tenant_id, inventory_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
             VALUES ($1, $2, 'salida', $3, $4, $5, $6)`,
            [tenant_id, inv.rows[0].id, item.cantidad, stockAnterior, stockNuevo, `Devolucion cancelada ${dev.rows[0].numero}`]
          )
        }
      }
    }

    await client.query(
      `UPDATE devoluciones SET estado = 'cancelada', cancelada_por = $1, cancelada_en = NOW() WHERE id = $2 AND tenant_id = $3`,
      [cancelada_por || null, id, tenant_id]
    )

    await client.query('COMMIT')
    res.json({ mensaje: 'Devolucion cancelada' })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ mensaje: err.message })
  } finally {
    client.release()
  }
})

// DELETE eliminar devolucion (solo si esta pendiente)
router.delete('/:id', async (req, res) => {
  try {
    const dev = await pool.query(
      'SELECT estado FROM devoluciones WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenant_id]
    )
    if (!dev.rows[0]) return res.status(404).json({ mensaje: 'Devolucion no encontrada' })
    if (dev.rows[0].estado !== 'pendiente') {
      return res.status(400).json({ mensaje: 'Solo se pueden eliminar devoluciones pendientes. Si ya fue aprobada o procesada, debes cancelarla' })
    }
    await pool.query(
      'DELETE FROM devoluciones WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenant_id]
    )
    res.json({ mensaje: 'Devolucion eliminada' })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

module.exports = router