const pool = require('../config/db');

// ==========================================
// HELPER: NCF ELECTRONICO (e-CF)
// Facturacion Electronica DGII Republica Dominicana
// ==========================================

/**
 * Genera un codigo de seguridad de 6 caracteres alfanumericos
 * Requerido por DGII para cada e-CF
 * Ejemplo: "A3B7K9"
 */
function generarCodigoSeguridad() {
  const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = '';
  for (let i = 0; i < 6; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return codigo;
}

/**
 * Obtiene el proximo NCF electronico disponible para el tenant
 * y tipo especificado (E31, E32, E34)
 *
 * IMPORTANTE: Esta funcion INCREMENTA el contador secuencia_actual
 * despues de obtener el NCF. Usa transaccion para evitar duplicados.
 *
 * @param {string} tenant_id - UUID del tenant
 * @param {string} tipo_ncf - Tipo de NCF ('E31', 'E32', 'E34')
 * @returns {Object} { ncf, codigo_seguridad, fecha_vencimiento, secuencia_id }
 */
async function obtenerProximoNCFElectronico(tenant_id, tipo_ncf) {
  // Validar tipo_ncf
  if (!['E31', 'E32', 'E34'].includes(tipo_ncf)) {
    throw new Error(`Tipo NCF invalido: ${tipo_ncf}. Debe ser E31, E32 o E34`);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Buscar secuencia activa para este tipo, con lock para evitar concurrencia
    const secuenciaResult = await client.query(
      `SELECT id, prefijo, secuencia_desde, secuencia_hasta, secuencia_actual, fecha_vencimiento
       FROM ncf_secuencias_electronicas
       WHERE tenant_id = $1
         AND tipo_ncf = $2
         AND activo = true
         AND secuencia_actual <= secuencia_hasta
       ORDER BY creado_en ASC
       LIMIT 1
       FOR UPDATE`,
      [tenant_id, tipo_ncf]
    );

    if (secuenciaResult.rows.length === 0) {
      throw new Error(`No hay secuencias ${tipo_ncf} disponibles. Cree una nueva secuencia en Mantenimiento > Secuencias NCF`);
    }

    const secuencia = secuenciaResult.rows[0];

    // 2. Verificar que no este vencida
    const hoy = new Date();
    const fechaVenc = new Date(secuencia.fecha_vencimiento);
    if (fechaVenc < hoy) {
      throw new Error(`La secuencia ${tipo_ncf} esta vencida (${fechaVenc.toLocaleDateString('es-DO')}). Cree una nueva secuencia`);
    }

    // 3. Generar el NCF formateado (ej: E310000000001)
    const numeroActual = secuencia.secuencia_actual;
    const ncfFormateado = `${secuencia.prefijo}${String(numeroActual).padStart(10, '0')}`;

    // 4. Generar codigo de seguridad unico
    const codigoSeguridad = generarCodigoSeguridad();

    // 5. Incrementar contador +1 para la proxima factura
    await client.query(
      `UPDATE ncf_secuencias_electronicas
       SET secuencia_actual = secuencia_actual + 1,
           actualizado_en = NOW()
       WHERE id = $1`,
      [secuencia.id]
    );

    await client.query('COMMIT');

    return {
      ncf: ncfFormateado,
      codigo_seguridad: codigoSeguridad,
      fecha_vencimiento: secuencia.fecha_vencimiento,
      secuencia_id: secuencia.id,
      tipo_ncf: tipo_ncf
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Detecta el tipo de NCF electronico segun el tipo de cliente
 *
 * @param {string} tipoCliente - Tipo de cliente del registro de clientes
 * @returns {string|null} - 'E31', 'E32', 'E34' o null si no aplica e-CF
 */
function detectarTipoNCF(tipoCliente) {
  const mapa = {
    'e31_credito_fiscal_electronico': 'E31',
    'e32_consumo_electronico': 'E32'
  };
  return mapa[tipoCliente] || null;
}

module.exports = {
  generarCodigoSeguridad,
  obtenerProximoNCFElectronico,
  detectarTipoNCF
};