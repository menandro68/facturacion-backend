const express = require('express');
const contaAuto = require('../utils/contabilidadAuto');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// ==========================================
// GET - Lista de empleados
// ==========================================
router.get('/empleados', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { estado } = req.query;
    let query = `SELECT * FROM empleados WHERE tenant_id = $1`;
    const params = [tenant_id];
    if (estado) {
      params.push(estado);
      query += ` AND estado = $${params.length}`;
    }
    query += ` ORDER BY nombre ASC`;
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - Detalle de un empleado
// ==========================================
router.get('/empleados/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM empleados WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// POST - Crear empleado
// ==========================================
router.post('/empleados', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const {
      codigo, nombre, cedula, nss, cargo, departamento,
      fecha_ingreso, tipo_contrato, salario_base, frecuencia_pago,
      forma_pago, banco, cuenta_bancaria, afp_id, ars_id,
      telefono, email, direccion, exento_isr
    } = req.body;

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre es obligatorio' });
    }
    if (salario_base != null && parseFloat(salario_base) < 0) {
      return res.status(400).json({ success: false, mensaje: 'El salario no puede ser negativo' });
    }
    if (cedula && String(cedula).trim()) {
      const dup = await pool.query(
        `SELECT id FROM empleados WHERE tenant_id = $1 AND cedula = $2`,
        [tenant_id, String(cedula).trim()]
      );
      if (dup.rows[0]) {
        return res.status(400).json({ success: false, mensaje: 'Ya existe un empleado con esa cedula' });
      }
    }

    const result = await pool.query(
      `INSERT INTO empleados
        (tenant_id, codigo, nombre, cedula, nss, cargo, departamento,
         fecha_ingreso, tipo_contrato, salario_base, frecuencia_pago,
         forma_pago, banco, cuenta_bancaria, afp_id, ars_id,
         telefono, email, direccion, exento_isr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        tenant_id,
        codigo || null,
        String(nombre).trim(),
        cedula ? String(cedula).trim() : null,
        nss || null,
        cargo || null,
        departamento || null,
        fecha_ingreso || null,
        tipo_contrato || 'indefinido',
        parseFloat(salario_base) || 0,
        frecuencia_pago || 'mensual',
        forma_pago || 'transferencia',
        banco || null,
        cuenta_bancaria || null,
        afp_id || null,
        ars_id || null,
        telefono || null,
        email || null,
        direccion || null,
        exento_isr === true
      ]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PUT - Actualizar empleado
// ==========================================
router.put('/empleados/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const {
      codigo, nombre, cedula, nss, cargo, departamento,
      fecha_ingreso, fecha_salida, tipo_contrato, salario_base, frecuencia_pago,
      forma_pago, banco, cuenta_bancaria, afp_id, ars_id,
      telefono, email, direccion, exento_isr, estado
    } = req.body;

    const actual = await pool.query(
      `SELECT * FROM empleados WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!actual.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre es obligatorio' });
    }
    if (salario_base != null && parseFloat(salario_base) < 0) {
      return res.status(400).json({ success: false, mensaje: 'El salario no puede ser negativo' });
    }
    if (cedula && String(cedula).trim()) {
      const dup = await pool.query(
        `SELECT id FROM empleados WHERE tenant_id = $1 AND cedula = $2 AND id <> $3`,
        [tenant_id, String(cedula).trim(), id]
      );
      if (dup.rows[0]) {
        return res.status(400).json({ success: false, mensaje: 'Ya existe otro empleado con esa cedula' });
      }
    }

    const a = actual.rows[0];
    const result = await pool.query(
      `UPDATE empleados SET
         codigo = $1, nombre = $2, cedula = $3, nss = $4, cargo = $5,
         departamento = $6, fecha_ingreso = $7, fecha_salida = $8,
         tipo_contrato = $9, salario_base = $10, frecuencia_pago = $11,
         forma_pago = $12, banco = $13, cuenta_bancaria = $14,
         afp_id = $15, ars_id = $16, telefono = $17, email = $18,
         direccion = $19, exento_isr = $20, estado = $21,
         actualizado_en = NOW()
       WHERE id = $22 AND tenant_id = $23
       RETURNING *`,
      [
        codigo !== undefined ? codigo : a.codigo,
        String(nombre).trim(),
        cedula ? String(cedula).trim() : null,
        nss !== undefined ? nss : a.nss,
        cargo !== undefined ? cargo : a.cargo,
        departamento !== undefined ? departamento : a.departamento,
        fecha_ingreso || null,
        fecha_salida || null,
        tipo_contrato || a.tipo_contrato,
        salario_base != null ? parseFloat(salario_base) : a.salario_base,
        frecuencia_pago || a.frecuencia_pago,
        forma_pago || a.forma_pago,
        banco !== undefined ? banco : a.banco,
        cuenta_bancaria !== undefined ? cuenta_bancaria : a.cuenta_bancaria,
        afp_id !== undefined ? afp_id : a.afp_id,
        ars_id !== undefined ? ars_id : a.ars_id,
        telefono !== undefined ? telefono : a.telefono,
        email !== undefined ? email : a.email,
        direccion !== undefined ? direccion : a.direccion,
        exento_isr !== undefined ? exento_isr === true : a.exento_isr,
        estado || a.estado,
        id,
        tenant_id
      ]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PUT - Inactivar empleado (nunca se borra: la nomina historica lo referencia)
// ==========================================
router.put('/empleados/:id/inactivar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { fecha_salida } = req.body;
    const result = await pool.query(
      `UPDATE empleados
          SET estado = 'inactivo',
              fecha_salida = COALESCE($3, fecha_salida, CURRENT_DATE),
              actualizado_en = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [req.params.id, tenant_id, fecha_salida || null]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PUT - Reactivar empleado
// ==========================================
router.put('/empleados/:id/reactivar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `UPDATE empleados
          SET estado = 'activo', fecha_salida = NULL, actualizado_en = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [req.params.id, tenant_id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - Configuracion vigente (la mas reciente segun fecha)
// ==========================================
router.get('/config', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM nomina_config
        WHERE tenant_id = $1 AND vigente_desde <= CURRENT_DATE
        ORDER BY vigente_desde DESC
        LIMIT 1`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - Historial de configuraciones
// ==========================================
router.get('/config/historial', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM nomina_config WHERE tenant_id = $1 ORDER BY vigente_desde DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// POST - Guardar configuracion (nueva vigencia o actualiza la de esa fecha)
// ==========================================
router.post('/config', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const {
      vigente_desde, afp_empleado_pct, afp_empleador_pct,
      sfs_empleado_pct, sfs_empleador_pct, srl_empleador_pct,
      infotep_empleador_pct, salario_minimo_cotizable,
      tope_afp_salarios, tope_sfs_salarios, escala_isr, notas
    } = req.body;

    if (!vigente_desde) {
      return res.status(400).json({ success: false, mensaje: 'La fecha de vigencia es obligatoria' });
    }

    const pcts = {
      afp_empleado_pct, afp_empleador_pct, sfs_empleado_pct,
      sfs_empleador_pct, srl_empleador_pct, infotep_empleador_pct
    };
    for (const [k, v] of Object.entries(pcts)) {
      const n = parseFloat(v);
      if (v != null && v !== '' && (isNaN(n) || n < 0 || n > 100)) {
        return res.status(400).json({ success: false, mensaje: `El porcentaje ${k} debe estar entre 0 y 100` });
      }
    }

    let escala = [];
    if (escala_isr) {
      escala = typeof escala_isr === 'string' ? JSON.parse(escala_isr) : escala_isr;
      if (!Array.isArray(escala)) {
        return res.status(400).json({ success: false, mensaje: 'La escala de ISR debe ser una lista' });
      }
      for (const t of escala) {
        if (t.desde == null || t.tasa == null) {
          return res.status(400).json({ success: false, mensaje: 'Cada tramo de ISR necesita desde y tasa' });
        }
      }
      escala.sort((a, b) => parseFloat(a.desde) - parseFloat(b.desde));
    }

    const existe = await pool.query(
      `SELECT id FROM nomina_config WHERE tenant_id = $1 AND vigente_desde = $2`,
      [tenant_id, vigente_desde]
    );

    const valores = [
      parseFloat(afp_empleado_pct) || 0,
      parseFloat(afp_empleador_pct) || 0,
      parseFloat(sfs_empleado_pct) || 0,
      parseFloat(sfs_empleador_pct) || 0,
      parseFloat(srl_empleador_pct) || 0,
      parseFloat(infotep_empleador_pct) || 0,
      parseFloat(salario_minimo_cotizable) || 0,
      parseInt(tope_afp_salarios) || 0,
      parseInt(tope_sfs_salarios) || 0,
      JSON.stringify(escala),
      notas || null
    ];

    let result;
    if (existe.rows[0]) {
      result = await pool.query(
        `UPDATE nomina_config SET
           afp_empleado_pct = $1, afp_empleador_pct = $2,
           sfs_empleado_pct = $3, sfs_empleador_pct = $4,
           srl_empleador_pct = $5, infotep_empleador_pct = $6,
           salario_minimo_cotizable = $7, tope_afp_salarios = $8,
           tope_sfs_salarios = $9, escala_isr = $10::jsonb, notas = $11,
           actualizado_en = NOW()
         WHERE id = $12 AND tenant_id = $13
         RETURNING *`,
        [...valores, existe.rows[0].id, tenant_id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO nomina_config
          (tenant_id, vigente_desde, afp_empleado_pct, afp_empleador_pct,
           sfs_empleado_pct, sfs_empleador_pct, srl_empleador_pct,
           infotep_empleador_pct, salario_minimo_cotizable,
           tope_afp_salarios, tope_sfs_salarios, escala_isr, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
         RETURNING *`,
        [tenant_id, vigente_desde, ...valores]
      );
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// MOTOR DE CALCULO DE NOMINA
// ==========================================

// Obtiene la configuracion vigente a una fecha dada
async function obtenerConfig(tenant_id, fecha) {
  const r = await pool.query(
    `SELECT * FROM nomina_config
      WHERE tenant_id = $1 AND vigente_desde <= $2
      ORDER BY vigente_desde DESC LIMIT 1`,
    [tenant_id, fecha]
  );
  return r.rows[0] || null;
}

// Divisor segun la frecuencia de pago (cuantos periodos tiene el ano)
function periodosPorAno(frecuencia) {
  if (frecuencia === 'semanal') return 52;
  if (frecuencia === 'quincenal') return 24;
  return 12;
}

// Calcula el ISR del periodo a partir del ingreso gravable del periodo.
// Procedimiento DGII: se anualiza el neto (ingreso menos TSS del empleado),
// se aplica la escala anual, y el ISR anual se divide entre los periodos del ano.
function calcularISR(netoGravablePeriodo, escala, periodos) {
  if (!Array.isArray(escala) || escala.length === 0) return 0;
  const anual = netoGravablePeriodo * periodos;
  let tramo = null;
  for (const t of escala) {
    const desde = parseFloat(t.desde) || 0;
    const hasta = t.hasta == null || t.hasta === '' ? Infinity : parseFloat(t.hasta);
    if (anual >= desde && anual <= hasta) { tramo = t; break; }
  }
  if (!tramo) {
    const ordenada = [...escala].sort((a, b) => parseFloat(a.desde) - parseFloat(b.desde));
    tramo = ordenada[ordenada.length - 1];
  }
  const desde = parseFloat(tramo.desde) || 0;
  const tasa = parseFloat(tramo.tasa) || 0;
  const cuotaFija = parseFloat(tramo.cuota_fija) || 0;
  if (tasa <= 0 && cuotaFija <= 0) return 0;
  const excedente = Math.max(0, anual - desde);
  const isrAnual = cuotaFija + (excedente * tasa / 100);
  return Math.max(0, isrAnual / periodos);
}

const r2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

// Calcula la nomina de UN empleado. Devuelve el desglose completo.
function calcularEmpleado(emp, config, movimientos) {
  const frecuencia = emp.frecuencia_pago || 'mensual';
  const periodos = periodosPorAno(frecuencia);
  const salarioMensual = parseFloat(emp.salario_base) || 0;
  // El salario base se guarda mensual: se convierte al periodo de pago
  const salarioPeriodo = frecuencia === 'mensual' ? salarioMensual
    : frecuencia === 'quincenal' ? salarioMensual / 2
    : salarioMensual * 12 / 52;

  const movs = movimientos || [];
  let ingresosCotizables = 0, ingresosNoCotizables = 0;
  let ingresosGravables = 0, ingresosNoGravables = 0;
  let deduccionesExtra = 0;
  const detalleMovs = [];

  for (const m of movs) {
    const monto = parseFloat(m.monto) || 0;
    if (m.tipo === 'deduccion') {
      deduccionesExtra += monto;
    } else {
      if (m.cotizable) ingresosCotizables += monto; else ingresosNoCotizables += monto;
      if (m.gravable_isr) ingresosGravables += monto; else ingresosNoGravables += monto;
    }
    detalleMovs.push({
      concepto: m.concepto_nombre || 'Movimiento',
      tipo: m.tipo,
      monto: r2(monto)
    });
  }

  const totalIngresos = salarioPeriodo + ingresosCotizables + ingresosNoCotizables;

  // Base cotizable con tope (tope expresado en salarios minimos cotizables)
  const salMin = parseFloat(config.salario_minimo_cotizable) || 0;
  const topeAfpN = parseInt(config.tope_afp_salarios) || 0;
  const topeSfsN = parseInt(config.tope_sfs_salarios) || 0;
  const baseCotizableMensual = (salarioMensual + (ingresosCotizables * (12 / periodos)));
  const topeAfpMensual = topeAfpN > 0 && salMin > 0 ? topeAfpN * salMin : Infinity;
  const topeSfsMensual = topeSfsN > 0 && salMin > 0 ? topeSfsN * salMin : Infinity;
  const baseAfpMensual = Math.min(baseCotizableMensual, topeAfpMensual);
  const baseSfsMensual = Math.min(baseCotizableMensual, topeSfsMensual);
  const baseAfp = baseAfpMensual * 12 / periodos;
  const baseSfs = baseSfsMensual * 12 / periodos;
  const salarioCotizable = Math.min(baseAfp, baseSfs) > 0 ? (baseCotizableMensual * 12 / periodos) : 0;

  const afpEmpleado = r2(baseAfp * (parseFloat(config.afp_empleado_pct) || 0) / 100);
  const sfsEmpleado = r2(baseSfs * (parseFloat(config.sfs_empleado_pct) || 0) / 100);
  const afpEmpleador = r2(baseAfp * (parseFloat(config.afp_empleador_pct) || 0) / 100);
  const sfsEmpleador = r2(baseSfs * (parseFloat(config.sfs_empleador_pct) || 0) / 100);
  const srlEmpleador = r2(baseSfs * (parseFloat(config.srl_empleador_pct) || 0) / 100);
  const infotepEmpleador = r2((salarioPeriodo + ingresosCotizables) * (parseFloat(config.infotep_empleador_pct) || 0) / 100);

  // ISR: sobre el ingreso gravable menos la TSS del empleado
  let isr = 0;
  if (!emp.exento_isr) {
    const baseGravable = salarioPeriodo + ingresosGravables - afpEmpleado - sfsEmpleado;
    const escala = Array.isArray(config.escala_isr) ? config.escala_isr : [];
    isr = r2(calcularISR(Math.max(0, baseGravable), escala, periodos));
  }

  const totalDeducciones = r2(afpEmpleado + sfsEmpleado + isr + deduccionesExtra);
  const netoPagar = r2(totalIngresos - totalDeducciones);
  const totalAportes = r2(afpEmpleador + sfsEmpleador + srlEmpleador + infotepEmpleador);

  return {
    empleado_id: emp.id,
    empleado_nombre: emp.nombre,
    empleado_cedula: emp.cedula,
    cargo: emp.cargo,
    salario_base: r2(salarioPeriodo),
    otros_ingresos: r2(ingresosCotizables + ingresosNoCotizables),
    total_ingresos: r2(totalIngresos),
    salario_cotizable: r2(salarioCotizable),
    afp_empleado: afpEmpleado,
    sfs_empleado: sfsEmpleado,
    isr,
    otras_deducciones: r2(deduccionesExtra),
    total_deducciones: totalDeducciones,
    neto_pagar: netoPagar,
    afp_empleador: afpEmpleador,
    sfs_empleador: sfsEmpleador,
    srl_empleador: srlEmpleador,
    infotep_empleador: infotepEmpleador,
    total_aportes_empleador: totalAportes,
    desglose: {
      frecuencia,
      periodos_ano: periodos,
      salario_mensual: r2(salarioMensual),
      base_afp: r2(baseAfp),
      base_sfs: r2(baseSfs),
      movimientos: detalleMovs
    }
  };
}

// ==========================================
// POST - Previsualizar calculo (no guarda nada)
// ==========================================
router.post('/calcular/preview', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { fecha_fin, empleado_id } = req.body;
    const fecha = fecha_fin || new Date().toISOString().slice(0, 10);

    const config = await obtenerConfig(tenant_id, fecha);
    if (!config) {
      return res.status(400).json({
        success: false,
        mensaje: 'No hay configuracion de nomina vigente para esa fecha. Registrela en la pestana Configuracion.'
      });
    }

    let q = `SELECT * FROM empleados WHERE tenant_id = $1 AND estado = 'activo'`;
    const params = [tenant_id];
    if (empleado_id) { params.push(empleado_id); q += ` AND id = $${params.length}`; }
    q += ` ORDER BY nombre ASC`;
    const empleados = await pool.query(q, params);

    if (empleados.rows.length === 0) {
      return res.json({ success: true, data: { config_vigente: config.vigente_desde, lineas: [], totales: null } });
    }

    const ids = empleados.rows.map(e => e.id);
    const movs = await pool.query(
      `SELECT * FROM nomina_movimientos
        WHERE tenant_id = $1 AND periodo_id IS NULL AND aplicado = false
          AND empleado_id = ANY($2::uuid[])`,
      [tenant_id, ids]
    );

    const lineas = empleados.rows.map(emp =>
      calcularEmpleado(emp, config, movs.rows.filter(m => m.empleado_id === emp.id))
    );

    const totales = lineas.reduce((acc, l) => ({
      total_ingresos: r2(acc.total_ingresos + l.total_ingresos),
      total_deducciones: r2(acc.total_deducciones + l.total_deducciones),
      total_neto: r2(acc.total_neto + l.neto_pagar),
      total_aportes_empleador: r2(acc.total_aportes_empleador + l.total_aportes_empleador),
      cantidad_empleados: acc.cantidad_empleados + 1
    }), { total_ingresos: 0, total_deducciones: 0, total_neto: 0, total_aportes_empleador: 0, cantidad_empleados: 0 });

    res.json({
      success: true,
      data: { config_vigente: config.vigente_desde, lineas, totales }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// PERIODOS DE NOMINA
// ==========================================

// GET - Lista de periodos
router.get('/periodos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM nomina_periodos WHERE tenant_id = $1
        ORDER BY fecha_inicio DESC, creado_en DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Detalle de un periodo con sus lineas
router.get('/periodos/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const cab = await pool.query(
      `SELECT * FROM nomina_periodos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!cab.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Periodo no encontrado' });
    }
    const det = await pool.query(
      `SELECT * FROM nomina_detalle WHERE periodo_id = $1 AND tenant_id = $2
        ORDER BY empleado_nombre ASC`,
      [req.params.id, tenant_id]
    );
    res.json({ success: true, data: { periodo: cab.rows[0], detalle: det.rows } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear periodo en borrador
router.post('/periodos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { descripcion, tipo, frecuencia, fecha_inicio, fecha_fin, fecha_pago } = req.body;

    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({ success: false, mensaje: 'Las fechas de inicio y fin son obligatorias' });
    }
    if (new Date(fecha_fin) < new Date(fecha_inicio)) {
      return res.status(400).json({ success: false, mensaje: 'La fecha fin no puede ser anterior a la de inicio' });
    }

    const dup = await pool.query(
      `SELECT id FROM nomina_periodos
        WHERE tenant_id = $1 AND fecha_inicio = $2 AND fecha_fin = $3 AND estado <> 'anulada'`,
      [tenant_id, fecha_inicio, fecha_fin]
    );
    if (dup.rows[0]) {
      return res.status(400).json({ success: false, mensaje: 'Ya existe un periodo con esas mismas fechas' });
    }

    const cont = await pool.query(
      `SELECT COUNT(*) AS total FROM nomina_periodos WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numero = 'NOM-' + String(parseInt(cont.rows[0].total) + 1).padStart(5, '0');

    const result = await pool.query(
      `INSERT INTO nomina_periodos
        (tenant_id, numero, descripcion, tipo, frecuencia, fecha_inicio, fecha_fin, fecha_pago)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        tenant_id, numero, descripcion || null,
        tipo || 'ordinaria', frecuencia || 'mensual',
        fecha_inicio, fecha_fin, fecha_pago || null
      ]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Procesar periodo: calcula, congela el detalle y bloquea la edicion
router.put('/periodos/:id/calcular', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;

    const cab = await pool.query(
      `SELECT * FROM nomina_periodos WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );
    if (!cab.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Periodo no encontrado' });
    }
    const periodo = cab.rows[0];
    if (periodo.estado !== 'borrador') {
      return res.status(400).json({
        success: false,
        mensaje: `Este periodo ya fue procesado (estado: ${periodo.estado}). Anulelo si necesita recalcularlo.`
      });
    }

    const fechaRef = periodo.fecha_fin instanceof Date
      ? periodo.fecha_fin.toISOString().slice(0, 10)
      : String(periodo.fecha_fin).slice(0, 10);
    const cfg = await pool.query(
      `SELECT * FROM nomina_config
        WHERE tenant_id = $1 AND vigente_desde <= $2
        ORDER BY vigente_desde DESC LIMIT 1`,
      [tenant_id, fechaRef]
    );
    const config = cfg.rows[0];
    if (!config) {
      return res.status(400).json({
        success: false,
        mensaje: 'No hay configuracion de nomina vigente para la fecha fin del periodo.'
      });
    }

    const empleados = await pool.query(
      `SELECT * FROM empleados
        WHERE tenant_id = $1 AND estado = 'activo' AND frecuencia_pago = $2
        ORDER BY nombre ASC`,
      [tenant_id, periodo.frecuencia]
    );
    if (empleados.rows.length === 0) {
      return res.status(400).json({
        success: false,
        mensaje: `No hay empleados activos con frecuencia de pago "${periodo.frecuencia}".`
      });
    }

      const ids = empleados.rows.map(e => e.id);
    const movs = await pool.query(
      `SELECT * FROM nomina_movimientos
        WHERE tenant_id = $1 AND aplicado = false
          AND (periodo_id = $2 OR periodo_id IS NULL)
          AND empleado_id = ANY($3::uuid[])`,
      [tenant_id, id, ids]
    );

    // Prestamos activos: la cuota se descuenta automaticamente
    const prestamos = await pool.query(
      `SELECT * FROM nomina_prestamos
        WHERE tenant_id = $1 AND estado = 'activo' AND balance > 0
          AND empleado_id = ANY($2::uuid[])
        ORDER BY creado_en ASC`,
      [tenant_id, ids]
    );

    // 1) Se calcula TODO en memoria antes de escribir nada
    const cuotasAplicar = [];
    const lineas = empleados.rows.map(emp => {
      const movsEmp = movs.rows.filter(m => m.empleado_id === emp.id).map(m => ({ ...m }));
      for (const pr of prestamos.rows.filter(p => p.empleado_id === emp.id)) {
        const balance = parseFloat(pr.balance) || 0;
        const cuota = parseFloat(pr.cuota) || 0;
        const aplicar = r2(Math.min(cuota, balance));
        if (aplicar <= 0) continue;
        movsEmp.push({
          tipo: 'deduccion',
          monto: aplicar,
          concepto_nombre: `Prestamo ${pr.numero || ''}`.trim(),
          cotizable: false,
          gravable_isr: false
        });
        cuotasAplicar.push({
          prestamo_id: pr.id,
          empleado_id: emp.id,
          monto: aplicar,
          balance_anterior: r2(balance),
          balance_nuevo: r2(balance - aplicar)
        });
      }
      return calcularEmpleado(emp, config, movsEmp);
    });

    let tIng = 0, tDed = 0, tNeto = 0, tAportes = 0;
    for (const l of lineas) {
      tIng += l.total_ingresos;
      tDed += l.total_deducciones;
      tNeto += l.neto_pagar;
      tAportes += l.total_aportes_empleador;
    }

    // 2) Se limpia cualquier detalle previo de este periodo
    await pool.query(
      `DELETE FROM nomina_detalle WHERE periodo_id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );

    // 3) Un solo INSERT con todas las lineas
    const cols = 22;
    const valores = [];
    const placeholders = lineas.map((l, i) => {
      const b = i * cols;
      valores.push(
        tenant_id, id, l.empleado_id, l.empleado_nombre, l.empleado_cedula, l.cargo,
        l.salario_base, l.otros_ingresos, l.total_ingresos, l.salario_cotizable,
        l.afp_empleado, l.sfs_empleado, l.isr, l.otras_deducciones, l.total_deducciones, l.neto_pagar,
        l.afp_empleador, l.sfs_empleador, l.srl_empleador, l.infotep_empleador,
        l.total_aportes_empleador, JSON.stringify(l.desglose)
      );
      const p = [];
      for (let k = 1; k <= cols; k++) p.push(`$${b + k}`);
      p[cols - 1] = `$${b + cols}::jsonb`;
      return `(${p.join(',')})`;
    }).join(',');

    await pool.query(
      `INSERT INTO nomina_detalle
        (tenant_id, periodo_id, empleado_id, empleado_nombre, empleado_cedula, cargo,
         salario_base, otros_ingresos, total_ingresos, salario_cotizable,
         afp_empleado, sfs_empleado, isr, otras_deducciones, total_deducciones, neto_pagar,
         afp_empleador, sfs_empleador, srl_empleador, infotep_empleador,
         total_aportes_empleador, desglose)
       VALUES ${placeholders}`,
      valores
    );

      // 4) Se marcan los movimientos como aplicados
    await pool.query(
      `UPDATE nomina_movimientos SET aplicado = true, periodo_id = $2
        WHERE tenant_id = $1 AND aplicado = false
          AND (periodo_id = $2 OR periodo_id IS NULL)
          AND empleado_id = ANY($3::uuid[])`,
      [tenant_id, id, ids]
    );

    // 4b) Se registran las cuotas de prestamo y se rebajan los balances
    for (const c of cuotasAplicar) {
      await pool.query(
        `INSERT INTO nomina_prestamos_cuotas
          (tenant_id, prestamo_id, periodo_id, empleado_id, monto, balance_anterior, balance_nuevo)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tenant_id, c.prestamo_id, id, c.empleado_id, c.monto, c.balance_anterior, c.balance_nuevo]
      );
      await pool.query(
        `UPDATE nomina_prestamos
            SET balance = $1,
                total_descontado = COALESCE(total_descontado,0) + $2,
                estado = CASE WHEN $1 <= 0.009 THEN 'saldado' ELSE estado END,
                saldado_en = CASE WHEN $1 <= 0.009 THEN NOW() ELSE saldado_en END,
                actualizado_en = NOW()
          WHERE id = $3 AND tenant_id = $4`,
        [c.balance_nuevo, c.monto, c.prestamo_id, tenant_id]
      );
    }

    // 5) Se cierra la cabecera con los totales y las tasas usadas
    const actualizado = await pool.query(
      `UPDATE nomina_periodos SET
         estado = 'procesada',
         total_ingresos = $1, total_deducciones = $2, total_neto = $3,
         total_aportes_empleador = $4, cantidad_empleados = $5,
         config_snapshot = $6::jsonb,
         procesado_por = $7, procesado_en = NOW(), actualizado_en = NOW()
       WHERE id = $8 AND tenant_id = $9 AND estado = 'borrador'
       RETURNING *`,
      [
        Math.round(tIng * 100) / 100,
        Math.round(tDed * 100) / 100,
        Math.round(tNeto * 100) / 100,
        Math.round(tAportes * 100) / 100,
        lineas.length,
        JSON.stringify(config),
        req.user.operador_id || req.user.id || null,
        id, tenant_id
      ]
    );

    if (!actualizado.rows[0]) {
      return res.status(409).json({
        success: false,
        mensaje: 'El periodo cambio de estado mientras se calculaba. Vuelva a intentarlo.'
      });
    }

    // Asiento contable automatico. Si falla, la nomina ya quedo procesada igual.
    contaAuto.asientoNomina({
      tenant_id,
      periodo: actualizado.rows[0],
      detalle: lineas,
      usuario_id: req.user.operador_id || req.user.id || null
    }).catch(() => {});

    res.json({ success: true, data: actualizado.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Marcar como pagada
router.put('/periodos/:id/pagar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { fecha_pago } = req.body;
    const actual = await pool.query(
      `SELECT estado FROM nomina_periodos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!actual.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Periodo no encontrado' });
    }
    if (actual.rows[0].estado !== 'procesada') {
      return res.status(400).json({ success: false, mensaje: 'Solo se puede pagar un periodo procesado' });
    }
    const result = await pool.query(
      `UPDATE nomina_periodos
          SET estado = 'pagada',
              fecha_pago = COALESCE($3, fecha_pago, CURRENT_DATE),
              actualizado_en = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenant_id, fecha_pago || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Anular periodo (libera los movimientos para recalcular)
router.put('/periodos/:id/anular', verifyToken, tenantGuard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await client.query('BEGIN');

    const actual = await client.query(
      `SELECT estado FROM nomina_periodos WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, tenant_id]
    );
    if (!actual.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Periodo no encontrado' });
    }
    if (actual.rows[0].estado === 'anulada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, mensaje: 'Este periodo ya esta anulado' });
    }

     await client.query(
      `UPDATE nomina_movimientos SET aplicado = false, periodo_id = NULL
        WHERE tenant_id = $1 AND periodo_id = $2`,
      [tenant_id, id]
    );

    // Revertir las cuotas de prestamo descontadas en este periodo
    const cuotasRev = await client.query(
      `SELECT * FROM nomina_prestamos_cuotas WHERE tenant_id = $1 AND periodo_id = $2`,
      [tenant_id, id]
    );
    for (const c of cuotasRev.rows) {
      await client.query(
        `UPDATE nomina_prestamos
            SET balance = COALESCE(balance,0) + $1,
                total_descontado = GREATEST(COALESCE(total_descontado,0) - $1, 0),
                estado = CASE WHEN estado = 'saldado' THEN 'activo' ELSE estado END,
                saldado_en = CASE WHEN estado = 'saldado' THEN NULL ELSE saldado_en END,
                actualizado_en = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        [parseFloat(c.monto) || 0, c.prestamo_id, tenant_id]
      );
    }
    await client.query(
      `DELETE FROM nomina_prestamos_cuotas WHERE tenant_id = $1 AND periodo_id = $2`,
      [tenant_id, id]
    );

    await client.query(`DELETE FROM nomina_detalle WHERE periodo_id = $1 AND tenant_id = $2`, [id, tenant_id]);

    const result = await client.query(
      `UPDATE nomina_periodos SET
         estado = 'anulada',
         total_ingresos = 0, total_deducciones = 0, total_neto = 0,
         total_aportes_empleador = 0, cantidad_empleados = 0,
         anulado_por = $3, anulado_en = NOW(), actualizado_en = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenant_id, req.user.operador_id || req.user.id || null]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// GET - Volante de pago individual en PDF
// ==========================================
router.get('/detalle/:id/volante', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const q = await pool.query(
      `SELECT d.*, p.numero AS periodo_numero, p.descripcion AS periodo_descripcion,
              p.fecha_inicio, p.fecha_fin, p.fecha_pago, p.estado AS periodo_estado,
              e.codigo AS empleado_codigo, e.departamento, e.nss,
              e.banco, e.cuenta_bancaria, e.forma_pago, e.fecha_ingreso,
              t.nombre AS empresa_nombre, t.rnc AS empresa_rnc,
              t.direccion AS empresa_direccion, t.telefono AS empresa_telefono
         FROM nomina_detalle d
         JOIN nomina_periodos p ON d.periodo_id = p.id
         LEFT JOIN empleados e ON d.empleado_id = e.id
         JOIN tenants t ON d.tenant_id = t.id
        WHERE d.id = $1 AND d.tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!q.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Volante no encontrado' });
    }
    const v = q.rows[0];

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: [612, 792] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="volante-${v.periodo_numero}-${(v.empleado_nombre || '').replace(/\s+/g, '_')}.pdf"`);
    doc.pipe(res);

    const azul = '#1e40af';
    const gris = '#6b7280';
    const negro = '#111827';
    const rojo = '#b91c1c';
    const M = 50;
    const W = 512;

    const money = (n) => 'RD$ ' + parseFloat(n || 0).toLocaleString('es-DO',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dia = (d) => d ? new Date(d).toISOString().slice(0, 10) : '-';

    // Encabezado
    doc.rect(M, 45, W, 60).fill(azul);
    doc.fillColor('white').fontSize(14).font('Helvetica-Bold')
       .text(v.empresa_nombre || '', M + 12, 56, { width: W - 200 });
    doc.fontSize(8).font('Helvetica')
       .text(`RNC: ${v.empresa_rnc || 'N/A'}`, M + 12, 74)
       .text(v.empresa_direccion || '', M + 12, 85, { width: W - 200 });
    doc.fontSize(13).font('Helvetica-Bold')
       .text('VOLANTE DE PAGO', M + W - 190, 58, { width: 178, align: 'right' });
    doc.fontSize(8).font('Helvetica')
       .text(v.periodo_numero || '', M + W - 190, 76, { width: 178, align: 'right' })
       .text(`Pago: ${dia(v.fecha_pago)}`, M + W - 190, 87, { width: 178, align: 'right' });

    let y = 120;

    // Datos del empleado
    doc.rect(M, y, W, 18).fill('#e5e7eb');
    doc.fillColor(negro).fontSize(9).font('Helvetica-Bold')
       .text('DATOS DEL EMPLEADO', M + 8, y + 5);
    y += 24;

    const fila = (etq1, val1, etq2, val2) => {
      doc.fontSize(8).font('Helvetica').fillColor(gris).text(etq1, M + 8, y);
      doc.font('Helvetica-Bold').fillColor(negro).text(val1 || '-', M + 80, y, { width: 170 });
      if (etq2) {
        doc.font('Helvetica').fillColor(gris).text(etq2, M + 270, y);
        doc.font('Helvetica-Bold').fillColor(negro).text(val2 || '-', M + 345, y, { width: 160 });
      }
      y += 14;
    };

    fila('Nombre:', v.empleado_nombre, 'Cedula:', v.empleado_cedula);
    fila('Cargo:', v.cargo, 'Departamento:', v.departamento);
    fila('Codigo:', v.empleado_codigo, 'NSS:', v.nss);
    fila('Ingreso:', dia(v.fecha_ingreso), 'Forma de pago:', v.forma_pago);
    if (v.banco || v.cuenta_bancaria) {
      fila('Banco:', v.banco, 'Cuenta:', v.cuenta_bancaria);
    }
    fila('Periodo:', `${dia(v.fecha_inicio)} al ${dia(v.fecha_fin)}`, 'Descripcion:', v.periodo_descripcion);

    y += 10;

    // Ingresos y deducciones lado a lado
    const colW = (W - 10) / 2;
    const yTablas = y;

    doc.rect(M, y, colW, 18).fill('#dcfce7');
    doc.fillColor('#166534').fontSize(9).font('Helvetica-Bold').text('INGRESOS', M + 8, y + 5);

    doc.rect(M + colW + 10, y, colW, 18).fill('#fee2e2');
    doc.fillColor('#991b1b').fontSize(9).font('Helvetica-Bold').text('DEDUCCIONES', M + colW + 18, y + 5);

    let yIng = y + 24;
    let yDed = y + 24;

    const linea = (x, yy, etq, val, color) => {
      doc.fontSize(8).font('Helvetica').fillColor(negro).text(etq, x + 8, yy, { width: colW - 110 });
      doc.font('Helvetica-Bold').fillColor(color || negro)
         .text(money(val), x + colW - 100, yy, { width: 92, align: 'right' });
    };

    linea(M, yIng, 'Salario del periodo', v.salario_base); yIng += 14;
    if (parseFloat(v.monto_horas_extras || 0) > 0) {
      linea(M, yIng, 'Horas extras', v.monto_horas_extras); yIng += 14;
    }

    const desg = v.desglose || {};
    const movs = Array.isArray(desg.movimientos) ? desg.movimientos : [];
    for (const m of movs.filter(x => x.tipo !== 'deduccion')) {
      linea(M, yIng, m.concepto, m.monto); yIng += 14;
    }
    if (parseFloat(v.otros_ingresos || 0) > 0 && movs.filter(x => x.tipo !== 'deduccion').length === 0) {
      linea(M, yIng, 'Otros ingresos', v.otros_ingresos); yIng += 14;
    }

    const xD = M + colW + 10;
    linea(xD, yDed, 'AFP (fondo de pension)', v.afp_empleado, rojo); yDed += 14;
    linea(xD, yDed, 'SFS (seguro de salud)', v.sfs_empleado, rojo); yDed += 14;
    if (parseFloat(v.isr || 0) > 0) {
      linea(xD, yDed, 'ISR (impuesto s/renta)', v.isr, rojo); yDed += 14;
    }
    for (const m of movs.filter(x => x.tipo === 'deduccion')) {
      linea(xD, yDed, m.concepto, m.monto, rojo); yDed += 14;
    }

    const yFin = Math.max(yIng, yDed) + 6;

    doc.moveTo(M, yFin).lineTo(M + colW, yFin).strokeColor('#d1d5db').stroke();
    doc.moveTo(xD, yFin).lineTo(xD + colW, yFin).strokeColor('#d1d5db').stroke();

    doc.fontSize(9).font('Helvetica-Bold').fillColor(negro)
       .text('Total ingresos', M + 8, yFin + 6)
       .text(money(v.total_ingresos), M + colW - 100, yFin + 6, { width: 92, align: 'right' });
    doc.fillColor(rojo)
       .text('Total deducciones', xD + 8, yFin + 6)
       .text(money(v.total_deducciones), xD + colW - 100, yFin + 6, { width: 92, align: 'right' });

    y = yFin + 30;

    // Neto a pagar
    doc.rect(M, y, W, 34).fill(azul);
    doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
       .text('NETO A PAGAR', M + 12, y + 11);
    doc.fontSize(16)
       .text(money(v.neto_pagar), M + W - 220, y + 8, { width: 208, align: 'right' });

    y += 48;

    // Aportes del empleador
    doc.rect(M, y, W, 18).fill('#ede9fe');
    doc.fillColor('#5b21b6').fontSize(9).font('Helvetica-Bold')
       .text('APORTES DEL EMPLEADOR (no se descuentan al empleado)', M + 8, y + 5);
    y += 24;

    const cuatro = (e1, v1, e2, v2) => {
      doc.fontSize(8).font('Helvetica').fillColor(gris).text(e1, M + 8, y);
      doc.font('Helvetica-Bold').fillColor(negro).text(money(v1), M + 100, y, { width: 100, align: 'right' });
      doc.font('Helvetica').fillColor(gris).text(e2, M + 270, y);
      doc.font('Helvetica-Bold').fillColor(negro).text(money(v2), M + 380, y, { width: 120, align: 'right' });
      y += 14;
    };

    cuatro('AFP empleador', v.afp_empleador, 'SFS empleador', v.sfs_empleador);
    cuatro('Riesgos laborales', v.srl_empleador, 'INFOTEP', v.infotep_empleador);

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#5b21b6')
       .text('Total aportes', M + 8, y + 4)
       .text(money(v.total_aportes_empleador), M + 380, y + 4, { width: 120, align: 'right' });

    y += 40;

    // Firmas
    doc.moveTo(M + 30, y + 30).lineTo(M + 200, y + 30).strokeColor('#9ca3af').stroke();
    doc.moveTo(M + 300, y + 30).lineTo(M + 470, y + 30).strokeColor('#9ca3af').stroke();
    doc.fontSize(8).font('Helvetica').fillColor(gris)
       .text('Recibido por el empleado', M + 30, y + 35, { width: 170, align: 'center' })
       .text('Por la empresa', M + 300, y + 35, { width: 170, align: 'center' });

    doc.fontSize(7).fillColor(gris)
       .text('Documento generado por el sistema. Conserve este volante como comprobante de pago.',
             M, y + 70, { width: W, align: 'center' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, mensaje: error.message });
    }
  }
});

// ==========================================
// GET - Nomina completa del periodo en PDF
// ==========================================
router.get('/periodos/:id/reporte', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const cab = await pool.query(
      `SELECT p.*, t.nombre AS empresa_nombre, t.rnc AS empresa_rnc,
              t.direccion AS empresa_direccion, t.telefono AS empresa_telefono
         FROM nomina_periodos p
         JOIN tenants t ON p.tenant_id = t.id
        WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!cab.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Periodo no encontrado' });
    }
    const p = cab.rows[0];

    const det = await pool.query(
      `SELECT * FROM nomina_detalle WHERE periodo_id = $1 AND tenant_id = $2
        ORDER BY empleado_nombre ASC`,
      [req.params.id, tenant_id]
    );
    if (det.rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Este periodo no tiene detalle calculado' });
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 30, size: [792, 612] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="nomina-${p.numero}.pdf"`);
    doc.pipe(res);

    const azul = '#1e40af';
    const gris = '#6b7280';
    const negro = '#111827';
    const M = 30;
    const W = 732;

    const money = (n) => parseFloat(n || 0).toLocaleString('es-DO',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dia = (d) => d ? new Date(d).toISOString().slice(0, 10) : '-';

    const cols = [
      { t: 'Empleado', w: 130, a: 'left' },
      { t: 'Cedula', w: 75, a: 'left' },
      { t: 'Cargo', w: 75, a: 'left' },
      { t: 'Salario', w: 62, a: 'right' },
      { t: 'Otros', w: 52, a: 'right' },
      { t: 'Total Ing.', w: 62, a: 'right' },
      { t: 'AFP', w: 52, a: 'right' },
      { t: 'SFS', w: 52, a: 'right' },
      { t: 'ISR', w: 52, a: 'right' },
      { t: 'Desc', w: 52, a: 'right' },
      { t: 'Neto', w: 68, a: 'right' }
    ];

    const encabezado = () => {
      doc.rect(M, 25, W, 44).fill(azul);
      doc.fillColor('white').fontSize(12).font('Helvetica-Bold')
         .text(p.empresa_nombre || '', M + 10, 33, { width: 400 });
      doc.fontSize(8).font('Helvetica')
         .text(`RNC: ${p.empresa_rnc || 'N/A'}`, M + 10, 49);
      doc.fontSize(12).font('Helvetica-Bold')
         .text('NOMINA DE PAGO', M + W - 280, 33, { width: 268, align: 'right' });
      doc.fontSize(8).font('Helvetica')
         .text(`${p.numero}  |  ${dia(p.fecha_inicio)} al ${dia(p.fecha_fin)}  |  ${String(p.estado).toUpperCase()}`,
               M + W - 280, 50, { width: 268, align: 'right' });

      let y = 78;
      doc.rect(M, y, W, 16).fill('#374151');
      let x = M;
      doc.fillColor('white').fontSize(7).font('Helvetica-Bold');
      for (const c of cols) {
        doc.text(c.t, x + 4, y + 5, { width: c.w - 8, align: c.a });
        x += c.w;
      }
      return y + 16;
    };

    let y = encabezado();
    let alterno = false;

    for (const d of det.rows) {
      if (y > 520) {
               doc.addPage({ margin: 30, size: [792, 612] });
        y = encabezado();
        alterno = false;
      }
      if (alterno) doc.rect(M, y, W, 15).fill('#f9fafb');
      alterno = !alterno;

      const vals = [
        d.empleado_nombre || '',
        d.empleado_cedula || '-',
        d.cargo || '-',
        money(d.salario_base),
        money(d.otros_ingresos),
        money(d.total_ingresos),
        money(d.afp_empleado),
        money(d.sfs_empleado),
        money(d.isr),
        money(d.otras_deducciones),
        money(d.neto_pagar)
      ];
      let x = M;
      doc.fontSize(7).font('Helvetica').fillColor(negro);
      vals.forEach((v, i) => {
        if (i >= 6 && i <= 9) doc.fillColor('#b91c1c');
        else if (i === 10) doc.font('Helvetica-Bold').fillColor('#166534');
        else doc.font('Helvetica').fillColor(negro);
        doc.text(v, x + 4, y + 4, { width: cols[i].w - 8, align: cols[i].a });
        x += cols[i].w;
      });
      y += 15;
    }

    // Totales
    doc.rect(M, y, W, 18).fill('#e5e7eb');
    const totCol = [
      null, null, null,
      det.rows.reduce((s, d) => s + parseFloat(d.salario_base || 0), 0),
      det.rows.reduce((s, d) => s + parseFloat(d.otros_ingresos || 0), 0),
      p.total_ingresos,
      det.rows.reduce((s, d) => s + parseFloat(d.afp_empleado || 0), 0),
      det.rows.reduce((s, d) => s + parseFloat(d.sfs_empleado || 0), 0),
      det.rows.reduce((s, d) => s + parseFloat(d.isr || 0), 0),
      det.rows.reduce((s, d) => s + parseFloat(d.otras_deducciones || 0), 0),
      p.total_neto
    ];
    let xt = M;
    doc.fillColor(negro).fontSize(8).font('Helvetica-Bold')
       .text(`TOTALES  (${det.rows.length} empleados)`, xt + 4, y + 5,
             { width: cols[0].w + cols[1].w + cols[2].w - 8 });
    cols.forEach((c, i) => {
      if (totCol[i] != null) {
        if (i >= 6 && i <= 9) doc.fillColor('#b91c1c');
        else if (i === 10) doc.fillColor('#166534');
        else doc.fillColor(negro);
        doc.text(money(totCol[i]), xt + 4, y + 5, { width: c.w - 8, align: 'right' });
      }
      xt += c.w;
    });

    y += 30;

    // Resumen de aportes
    if (y > 480) {
          doc.addPage({ margin: 30, size: [792, 612] });
      y = 40;
    }

    doc.rect(M, y, 350, 16).fill('#ede9fe');
    doc.fillColor('#5b21b6').fontSize(8).font('Helvetica-Bold')
       .text('RESUMEN PARA LA TSS Y COSTO PATRONAL', M + 8, y + 4);
    y += 22;

    const totAfpE = det.rows.reduce((s, d) => s + parseFloat(d.afp_empleado || 0), 0);
    const totSfsE = det.rows.reduce((s, d) => s + parseFloat(d.sfs_empleado || 0), 0);
    const totIsr = det.rows.reduce((s, d) => s + parseFloat(d.isr || 0), 0);
    const totAfpP = det.rows.reduce((s, d) => s + parseFloat(d.afp_empleador || 0), 0);
    const totSfsP = det.rows.reduce((s, d) => s + parseFloat(d.sfs_empleador || 0), 0);
    const totSrl = det.rows.reduce((s, d) => s + parseFloat(d.srl_empleador || 0), 0);
    const totInf = det.rows.reduce((s, d) => s + parseFloat(d.infotep_empleador || 0), 0);

    const linea = (etq, val, negrita) => {
      doc.fontSize(8).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fillColor(negrita ? negro : gris)
         .text(etq, M + 8, y, { width: 220 });
      doc.font('Helvetica-Bold').fillColor(negro)
         .text('RD$ ' + money(val), M + 228, y, { width: 114, align: 'right' });
      y += 13;
    };

    linea('AFP empleado (retenido)', totAfpE);
    linea('SFS empleado (retenido)', totSfsE);
    linea('ISR retenido a la DGII', totIsr);
    linea('AFP empleador', totAfpP);
    linea('SFS empleador', totSfsP);
    linea('Riesgos laborales (SRL)', totSrl);
    linea('INFOTEP', totInf);
    y += 4;
    linea('Total a pagar a la TSS', totAfpE + totSfsE + totAfpP + totSfsP + totSrl, true);
    linea('Neto pagado a empleados', p.total_neto, true);
    linea('COSTO TOTAL DE LA NOMINA',
      parseFloat(p.total_ingresos || 0) + parseFloat(p.total_aportes_empleador || 0), true);

    doc.fontSize(7).fillColor(gris)
       .text(`Generado el ${new Date().toISOString().slice(0, 10)}`, M, 570, { width: W, align: 'right' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, mensaje: error.message });
    }
  }
});

// ==========================================
// GET - Archivo de autodeterminacion TSS (CSV)
// ==========================================
router.get('/periodos/:id/tss', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const cab = await pool.query(
      `SELECT p.*, t.rnc AS empresa_rnc FROM nomina_periodos p
         JOIN tenants t ON p.tenant_id = t.id
        WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!cab.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Periodo no encontrado' });
    }
    const p = cab.rows[0];

    const det = await pool.query(
      `SELECT d.*, e.nss, e.fecha_ingreso
         FROM nomina_detalle d
         LEFT JOIN empleados e ON d.empleado_id = e.id
        WHERE d.periodo_id = $1 AND d.tenant_id = $2
        ORDER BY d.empleado_nombre ASC`,
      [req.params.id, tenant_id]
    );
    if (det.rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Este periodo no tiene detalle calculado' });
    }

    const n2 = (v) => parseFloat(v || 0).toFixed(2);
    const limpio = (s) => String(s == null ? '' : s).replace(/[;\r\n]/g, ' ').trim();

    const filas = [
      'RNC_EMPRESA;PERIODO;NSS;CEDULA;NOMBRE;SALARIO_COTIZABLE;AFP_EMPLEADO;SFS_EMPLEADO;AFP_EMPLEADOR;SFS_EMPLEADOR;SRL_EMPLEADOR;INFOTEP;ISR'
    ];
    const periodoTxt = new Date(p.fecha_fin).toISOString().slice(0, 7).replace('-', '');

    // Los identificadores van como texto para que Excel no elimine los ceros iniciales
    const txt = (s) => '="' + limpio(s) + '"';

    for (const d of det.rows) {
      filas.push([
        txt(p.empresa_rnc),
        txt(periodoTxt),
        txt(d.nss),
        txt(d.empleado_cedula),
        limpio(d.empleado_nombre),
        n2(d.salario_cotizable),
        n2(d.afp_empleado),
        n2(d.sfs_empleado),
        n2(d.afp_empleador),
        n2(d.sfs_empleador),
        n2(d.srl_empleador),
        n2(d.infotep_empleador),
        n2(d.isr)
      ].join(';'));
    }

    const csv = '\uFEFF' + filas.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tss-${p.numero}.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// REGALIA PASCUAL Y LIQUIDACIONES
// (Codigo de Trabajo de la Republica Dominicana)
// ==========================================

// Salario diario para preaviso y cesantia: mensual x 12 / 365
const salarioDiario = (mensual) => (parseFloat(mensual) || 0) * 12 / 365;

// Meses completos entre dos fechas
function mesesEntre(desde, hasta) {
  const a = new Date(desde), b = new Date(hasta);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return Math.max(0, m);
}

// Dias de preaviso segun Art. 76
function diasPreaviso(meses) {
  if (meses >= 12) return 28;
  if (meses >= 6) return 14;
  if (meses >= 3) return 7;
  return 0;
}

// Dias de cesantia segun Art. 80
function diasCesantia(meses) {
  if (meses < 3) return 0;
  if (meses < 6) return 6;
  if (meses < 12) return 13;
  const anos = Math.floor(meses / 12);
  if (anos <= 5) return anos * 21;
  return (5 * 21) + ((anos - 5) * 23);
}

// Dias de vacaciones segun Art. 177
function diasVacaciones(meses) {
  if (meses < 12) return 0;
  const anos = Math.floor(meses / 12);
  return anos > 5 ? 18 : 14;
}

// ==========================================
// POST - Calculo de regalia pascual (previsualizacion)
// ==========================================
router.post('/regalia/preview', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { ano } = req.body;
    const anio = parseInt(ano) || new Date().getFullYear();

    const config = await obtenerConfig(tenant_id, `${anio}-12-31`);
    const salMin = config ? parseFloat(config.salario_minimo_cotizable) || 0 : 0;
    const tope = salMin > 0 ? salMin * 5 : Infinity;

    const empleados = await pool.query(
      `SELECT * FROM empleados
        WHERE tenant_id = $1 AND estado = 'activo'
        ORDER BY nombre ASC`,
      [tenant_id]
    );
    if (empleados.rows.length === 0) {
      return res.json({ success: true, data: { ano: anio, lineas: [], total: 0 } });
    }

    // Suma de salarios ordinarios del ano ya procesados
    const sumas = await pool.query(
      `SELECT d.empleado_id,
              COALESCE(SUM(d.salario_base), 0) AS suma_salarios,
              COUNT(*) AS periodos_pagados
         FROM nomina_detalle d
         JOIN nomina_periodos p ON d.periodo_id = p.id
        WHERE d.tenant_id = $1
          AND p.estado IN ('procesada','pagada')
          AND p.tipo = 'ordinaria'
          AND EXTRACT(YEAR FROM p.fecha_fin) = $2
        GROUP BY d.empleado_id`,
      [tenant_id, anio]
    );
    const mapa = {};
    for (const s of sumas.rows) mapa[s.empleado_id] = s;

    const lineas = empleados.rows.map(e => {
      const s = mapa[e.id];
      const sumaReal = s ? parseFloat(s.suma_salarios) || 0 : 0;
      const periodos = s ? parseInt(s.periodos_pagados) || 0 : 0;

      // Si no hay nomina procesada, se estima con el salario base y los meses trabajados
      let base = sumaReal;
      let estimado = false;
      if (base <= 0) {
        const ing = e.fecha_ingreso ? new Date(e.fecha_ingreso) : null;
        const inicio = ing && ing.getFullYear() === anio ? ing : new Date(`${anio}-01-01`);
        const fin = new Date(`${anio}-12-31`);
        const mesesTrab = Math.min(12, mesesEntre(inicio, fin) + 1);
        base = (parseFloat(e.salario_base) || 0) * mesesTrab;
        estimado = true;
      }

      const bruto = base / 12;
      const monto = Math.min(bruto, tope);
      return {
        empleado_id: e.id,
        empleado_nombre: e.nombre,
        empleado_cedula: e.cedula,
        cargo: e.cargo,
        salario_base: parseFloat(e.salario_base) || 0,
        suma_salarios_ano: r2(base),
        periodos_pagados: periodos,
        estimado,
        regalia_bruta: r2(bruto),
        tope_aplicado: bruto > tope,
        regalia_pagar: r2(monto)
      };
    }).filter(l => l.regalia_pagar > 0);

    const total = r2(lineas.reduce((s, l) => s + l.regalia_pagar, 0));

    res.json({
      success: true,
      data: {
        ano: anio,
        tope_legal: tope === Infinity ? null : r2(tope),
        salario_minimo_cotizable: salMin,
        lineas,
        total,
        nota: 'La regalia pascual esta exenta de AFP, SFS e ISR (Art. 222 del Codigo de Trabajo).'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// POST - Calculo de liquidacion laboral (previsualizacion)
// ==========================================
router.post('/liquidacion/preview', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { empleado_id, fecha_salida, causa, vacaciones_tomadas, preaviso_cumplido } = req.body;

    if (!empleado_id) {
      return res.status(400).json({ success: false, mensaje: 'Debe seleccionar un empleado' });
    }
    const emp = await pool.query(
      `SELECT * FROM empleados WHERE id = $1 AND tenant_id = $2`,
      [empleado_id, tenant_id]
    );
    if (!emp.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }
    const e = emp.rows[0];
    if (!e.fecha_ingreso) {
      return res.status(400).json({ success: false, mensaje: 'El empleado no tiene fecha de ingreso registrada' });
    }

    const salida = fecha_salida || new Date().toISOString().slice(0, 10);
    const ingreso = e.fecha_ingreso instanceof Date
      ? e.fecha_ingreso.toISOString().slice(0, 10)
      : String(e.fecha_ingreso).slice(0, 10);

    const meses = mesesEntre(ingreso, salida);
    const anos = Math.floor(meses / 12);
    const salarioMensual = parseFloat(e.salario_base) || 0;
    const diario = salarioDiario(salarioMensual);

    // El desahucio genera preaviso y cesantia. Renuncia y despido justificado no.
    const tipoCausa = causa || 'desahucio';
    const generaPrestaciones = tipoCausa === 'desahucio';

    const dPrev = generaPrestaciones && !preaviso_cumplido ? diasPreaviso(meses) : 0;
    const dCes = generaPrestaciones ? diasCesantia(meses) : 0;
    const dVacTotal = diasVacaciones(meses);
    const dVacTomadas = parseFloat(vacaciones_tomadas) || 0;
    const dVac = Math.max(0, dVacTotal - dVacTomadas);

    const montoPreaviso = r2(dPrev * diario);
    const montoCesantia = r2(dCes * diario);
    const montoVacaciones = r2(dVac * (salarioMensual / 23.83));

    // Regalia proporcional: meses trabajados en el ano de salida
    const anioSalida = new Date(salida).getFullYear();
    const inicioAno = new Date(`${anioSalida}-01-01`);
    const ingDate = new Date(ingreso);
    const desdeRegalia = ingDate > inicioAno ? ingDate : inicioAno;
    const mesesRegalia = Math.min(12, mesesEntre(desdeRegalia, salida));
    const montoRegalia = r2((salarioMensual * mesesRegalia) / 12);

    const totalPrestaciones = r2(montoPreaviso + montoCesantia);
    const totalDerechos = r2(montoVacaciones + montoRegalia);
    const totalGeneral = r2(totalPrestaciones + totalDerechos);

    res.json({
      success: true,
      data: {
        empleado: {
          id: e.id, nombre: e.nombre, cedula: e.cedula, cargo: e.cargo,
          salario_base: salarioMensual, fecha_ingreso: ingreso
        },
        fecha_salida: salida,
        causa: tipoCausa,
        tiempo_laborado: { meses, anos, texto: `${anos} ano(s) y ${meses % 12} mes(es)` },
        salario_diario: r2(diario),
        conceptos: [
          { concepto: 'Preaviso', dias: dPrev, monto: montoPreaviso, base: 'Art. 76', aplica: generaPrestaciones },
          { concepto: 'Cesantia', dias: dCes, monto: montoCesantia, base: 'Art. 80', aplica: generaPrestaciones },
          { concepto: 'Vacaciones no disfrutadas', dias: dVac, monto: montoVacaciones, base: 'Art. 177', aplica: true },
          { concepto: 'Regalia pascual proporcional', dias: mesesRegalia, monto: montoRegalia, base: 'Art. 219', aplica: true }
        ],
        total_prestaciones: totalPrestaciones,
        total_derechos_adquiridos: totalDerechos,
        total_general: totalGeneral,
        nota: generaPrestaciones
          ? 'Desahucio: se pagan preaviso y cesantia ademas de los derechos adquiridos.'
          : 'Renuncia o despido justificado: solo se pagan los derechos adquiridos (vacaciones y regalia proporcional).'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// POST - Liquidacion laboral en PDF
// ==========================================
router.post('/liquidacion/pdf', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { empleado_id, fecha_salida, causa, vacaciones_tomadas, preaviso_cumplido } = req.body;

    if (!empleado_id) {
      return res.status(400).json({ success: false, mensaje: 'Debe seleccionar un empleado' });
    }

    const q = await pool.query(
      `SELECT e.*, t.nombre AS empresa_nombre, t.rnc AS empresa_rnc,
              t.direccion AS empresa_direccion, t.telefono AS empresa_telefono
         FROM empleados e
         JOIN tenants t ON e.tenant_id = t.id
        WHERE e.id = $1 AND e.tenant_id = $2`,
      [empleado_id, tenant_id]
    );
    if (!q.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }
    const e = q.rows[0];
    if (!e.fecha_ingreso) {
      return res.status(400).json({ success: false, mensaje: 'El empleado no tiene fecha de ingreso registrada' });
    }

    const salida = fecha_salida || new Date().toISOString().slice(0, 10);
    const ingreso = e.fecha_ingreso instanceof Date
      ? e.fecha_ingreso.toISOString().slice(0, 10)
      : String(e.fecha_ingreso).slice(0, 10);

    const meses = mesesEntre(ingreso, salida);
    const anos = Math.floor(meses / 12);
    const salarioMensual = parseFloat(e.salario_base) || 0;
    const diario = salarioDiario(salarioMensual);

    const tipoCausa = causa || 'desahucio';
    const generaPrestaciones = tipoCausa === 'desahucio';

    const dPrev = generaPrestaciones && !preaviso_cumplido ? diasPreaviso(meses) : 0;
    const dCes = generaPrestaciones ? diasCesantia(meses) : 0;
    const dVacTotal = diasVacaciones(meses);
    const dVac = Math.max(0, dVacTotal - (parseFloat(vacaciones_tomadas) || 0));

    const montoPreaviso = r2(dPrev * diario);
    const montoCesantia = r2(dCes * diario);
    const montoVacaciones = r2(dVac * (salarioMensual / 23.83));

    const anioSalida = new Date(salida).getFullYear();
    const inicioAno = new Date(`${anioSalida}-01-01`);
    const ingDate = new Date(ingreso);
    const desdeRegalia = ingDate > inicioAno ? ingDate : inicioAno;
    const mesesRegalia = Math.min(12, mesesEntre(desdeRegalia, salida));
    const montoRegalia = r2((salarioMensual * mesesRegalia) / 12);

    const totalPrestaciones = r2(montoPreaviso + montoCesantia);
    const totalDerechos = r2(montoVacaciones + montoRegalia);
    const totalGeneral = r2(totalPrestaciones + totalDerechos);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: [612, 792] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="liquidacion-${(e.nombre || '').replace(/\s+/g, '_')}.pdf"`);
    doc.pipe(res);

    const azul = '#1e40af';
    const gris = '#6b7280';
    const negro = '#111827';
    const M = 50;
    const W = 512;

    const money = (n) => 'RD$ ' + parseFloat(n || 0).toLocaleString('es-DO',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const causaTexto = {
      desahucio: 'Desahucio ejercido por el empleador',
      renuncia: 'Renuncia del trabajador',
      despido_justificado: 'Despido justificado'
    }[tipoCausa] || tipoCausa;

    // Encabezado
    doc.rect(M, 45, W, 60).fill(azul);
    doc.fillColor('white').fontSize(14).font('Helvetica-Bold')
       .text(e.empresa_nombre || '', M + 12, 56, { width: W - 210 });
    doc.fontSize(8).font('Helvetica')
       .text(`RNC: ${e.empresa_rnc || 'N/A'}`, M + 12, 74)
       .text(e.empresa_direccion || '', M + 12, 85, { width: W - 210 });
    doc.fontSize(12).font('Helvetica-Bold')
       .text('LIQUIDACION LABORAL', M + W - 200, 58, { width: 188, align: 'right' });
    doc.fontSize(8).font('Helvetica')
       .text(`Fecha de salida: ${salida}`, M + W - 200, 78, { width: 188, align: 'right' });

    let y = 120;

    doc.rect(M, y, W, 18).fill('#e5e7eb');
    doc.fillColor(negro).fontSize(9).font('Helvetica-Bold')
       .text('DATOS DEL TRABAJADOR', M + 8, y + 5);
    y += 24;

    const fila = (e1, v1, e2, v2) => {
      doc.fontSize(8).font('Helvetica').fillColor(gris).text(e1, M + 8, y);
      doc.font('Helvetica-Bold').fillColor(negro).text(v1 || '-', M + 90, y, { width: 165 });
      if (e2) {
        doc.font('Helvetica').fillColor(gris).text(e2, M + 275, y);
        doc.font('Helvetica-Bold').fillColor(negro).text(v2 || '-', M + 370, y, { width: 135 });
      }
      y += 14;
    };

    fila('Nombre:', e.nombre, 'Cedula:', e.cedula);
    fila('Cargo:', e.cargo, 'Departamento:', e.departamento);
    fila('Fecha ingreso:', ingreso, 'Fecha salida:', salida);
    fila('Tiempo laborado:', `${anos} ano(s) y ${meses % 12} mes(es)`, 'Salario mensual:', money(salarioMensual));
    fila('Salario diario:', money(diario), 'Causa:', causaTexto);

    y += 12;

    // Conceptos
    doc.rect(M, y, W, 18).fill('#374151');
    doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
       .text('CONCEPTO', M + 8, y + 5, { width: 200 })
       .text('BASE LEGAL', M + 220, y + 5, { width: 90 })
       .text('DIAS', M + 320, y + 5, { width: 60, align: 'center' })
       .text('MONTO', M + W - 130, y + 5, { width: 122, align: 'right' });
    y += 18;

    const concepto = (nom, base, dias, monto, aplica) => {
      doc.fontSize(8).font('Helvetica').fillColor(aplica ? negro : '#9ca3af')
         .text(nom, M + 8, y + 5, { width: 200 })
         .text(base, M + 220, y + 5, { width: 90 })
         .text(String(dias), M + 320, y + 5, { width: 60, align: 'center' });
      doc.font('Helvetica-Bold').fillColor(aplica ? negro : '#9ca3af')
         .text(money(monto), M + W - 130, y + 5, { width: 122, align: 'right' });
      y += 18;
      doc.moveTo(M, y).lineTo(M + W, y).strokeColor('#e5e7eb').stroke();
    };

    concepto('Preaviso', 'Art. 76', dPrev, montoPreaviso, generaPrestaciones && dPrev > 0);
    concepto('Auxilio de cesantia', 'Art. 80', dCes, montoCesantia, generaPrestaciones && dCes > 0);
    concepto('Vacaciones no disfrutadas', 'Art. 177', dVac, montoVacaciones, dVac > 0);
    concepto('Regalia pascual proporcional', 'Art. 219', mesesRegalia, montoRegalia, montoRegalia > 0);

    y += 8;

    const subtotal = (etq, val) => {
      doc.fontSize(8).font('Helvetica').fillColor(gris)
         .text(etq, M + 8, y, { width: 300 });
      doc.font('Helvetica-Bold').fillColor(negro)
         .text(money(val), M + W - 130, y, { width: 122, align: 'right' });
      y += 14;
    };

    subtotal('Prestaciones laborales (preaviso + cesantia)', totalPrestaciones);
    subtotal('Derechos adquiridos (vacaciones + regalia)', totalDerechos);

    y += 10;
    doc.rect(M, y, W, 34).fill(azul);
    doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
       .text('TOTAL A PAGAR', M + 12, y + 11);
    doc.fontSize(16)
       .text(money(totalGeneral), M + W - 220, y + 8, { width: 208, align: 'right' });

    y += 52;

    // Nota legal
    doc.rect(M, y, W, 46).fill('#eff6ff');
    doc.fillColor('#1e3a8a').fontSize(7).font('Helvetica')
       .text(generaPrestaciones
         ? 'Por tratarse de un desahucio ejercido por el empleador, se pagan el preaviso y el auxilio de cesantia, ademas de los derechos adquiridos que corresponden al trabajador.'
         : 'Por tratarse de renuncia o despido justificado, no proceden el preaviso ni el auxilio de cesantia. Se pagan unicamente los derechos adquiridos: vacaciones no disfrutadas y la proporcion de regalia pascual.',
         M + 8, y + 7, { width: W - 16 });
    doc.text('Calculo realizado conforme al Codigo de Trabajo de la Republica Dominicana.',
             M + 8, y + 31, { width: W - 16 });

    y += 66;

    // Descargo y firmas
    doc.fillColor(negro).fontSize(8).font('Helvetica')
       .text(`Yo, ${e.nombre || ''}, portador(a) de la cedula ${e.cedula || ''}, declaro haber recibido de ${e.empresa_nombre || ''} la suma de ${money(totalGeneral)} por concepto de la liquidacion detallada, quedando conforme con el calculo presentado.`,
             M, y, { width: W, align: 'justify' });

    y += 60;

    doc.moveTo(M + 30, y).lineTo(M + 210, y).strokeColor('#9ca3af').stroke();
    doc.moveTo(M + 300, y).lineTo(M + 480, y).strokeColor('#9ca3af').stroke();
    doc.fontSize(8).fillColor(gris)
       .text('Firma del trabajador', M + 30, y + 6, { width: 180, align: 'center' })
       .text('Por la empresa', M + 300, y + 6, { width: 180, align: 'center' });

    doc.fontSize(7).fillColor(gris)
       .text(`Documento generado el ${new Date().toISOString().slice(0, 10)}. Calculo referencial: verifique con su asesor laboral antes de firmar el descargo.`,
             M, y + 40, { width: W, align: 'center' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, mensaje: error.message });
    }
  }
});

// ==========================================
// POST - Regalia pascual en PDF
// ==========================================
router.post('/regalia/pdf', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const anio = parseInt(req.body.ano) || new Date().getFullYear();

    const emp = await pool.query(
      `SELECT t.nombre AS empresa_nombre, t.rnc AS empresa_rnc,
              t.direccion AS empresa_direccion
         FROM tenants t WHERE t.id = $1`,
      [tenant_id]
    );
    const empresa = emp.rows[0] || {};

    const config = await obtenerConfig(tenant_id, `${anio}-12-31`);
    const salMin = config ? parseFloat(config.salario_minimo_cotizable) || 0 : 0;
    const tope = salMin > 0 ? salMin * 5 : Infinity;

    const empleados = await pool.query(
      `SELECT * FROM empleados WHERE tenant_id = $1 AND estado = 'activo' ORDER BY nombre ASC`,
      [tenant_id]
    );

    const sumas = await pool.query(
      `SELECT d.empleado_id, COALESCE(SUM(d.salario_base), 0) AS suma_salarios
         FROM nomina_detalle d
         JOIN nomina_periodos p ON d.periodo_id = p.id
        WHERE d.tenant_id = $1 AND p.estado IN ('procesada','pagada')
          AND p.tipo = 'ordinaria' AND EXTRACT(YEAR FROM p.fecha_fin) = $2
        GROUP BY d.empleado_id`,
      [tenant_id, anio]
    );
    const mapa = {};
    for (const s of sumas.rows) mapa[s.empleado_id] = parseFloat(s.suma_salarios) || 0;

    const lineas = empleados.rows.map(e => {
      let base = mapa[e.id] || 0;
      let estimado = false;
      if (base <= 0) {
        const ing = e.fecha_ingreso ? new Date(e.fecha_ingreso) : null;
        const inicio = ing && ing.getFullYear() === anio ? ing : new Date(`${anio}-01-01`);
        const mesesTrab = Math.min(12, mesesEntre(inicio, new Date(`${anio}-12-31`)) + 1);
        base = (parseFloat(e.salario_base) || 0) * mesesTrab;
        estimado = true;
      }
      const bruto = base / 12;
      return {
        nombre: e.nombre, cedula: e.cedula, cargo: e.cargo,
        suma: r2(base), bruto: r2(bruto),
        pagar: r2(Math.min(bruto, tope)),
        tope_aplicado: bruto > tope, estimado
      };
    }).filter(l => l.pagar > 0);

    if (lineas.length === 0) {
      return res.status(400).json({ success: false, mensaje: `No hay regalia que pagar en ${anio}` });
    }
    const total = r2(lineas.reduce((s, l) => s + l.pagar, 0));

     const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: [792, 612] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="regalia-${anio}.pdf"`);
    doc.pipe(res);

    const azul = '#1e40af';
    const gris = '#6b7280';
    const negro = '#111827';
    const M = 40;
    const W = 712;

    const money = (n) => parseFloat(n || 0).toLocaleString('es-DO',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Columnas: la ultima queda en blanco para la firma del empleado
    const C = {
      emp: { x: M, w: 175 },
      ced: { x: M + 175, w: 95 },
      sal: { x: M + 270, w: 105 },
      bru: { x: M + 375, w: 95 },
      pag: { x: M + 470, w: 95 },
      fir: { x: M + 565, w: 147 }
    };

    const encabezado = () => {
      doc.rect(M, 35, W, 50).fill(azul);
      doc.fillColor('white').fontSize(13).font('Helvetica-Bold')
         .text(empresa.empresa_nombre || '', M + 12, 45, { width: W - 250 });
      doc.fontSize(8).font('Helvetica')
         .text(`RNC: ${empresa.empresa_rnc || 'N/A'}`, M + 12, 63);
      doc.fontSize(13).font('Helvetica-Bold')
         .text('REGALIA PASCUAL', M + W - 240, 45, { width: 228, align: 'right' });
      doc.fontSize(9).font('Helvetica')
         .text(`Ano ${anio}`, M + W - 240, 64, { width: 228, align: 'right' });

      let yy = 96;
      doc.rect(M, yy, W, 18).fill('#374151');
      doc.fillColor('white').fontSize(7.5).font('Helvetica-Bold')
         .text('EMPLEADO', C.emp.x + 6, yy + 6, { width: C.emp.w - 10 })
         .text('CEDULA', C.ced.x + 6, yy + 6, { width: C.ced.w - 10 })
         .text('SALARIOS DEL ANO', C.sal.x, yy + 6, { width: C.sal.w - 8, align: 'right' })
         .text('REGALIA BRUTA', C.bru.x, yy + 6, { width: C.bru.w - 8, align: 'right' })
         .text('A PAGAR', C.pag.x, yy + 6, { width: C.pag.w - 8, align: 'right' })
         .text('FIRMA DEL EMPLEADO', C.fir.x, yy + 6, { width: C.fir.w - 8, align: 'center' });
      return yy + 18;
    };

    let y = encabezado();
    let alterno = false;

    const ALTO = 30;

    for (const l of lineas) {
      if (y > 500) {
        doc.addPage({ margin: 40, size: [792, 612] });
        y = encabezado();
        alterno = false;
      }
      if (alterno) doc.rect(M, y, W, ALTO).fill('#f9fafb');
      alterno = !alterno;

      const yTxt = y + 10;
      doc.fontSize(8).font('Helvetica').fillColor(negro)
         .text((l.nombre || '') + (l.estimado ? ' (est.)' : ''), C.emp.x + 6, yTxt, { width: C.emp.w - 10 })
         .text(l.cedula || '-', C.ced.x + 6, yTxt, { width: C.ced.w - 10 })
         .text(money(l.suma), C.sal.x, yTxt, { width: C.sal.w - 8, align: 'right' })
         .text(money(l.bruto), C.bru.x, yTxt, { width: C.bru.w - 8, align: 'right' });
      doc.font('Helvetica-Bold').fillColor('#166534')
         .text(money(l.pagar), C.pag.x, yTxt, { width: C.pag.w - 8, align: 'right' });

      // Linea para que el empleado firme
      doc.moveTo(C.fir.x + 12, y + ALTO - 8).lineTo(C.fir.x + C.fir.w - 12, y + ALTO - 8)
         .strokeColor('#9ca3af').lineWidth(0.5).stroke();

      y += ALTO;
      doc.moveTo(M, y).lineTo(M + W, y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    }

    doc.rect(M, y, W, 22).fill('#e5e7eb');
    doc.fillColor(negro).fontSize(9).font('Helvetica-Bold')
       .text(`TOTAL  (${lineas.length} empleados)`, C.emp.x + 6, y + 7, { width: 300 });
    doc.fillColor('#166534').fontSize(12)
       .text('RD$ ' + money(total), C.bru.x, y + 5, { width: C.bru.w + C.pag.w - 8, align: 'right' });

    y += 38;

    if (y > 470) {
      doc.addPage({ margin: 40, size: [792, 612] });
      y = 50;
    }

    doc.rect(M, y, W, 40).fill('#eff6ff');
    doc.fillColor('#1e3a8a').fontSize(7.5).font('Helvetica')
       .text('La regalia pascual se calcula sumando los salarios ordinarios devengados en el ano y dividiendo el resultado entre doce (Art. 219 del Codigo de Trabajo). Esta exenta del pago de AFP, SFS e Impuesto Sobre la Renta (Art. 222).',
             M + 8, y + 7, { width: W - 16 });
    doc.text(`Tope legal aplicado: ${tope === Infinity ? 'no configurado' : 'RD$ ' + money(tope)} (5 salarios minimos). Debe pagarse a mas tardar el 20 de diciembre. La firma del empleado en cada linea constituye constancia de recibo.`,
             M + 8, y + 24, { width: W - 16 });

    y += 62;

    doc.moveTo(M + 60, y).lineTo(M + 280, y).strokeColor('#9ca3af').lineWidth(0.5).stroke();
    doc.moveTo(M + 430, y).lineTo(M + 650, y).strokeColor('#9ca3af').lineWidth(0.5).stroke();
    doc.fontSize(8).font('Helvetica').fillColor(gris)
       .text('Preparado por', M + 60, y + 6, { width: 220, align: 'center' })
       .text('Autorizado por', M + 430, y + 6, { width: 220, align: 'center' });

    doc.fontSize(7).fillColor(gris)
       .text(`Generado el ${new Date().toISOString().slice(0, 10)}. La marca (est.) indica un monto estimado con el salario base actual por no haber nominas procesadas de ese ano.`,
             M, y + 32, { width: W, align: 'center' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, mensaje: error.message });
    }
  }
});
// ==========================================
// GET - Listado de empleados en PDF
// ==========================================
router.get('/empleados-pdf', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { estado, buscar } = req.query;

    const emp = await pool.query(
      `SELECT nombre AS empresa_nombre, rnc AS empresa_rnc, direccion AS empresa_direccion
         FROM tenants WHERE id = $1`,
      [tenant_id]
    );
    const empresa = emp.rows[0] || {};

    let q = `SELECT * FROM empleados WHERE tenant_id = $1`;
    const params = [tenant_id];
    if (estado && estado !== 'todos') {
      params.push(estado);
      q += ` AND estado = $${params.length}`;
    }
    if (buscar && String(buscar).trim()) {
      params.push('%' + String(buscar).trim().toLowerCase() + '%');
      q += ` AND (LOWER(nombre) LIKE $${params.length}
                  OR LOWER(COALESCE(cedula,'')) LIKE $${params.length}
                  OR LOWER(COALESCE(cargo,'')) LIKE $${params.length}
                  OR LOWER(COALESCE(departamento,'')) LIKE $${params.length}
                  OR LOWER(COALESCE(codigo,'')) LIKE $${params.length})`;
    }
    q += ` ORDER BY nombre ASC`;

    const lista = await pool.query(q, params);
    if (lista.rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay empleados que listar con ese filtro' });
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: [792, 612] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="listado-empleados.pdf"');
    doc.pipe(res);

    const azul = '#1e40af';
    const gris = '#6b7280';
    const negro = '#111827';
    const M = 40;
    const W = 712;

    const money = (n) => parseFloat(n || 0).toLocaleString('es-DO',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dia = (d) => d ? new Date(d).toISOString().slice(0, 10) : '-';

    const C = {
      cod: { x: M, w: 50 },
      nom: { x: M + 50, w: 155 },
      ced: { x: M + 205, w: 90 },
      car: { x: M + 295, w: 95 },
      dep: { x: M + 390, w: 90 },
      ing: { x: M + 480, w: 70 },
      sal: { x: M + 550, w: 85 },
      fre: { x: M + 635, w: 45 },
      est: { x: M + 680, w: 32 }
    };

    const etiquetaEstado = estado === 'activo' ? 'Activos'
      : estado === 'inactivo' ? 'Inactivos' : 'Todos';

    const encabezado = () => {
      doc.rect(M, 35, W, 50).fill(azul);
      doc.fillColor('white').fontSize(13).font('Helvetica-Bold')
         .text(empresa.empresa_nombre || '', M + 12, 45, { width: W - 250 });
      doc.fontSize(8).font('Helvetica')
         .text(`RNC: ${empresa.empresa_rnc || 'N/A'}`, M + 12, 63);
      doc.fontSize(13).font('Helvetica-Bold')
         .text('LISTADO DE EMPLEADOS', M + W - 250, 45, { width: 238, align: 'right' });
      doc.fontSize(8).font('Helvetica')
         .text(`Estado: ${etiquetaEstado}${buscar ? '  |  Filtro: ' + buscar : ''}`,
               M + W - 250, 64, { width: 238, align: 'right' });

      let yy = 96;
      doc.rect(M, yy, W, 18).fill('#374151');
      doc.fillColor('white').fontSize(7).font('Helvetica-Bold')
         .text('CODIGO', C.cod.x + 4, yy + 6, { width: C.cod.w - 6 })
         .text('NOMBRE', C.nom.x + 4, yy + 6, { width: C.nom.w - 6 })
         .text('CEDULA', C.ced.x + 4, yy + 6, { width: C.ced.w - 6 })
         .text('CARGO', C.car.x + 4, yy + 6, { width: C.car.w - 6 })
         .text('DEPARTAMENTO', C.dep.x + 4, yy + 6, { width: C.dep.w - 6 })
         .text('INGRESO', C.ing.x + 4, yy + 6, { width: C.ing.w - 6 })
         .text('SALARIO', C.sal.x, yy + 6, { width: C.sal.w - 6, align: 'right' })
         .text('FREC.', C.fre.x + 4, yy + 6, { width: C.fre.w - 6 })
         .text('EST.', C.est.x + 2, yy + 6, { width: C.est.w - 4 });
      return yy + 18;
    };

    let y = encabezado();
    let alterno = false;
    let totalSalarios = 0;
    let activos = 0;

    for (const e of lista.rows) {
      if (y > 520) {
        doc.addPage({ margin: 40, size: [792, 612] });
        y = encabezado();
        alterno = false;
      }
      if (alterno) doc.rect(M, y, W, 16).fill('#f9fafb');
      alterno = !alterno;

      const act = e.estado === 'activo';
      if (act) { totalSalarios += parseFloat(e.salario_base) || 0; activos += 1; }

      const yTxt = y + 5;
      doc.fontSize(7).font('Helvetica').fillColor(act ? negro : '#9ca3af')
         .text(e.codigo || '-', C.cod.x + 4, yTxt, { width: C.cod.w - 6 })
         .text(e.nombre || '', C.nom.x + 4, yTxt, { width: C.nom.w - 6 })
         .text(e.cedula || '-', C.ced.x + 4, yTxt, { width: C.ced.w - 6 })
         .text(e.cargo || '-', C.car.x + 4, yTxt, { width: C.car.w - 6 })
         .text(e.departamento || '-', C.dep.x + 4, yTxt, { width: C.dep.w - 6 })
         .text(dia(e.fecha_ingreso), C.ing.x + 4, yTxt, { width: C.ing.w - 6 });
      doc.font('Helvetica-Bold')
         .text(money(e.salario_base), C.sal.x, yTxt, { width: C.sal.w - 6, align: 'right' });
      doc.font('Helvetica')
         .text((e.frecuencia_pago || '').slice(0, 5), C.fre.x + 4, yTxt, { width: C.fre.w - 6 });
      doc.fillColor(act ? '#166534' : '#b91c1c')
         .text(act ? 'ACT' : 'INA', C.est.x + 2, yTxt, { width: C.est.w - 4 });

      y += 16;
    }

    doc.rect(M, y, W, 20).fill('#e5e7eb');
    doc.fillColor(negro).fontSize(8).font('Helvetica-Bold')
       .text(`TOTAL: ${lista.rows.length} empleado(s)  |  ${activos} activo(s)`, C.cod.x + 6, y + 6, { width: 350 });
    doc.text('Nomina base mensual:', C.dep.x, y + 6, { width: 170, align: 'right' });
    doc.fillColor('#166534').fontSize(10)
       .text('RD$ ' + money(totalSalarios), C.sal.x - 30, y + 5, { width: C.sal.w + 60, align: 'right' });

    y += 34;

    doc.fontSize(7).font('Helvetica').fillColor(gris)
       .text(`Generado el ${new Date().toISOString().slice(0, 10)}. La nomina base mensual suma unicamente los empleados activos.`,
             M, y, { width: W, align: 'center' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, mensaje: error.message });
    }
  }
});

// ==========================================
// PRESTAMOS A EMPLEADOS
// Se amortizan automaticamente al procesar cada nomina
// ==========================================

// GET - Lista de prestamos
router.get('/prestamos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { estado, empleado_id } = req.query;

    let q = `SELECT p.*, e.nombre AS empleado_nombre, e.cedula AS empleado_cedula,
                    e.cargo, e.salario_base
               FROM nomina_prestamos p
               JOIN empleados e ON p.empleado_id = e.id
              WHERE p.tenant_id = $1`;
    const params = [tenant_id];
    if (estado && estado !== 'todos') {
      params.push(estado);
      q += ` AND p.estado = $${params.length}`;
    }
    if (empleado_id) {
      params.push(empleado_id);
      q += ` AND p.empleado_id = $${params.length}`;
    }
    q += ` ORDER BY p.creado_en DESC`;

    const r = await pool.query(q, params);
    res.json({ success: true, data: r.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Detalle de un prestamo con su historial de cuotas
router.get('/prestamos/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const cab = await pool.query(
      `SELECT p.*, e.nombre AS empleado_nombre, e.cedula AS empleado_cedula, e.cargo
         FROM nomina_prestamos p
         JOIN empleados e ON p.empleado_id = e.id
        WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!cab.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Prestamo no encontrado' });
    }
    const cuotas = await pool.query(
      `SELECT c.*, per.numero AS periodo_numero, per.descripcion AS periodo_descripcion,
              per.fecha_inicio, per.fecha_fin
         FROM nomina_prestamos_cuotas c
         LEFT JOIN nomina_periodos per ON c.periodo_id = per.id
        WHERE c.prestamo_id = $1 AND c.tenant_id = $2
        ORDER BY c.creado_en ASC`,
      [req.params.id, tenant_id]
    );
    res.json({ success: true, data: { prestamo: cab.rows[0], cuotas: cuotas.rows } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Registrar prestamo
router.post('/prestamos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { empleado_id, fecha, monto_original, cuota, motivo, notas } = req.body;

    if (!empleado_id) {
      return res.status(400).json({ success: false, mensaje: 'Debe seleccionar un empleado' });
    }
    const monto = parseFloat(monto_original) || 0;
    const cuotaVal = parseFloat(cuota) || 0;
    if (monto <= 0) {
      return res.status(400).json({ success: false, mensaje: 'El monto del prestamo debe ser mayor que cero' });
    }
    if (cuotaVal <= 0) {
      return res.status(400).json({ success: false, mensaje: 'La cuota debe ser mayor que cero' });
    }
    if (cuotaVal > monto) {
      return res.status(400).json({ success: false, mensaje: 'La cuota no puede ser mayor que el monto del prestamo' });
    }

    const e = await pool.query(
      `SELECT id, nombre, salario_base FROM empleados WHERE id = $1 AND tenant_id = $2`,
      [empleado_id, tenant_id]
    );
    if (!e.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }

    const cont = await pool.query(
      `SELECT COUNT(*) AS total FROM nomina_prestamos WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numero = 'PR-' + String(parseInt(cont.rows[0].total) + 1).padStart(5, '0');

    const r = await pool.query(
      `INSERT INTO nomina_prestamos
        (tenant_id, empleado_id, numero, fecha, monto_original, cuota, balance, motivo, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$5,$7,$8) RETURNING *`,
        [tenant_id, empleado_id, numero, fecha || new Date().toISOString().slice(0, 10),
       monto, cuotaVal, motivo || null, notas || null]
    );

    // Asiento contable automatico. Si falla, el prestamo ya quedo registrado igual.
    contaAuto.asientoPrestamo({
      tenant_id,
      prestamo: r.rows[0],
      empleadoNombre: e.rows[0].nombre,
      usuario_id: req.user.operador_id || req.user.id || null
    }).catch(() => {});

    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Actualizar la cuota de un prestamo activo
router.put('/prestamos/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { cuota, motivo, notas } = req.body;

    const actual = await pool.query(
      `SELECT * FROM nomina_prestamos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!actual.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Prestamo no encontrado' });
    }
    if (actual.rows[0].estado !== 'activo') {
      return res.status(400).json({ success: false, mensaje: 'Solo se puede modificar un prestamo activo' });
    }
    const cuotaVal = cuota != null ? parseFloat(cuota) : parseFloat(actual.rows[0].cuota);
    if (cuotaVal <= 0) {
      return res.status(400).json({ success: false, mensaje: 'La cuota debe ser mayor que cero' });
    }

    const r = await pool.query(
      `UPDATE nomina_prestamos
          SET cuota = $1, motivo = $2, notas = $3, actualizado_en = NOW()
        WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [cuotaVal,
       motivo !== undefined ? motivo : actual.rows[0].motivo,
       notas !== undefined ? notas : actual.rows[0].notas,
       req.params.id, tenant_id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Abono manual (fuera de nomina, por ejemplo en efectivo)
router.post('/prestamos/:id/abono', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const monto = parseFloat(req.body.monto) || 0;
    if (monto <= 0) {
      return res.status(400).json({ success: false, mensaje: 'El abono debe ser mayor que cero' });
    }

    const actual = await pool.query(
      `SELECT * FROM nomina_prestamos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!actual.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Prestamo no encontrado' });
    }
    const p = actual.rows[0];
    if (p.estado !== 'activo') {
      return res.status(400).json({ success: false, mensaje: 'Este prestamo no esta activo' });
    }

    const balanceAnterior = parseFloat(p.balance) || 0;
    const aplicar = Math.min(monto, balanceAnterior);
    const balanceNuevo = r2(balanceAnterior - aplicar);

    await pool.query(
      `INSERT INTO nomina_prestamos_cuotas
        (tenant_id, prestamo_id, periodo_id, empleado_id, monto, balance_anterior, balance_nuevo)
       VALUES ($1,$2,NULL,$3,$4,$5,$6)`,
      [tenant_id, p.id, p.empleado_id, aplicar, balanceAnterior, balanceNuevo]
    );

    const r = await pool.query(
      `UPDATE nomina_prestamos
          SET balance = $1,
              total_descontado = COALESCE(total_descontado,0) + $2,
              estado = CASE WHEN $1 <= 0.009 THEN 'saldado' ELSE estado END,
              saldado_en = CASE WHEN $1 <= 0.009 THEN NOW() ELSE saldado_en END,
              actualizado_en = NOW()
        WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [balanceNuevo, aplicar, p.id, tenant_id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Cancelar prestamo (condonar el balance pendiente)
router.put('/prestamos/:id/cancelar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const actual = await pool.query(
      `SELECT estado FROM nomina_prestamos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!actual.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Prestamo no encontrado' });
    }
    if (actual.rows[0].estado !== 'activo') {
      return res.status(400).json({ success: false, mensaje: 'Solo se puede cancelar un prestamo activo' });
    }
    const r = await pool.query(
      `UPDATE nomina_prestamos
          SET estado = 'cancelado', cancelado_en = NOW(), actualizado_en = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenant_id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET - Resumen de prestamos por empleado
router.get('/prestamos/resumen/empleados', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const r = await pool.query(
      `SELECT e.id AS empleado_id, e.nombre, e.cedula, e.salario_base,
              COUNT(p.id) FILTER (WHERE p.estado = 'activo') AS prestamos_activos,
              COALESCE(SUM(p.balance) FILTER (WHERE p.estado = 'activo'), 0) AS balance_total,
              COALESCE(SUM(p.cuota) FILTER (WHERE p.estado = 'activo'), 0) AS cuota_periodo
         FROM empleados e
         LEFT JOIN nomina_prestamos p ON p.empleado_id = e.id AND p.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1 AND e.estado = 'activo'
        GROUP BY e.id, e.nombre, e.cedula, e.salario_base
       HAVING COUNT(p.id) FILTER (WHERE p.estado = 'activo') > 0
        ORDER BY e.nombre ASC`,
      [tenant_id]
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - Comprobante de prestamo en PDF (pagare para firma del empleado)
// ==========================================
router.get('/prestamos/:id/pdf', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const q = await pool.query(
      `SELECT p.*, e.nombre AS empleado_nombre, e.cedula AS empleado_cedula,
              e.cargo, e.departamento, e.salario_base, e.fecha_ingreso,
              t.nombre AS empresa_nombre, t.rnc AS empresa_rnc,
              t.direccion AS empresa_direccion, t.telefono AS empresa_telefono
         FROM nomina_prestamos p
         JOIN empleados e ON p.empleado_id = e.id
         JOIN tenants t ON p.tenant_id = t.id
        WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!q.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Prestamo no encontrado' });
    }
    const p = q.rows[0];

    const monto = parseFloat(p.monto_original) || 0;
    const cuota = parseFloat(p.cuota) || 0;
    const periodos = cuota > 0 ? Math.ceil(monto / cuota) : 0;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: [612, 792] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="prestamo-${p.numero}.pdf"`);
    doc.pipe(res);

    const azul = '#1e40af';
    const gris = '#6b7280';
    const negro = '#111827';
    const M = 50;
    const W = 512;

    const money = (n) => 'RD$ ' + parseFloat(n || 0).toLocaleString('es-DO',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dia = (d) => d ? new Date(d).toISOString().slice(0, 10) : '-';

    // Encabezado
    doc.rect(M, 45, W, 60).fill(azul);
    doc.fillColor('white').fontSize(13).font('Helvetica-Bold')
       .text(p.empresa_nombre || '', M + 12, 56, { width: W - 275, lineBreak: false });
    doc.fontSize(8).font('Helvetica')
       .text(`RNC: ${p.empresa_rnc || 'N/A'}`, M + 12, 74)
       .text(p.empresa_direccion || '', M + 12, 85, { width: W - 275, lineBreak: false });
     doc.fontSize(12).font('Helvetica-Bold')
       .text('COMPROBANTE DE PRESTAMO', M + W - 260, 58, { width: 248, align: 'right', lineBreak: false });
    doc.fontSize(9).font('Helvetica')
       .text(`${p.numero}  |  ${dia(p.fecha)}`, M + W - 260, 78, { width: 248, align: 'right' });

    let y = 122;

    // Datos del empleado
    doc.rect(M, y, W, 18).fill('#e5e7eb');
    doc.fillColor(negro).fontSize(9).font('Helvetica-Bold')
       .text('DATOS DEL EMPLEADO', M + 8, y + 5);
    y += 24;

    const fila = (e1, v1, e2, v2) => {
      doc.fontSize(8).font('Helvetica').fillColor(gris).text(e1, M + 8, y);
      doc.font('Helvetica-Bold').fillColor(negro).text(v1 || '-', M + 90, y, { width: 165 });
      if (e2) {
        doc.font('Helvetica').fillColor(gris).text(e2, M + 275, y);
        doc.font('Helvetica-Bold').fillColor(negro).text(v2 || '-', M + 365, y, { width: 140 });
      }
      y += 14;
    };

    fila('Nombre:', p.empleado_nombre, 'Cedula:', p.empleado_cedula);
    fila('Cargo:', p.cargo, 'Departamento:', p.departamento);
    fila('Ingreso:', dia(p.fecha_ingreso), 'Salario mensual:', money(p.salario_base));

    y += 12;

    // Condiciones del prestamo
    doc.rect(M, y, W, 18).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold')
       .text('CONDICIONES DEL PRESTAMO', M + 8, y + 5);
    y += 24;

    fila('Monto otorgado:', money(monto), 'Cuota por periodo:', money(cuota));
    fila('Periodos estimados:', String(periodos), 'Fecha:', dia(p.fecha));
    if (p.motivo) fila('Motivo:', p.motivo, null, null);

    y += 10;

    // Monto destacado
    doc.rect(M, y, W, 36).fill(azul);
    doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
       .text('MONTO DEL PRESTAMO', M + 12, y + 12);
    doc.fontSize(17)
       .text(money(monto), M + W - 240, y + 9, { width: 228, align: 'right' });

    y += 52;

    // Plan de descuento
    doc.rect(M, y, W, 18).fill('#e5e7eb');
    doc.fillColor(negro).fontSize(9).font('Helvetica-Bold')
       .text('PLAN DE DESCUENTO', M + 8, y + 5);
    y += 24;

    doc.fontSize(8).font('Helvetica').fillColor(negro)
       .text(`El monto sera descontado del salario del empleado en cuotas de ${money(cuota)} por cada periodo de nomina, hasta saldar la totalidad del prestamo. Se estiman ${periodos} periodo(s) de descuento.`,
             M + 8, y, { width: W - 16, align: 'justify' });

    y += 34;

    doc.text(`Si la relacion laboral termina antes de saldar el prestamo, el balance pendiente sera descontado de la liquidacion final conforme a lo establecido en el Codigo de Trabajo.`,
             M + 8, y, { width: W - 16, align: 'justify' });

    y += 40;

    // Declaracion del empleado
    doc.rect(M, y, W, 78).fill('#eff6ff');
    doc.fillColor('#1e3a8a').fontSize(8).font('Helvetica-Bold')
       .text('DECLARACION Y AUTORIZACION', M + 10, y + 8);
    doc.font('Helvetica').fontSize(8)
       .text(`Yo, ${p.empleado_nombre || ''}, portador(a) de la cedula de identidad y electoral No. ${p.empleado_cedula || ''}, declaro haber recibido de ${p.empresa_nombre || ''} la suma de ${money(monto)} en calidad de prestamo, y autorizo expresamente a la empresa a descontar de mi salario la cantidad de ${money(cuota)} en cada periodo de pago hasta la cancelacion total de la deuda.`,
             M + 10, y + 24, { width: W - 20, align: 'justify' });

    y += 96;

    // Firmas
    doc.moveTo(M + 30, y).lineTo(M + 210, y).strokeColor('#9ca3af').lineWidth(0.5).stroke();
    doc.moveTo(M + 300, y).lineTo(M + 480, y).strokeColor('#9ca3af').lineWidth(0.5).stroke();
    doc.fontSize(8).font('Helvetica-Bold').fillColor(negro)
       .text(p.empleado_nombre || '', M + 30, y + 6, { width: 180, align: 'center' })
       .text(p.empresa_nombre || '', M + 300, y + 6, { width: 180, align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor(gris)
       .text(`Cedula: ${p.empleado_cedula || ''}`, M + 30, y + 18, { width: 180, align: 'center' })
       .text('Por la empresa', M + 300, y + 18, { width: 180, align: 'center' });

    doc.fontSize(7).fillColor(gris)
       .text(`Documento generado el ${new Date().toISOString().slice(0, 10)}. Conserve este comprobante firmado como constancia del prestamo.`,
             M, y + 44, { width: W, align: 'center' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, mensaje: error.message });
    }
  }
});

// ==========================================
// CONCEPTOS (catalogo de ingresos y deducciones)
// ==========================================

// GET - Lista de conceptos
router.get('/conceptos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { estado } = req.query;
    let q = `SELECT * FROM nomina_conceptos WHERE tenant_id = $1`;
    const params = [tenant_id];
    if (estado && estado !== 'todos') {
      params.push(estado);
      q += ` AND estado = $${params.length}`;
    }
    q += ` ORDER BY tipo ASC, nombre ASC`;
    const r = await pool.query(q, params);
    res.json({ success: true, data: r.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear concepto
router.post('/conceptos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { codigo, nombre, tipo, cotizable, gravable_isr, formula, valor } = req.body;

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre es obligatorio' });
    }
    if (!['ingreso', 'deduccion'].includes(tipo)) {
      return res.status(400).json({ success: false, mensaje: 'El tipo debe ser ingreso o deduccion' });
    }

    const r = await pool.query(
      `INSERT INTO nomina_conceptos
        (tenant_id, codigo, nombre, tipo, cotizable, gravable_isr, formula, valor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tenant_id, codigo || null, String(nombre).trim(), tipo,
       tipo === 'deduccion' ? false : cotizable !== false,
       tipo === 'deduccion' ? false : gravable_isr !== false,
       formula || 'monto', parseFloat(valor) || 0]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Actualizar concepto
router.put('/conceptos/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { codigo, nombre, tipo, cotizable, gravable_isr, formula, valor, estado } = req.body;

    const a = await pool.query(
      `SELECT * FROM nomina_conceptos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!a.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Concepto no encontrado' });
    }
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre es obligatorio' });
    }
    const act = a.rows[0];
    const tipoFinal = tipo || act.tipo;

    const r = await pool.query(
      `UPDATE nomina_conceptos SET
         codigo = $1, nombre = $2, tipo = $3, cotizable = $4, gravable_isr = $5,
         formula = $6, valor = $7, estado = $8, actualizado_en = NOW()
       WHERE id = $9 AND tenant_id = $10 RETURNING *`,
      [codigo !== undefined ? codigo : act.codigo,
       String(nombre).trim(), tipoFinal,
       tipoFinal === 'deduccion' ? false : (cotizable !== undefined ? cotizable !== false : act.cotizable),
       tipoFinal === 'deduccion' ? false : (gravable_isr !== undefined ? gravable_isr !== false : act.gravable_isr),
       formula || act.formula,
       valor != null ? parseFloat(valor) : act.valor,
       estado || act.estado,
       req.params.id, tenant_id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Inactivar concepto (no se borra: los movimientos historicos lo referencian)
router.put('/conceptos/:id/inactivar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const r = await pool.query(
      `UPDATE nomina_conceptos SET estado = 'inactivo', actualizado_en = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenant_id]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Concepto no encontrado' });
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Reactivar concepto
router.put('/conceptos/:id/reactivar', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const r = await pool.query(
      `UPDATE nomina_conceptos SET estado = 'activo', actualizado_en = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenant_id]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Concepto no encontrado' });
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// MOVIMIENTOS (ingresos y deducciones puntuales por empleado)
// ==========================================

// GET - Lista de movimientos pendientes de aplicar
router.get('/movimientos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { aplicado, empleado_id, periodo_id } = req.query;

    let q = `SELECT m.*, e.nombre AS empleado_nombre, e.cedula AS empleado_cedula,
                    p.numero AS periodo_numero, p.descripcion AS periodo_descripcion
               FROM nomina_movimientos m
               JOIN empleados e ON m.empleado_id = e.id
               LEFT JOIN nomina_periodos p ON m.periodo_id = p.id
              WHERE m.tenant_id = $1`;
    const params = [tenant_id];
    if (aplicado === 'true' || aplicado === 'false') {
      params.push(aplicado === 'true');
      q += ` AND m.aplicado = $${params.length}`;
    }
    if (empleado_id) {
      params.push(empleado_id);
      q += ` AND m.empleado_id = $${params.length}`;
    }
    if (periodo_id) {
      params.push(periodo_id);
      q += ` AND m.periodo_id = $${params.length}`;
    }
    q += ` ORDER BY m.creado_en DESC`;

    const r = await pool.query(q, params);
    res.json({ success: true, data: r.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Registrar movimiento
router.post('/movimientos', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { empleado_id, concepto_id, cantidad, monto, notas } = req.body;

    if (!empleado_id) {
      return res.status(400).json({ success: false, mensaje: 'Debe seleccionar un empleado' });
    }
    if (!concepto_id) {
      return res.status(400).json({ success: false, mensaje: 'Debe seleccionar un concepto' });
    }
    const montoVal = parseFloat(monto) || 0;
    if (montoVal <= 0) {
      return res.status(400).json({ success: false, mensaje: 'El monto debe ser mayor que cero' });
    }

    const c = await pool.query(
      `SELECT * FROM nomina_conceptos WHERE id = $1 AND tenant_id = $2`,
      [concepto_id, tenant_id]
    );
    if (!c.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Concepto no encontrado' });
    }
    const con = c.rows[0];

    const e = await pool.query(
      `SELECT id FROM empleados WHERE id = $1 AND tenant_id = $2`,
      [empleado_id, tenant_id]
    );
    if (!e.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }

    const r = await pool.query(
      `INSERT INTO nomina_movimientos
        (tenant_id, empleado_id, concepto_id, concepto_nombre, tipo,
         cantidad, monto, cotizable, gravable_isr, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tenant_id, empleado_id, concepto_id, con.nombre, con.tipo,
       parseFloat(cantidad) || 1, montoVal,
       con.cotizable === true, con.gravable_isr === true, notas || null]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE - Eliminar movimiento pendiente
router.delete('/movimientos/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const a = await pool.query(
      `SELECT aplicado FROM nomina_movimientos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    if (!a.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Movimiento no encontrado' });
    }
    if (a.rows[0].aplicado) {
      return res.status(400).json({
        success: false,
        mensaje: 'Este movimiento ya fue aplicado en una nomina. Anule el periodo si necesita eliminarlo.'
      });
    }
    await pool.query(
      `DELETE FROM nomina_movimientos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenant_id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// GET - Estado de cuenta de prestamos de un empleado en PDF
// ==========================================
router.get('/prestamos/empleado/:empleadoId/estado', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const e = await pool.query(
      `SELECT e.*, t.nombre AS empresa_nombre, t.rnc AS empresa_rnc,
              t.direccion AS empresa_direccion
         FROM empleados e
         JOIN tenants t ON e.tenant_id = t.id
        WHERE e.id = $1 AND e.tenant_id = $2`,
      [req.params.empleadoId, tenant_id]
    );
    if (!e.rows[0]) {
      return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    }
    const emp = e.rows[0];

    const pres = await pool.query(
      `SELECT * FROM nomina_prestamos
        WHERE tenant_id = $1 AND empleado_id = $2
        ORDER BY creado_en ASC`,
      [tenant_id, req.params.empleadoId]
    );
    if (pres.rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Este empleado no tiene prestamos registrados' });
    }

    const ids = pres.rows.map(p => p.id);
    const cuotas = await pool.query(
      `SELECT c.*, per.numero AS periodo_numero
         FROM nomina_prestamos_cuotas c
         LEFT JOIN nomina_periodos per ON c.periodo_id = per.id
        WHERE c.tenant_id = $1 AND c.prestamo_id = ANY($2::uuid[])
        ORDER BY c.creado_en ASC`,
      [tenant_id, ids]
    );

    const activos = pres.rows.filter(p => p.estado === 'activo');
    const balanceTotal = activos.reduce((s, p) => s + (parseFloat(p.balance) || 0), 0);
    const cuotaTotal = activos.reduce((s, p) => s + (parseFloat(p.cuota) || 0), 0);
    const prestado = pres.rows.reduce((s, p) => s + (parseFloat(p.monto_original) || 0), 0);
    const pagado = pres.rows.reduce((s, p) => s + (parseFloat(p.total_descontado) || 0), 0);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 45, size: [612, 792] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="estado-cuenta-${(emp.nombre || '').replace(/\s+/g, '_')}.pdf"`);
    doc.pipe(res);

    const azul = '#1e40af';
    const gris = '#6b7280';
    const negro = '#111827';
    const M = 45;
    const W = 522;

    const money = (n) => parseFloat(n || 0).toLocaleString('es-DO',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dia = (d) => d ? new Date(d).toISOString().slice(0, 10) : '-';

    // Encabezado
    doc.rect(M, 40, W, 56).fill(azul);
    doc.fillColor('white').fontSize(13).font('Helvetica-Bold')
       .text(emp.empresa_nombre || '', M + 12, 51, { width: W - 250, lineBreak: false });
    doc.fontSize(8).font('Helvetica')
       .text(`RNC: ${emp.empresa_rnc || 'N/A'}`, M + 12, 69);
    doc.fontSize(12).font('Helvetica-Bold')
       .text('ESTADO DE CUENTA', M + W - 240, 51, { width: 228, align: 'right', lineBreak: false });
    doc.fontSize(8).font('Helvetica')
       .text(`Prestamos al ${new Date().toISOString().slice(0, 10)}`,
             M + W - 240, 70, { width: 228, align: 'right' });

    let y = 110;

    // Datos del empleado
    doc.rect(M, y, W, 18).fill('#e5e7eb');
    doc.fillColor(negro).fontSize(9).font('Helvetica-Bold')
       .text('EMPLEADO', M + 8, y + 5);
    y += 24;

    const fila = (e1, v1, e2, v2) => {
      doc.fontSize(8).font('Helvetica').fillColor(gris).text(e1, M + 8, y);
      doc.font('Helvetica-Bold').fillColor(negro).text(v1 || '-', M + 85, y, { width: 170 });
      if (e2) {
        doc.font('Helvetica').fillColor(gris).text(e2, M + 280, y);
        doc.font('Helvetica-Bold').fillColor(negro).text(v2 || '-', M + 375, y, { width: 140 });
      }
      y += 14;
    };

    fila('Nombre:', emp.nombre, 'Cedula:', emp.cedula);
    fila('Cargo:', emp.cargo, 'Departamento:', emp.departamento);
    fila('Salario mensual:', 'RD$ ' + money(emp.salario_base), 'Ingreso:', dia(emp.fecha_ingreso));

    y += 12;

    // Resumen
    doc.rect(M, y, W, 18).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold')
       .text('RESUMEN DE LA DEUDA', M + 8, y + 5);
    y += 24;

    const res2 = (etq, val, color) => {
      doc.fontSize(8).font('Helvetica').fillColor(gris).text(etq, M + 8, y, { width: 300 });
      doc.font('Helvetica-Bold').fillColor(color || negro)
         .text('RD$ ' + money(val), M + W - 150, y, { width: 142, align: 'right' });
      y += 14;
    };

    res2('Total prestado historico', prestado);
    res2('Total descontado a la fecha', pagado, '#166534');
    res2('Prestamos activos', activos.length === 0 ? 0 : activos.length, negro);
    res2('Cuota total por periodo', cuotaTotal, '#b91c1c');

    y += 6;
    doc.rect(M, y, W, 32).fill(azul);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
       .text('DEUDA PENDIENTE', M + 12, y + 11);
    doc.fontSize(15)
       .text('RD$ ' + money(balanceTotal), M + W - 220, y + 8, { width: 208, align: 'right' });

    y += 48;

    // Detalle de cada prestamo
    for (const p of pres.rows) {
      if (y > 640) {
        doc.addPage({ margin: 45, size: [612, 792] });
        y = 50;
      }

      const colorEstado = p.estado === 'activo' ? '#1d4ed8'
        : p.estado === 'saldado' ? '#166534' : '#6b7280';

      doc.rect(M, y, W, 16).fill('#f3f4f6');
      doc.fillColor(negro).fontSize(8).font('Helvetica-Bold')
         .text(`${p.numero || ''}  ·  ${dia(p.fecha)}  ·  ${p.motivo || 'Sin motivo'}`, M + 6, y + 5, { width: 340 });
      doc.fillColor(colorEstado)
         .text(String(p.estado).toUpperCase(), M + W - 90, y + 5, { width: 84, align: 'right' });
      y += 20;

      doc.fontSize(7.5).font('Helvetica').fillColor(gris)
         .text(`Monto: RD$ ${money(p.monto_original)}   ·   Cuota: RD$ ${money(p.cuota)}   ·   Descontado: RD$ ${money(p.total_descontado)}   ·   Balance: RD$ ${money(p.balance)}`,
               M + 6, y, { width: W - 12 });
      y += 16;

      const cs = cuotas.rows.filter(c => c.prestamo_id === p.id);
      if (cs.length > 0) {
        doc.fontSize(7).font('Helvetica-Bold').fillColor(negro)
           .text('Fecha', M + 16, y, { width: 70 })
           .text('Origen', M + 90, y, { width: 200 })
           .text('Monto', M + 300, y, { width: 80, align: 'right' })
           .text('Balance', M + W - 90, y, { width: 84, align: 'right' });
        y += 12;

        for (const c of cs) {
          if (y > 700) {
            doc.addPage({ margin: 45, size: [612, 792] });
            y = 50;
          }
          doc.fontSize(7).font('Helvetica').fillColor(negro)
             .text(dia(c.creado_en), M + 16, y, { width: 70 })
             .text(c.periodo_numero ? `Nomina ${c.periodo_numero}` : 'Abono manual', M + 90, y, { width: 200 });
          doc.fillColor('#166534')
             .text(money(c.monto), M + 300, y, { width: 80, align: 'right' });
          doc.fillColor('#b45309')
             .text(money(c.balance_nuevo), M + W - 90, y, { width: 84, align: 'right' });
          y += 11;
        }
      } else {
        doc.fontSize(7).font('Helvetica').fillColor(gris)
           .text('Sin descuentos aplicados todavia.', M + 16, y, { width: W - 32 });
        y += 11;
      }
      y += 12;
    }

    if (y > 640) {
      doc.addPage({ margin: 45, size: [612, 792] });
      y = 50;
    }

    // Conformidad del empleado
    doc.rect(M, y, W, 46).fill('#eff6ff');
    doc.fillColor('#1e3a8a').fontSize(7.5).font('Helvetica')
       .text(`Yo, ${emp.nombre || ''}, portador(a) de la cedula ${emp.cedula || ''}, reconozco que a la fecha mantengo un balance pendiente de RD$ ${money(balanceTotal)} por concepto de prestamos recibidos, y estoy conforme con el detalle presentado en este estado de cuenta.`,
             M + 10, y + 10, { width: W - 20, align: 'justify' });

    y += 66;

    doc.moveTo(M + 40, y).lineTo(M + 230, y).strokeColor('#9ca3af').lineWidth(0.5).stroke();
    doc.moveTo(M + 300, y).lineTo(M + 490, y).strokeColor('#9ca3af').lineWidth(0.5).stroke();
    doc.fontSize(8).font('Helvetica').fillColor(gris)
       .text('Firma del empleado', M + 40, y + 6, { width: 190, align: 'center' })
       .text('Por la empresa', M + 300, y + 6, { width: 190, align: 'center' });

    doc.fontSize(7).fillColor(gris)
       .text(`Documento generado el ${new Date().toISOString().slice(0, 10)}.`,
             M, y + 32, { width: W, align: 'center' });

    doc.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, mensaje: error.message });
    }
  }
});

module.exports = router;