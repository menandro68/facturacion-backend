const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Listar inventario
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT i.*, p.nombre as producto_nombre, p.precio, p.descripcion
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       WHERE i.tenant_id = $1
       ORDER BY p.nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Productos con stock bajo
router.get('/alertas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT i.*, p.nombre as producto_nombre, p.precio
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       WHERE i.tenant_id = $1
       AND i.stock_actual <= i.stock_minimo
       ORDER BY i.stock_actual ASC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Movimientos de un inventario
router.get('/:id/movimientos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM inventory_movements 
       WHERE inventory_id = $1 AND tenant_id = $2
       ORDER BY creado_en DESC`,
      [id, tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear inventario para un producto
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { product_id, stock_actual, stock_minimo, stock_maximo, unidad, ubicacion } = req.body;
    if (!product_id) return res.status(400).json({ success: false, mensaje: 'El producto es requerido' });

    // Verificar si ya existe inventario para este producto
    const existe = await pool.query(
      `SELECT id FROM inventory WHERE product_id = $1 AND tenant_id = $2`,
      [product_id, tenant_id]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ success: false, mensaje: 'Ya existe inventario para este producto' });
    }

    const result = await pool.query(
      `INSERT INTO inventory (tenant_id, product_id, stock_actual, stock_minimo, stock_maximo, unidad, ubicacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tenant_id, product_id, stock_actual || 0, stock_minimo || 0, stock_maximo || 0, unidad || 'unidad', ubicacion || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Actualizar stock (entrada/salida)
router.put('/:id/movimiento', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { tipo, cantidad, motivo } = req.body;

    if (!tipo || !cantidad) {
      return res.status(400).json({ success: false, mensaje: 'Tipo y cantidad son requeridos' });
    }
    if (!['entrada', 'salida', 'ajuste'].includes(tipo)) {
      return res.status(400).json({ success: false, mensaje: 'Tipo debe ser: entrada, salida o ajuste' });
    }

    await client.query('BEGIN');

    const inv = await client.query(
      `SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!inv.rows[0]) return res.status(404).json({ success: false, mensaje: 'Inventario no encontrado' });

    const stock_anterior = parseFloat(inv.rows[0].stock_actual);
    let stock_nuevo;

    if (tipo === 'entrada') {
      stock_nuevo = stock_anterior + parseFloat(cantidad)
    } else if (tipo === 'salida') {
      stock_nuevo = stock_anterior - parseFloat(cantidad)
      if (stock_nuevo < 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ success: false, mensaje: 'Stock insuficiente' })
      }
    } else {
      stock_nuevo = parseFloat(cantidad)
    }

    // Actualizar stock
    await client.query(
      `UPDATE inventory SET stock_actual = $1, actualizado_en = NOW() WHERE id = $2`,
      [stock_nuevo, id]
    );

    // Registrar movimiento
    await client.query(
      `INSERT INTO inventory_movements (tenant_id, inventory_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenant_id, id, tipo, cantidad, stock_anterior, stock_nuevo, motivo || null]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { stock_anterior, stock_nuevo, tipo, cantidad } });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// PUT - Actualizar configuración de inventario
router.put('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { stock_minimo, stock_maximo, unidad, ubicacion } = req.body;
    const result = await pool.query(
      `UPDATE inventory SET stock_minimo=$1, stock_maximo=$2, unidad=$3, ubicacion=$4, actualizado_en=NOW()
       WHERE id=$5 AND tenant_id=$6 RETURNING *`,
      [stock_minimo, stock_maximo, unidad, ubicacion, id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Inventario no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;