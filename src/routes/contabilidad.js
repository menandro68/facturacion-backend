const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

const r2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

// ==========================================
// Catalogo de cuentas base para Republica Dominicana
// nivel 1 = grupo, 2 = rubro, 3 = cuenta de movimiento
// ==========================================
const CATALOGO_BASE = [
  // ACTIVOS
  ['1', 'ACTIVOS', 'activo', 'deudora', 1, null, false],
  ['11', 'ACTIVOS CORRIENTES', 'activo', 'deudora', 2, '1', false],
  ['1101', 'Caja General', 'activo', 'deudora', 3, '11', true],
  ['1102', 'Caja Chica', 'activo', 'deudora', 3, '11', true],
  ['1103', 'Bancos', 'activo', 'deudora', 3, '11', true],
  ['1104', 'Cuentas por Cobrar Clientes', 'activo', 'deudora', 3, '11', true],
  ['1105', 'Cuentas por Cobrar Empleados', 'activo', 'deudora', 3, '11', true],
  ['1106', 'Inventario de Mercancias', 'activo', 'deudora', 3, '11', true],
  ['1107', 'ITBIS Adelantado', 'activo', 'deudora', 3, '11', true],
  ['1108', 'Anticipos a Proveedores', 'activo', 'deudora', 3, '11', true],
  ['12', 'ACTIVOS FIJOS', 'activo', 'deudora', 2, '1', false],
  ['1201', 'Mobiliario y Equipos', 'activo', 'deudora', 3, '12', true],
  ['1202', 'Vehiculos', 'activo', 'deudora', 3, '12', true],
  ['1203', 'Depreciacion Acumulada', 'activo', 'acreedora', 3, '12', true],

  // PASIVOS
  ['2', 'PASIVOS', 'pasivo', 'acreedora', 1, null, false],
  ['21', 'PASIVOS CORRIENTES', 'pasivo', 'acreedora', 2, '2', false],
  ['2101', 'Cuentas por Pagar Proveedores', 'pasivo', 'acreedora', 3, '21', true],
  ['2102', 'ITBIS por Pagar', 'pasivo', 'acreedora', 3, '21', true],
  ['2103', 'Sueldos por Pagar', 'pasivo', 'acreedora', 3, '21', true],
  ['2104', 'TSS por Pagar', 'pasivo', 'acreedora', 3, '21', true],
  ['2105', 'ISR Retenido por Pagar', 'pasivo', 'acreedora', 3, '21', true],
  ['2106', 'INFOTEP por Pagar', 'pasivo', 'acreedora', 3, '21', true],
  ['2107', 'Retenciones por Pagar', 'pasivo', 'acreedora', 3, '21', true],
  ['2108', 'Anticipos de Clientes', 'pasivo', 'acreedora', 3, '21', true],
  ['22', 'PASIVOS A LARGO PLAZO', 'pasivo', 'acreedora', 2, '2', false],
  ['2201', 'Prestamos Bancarios', 'pasivo', 'acreedora', 3, '22', true],

  // CAPITAL
  ['3', 'CAPITAL', 'capital', 'acreedora', 1, null, false],
  ['31', 'PATRIMONIO', 'capital', 'acreedora', 2, '3', false],
  ['3101', 'Capital Social', 'capital', 'acreedora', 3, '31', true],
  ['3102', 'Resultados Acumulados', 'capital', 'acreedora', 3, '31', true],
  ['3103', 'Resultado del Ejercicio', 'capital', 'acreedora', 3, '31', true],

  // INGRESOS
  ['4', 'INGRESOS', 'ingreso', 'acreedora', 1, null, false],
  ['41', 'INGRESOS OPERACIONALES', 'ingreso', 'acreedora', 2, '4', false],
  ['4101', 'Ingresos por Ventas', 'ingreso', 'acreedora', 3, '41', true],
  ['4102', 'Devoluciones sobre Ventas', 'ingreso', 'deudora', 3, '41', true],
  ['4103', 'Descuentos sobre Ventas', 'ingreso', 'deudora', 3, '41', true],
  ['42', 'OTROS INGRESOS', 'ingreso', 'acreedora', 2, '4', false],
  ['4201', 'Ingresos Financieros', 'ingreso', 'acreedora', 3, '42', true],
  ['4202', 'Otros Ingresos', 'ingreso', 'acreedora', 3, '42', true],

  // COSTOS
  ['5', 'COSTOS', 'costo', 'deudora', 1, null, false],
  ['51', 'COSTO DE VENTAS', 'costo', 'deudora', 2, '5', false],
  ['5101', 'Costo de Mercancia Vendida', 'costo', 'deudora', 3, '51', true],
  ['5102', 'Fletes sobre Compras', 'costo', 'deudora', 3, '51', true],

  // GASTOS
  ['6', 'GASTOS', 'gasto', 'deudora', 1, null, false],
  ['61', 'GASTOS DE PERSONAL', 'gasto', 'deudora', 2, '6', false],
  ['6101', 'Sueldos y Salarios', 'gasto', 'deudora', 3, '61', true],
  ['6102', 'Aportes Patronales TSS', 'gasto', 'deudora', 3, '61', true],
  ['6103', 'INFOTEP', 'gasto', 'deudora', 3, '61', true],
  ['6104', 'Regalia Pascual', 'gasto', 'deudora', 3, '61', true],
  ['6105', 'Prestaciones Laborales', 'gasto', 'deudora', 3, '61', true],
  ['6106', 'Comisiones a Vendedores', 'gasto', 'deudora', 3, '61', true],
  ['62', 'GASTOS OPERACIONALES', 'gasto', 'deudora', 2, '6', false],
  ['6201', 'Alquiler', 'gasto', 'deudora', 3, '62', true],
  ['6202', 'Energia Electrica', 'gasto', 'deudora', 3, '62', true],
  ['6203', 'Agua', 'gasto', 'deudora', 3, '62', true],
  ['6204', 'Telefono e Internet', 'gasto', 'deudora', 3, '62', true],
  ['6205', 'Combustible', 'gasto', 'deudora', 3, '62', true],
  ['6206', 'Mantenimiento y Reparaciones', 'gasto', 'deudora', 3, '62', true],
  ['6207', 'Publicidad', 'gasto', 'deudora', 3, '62', true],
  ['6208', 'Papeleria y Utiles', 'gasto', 'deudora', 3, '62', true],
  ['6209', 'Seguros', 'gasto', 'deudora', 3, '62', true],
  ['6210', 'Honorarios Profesionales', 'gasto', 'deudora', 3, '62', true],
  ['6211', 'Depreciacion', 'gasto', 'deudora', 3, '62', true],
  ['6212', 'Gastos Varios', 'gasto', 'deudora', 3, '62', true],
  ['63', 'GASTOS FINANCIEROS', 'gasto', 'deudora', 2, '6', false],
  ['6301', 'Intereses Bancarios', 'gasto', 'deudora', 3, '63', true],
  ['6302', 'Comisiones Bancarias', 'gasto', 'deudora', 3, '63', true]
];

// Cuentas que usa cada operacion automatica
const CONFIG_BASE = [
  ['ventas_cxc', '1104', 'Cuentas por cobrar al facturar'],
  ['ventas_ingreso', '4101', 'Ingreso por la venta'],
  ['ventas_itbis', '2102', 'ITBIS cobrado al cliente'],
  ['cobro_efectivo', '1101', 'Caja al recibir pago en efectivo'],
  ['cobro_banco', '1103', 'Banco al recibir transferencia o cheque'],
  ['compra_inventario', '1106', 'Inventario al comprar mercancia'],
  ['compra_cxp', '2101', 'Cuentas por pagar al proveedor'],
  ['compra_itbis', '1107', 'ITBIS adelantado en la compra'],
  ['nomina_sueldos', '6101', 'Gasto de sueldos'],
  ['nomina_aportes', '6102', 'Aportes patronales a la TSS'],
  ['nomina_infotep', '6103', 'Aporte a INFOTEP'],
  ['nomina_por_pagar', '2103', 'Sueldos netos por pagar'],
  ['nomina_tss', '2104', 'TSS por pagar'],
  ['nomina_isr', '2105', 'ISR retenido por pagar'],
  ['nomina_infotep_pagar', '2106', 'INFOTEP por pagar'],
  ['prestamo_empleado', '1105', 'Prestamo otorgado al empleado'],
  ['costo_ventas', '5101', 'Costo de la mercancia vendida']
];

// ==========================================
// POST - Inicializar el catalogo base
// ==========================================
router.post('/cuentas/inicializar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const existe = await pool.query(
      `SELECT COUNT(*) AS total FROM cuentas_contables WHERE tenant_id = $1`,
      [tenant_id]
    );
    if (parseInt(existe.rows[0].total) > 0) {
      return res.status(400).json({
        success: false,
        mensaje: 'Esta empresa ya tiene un catalogo de cuentas. Agregue las cuentas que falten manualmente.'
      });
    }

    const valores = [];
    const filas = CATALOGO_BASE.map((c, i) => {
      const b = i * 8;
      valores.push(tenant_id, c[0], c[1], c[2], c[3], c[4], c[5], c[6]);
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`;
    }).join(',');

    await pool.query(
      `INSERT INTO cuentas_contables
        (tenant_id, codigo, nombre, tipo, naturaleza, nivel, padre_codigo, acepta_movimiento)
       VALUES ${filas}
       ON CONFLICT (tenant_id, codigo) DO NOTHING`,
      valores
    );

    const vCfg = [];
    const fCfg = CONFIG_BASE.map((c, i) => {
      const b = i * 4;
      vCfg.push(tenant_id, c[0], c[1], c[2]);
      return `($${b+1},$${b+2},$${b+3},$${b+4})`;
    }).join(',');

    await pool.query(
      `INSERT INTO contabilidad_config (tenant_id, clave, cuenta_codigo, descripcion)
       VALUES ${fCfg}
       ON CONFLICT (tenant_id, clave) DO NOTHING`,
      vCfg
    );

    const total = await pool.query(
      `SELECT COUNT(*) AS total FROM cuentas_contables WHERE tenant_id = $1`,
      [tenant_id]
    );

    res.json({
      success: true,
      mensaje: `Catalogo inicializado con ${total.rows[0].total} cuentas`,
      data: { cuentas: parseInt(total.rows[0].total) }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - Catalogo de cuentas
// ==========================================
router.get('/cuentas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { tipo, estado, solo_movimiento } = req.query;

    let q = `SELECT * FROM cuentas_contables WHERE tenant_id = $1`;
    const params = [tenant_id];
    if (tipo && tipo !== 'todos') {
      params.push(tipo);
      q += ` AND tipo = $${params.length}`;
    }
    if (estado && estado !== 'todos') {
      params.push(estado);
      q += ` AND estado = $${params.length}`;
    }
    if (solo_movimiento === 'true') {
      q += ` AND acepta_movimiento = true`;
    }
    q += ` ORDER BY codigo ASC`;

    const r = await pool.query(q, params);
    res.json({ success: true, data: r.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// POST - Sincronizar configuraciones faltantes
// Agrega las claves nuevas sin tocar las existentes
// ==========================================
router.post('/config/sincronizar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const hay = await pool.query(
      `SELECT 1 FROM cuentas_contables WHERE tenant_id = $1 LIMIT 1`,
      [tenant_id]
    );
    if (!hay.rows[0]) {
      return res.status(400).json({
        success: false,
        mensaje: 'Esta empresa no tiene catalogo de cuentas. Inicialicelo primero.'
      });
    }

    const antes = await pool.query(
      `SELECT COUNT(*) AS total FROM contabilidad_config WHERE tenant_id = $1`,
      [tenant_id]
    );

    const vals = [];
    const filas = CONFIG_BASE.map((c, i) => {
      const b = i * 4;
      vals.push(tenant_id, c[0], c[1], c[2]);
      return `($${b+1},$${b+2},$${b+3},$${b+4})`;
    }).join(',');

    await pool.query(
      `INSERT INTO contabilidad_config (tenant_id, clave, cuenta_codigo, descripcion)
       VALUES ${filas}
       ON CONFLICT (tenant_id, clave) DO NOTHING`,
      vals
    );

    const despues = await pool.query(
      `SELECT COUNT(*) AS total FROM contabilidad_config WHERE tenant_id = $1`,
      [tenant_id]
    );

    const nuevas = parseInt(despues.rows[0].total) - parseInt(antes.rows[0].total);
    res.json({
      success: true,
      mensaje: nuevas > 0
        ? `${nuevas} configuracion(es) nueva(s) agregada(s)`
        : 'Todas las configuraciones ya estaban al dia',
      data: { antes: parseInt(antes.rows[0].total), despues: parseInt(despues.rows[0].total), nuevas }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - Configuracion de cuentas automaticas
// ==========================================
router.get('/config', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const r = await pool.query(
      `SELECT c.*, cu.nombre AS cuenta_nombre
         FROM contabilidad_config c
         LEFT JOIN cuentas_contables cu
           ON cu.codigo = c.cuenta_codigo AND cu.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1
        ORDER BY c.clave ASC`,
      [tenant_id]
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// POST - Crear cuenta
// ==========================================
router.post('/cuentas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { codigo, nombre, tipo, naturaleza, padre_codigo, acepta_movimiento, descripcion } = req.body;

    if (!codigo || !String(codigo).trim()) {
      return res.status(400).json({ success: false, mensaje: 'El codigo es obligatorio' });
    }
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre es obligatorio' });
    }
    if (!['activo', 'pasivo', 'capital', 'ingreso', 'costo', 'gasto'].includes(tipo)) {
      return res.status(400).json({ success: false, mensaje: 'Tipo de cuenta invalido' });
    }
    if (!['deudora', 'acreedora'].includes(naturaleza)) {
      return res.status(400).json({ success: false, mensaje: 'La naturaleza debe ser deudora o acreedora' });
    }

    const cod = String(codigo).trim();

    const dup = await pool.query(
      `SELECT id FROM cuentas_contables WHERE tenant_id = $1 AND codigo = $2`,
      [tenant_id, cod]
    );
    if (dup.rows[0]) {
      return res.status(400).json({ success: false, mensaje: `Ya existe una cuenta con el codigo ${cod}` });
    }

    // El padre debe existir y no aceptar movimiento
    let nivel = 1;
    if (padre_codigo && String(padre_codigo).trim()) {
      const padre = await pool.query(
        `SELECT * FROM cuentas_contables WHERE tenant_id = $1 AND codigo = $2`,
        [tenant_id, String(padre_codigo).trim()]
      );
      if (!padre.rows[0]) {
        return res.status(400).json({ success: false, mensaje: 'La cuenta padre no existe' });
      }
      if (padre.rows[0].acepta_movimiento) {
        return res.status(400).json({
          success: false,
          mensaje: 'La cuenta padre acepta movimientos, no puede tener cuentas hijas'
        });
      }
      nivel = (parseInt(padre.rows[0].nivel) || 1) + 1;
    }

    const r = await pool.query(
      `INSERT INTO cuentas_contables
        (tenant_id, codigo, nombre, tipo, naturaleza, nivel, padre_codigo, acepta_movimiento, descripcion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tenant_id, cod, String(nombre).trim(), tipo, naturaleza, nivel,
       padre_codigo ? String(padre_codigo).trim() : null,
       acepta_movimiento !== false, descripcion || null]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PUT - Actualizar cuenta
// ==========================================
router.put('/cuentas/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, naturaleza, acepta_movimiento, descripcion, estado } = req.body;

    const a = await pool.query(
      `SELECT * FROM cuentas_contables WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!a.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Cuenta no encontrada' });
    }
    const act = a.rows[0];

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre es obligatorio' });
    }

    // Si tiene movimientos, no se puede cambiar la naturaleza
    if (naturaleza && naturaleza !== act.naturaleza) {
      const mov = await pool.query(
        `SELECT COUNT(*) AS total FROM asientos_detalle
          WHERE tenant_id = $1 AND cuenta_codigo = $2`,
        [tenant_id, act.codigo]
      );
      if (parseInt(mov.rows[0].total) > 0) {
        return res.status(400).json({
          success: false,
          mensaje: 'Esta cuenta ya tiene movimientos registrados. No se puede cambiar su naturaleza.'
        });
      }
    }

    const r = await pool.query(
      `UPDATE cuentas_contables SET
         nombre = $1, naturaleza = $2, acepta_movimiento = $3,
         descripcion = $4, estado = $5, actualizado_en = NOW()
       WHERE id = $6 AND tenant_id = $7 RETURNING *`,
      [String(nombre).trim(),
       naturaleza || act.naturaleza,
       acepta_movimiento !== undefined ? acepta_movimiento !== false : act.acepta_movimiento,
       descripcion !== undefined ? descripcion : act.descripcion,
       estado || act.estado,
       req.params.id, tenant_id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PUT - Inactivar cuenta
// ==========================================
router.put('/cuentas/:id/inactivar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const a = await pool.query(
      `SELECT * FROM cuentas_contables WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!a.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Cuenta no encontrada' });
    }

    // No se inactiva una cuenta que este configurada para asientos automaticos
    const cfg = await pool.query(
      `SELECT clave FROM contabilidad_config WHERE tenant_id = $1 AND cuenta_codigo = $2`,
      [tenant_id, a.rows[0].codigo]
    );
    if (cfg.rows[0]) {
      return res.status(400).json({
        success: false,
        mensaje: `Esta cuenta esta configurada para asientos automaticos (${cfg.rows[0].clave}). Cambie la configuracion antes de inactivarla.`
      });
    }

    const r = await pool.query(
      `UPDATE cuentas_contables SET estado = 'inactivo', actualizado_en = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenant_id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PUT - Reactivar cuenta
// ==========================================
router.put('/cuentas/:id/reactivar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const r = await pool.query(
      `UPDATE cuentas_contables SET estado = 'activo', actualizado_en = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenant_id]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Cuenta no encontrada' });
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PUT - Cambiar la cuenta de una configuracion automatica
// ==========================================
router.put('/config/:clave', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { cuenta_codigo } = req.body;

    if (!cuenta_codigo || !String(cuenta_codigo).trim()) {
      return res.status(400).json({ success: false, mensaje: 'Debe indicar una cuenta' });
    }
    const cod = String(cuenta_codigo).trim();

    const c = await pool.query(
      `SELECT * FROM cuentas_contables WHERE tenant_id = $1 AND codigo = $2`,
      [tenant_id, cod]
    );
    if (!c.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'La cuenta no existe en el catalogo' });
    }
    if (!c.rows[0].acepta_movimiento) {
      return res.status(400).json({
        success: false,
        mensaje: 'Esa cuenta es agrupadora y no acepta movimientos. Escoja una cuenta de detalle.'
      });
    }
    if (c.rows[0].estado !== 'activo') {
      return res.status(400).json({ success: false, mensaje: 'Esa cuenta esta inactiva' });
    }

    const r = await pool.query(
      `UPDATE contabilidad_config SET cuenta_codigo = $1, actualizado_en = NOW()
        WHERE tenant_id = $2 AND clave = $3 RETURNING *`,
      [cod, tenant_id, req.params.clave]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Configuracion no encontrada' });
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// ASIENTOS CONTABLES
// ==========================================

// Verifica que el periodo de esa fecha este abierto
async function periodoAbierto(tenant_id, fecha) {
  const d = new Date(fecha);
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth() + 1;
  const r = await pool.query(
    `SELECT estado FROM periodos_contables WHERE tenant_id = $1 AND ano = $2 AND mes = $3`,
    [tenant_id, ano, mes]
  );
  // Si el periodo no existe se considera abierto
  if (!r.rows[0]) return { abierto: true, ano, mes };
  return { abierto: r.rows[0].estado !== 'cerrado', ano, mes };
}

// GET - Lista de asientos
router.get('/asientos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desde, hasta, estado, tipo, buscar } = req.query;

    let q = `SELECT * FROM asientos_contables WHERE tenant_id = $1`;
    const params = [tenant_id];
    if (desde) { params.push(desde); q += ` AND fecha >= $${params.length}`; }
    if (hasta) { params.push(hasta); q += ` AND fecha <= $${params.length}`; }
    if (estado && estado !== 'todos') { params.push(estado); q += ` AND estado = $${params.length}`; }
    if (tipo && tipo !== 'todos') { params.push(tipo); q += ` AND tipo = $${params.length}`; }
    if (buscar && String(buscar).trim()) {
      params.push('%' + String(buscar).trim().toLowerCase() + '%');
      q += ` AND (LOWER(COALESCE(numero,'')) LIKE $${params.length}
                  OR LOWER(COALESCE(descripcion,'')) LIKE $${params.length}
                  OR LOWER(COALESCE(origen_documento,'')) LIKE $${params.length})`;
    }
    q += ` ORDER BY fecha DESC, creado_en DESC LIMIT 500`;

    const r = await pool.query(q, params);
    res.json({ success: true, data: r.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Detalle de un asiento
router.get('/asientos/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const cab = await pool.query(
      `SELECT * FROM asientos_contables WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!cab.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });
    }
    const det = await pool.query(
      `SELECT * FROM asientos_detalle WHERE asiento_id = $1 AND tenant_id = $2
        ORDER BY orden ASC, creado_en ASC`,
      [req.params.id, tenant_id]
    );
    res.json({ success: true, data: { asiento: cab.rows[0], detalle: det.rows } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Registrar asiento manual
router.post('/asientos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { fecha, descripcion, notas, lineas } = req.body;

    if (!fecha) {
      return res.status(400).json({ success: false, mensaje: 'La fecha es obligatoria' });
    }
    if (!descripcion || !String(descripcion).trim()) {
      return res.status(400).json({ success: false, mensaje: 'La descripcion es obligatoria' });
    }
    if (!Array.isArray(lineas) || lineas.length < 2) {
      return res.status(400).json({
        success: false,
        mensaje: 'Un asiento necesita al menos dos lineas (un debito y un credito)'
      });
    }

    const per = await periodoAbierto(tenant_id, fecha);
    if (!per.abierto) {
      return res.status(400).json({
        success: false,
        mensaje: `El periodo ${per.mes}/${per.ano} esta cerrado. No admite asientos nuevos.`
      });
    }

    // Validar cada linea contra el catalogo
    const codigos = lineas.map(l => String(l.cuenta_codigo || '').trim()).filter(Boolean);
    if (codigos.length !== lineas.length) {
      return res.status(400).json({ success: false, mensaje: 'Todas las lineas necesitan una cuenta' });
    }
    const cuentas = await pool.query(
      `SELECT * FROM cuentas_contables WHERE tenant_id = $1 AND codigo = ANY($2::varchar[])`,
      [tenant_id, codigos]
    );
    const mapa = {};
    for (const c of cuentas.rows) mapa[c.codigo] = c;

    let totalDebito = 0;
    let totalCredito = 0;
    const limpias = [];

    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      const cod = String(l.cuenta_codigo || '').trim();
      const c = mapa[cod];
      if (!c) {
        return res.status(400).json({ success: false, mensaje: `La cuenta ${cod} no existe en el catalogo` });
      }
      if (!c.acepta_movimiento) {
        return res.status(400).json({
          success: false,
          mensaje: `La cuenta ${cod} (${c.nombre}) es agrupadora y no acepta movimientos`
        });
      }
      if (c.estado !== 'activo') {
        return res.status(400).json({ success: false, mensaje: `La cuenta ${cod} esta inactiva` });
      }

      const deb = r2(l.debito);
      const cre = r2(l.credito);
      if (deb < 0 || cre < 0) {
        return res.status(400).json({ success: false, mensaje: 'Los montos no pueden ser negativos' });
      }
      if (deb > 0 && cre > 0) {
        return res.status(400).json({
          success: false,
          mensaje: `La linea de la cuenta ${cod} no puede tener debito y credito a la vez`
        });
      }
      if (deb === 0 && cre === 0) {
        return res.status(400).json({
          success: false,
          mensaje: `La linea de la cuenta ${cod} no tiene monto`
        });
      }

      totalDebito = r2(totalDebito + deb);
      totalCredito = r2(totalCredito + cre);
      limpias.push({
        cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre,
        descripcion: l.descripcion || null, debito: deb, credito: cre, orden: i + 1
      });
    }

    // PARTIDA DOBLE: la validacion que no se negocia
    if (Math.abs(totalDebito - totalCredito) > 0.009) {
      return res.status(400).json({
        success: false,
        mensaje: `El asiento no cuadra. Debito: ${totalDebito.toFixed(2)} · Credito: ${totalCredito.toFixed(2)} · Diferencia: ${Math.abs(totalDebito - totalCredito).toFixed(2)}`
      });
    }
    if (totalDebito === 0) {
      return res.status(400).json({ success: false, mensaje: 'El asiento no tiene montos' });
    }

    const cont = await pool.query(
      `SELECT COUNT(*) AS total FROM asientos_contables WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numero = 'AS-' + String(parseInt(cont.rows[0].total) + 1).padStart(6, '0');

    const cab = await pool.query(
      `INSERT INTO asientos_contables
        (tenant_id, numero, fecha, tipo, descripcion, total_debito, total_credito, creado_por, notas)
       VALUES ($1,$2,$3,'manual',$4,$5,$6,$7,$8) RETURNING *`,
      [tenant_id, numero, fecha, String(descripcion).trim(),
       totalDebito, totalCredito, req.user.operador_id || req.user.id || null, notas || null]
    );
    const asientoId = cab.rows[0].id;

    const cols = 9;
    const vals = [];
    const ph = limpias.map((l, i) => {
      const b = i * cols;
      vals.push(tenant_id, asientoId, l.cuenta_id, l.cuenta_codigo, l.cuenta_nombre,
                l.descripcion, l.debito, l.credito, l.orden);
      const p = [];
      for (let k = 1; k <= cols; k++) p.push(`$${b + k}`);
      return `(${p.join(',')})`;
    }).join(',');

    await pool.query(
      `INSERT INTO asientos_detalle
        (tenant_id, asiento_id, cuenta_id, cuenta_codigo, cuenta_nombre,
         descripcion, debito, credito, orden)
       VALUES ${ph}`,
      vals
    );

    res.json({ success: true, data: cab.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Anular asiento (nunca se borra, queda el rastro)
router.put('/asientos/:id/anular', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const a = await pool.query(
      `SELECT * FROM asientos_contables WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!a.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });
    }
    const as = a.rows[0];
    if (as.estado === 'anulado') {
      return res.status(400).json({ success: false, mensaje: 'Este asiento ya esta anulado' });
    }
    if (as.tipo === 'automatico') {
      return res.status(400).json({
        success: false,
        mensaje: 'Este asiento fue generado por el sistema. Anule el documento de origen para revertirlo.'
      });
    }

    const per = await periodoAbierto(tenant_id, as.fecha);
    if (!per.abierto) {
      return res.status(400).json({
        success: false,
        mensaje: `El periodo ${per.mes}/${per.ano} esta cerrado. No se pueden anular asientos.`
      });
    }

    const r = await pool.query(
      `UPDATE asientos_contables
          SET estado = 'anulado', anulado_por = $1, anulado_en = NOW(), actualizado_en = NOW()
        WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [req.user.operador_id || req.user.id || null, req.params.id, tenant_id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// LIBRO DIARIO
// Todos los asientos de un rango, en orden cronologico
// ==========================================
router.get('/libro-diario', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desde, hasta, incluir_anulados } = req.query;

    if (!desde || !hasta) {
      return res.status(400).json({ success: false, mensaje: 'Debe indicar el rango de fechas' });
    }

    let filtroEstado = `AND a.estado = 'registrado'`;
    if (incluir_anulados === 'true') filtroEstado = '';

    const r = await pool.query(
      `SELECT a.id, a.numero, a.fecha, a.tipo, a.descripcion, a.estado,
              a.origen_documento, a.total_debito, a.total_credito,
              d.cuenta_codigo, d.cuenta_nombre, d.descripcion AS linea_descripcion,
              d.debito, d.credito, d.orden
         FROM asientos_contables a
         JOIN asientos_detalle d ON d.asiento_id = a.id
        WHERE a.tenant_id = $1 AND a.fecha >= $2 AND a.fecha <= $3 ${filtroEstado}
        ORDER BY a.fecha ASC, a.numero ASC, d.orden ASC`,
      [tenant_id, desde, hasta]
    );

    // Agrupar las lineas por asiento
    const mapa = new Map();
    for (const f of r.rows) {
      if (!mapa.has(f.id)) {
        mapa.set(f.id, {
          id: f.id, numero: f.numero, fecha: f.fecha, tipo: f.tipo,
          descripcion: f.descripcion, estado: f.estado,
          origen_documento: f.origen_documento,
          total_debito: f.total_debito, total_credito: f.total_credito,
          lineas: []
        });
      }
      mapa.get(f.id).lineas.push({
        cuenta_codigo: f.cuenta_codigo, cuenta_nombre: f.cuenta_nombre,
        descripcion: f.linea_descripcion, debito: f.debito, credito: f.credito
      });
    }
    const asientos = Array.from(mapa.values());

    const totalDebito = r2(asientos.reduce((s, a) => s + parseFloat(a.total_debito || 0), 0));
    const totalCredito = r2(asientos.reduce((s, a) => s + parseFloat(a.total_credito || 0), 0));

    res.json({
      success: true,
      data: {
        desde, hasta,
        cantidad_asientos: asientos.length,
        total_debito: totalDebito,
        total_credito: totalCredito,
        asientos
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// LIBRO MAYOR
// Movimiento de una cuenta con saldo acumulado
// ==========================================
router.get('/libro-mayor', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { cuenta_codigo, desde, hasta } = req.query;

    if (!cuenta_codigo) {
      return res.status(400).json({ success: false, mensaje: 'Debe indicar la cuenta' });
    }
    if (!desde || !hasta) {
      return res.status(400).json({ success: false, mensaje: 'Debe indicar el rango de fechas' });
    }

    const c = await pool.query(
      `SELECT * FROM cuentas_contables WHERE tenant_id = $1 AND codigo = $2`,
      [tenant_id, cuenta_codigo]
    );
    if (!c.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'La cuenta no existe' });
    }
    const cuenta = c.rows[0];

    // Saldo anterior: todo lo movido antes de la fecha inicial
    const ant = await pool.query(
      `SELECT COALESCE(SUM(d.debito), 0) AS debito, COALESCE(SUM(d.credito), 0) AS credito
         FROM asientos_detalle d
         JOIN asientos_contables a ON d.asiento_id = a.id
        WHERE d.tenant_id = $1 AND d.cuenta_codigo = $2
          AND a.fecha < $3 AND a.estado = 'registrado'`,
      [tenant_id, cuenta_codigo, desde]
    );
    const debAnt = parseFloat(ant.rows[0].debito) || 0;
    const creAnt = parseFloat(ant.rows[0].credito) || 0;
    const saldoAnterior = cuenta.naturaleza === 'deudora'
      ? r2(debAnt - creAnt)
      : r2(creAnt - debAnt);

    const mov = await pool.query(
      `SELECT a.numero, a.fecha, a.tipo, a.descripcion AS asiento_descripcion,
              a.origen_documento, d.descripcion, d.debito, d.credito
         FROM asientos_detalle d
         JOIN asientos_contables a ON d.asiento_id = a.id
        WHERE d.tenant_id = $1 AND d.cuenta_codigo = $2
          AND a.fecha >= $3 AND a.fecha <= $4 AND a.estado = 'registrado'
        ORDER BY a.fecha ASC, a.numero ASC, d.orden ASC`,
      [tenant_id, cuenta_codigo, desde, hasta]
    );

    let saldo = saldoAnterior;
    let totalDeb = 0;
    let totalCre = 0;

    const movimientos = mov.rows.map(m => {
      const deb = parseFloat(m.debito) || 0;
      const cre = parseFloat(m.credito) || 0;
      totalDeb = r2(totalDeb + deb);
      totalCre = r2(totalCre + cre);
      saldo = cuenta.naturaleza === 'deudora'
        ? r2(saldo + deb - cre)
        : r2(saldo + cre - deb);
      return {
        numero: m.numero, fecha: m.fecha, tipo: m.tipo,
        asiento_descripcion: m.asiento_descripcion,
        origen_documento: m.origen_documento,
        descripcion: m.descripcion,
        debito: r2(deb), credito: r2(cre), saldo
      };
    });

    res.json({
      success: true,
      data: {
        cuenta: {
          codigo: cuenta.codigo, nombre: cuenta.nombre,
          tipo: cuenta.tipo, naturaleza: cuenta.naturaleza
        },
        desde, hasta,
        saldo_anterior: saldoAnterior,
        total_debito: totalDeb,
        total_credito: totalCre,
        saldo_final: saldo,
        cantidad_movimientos: movimientos.length,
        movimientos
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// BALANZA DE COMPROBACION
// Todas las cuentas con saldo anterior, movimientos y saldo final
// ==========================================
router.get('/balanza', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desde, hasta, solo_con_movimiento } = req.query;

    if (!desde || !hasta) {
      return res.status(400).json({ success: false, mensaje: 'Debe indicar el rango de fechas' });
    }

    const cuentas = await pool.query(
      `SELECT * FROM cuentas_contables
        WHERE tenant_id = $1 AND acepta_movimiento = true
        ORDER BY codigo ASC`,
      [tenant_id]
    );

    // Movimiento anterior al rango
    const ant = await pool.query(
      `SELECT d.cuenta_codigo,
              COALESCE(SUM(d.debito), 0) AS debito,
              COALESCE(SUM(d.credito), 0) AS credito
         FROM asientos_detalle d
         JOIN asientos_contables a ON d.asiento_id = a.id
        WHERE d.tenant_id = $1 AND a.fecha < $2 AND a.estado = 'registrado'
        GROUP BY d.cuenta_codigo`,
      [tenant_id, desde]
    );
    const mapaAnt = {};
    for (const x of ant.rows) mapaAnt[x.cuenta_codigo] = x;

    // Movimiento dentro del rango
    const per = await pool.query(
      `SELECT d.cuenta_codigo,
              COALESCE(SUM(d.debito), 0) AS debito,
              COALESCE(SUM(d.credito), 0) AS credito
         FROM asientos_detalle d
         JOIN asientos_contables a ON d.asiento_id = a.id
        WHERE d.tenant_id = $1 AND a.fecha >= $2 AND a.fecha <= $3 AND a.estado = 'registrado'
        GROUP BY d.cuenta_codigo`,
      [tenant_id, desde, hasta]
    );
    const mapaPer = {};
    for (const x of per.rows) mapaPer[x.cuenta_codigo] = x;

    const lineas = [];
    let tSaldoAntDeudor = 0, tSaldoAntAcreedor = 0;
    let tDebito = 0, tCredito = 0;
    let tSaldoDeudor = 0, tSaldoAcreedor = 0;

    for (const c of cuentas.rows) {
      const a = mapaAnt[c.codigo] || { debito: 0, credito: 0 };
      const p = mapaPer[c.codigo] || { debito: 0, credito: 0 };

      const debAnt = parseFloat(a.debito) || 0;
      const creAnt = parseFloat(a.credito) || 0;
      const debPer = parseFloat(p.debito) || 0;
      const crePer = parseFloat(p.credito) || 0;

      const tieneMovimiento = debAnt || creAnt || debPer || crePer;
      if (solo_con_movimiento === 'true' && !tieneMovimiento) continue;

      // El saldo se expresa segun la naturaleza de la cuenta
      const saldoAnt = c.naturaleza === 'deudora' ? r2(debAnt - creAnt) : r2(creAnt - debAnt);
      const saldoFin = c.naturaleza === 'deudora'
        ? r2(debAnt + debPer - creAnt - crePer)
        : r2(creAnt + crePer - debAnt - debPer);

      // En la balanza, un saldo se coloca en la columna que corresponde a su signo real
      const saldoAntDeudor = c.naturaleza === 'deudora'
        ? (saldoAnt > 0 ? saldoAnt : 0) : (saldoAnt < 0 ? Math.abs(saldoAnt) : 0);
      const saldoAntAcreedor = c.naturaleza === 'acreedora'
        ? (saldoAnt > 0 ? saldoAnt : 0) : (saldoAnt < 0 ? Math.abs(saldoAnt) : 0);
      const saldoDeudor = c.naturaleza === 'deudora'
        ? (saldoFin > 0 ? saldoFin : 0) : (saldoFin < 0 ? Math.abs(saldoFin) : 0);
      const saldoAcreedor = c.naturaleza === 'acreedora'
        ? (saldoFin > 0 ? saldoFin : 0) : (saldoFin < 0 ? Math.abs(saldoFin) : 0);

      tSaldoAntDeudor = r2(tSaldoAntDeudor + saldoAntDeudor);
      tSaldoAntAcreedor = r2(tSaldoAntAcreedor + saldoAntAcreedor);
      tDebito = r2(tDebito + debPer);
      tCredito = r2(tCredito + crePer);
      tSaldoDeudor = r2(tSaldoDeudor + saldoDeudor);
      tSaldoAcreedor = r2(tSaldoAcreedor + saldoAcreedor);

      lineas.push({
        codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, naturaleza: c.naturaleza,
        saldo_anterior_deudor: saldoAntDeudor,
        saldo_anterior_acreedor: saldoAntAcreedor,
        debito: r2(debPer),
        credito: r2(crePer),
        saldo_deudor: saldoDeudor,
        saldo_acreedor: saldoAcreedor
      });
    }

    const cuadra = Math.abs(tDebito - tCredito) < 0.009
      && Math.abs(tSaldoDeudor - tSaldoAcreedor) < 0.009;

    res.json({
      success: true,
      data: {
        desde, hasta,
        cantidad_cuentas: lineas.length,
        totales: {
          saldo_anterior_deudor: tSaldoAntDeudor,
          saldo_anterior_acreedor: tSaldoAntAcreedor,
          debito: tDebito,
          credito: tCredito,
          saldo_deudor: tSaldoDeudor,
          saldo_acreedor: tSaldoAcreedor
        },
        cuadra,
        diferencia_movimientos: r2(tDebito - tCredito),
        diferencia_saldos: r2(tSaldoDeudor - tSaldoAcreedor),
        lineas
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// Saldos por cuenta a una fecha, segun naturaleza
// ==========================================
async function saldosPorTipo(tenant_id, hasta, tipos, desde) {
  const params = [tenant_id, hasta, tipos];
  let filtroDesde = '';
  if (desde) {
    params.push(desde);
    filtroDesde = ` AND a.fecha >= $${params.length}`;
  }
  const r = await pool.query(
    `SELECT c.codigo, c.nombre, c.tipo, c.naturaleza,
            COALESCE(SUM(d.debito), 0) AS debito,
            COALESCE(SUM(d.credito), 0) AS credito
       FROM cuentas_contables c
       LEFT JOIN asientos_detalle d ON d.cuenta_codigo = c.codigo AND d.tenant_id = c.tenant_id
       LEFT JOIN asientos_contables a ON d.asiento_id = a.id
        AND a.estado = 'registrado' AND a.fecha <= $2${filtroDesde}
      WHERE c.tenant_id = $1 AND c.acepta_movimiento = true AND c.tipo = ANY($3::varchar[])
      GROUP BY c.codigo, c.nombre, c.tipo, c.naturaleza
      ORDER BY c.codigo ASC`,
    params
  );
  return r.rows.map(x => {
    const deb = parseFloat(x.debito) || 0;
    const cre = parseFloat(x.credito) || 0;
    const saldo = x.naturaleza === 'deudora' ? r2(deb - cre) : r2(cre - deb);
    return { codigo: x.codigo, nombre: x.nombre, tipo: x.tipo, naturaleza: x.naturaleza, saldo };
  });
}

// ==========================================
// ESTADO DE RESULTADOS
// Ingresos menos costos y gastos de un periodo
// ==========================================
router.get('/estado-resultados', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { desde, hasta } = req.query;

    if (!desde || !hasta) {
      return res.status(400).json({ success: false, mensaje: 'Debe indicar el rango de fechas' });
    }

    const filas = await saldosPorTipo(tenant_id, hasta, ['ingreso', 'costo', 'gasto'], desde);

    const ingresos = filas.filter(f => f.tipo === 'ingreso' && f.saldo !== 0);
    const costos = filas.filter(f => f.tipo === 'costo' && f.saldo !== 0);
    const gastos = filas.filter(f => f.tipo === 'gasto' && f.saldo !== 0);

    const totalIngresos = r2(ingresos.reduce((s, x) => s + x.saldo, 0));
    const totalCostos = r2(costos.reduce((s, x) => s + x.saldo, 0));
    const totalGastos = r2(gastos.reduce((s, x) => s + x.saldo, 0));

    const utilidadBruta = r2(totalIngresos - totalCostos);
    const utilidadOperacional = r2(utilidadBruta - totalGastos);

    const margenBruto = totalIngresos !== 0 ? r2((utilidadBruta / totalIngresos) * 100) : 0;
    const margenNeto = totalIngresos !== 0 ? r2((utilidadOperacional / totalIngresos) * 100) : 0;

    res.json({
      success: true,
      data: {
        desde, hasta,
        ingresos, total_ingresos: totalIngresos,
        costos, total_costos: totalCostos,
        utilidad_bruta: utilidadBruta,
        gastos, total_gastos: totalGastos,
        utilidad_operacional: utilidadOperacional,
        margen_bruto: margenBruto,
        margen_neto: margenNeto
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// BALANCE GENERAL
// Activos = Pasivos + Capital, a una fecha de corte
// ==========================================
router.get('/balance-general', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { hasta } = req.query;

    if (!hasta) {
      return res.status(400).json({ success: false, mensaje: 'Debe indicar la fecha de corte' });
    }

    const filas = await saldosPorTipo(tenant_id, hasta, ['activo', 'pasivo', 'capital'], null);

    const activos = filas.filter(f => f.tipo === 'activo' && f.saldo !== 0);
    const pasivos = filas.filter(f => f.tipo === 'pasivo' && f.saldo !== 0);
    const capital = filas.filter(f => f.tipo === 'capital' && f.saldo !== 0);

    const totalActivos = r2(activos.reduce((s, x) => s + x.saldo, 0));
    const totalPasivos = r2(pasivos.reduce((s, x) => s + x.saldo, 0));
    const totalCapitalCuentas = r2(capital.reduce((s, x) => s + x.saldo, 0));

    // El resultado del ejercicio se calcula y se suma al capital
    const resultado = await saldosPorTipo(tenant_id, hasta, ['ingreso', 'costo', 'gasto'], null);
    const ing = r2(resultado.filter(f => f.tipo === 'ingreso').reduce((s, x) => s + x.saldo, 0));
    const cos = r2(resultado.filter(f => f.tipo === 'costo').reduce((s, x) => s + x.saldo, 0));
    const gas = r2(resultado.filter(f => f.tipo === 'gasto').reduce((s, x) => s + x.saldo, 0));
    const resultadoEjercicio = r2(ing - cos - gas);

    const totalCapital = r2(totalCapitalCuentas + resultadoEjercicio);
    const totalPasivoCapital = r2(totalPasivos + totalCapital);
    const diferencia = r2(totalActivos - totalPasivoCapital);
    const cuadra = Math.abs(diferencia) < 0.009;

    res.json({
      success: true,
      data: {
        hasta,
        activos, total_activos: totalActivos,
        pasivos, total_pasivos: totalPasivos,
        capital,
        total_capital_cuentas: totalCapitalCuentas,
        resultado_ejercicio: resultadoEjercicio,
        total_capital: totalCapital,
        total_pasivo_capital: totalPasivoCapital,
        diferencia,
        cuadra
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PERIODOS CONTABLES
// Un mes cerrado no admite asientos nuevos ni anulaciones
// ==========================================

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// GET - Lista de periodos de un ano, con el resumen de cada mes
router.get('/periodos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const ano = parseInt(req.query.ano) || new Date().getFullYear();

    const regs = await pool.query(
      `SELECT * FROM periodos_contables WHERE tenant_id = $1 AND ano = $2 ORDER BY mes ASC`,
      [tenant_id, ano]
    );
    const mapa = {};
    for (const p of regs.rows) mapa[p.mes] = p;

    const mov = await pool.query(
      `SELECT EXTRACT(MONTH FROM fecha)::int AS mes,
              COUNT(*) AS asientos,
              COALESCE(SUM(total_debito), 0) AS debito
         FROM asientos_contables
        WHERE tenant_id = $1 AND EXTRACT(YEAR FROM fecha) = $2 AND estado = 'registrado'
        GROUP BY EXTRACT(MONTH FROM fecha)`,
      [tenant_id, ano]
    );
    const mapaMov = {};
    for (const m of mov.rows) mapaMov[m.mes] = m;

    const meses = [];
    for (let m = 1; m <= 12; m++) {
      const p = mapa[m];
      const mv = mapaMov[m] || { asientos: 0, debito: 0 };
      meses.push({
        ano, mes: m, nombre: MESES[m - 1],
        id: p ? p.id : null,
        estado: p ? p.estado : 'abierto',
        cerrado_en: p ? p.cerrado_en : null,
        notas: p ? p.notas : null,
        asientos: parseInt(mv.asientos) || 0,
        movimiento: r2(mv.debito)
      });
    }

    res.json({ success: true, data: { ano, meses } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Cerrar un periodo
router.post('/periodos/cerrar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const ano = parseInt(req.body.ano);
    const mes = parseInt(req.body.mes);
    const { notas } = req.body;

    if (!ano || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ success: false, mensaje: 'Indique un ano y mes validos' });
    }

    const actual = await pool.query(
      `SELECT * FROM periodos_contables WHERE tenant_id = $1 AND ano = $2 AND mes = $3`,
      [tenant_id, ano, mes]
    );
    if (actual.rows[0] && actual.rows[0].estado === 'cerrado') {
      return res.status(400).json({ success: false, mensaje: 'Este periodo ya esta cerrado' });
    }

    // No se cierra un mes si el anterior sigue abierto
    let anoAnt = mes === 1 ? ano - 1 : ano;
    let mesAnt = mes === 1 ? 12 : mes - 1;
    const hayMovAnt = await pool.query(
      `SELECT COUNT(*) AS total FROM asientos_contables
        WHERE tenant_id = $1 AND EXTRACT(YEAR FROM fecha) = $2
          AND EXTRACT(MONTH FROM fecha) = $3 AND estado = 'registrado'`,
      [tenant_id, anoAnt, mesAnt]
    );
    if (parseInt(hayMovAnt.rows[0].total) > 0) {
      const ant = await pool.query(
        `SELECT estado FROM periodos_contables WHERE tenant_id = $1 AND ano = $2 AND mes = $3`,
        [tenant_id, anoAnt, mesAnt]
      );
      if (!ant.rows[0] || ant.rows[0].estado !== 'cerrado') {
        return res.status(400).json({
          success: false,
          mensaje: `No puede cerrar ${MESES[mes-1]} ${ano} porque ${MESES[mesAnt-1]} ${anoAnt} tiene movimientos y sigue abierto. Cierre los periodos en orden.`
        });
      }
    }

    // Verificar que el periodo cuadre antes de cerrarlo
    const cuadre = await pool.query(
      `SELECT COALESCE(SUM(total_debito), 0) AS debito,
              COALESCE(SUM(total_credito), 0) AS credito,
              COUNT(*) AS asientos
         FROM asientos_contables
        WHERE tenant_id = $1 AND EXTRACT(YEAR FROM fecha) = $2
          AND EXTRACT(MONTH FROM fecha) = $3 AND estado = 'registrado'`,
      [tenant_id, ano, mes]
    );
    const deb = r2(cuadre.rows[0].debito);
    const cre = r2(cuadre.rows[0].credito);
    if (Math.abs(deb - cre) > 0.009) {
      return res.status(400).json({
        success: false,
        mensaje: `El periodo no cuadra. Debito: ${deb.toFixed(2)} · Credito: ${cre.toFixed(2)}. Revise los asientos antes de cerrar.`
      });
    }

    const usuario = req.user.operador_id || req.user.id || null;
    let r;
    if (actual.rows[0]) {
      r = await pool.query(
        `UPDATE periodos_contables
            SET estado = 'cerrado', cerrado_por = $1, cerrado_en = NOW(), notas = $2
          WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [usuario, notas || null, actual.rows[0].id, tenant_id]
      );
    } else {
      r = await pool.query(
        `INSERT INTO periodos_contables (tenant_id, ano, mes, estado, cerrado_por, cerrado_en, notas)
         VALUES ($1,$2,$3,'cerrado',$4,NOW(),$5) RETURNING *`,
        [tenant_id, ano, mes, usuario, notas || null]
      );
    }

    res.json({
      success: true,
      mensaje: `${MESES[mes-1]} ${ano} cerrado con ${cuadre.rows[0].asientos} asiento(s) por RD$ ${deb.toFixed(2)}`,
      data: r.rows[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Reabrir un periodo
router.post('/periodos/reabrir', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const ano = parseInt(req.body.ano);
    const mes = parseInt(req.body.mes);

    if (!ano || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ success: false, mensaje: 'Indique un ano y mes validos' });
    }

    const actual = await pool.query(
      `SELECT * FROM periodos_contables WHERE tenant_id = $1 AND ano = $2 AND mes = $3`,
      [tenant_id, ano, mes]
    );
    if (!actual.rows[0] || actual.rows[0].estado !== 'cerrado') {
      return res.status(400).json({ success: false, mensaje: 'Este periodo no esta cerrado' });
    }

    // No se reabre un mes si hay meses posteriores cerrados
    const posteriores = await pool.query(
      `SELECT ano, mes FROM periodos_contables
        WHERE tenant_id = $1 AND estado = 'cerrado'
          AND (ano > $2 OR (ano = $2 AND mes > $3))
        ORDER BY ano ASC, mes ASC LIMIT 1`,
      [tenant_id, ano, mes]
    );
    if (posteriores.rows[0]) {
      const p = posteriores.rows[0];
      return res.status(400).json({
        success: false,
        mensaje: `No puede reabrir ${MESES[mes-1]} ${ano} porque ${MESES[p.mes-1]} ${p.ano} ya esta cerrado. Reabra los periodos del mas reciente al mas antiguo.`
      });
    }

    const r = await pool.query(
      `UPDATE periodos_contables
          SET estado = 'abierto', cerrado_por = NULL, cerrado_en = NULL
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [actual.rows[0].id, tenant_id]
    );

    res.json({
      success: true,
      mensaje: `${MESES[mes-1]} ${ano} reabierto`,
      data: r.rows[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;