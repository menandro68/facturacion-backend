const pool = require('../config/db')

// Crear tabla de bitácora al cargar el módulo (idempotente)
const initTabla = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS actividad_operadores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        operador_id UUID,
        modulo VARCHAR(50) NOT NULL,
        accion VARCHAR(50) NOT NULL,
        descripcion TEXT,
        referencia_id UUID,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_actividad_tenant_operador ON actividad_operadores (tenant_id, operador_id, creado_en)`)
    console.log('✅ Tabla actividad_operadores lista')
  } catch (e) {
    console.error('Error creando tabla actividad_operadores:', e.message)
  }
}
initTabla()

// Registrar actividad de un operador (fail-safe: nunca rompe el flujo principal)
// Uso: logActividad(req, 'clientes', 'crear', 'Creó cliente RAMON', clienteId)
const logActividad = (req, modulo, accion, descripcion, referencia_id = null) => {
  try {
    const tenant_id = req.user?.tenant_id
    const operador_id = req.user?.operador_id || null
    if (!tenant_id) return
    pool.query(
      `INSERT INTO actividad_operadores (tenant_id, operador_id, modulo, accion, descripcion, referencia_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenant_id, operador_id, modulo, accion, descripcion || '', referencia_id]
    ).catch(e => console.error('logActividad error:', e.message))
  } catch (e) {
    console.error('logActividad error:', e.message)
  }
}

module.exports = logActividad