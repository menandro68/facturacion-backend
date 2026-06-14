/**
 * Helper: Mapea el tipo de cliente al tipo de NCF que debe generar.
 *
 * credito_fiscal           -> B01 (Credito Fiscal tradicional)
 * consumidor_final         -> B02 (Consumo tradicional)
 * e32_consumo_electronico  -> E32 (Consumo Electronico e-CF)
 *
 * Si el tipo no se reconoce, cae por defecto en B02 (consumo).
 *
 * @param {string} tipoCliente - valor del campo customers.tipo
 * @returns {string} tipo de NCF: 'B01' | 'B02' | 'E32'
 */
function tipoNcfDesdeCliente(tipoCliente) {
  const mapa = {
    'credito_fiscal': 'B01',
    'consumidor_final': 'B02',
    'e32_consumo_electronico': 'E32'
  };
  return mapa[tipoCliente] || 'B02';
}

module.exports = { tipoNcfDesdeCliente };