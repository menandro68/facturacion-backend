// Borra SOLO los registros con caracteres dañados (�) del tenant casa reyes
// Se ejecuta UNA vez: railway run node limpiar-danados.js
require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function main() {
  const client = await pool.connect()
  try {
    const t = await client.query("SELECT id, nombre FROM tenants WHERE LOWER(nombre) LIKE '%casa reyes%'")
    if (t.rows.length !== 1) throw new Error('No se encontró un único tenant casa reyes')
    const tenantId = t.rows[0].id
    console.log('✅ Tenant:', t.rows[0].nombre, '->', tenantId)

    await client.query('BEGIN')

    // El carácter dañado es U+FFFD (�)
    const danado = '\uFFFD'

    // Inventario de productos dañados primero (FK)
    const inv = await client.query(
      `DELETE FROM inventory WHERE tenant_id = $1 AND product_id IN
       (SELECT id FROM products WHERE tenant_id = $1 AND nombre LIKE '%' || $2 || '%')`,
      [tenantId, danado])
    console.log('🗑️ Inventario de productos dañados:', inv.rowCount)

    const p = await client.query(
      `DELETE FROM products WHERE tenant_id = $1 AND nombre LIKE '%' || $2 || '%'`,
      [tenantId, danado])
    console.log('🗑️ Productos dañados borrados:', p.rowCount)

    const c = await client.query(
      `DELETE FROM customers WHERE tenant_id = $1 AND (nombre LIKE '%' || $2 || '%' OR direccion LIKE '%' || $2 || '%')`,
      [tenantId, danado])
    console.log('🗑️ Clientes dañados borrados:', c.rowCount)

    const pr = await client.query(
      `DELETE FROM suppliers WHERE tenant_id = $1 AND (nombre LIKE '%' || $2 || '%' OR contacto LIKE '%' || $2 || '%')`,
      [tenantId, danado])
    console.log('🗑️ Proveedores dañados borrados:', pr.rowCount)

    await client.query('COMMIT')
    console.log('✅ LIMPIEZA COMPLETADA — ahora corre de nuevo la migración')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ ERROR — se revirtió todo:', e.message)
  } finally {
    client.release()
    await pool.end()
  }
}

main()