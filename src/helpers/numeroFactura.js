/**
 * Helper: Obtener próximo número de factura consecutivo por tenant
 *
 * Garantiza:
 * - Atómico (UPDATE/INSERT con ON CONFLICT)
 * - Concurrencia segura (dos llamadas simultáneas no dan el mismo número)
 * - Secuencia sin saltos por tenant
 *
 * IMPORTANTE: Debe llamarse DENTRO de una transacción ya iniciada
 * con un cliente obtenido por pool.connect()
 *
 * @param {object} client - Cliente PostgreSQL con transacción activa
 * @param {string} tenant_id - UUID del tenant
 * @returns {Promise<number>} - Próximo número de factura (1, 2, 3, ...)
 */
const obtenerProximoNumeroFactura = async (client, tenant_id) => {
  // Intentar incrementar el contador existente del tenant
  const resultado = await client.query(
    `UPDATE tenant_invoice_counter
     SET ultimo_numero = ultimo_numero + 1,
         actualizado_en = NOW()
     WHERE tenant_id = $1
     RETURNING ultimo_numero`,
    [tenant_id]
  );

  // Si el tenant ya tenia contador, devolver el nuevo numero
  if (resultado.rows.length > 0) {
    return resultado.rows[0].ultimo_numero;
  }

  // Si el tenant NO tenia contador (primera factura), crearlo con valor 1
  const insercion = await client.query(
    `INSERT INTO tenant_invoice_counter (tenant_id, ultimo_numero)
     VALUES ($1, 1)
     ON CONFLICT (tenant_id) DO UPDATE
       SET ultimo_numero = tenant_invoice_counter.ultimo_numero + 1,
           actualizado_en = NOW()
     RETURNING ultimo_numero`,
    [tenant_id]
  );

  return insercion.rows[0].ultimo_numero;
};

module.exports = { obtenerProximoNumeroFactura };