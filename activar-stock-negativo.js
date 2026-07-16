// Activa el feature flag stock_negativo para casa reyes
// Se ejecuta UNA vez: railway run node activar-stock-negativo.js
require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function main() {
  try {
    const t = await pool.query("SELECT id, nombre, features FROM tenants WHERE LOWER(nombre) LIKE '%casa reyes%'")
    if (t.rows.length !== 1) throw new Error('No se encontró un único tenant casa reyes: ' + JSON.stringify(t.rows))
    console.log('✅ Tenant:', t.rows[0].nombre)
    console.log('Features ANTES:', JSON.stringify(t.rows[0].features))

    const upd = await pool.query(
      `UPDATE tenants SET features = COALESCE(features, '{}'::jsonb) || '{"stock_negativo": true}'::jsonb
       WHERE id = $1 RETURNING features`,
      [t.rows[0].id]
    )
    console.log('Features DESPUÉS:', JSON.stringify(upd.rows[0].features))
    console.log('🎉 Flag stock_negativo ACTIVADO para casa reyes')
  } catch (e) {
    console.error('❌ ERROR:', e.message)
  } finally {
    await pool.end()
  }
}

main()