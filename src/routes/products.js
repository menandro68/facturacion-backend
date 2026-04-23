const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// GET - Listar productos
router.get('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM products WHERE tenant_id = $1 AND estado = 'activo' ORDER BY nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Obtener un producto
router.get('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM products WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Producto no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear producto
router.post('/', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, descripcion, precio, itbis_rate, unidad, costo, codigo, comision_vendedor, beneficio, suplidor, stock_minimo, stock_maximo } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    if (!precio) return res.status(400).json({ success: false, mensaje: 'El precio es requerido' });

    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS costo DECIMAL(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS codigo VARCHAR(50)`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS comision_vendedor DECIMAL(5,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS beneficio DECIMAL(5,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS suplidor VARCHAR(150)`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimo DECIMAL(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_maximo DECIMAL(12,2) DEFAULT 0`);

    const result = await pool.query(
      `INSERT INTO products (tenant_id, nombre, descripcion, precio, itbis_rate, unidad, costo, codigo, comision_vendedor, beneficio, suplidor, stock_minimo, stock_maximo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [tenant_id, nombre, descripcion, precio, itbis_rate || 18.00, unidad || 'unidad',
       costo || 0, codigo || null, comision_vendedor || 0, beneficio || 0, suplidor || null,
       stock_minimo || 0, stock_maximo || 0]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Actualizar producto
router.put('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, descripcion, precio, itbis_rate, unidad, costo, codigo, comision_vendedor, beneficio, suplidor, stock_minimo, stock_maximo } = req.body;

    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS costo DECIMAL(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS codigo VARCHAR(50)`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS comision_vendedor DECIMAL(5,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS beneficio DECIMAL(5,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS suplidor VARCHAR(150)`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimo DECIMAL(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_maximo DECIMAL(12,2) DEFAULT 0`);

    const result = await pool.query(
      `UPDATE products SET 
        nombre=$1, descripcion=$2, precio=$3, itbis_rate=$4, unidad=$5,
        costo=$6, codigo=$7, comision_vendedor=$8, beneficio=$9, suplidor=$10,
        stock_minimo=$11, stock_maximo=$12, actualizado_en=NOW()
       WHERE id=$13 AND tenant_id=$14 RETURNING *`,
      [nombre, descripcion, precio, itbis_rate, unidad,
       costo || 0, codigo || null, comision_vendedor || 0, beneficio || 0, suplidor || null,
       stock_minimo || 0, stock_maximo || 0, id, tenant_id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, mensaje: 'Producto no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE - Eliminar producto (soft delete) - VALIDA QUE NO TENGA STOCK
router.delete('/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    // 1. Verificar que el producto existe
    const productoResult = await pool.query(
      `SELECT nombre FROM products WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (productoResult.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Articulo no encontrado' });
    }
    const nombreProducto = productoResult.rows[0].nombre;

    // 2. Verificar si tiene stock en inventario
    const stockResult = await pool.query(
      `SELECT COALESCE(SUM(stock_actual), 0) as stock_total
       FROM inventory 
       WHERE product_id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    const stockTotal = parseFloat(stockResult.rows[0].stock_total);

    // 3. Si tiene stock, rechazar eliminacion
    if (stockTotal > 0) {
      return res.status(400).json({
        success: false,
        mensaje: `No se puede eliminar el articulo "${nombreProducto}". Tiene ${stockTotal.toLocaleString('es-DO')} unidad(es) en stock. Debe agotar el inventario antes de eliminar.`,
        stock_actual: stockTotal
      });
    }

    // 4. Si no tiene stock, eliminar (soft delete)
    await pool.query(
      `UPDATE products SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Articulo eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;