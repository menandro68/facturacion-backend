// Migración de datos app vieja -> tenant casa reyes
// Se ejecuta UNA sola vez: node migrar-casa-reyes.js
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const CARPETA = 'C:\\Users\\DELL\\Documents\\CASA REYES'

// Parser CSV que respeta comillas (nombres con comas)
function parseCSV(contenido) {
  // Limpiar caracteres nulos y de control que trae la app vieja (PostgreSQL no los acepta)
  contenido = contenido.replace(/\u0000/g, '').replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  const lineas = contenido.split(/\r?\n/).filter(l => l.trim() !== '')
  const filas = []
  for (const linea of lineas) {
    const campos = []
    let actual = ''
    let dentroComillas = false
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i]
      if (c === '"') {
        if (dentroComillas && linea[i + 1] === '"') { actual += '"'; i++ }
        else dentroComillas = !dentroComillas
      } else if (c === ',' && !dentroComillas) {
        campos.push(actual); actual = ''
      } else {
        actual += c
      }
    }
    campos.push(actual)
    filas.push(campos)
  }
  return filas.slice(1) // sin encabezado
}

async function main() {
  const client = await pool.connect()
  try {
    // 1. Buscar el tenant casa reyes
    const t = await client.query("SELECT id, nombre FROM tenants WHERE LOWER(nombre) LIKE '%casa reyes%'")
    if (t.rows.length !== 1) {
      console.log('❌ Tenants encontrados:', t.rows)
      throw new Error('No se encontró un único tenant casa reyes — verifica el nombre')
    }
    const tenantId = t.rows[0].id
    console.log('✅ Tenant:', t.rows[0].nombre, '->', tenantId)

    // 2. Leer CSVs
    const clientes = parseCSV(fs.readFileSync(path.join(CARPETA, 'clientes.csv'), 'utf8'))
    const productos = parseCSV(fs.readFileSync(path.join(CARPETA, 'productos.csv'), 'utf8'))
    const proveedores = parseCSV(fs.readFileSync(path.join(CARPETA, 'proveedores.csv'), 'utf8'))
    console.log(`📦 A migrar: ${clientes.length} clientes, ${productos.length} productos, ${proveedores.length} proveedores`)

    await client.query('BEGIN')

    // 3. Clientes: nombre, telefono, correo, direccion (tal cual)
    let cIns = 0, cDup = 0
    for (const [nombre, telefono, correo, direccion] of clientes) {
      const nom = (nombre || '').trim()
      if (!nom) continue
      const existe = await client.query(
        'SELECT id FROM customers WHERE tenant_id = $1 AND LOWER(nombre) = LOWER($2)', [tenantId, nom])
      if (existe.rows.length > 0) { cDup++; continue }
      await client.query(
        `INSERT INTO customers (tenant_id, nombre, telefono, email, direccion, tipo, estado)
         VALUES ($1, $2, $3, $4, $5, 'consumidor_final', 'activo')`,
        [tenantId, nom.substring(0, 150), (telefono || '').substring(0, 20), (correo || '').substring(0, 100) || null, direccion || null])
      cIns++
    }
    console.log(`✅ Clientes: ${cIns} insertados, ${cDup} ya existían`)

    // 4. Productos: nombre, clave, costo, precio, cantidad
    //    TODO tal cual: precio como está y stock como está (aunque sea negativo)
    let pIns = 0, pDup = 0
    for (const [nombre, clave, costo, precio, cantidad] of productos) {
      const nom = (nombre || '').trim()
      if (!nom) continue
      const existe = await client.query(
        'SELECT id FROM products WHERE tenant_id = $1 AND LOWER(nombre) = LOWER($2)', [tenantId, nom])
      if (existe.rows.length > 0) { pDup++; continue }
      const desc = clave && clave.trim() ? `Código: ${clave.trim()}` : null
      const res = await client.query(
        `INSERT INTO products (tenant_id, nombre, descripcion, precio, itbis_rate, unidad, estado)
         VALUES ($1, $2, $3, $4, 18.00, 'unidad', 'activo') RETURNING id`,
        [tenantId, nom.substring(0, 150), desc, parseFloat(precio) || 0])
      // Stock tal cual está en la app vieja (positivo o negativo)
      await client.query(
        `INSERT INTO inventory (tenant_id, product_id, stock_actual, stock_minimo, stock_maximo, unidad)
         VALUES ($1, $2, $3, 0, 0, 'unidad')`,
        [tenantId, res.rows[0].id, parseFloat(cantidad) || 0])
      pIns++
    }
    console.log(`✅ Productos: ${pIns} insertados (con su stock tal cual), ${pDup} ya existían`)

    // 5. Proveedores: nombre, empresa, telefono, correo, direccion
    let prIns = 0, prDup = 0
    for (const [nombre, empresa, telefono, correo, direccion] of proveedores) {
      const nom = ((empresa || '').trim() || (nombre || '').trim())
      if (!nom) continue
      const existe = await client.query(
        'SELECT id FROM suppliers WHERE tenant_id = $1 AND LOWER(nombre) = LOWER($2)', [tenantId, nom])
      if (existe.rows.length > 0) { prDup++; continue }
      await client.query(
        `INSERT INTO suppliers (tenant_id, nombre, telefono, email, direccion, contacto, estado)
         VALUES ($1, $2, $3, $4, $5, $6, 'activo')`,
        [tenantId, nom.substring(0, 150), (telefono || '').substring(0, 20), (correo || '').substring(0, 100) || null, direccion || null, (nombre || '').substring(0, 100) || null])
      prIns++
    }
    console.log(`✅ Proveedores: ${prIns} insertados, ${prDup} ya existían`)

    await client.query('COMMIT')
    console.log('🎉 MIGRACIÓN COMPLETADA')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ ERROR — se revirtió todo, no se insertó nada:', e.message)
  } finally {
    client.release()
    await pool.end()
  }
}

main()