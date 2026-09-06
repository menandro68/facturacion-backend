const pool = require('../config/db');

const r2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

// Devuelve el codigo de cuenta configurado para una operacion
async function cuentaDe(tenant_id, clave) {
  const r = await pool.query(
    `SELECT cuenta_codigo FROM contabilidad_config WHERE tenant_id = $1 AND clave = $2`,
    [tenant_id, clave]
  );
  return r.rows[0] ? r.rows[0].cuenta_codigo : null;
}

// Verifica que el periodo de esa fecha admita asientos
async function periodoAdmite(tenant_id, fecha) {
  const d = new Date(fecha);
  const r = await pool.query(
    `SELECT estado FROM periodos_contables
      WHERE tenant_id = $1 AND ano = $2 AND mes = $3`,
    [tenant_id, d.getUTCFullYear(), d.getUTCMonth() + 1]
  );
  if (!r.rows[0]) return true;
  return r.rows[0].estado !== 'cerrado';
}

/**
 * Registra un asiento automatico.
 * Nunca lanza excepcion: si algo falla devuelve { ok:false, motivo }.
 * La operacion de negocio que lo invoca NO debe verse afectada.
 */
async function registrarAsiento({ tenant_id, fecha, descripcion, modulo, origen_id, documento, lineas, usuario_id }) {
  try {
    if (!tenant_id || !fecha || !Array.isArray(lineas) || lineas.length < 2) {
      return { ok: false, motivo: 'Datos incompletos' };
    }

    // Si el tenant no tiene catalogo, la contabilidad no esta en uso
    const hayCatalogo = await pool.query(
      `SELECT 1 FROM cuentas_contables WHERE tenant_id = $1 LIMIT 1`,
      [tenant_id]
    );
    if (!hayCatalogo.rows[0]) {
      return { ok: false, motivo: 'Sin catalogo de cuentas' };
    }

    if (!(await periodoAdmite(tenant_id, fecha))) {
      return { ok: false, motivo: 'Periodo contable cerrado' };
    }

    // No duplicar el asiento del mismo documento
    if (origen_id) {
      const dup = await pool.query(
        `SELECT id FROM asientos_contables
          WHERE tenant_id = $1 AND origen_modulo = $2 AND origen_id = $3 AND estado = 'registrado'`,
        [tenant_id, modulo, origen_id]
      );
      if (dup.rows[0]) {
        return { ok: false, motivo: 'El asiento ya existe', asiento_id: dup.rows[0].id };
      }
    }

    // Resolver cada linea contra el catalogo
    const codigos = lineas.map(l => l.cuenta_codigo).filter(Boolean);
    if (codigos.length !== lineas.length) {
      return { ok: false, motivo: 'Hay lineas sin cuenta configurada' };
    }
    const cuentas = await pool.query(
      `SELECT * FROM cuentas_contables
        WHERE tenant_id = $1 AND codigo = ANY($2::varchar[]) AND acepta_movimiento = true`,
      [tenant_id, codigos]
    );
    const mapa = {};
    for (const c of cuentas.rows) mapa[c.codigo] = c;

    let tDeb = 0, tCre = 0;
    const limpias = [];

    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      const c = mapa[l.cuenta_codigo];
      if (!c) return { ok: false, motivo: `Cuenta ${l.cuenta_codigo} no valida` };

      const deb = r2(l.debito);
      const cre = r2(l.credito);
      if (deb === 0 && cre === 0) continue;

      tDeb = r2(tDeb + deb);
      tCre = r2(tCre + cre);
      limpias.push({
        cuenta_id: c.id, cuenta_codigo: c.codigo, cuenta_nombre: c.nombre,
        descripcion: l.descripcion || null, debito: deb, credito: cre, orden: limpias.length + 1
      });
    }

    if (limpias.length < 2) return { ok: false, motivo: 'El asiento quedo con menos de dos lineas' };
    if (Math.abs(tDeb - tCre) > 0.009) {
      return { ok: false, motivo: `El asiento no cuadra (${tDeb} vs ${tCre})` };
    }
    if (tDeb === 0) return { ok: false, motivo: 'El asiento no tiene montos' };

    const cont = await pool.query(
      `SELECT COUNT(*) AS total FROM asientos_contables WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numero = 'AS-' + String(parseInt(cont.rows[0].total) + 1).padStart(6, '0');

    const cab = await pool.query(
      `INSERT INTO asientos_contables
        (tenant_id, numero, fecha, tipo, origen_modulo, origen_id, origen_documento,
         descripcion, total_debito, total_credito, creado_por)
       VALUES ($1,$2,$3,'automatico',$4,$5,$6,$7,$8,$9,$10) RETURNING id, numero`,
      [tenant_id, numero, fecha, modulo || null, origen_id || null, documento || null,
       descripcion || 'Asiento automatico', tDeb, tCre, usuario_id || null]
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

    return { ok: true, asiento_id: asientoId, numero: cab.rows[0].numero };
  } catch (e) {
    console.error('[CONTA-AUTO] Error registrando asiento:', e.message);
    return { ok: false, motivo: e.message };
  }
}

/**
 * Anula el asiento de un documento (cuando se anula la factura o el pago)
 */
async function anularAsientoDe(tenant_id, modulo, origen_id, usuario_id) {
  try {
    const r = await pool.query(
      `UPDATE asientos_contables
          SET estado = 'anulado', anulado_por = $4, anulado_en = NOW(), actualizado_en = NOW()
        WHERE tenant_id = $1 AND origen_modulo = $2 AND origen_id = $3 AND estado = 'registrado'
        RETURNING numero`,
      [tenant_id, modulo, origen_id, usuario_id || null]
    );
    return { ok: !!r.rows[0], numero: r.rows[0] ? r.rows[0].numero : null };
  } catch (e) {
    console.error('[CONTA-AUTO] Error anulando asiento:', e.message);
    return { ok: false, motivo: e.message };
  }
}

/**
 * FACTURA EMITIDA
 * Cuentas por Cobrar (o Caja si es de contado) / Ingresos por Ventas / ITBIS por Pagar
 */
async function asientoFactura({ tenant_id, invoice, esContado, usuario_id }) {
  try {
    const subtotal = r2(invoice.subtotal);
    const itbis = r2(invoice.itbis);
    const total = r2(invoice.total);
    if (total <= 0) return { ok: false, motivo: 'Factura sin monto' };

    const cuentaDebito = esContado
      ? await cuentaDe(tenant_id, 'cobro_efectivo')
      : await cuentaDe(tenant_id, 'ventas_cxc');
    const cuentaIngreso = await cuentaDe(tenant_id, 'ventas_ingreso');
    const cuentaItbis = await cuentaDe(tenant_id, 'ventas_itbis');

    if (!cuentaDebito || !cuentaIngreso) {
      return { ok: false, motivo: 'Faltan cuentas configuradas para ventas' };
    }

    const doc = invoice.ncf || invoice.numero_factura || '';
    const lineas = [
      { cuenta_codigo: cuentaDebito, descripcion: `Factura ${doc}`, debito: total, credito: 0 },
      { cuenta_codigo: cuentaIngreso, descripcion: `Venta ${doc}`, debito: 0, credito: subtotal }
    ];
    if (itbis > 0 && cuentaItbis) {
      lineas.push({ cuenta_codigo: cuentaItbis, descripcion: `ITBIS ${doc}`, debito: 0, credito: itbis });
    }

    const fecha = invoice.fecha_emision || invoice.creado_en || new Date();
    const fechaTxt = fecha instanceof Date
      ? fecha.toISOString().slice(0, 10)
      : String(fecha).slice(0, 10);

    return await registrarAsiento({
      tenant_id, fecha: fechaTxt,
      descripcion: `Factura ${doc}`,
      modulo: 'facturas', origen_id: invoice.id, documento: doc,
      lineas, usuario_id
    });
  } catch (e) {
    console.error('[CONTA-AUTO] asientoFactura:', e.message);
    return { ok: false, motivo: e.message };
  }
}

/**
 * PAGO RECIBIDO
 * Caja o Banco / Cuentas por Cobrar
 */
async function asientoPago({ tenant_id, pago, documento, usuario_id }) {
  try {
    const monto = r2(pago.monto);
    if (monto <= 0) return { ok: false, motivo: 'Pago sin monto' };

    const esEfectivo = String(pago.metodo || '').toLowerCase() === 'efectivo';
    const cuentaDebito = esEfectivo
      ? await cuentaDe(tenant_id, 'cobro_efectivo')
      : await cuentaDe(tenant_id, 'cobro_banco');
    const cuentaCredito = await cuentaDe(tenant_id, 'ventas_cxc');

    if (!cuentaDebito || !cuentaCredito) {
      return { ok: false, motivo: 'Faltan cuentas configuradas para cobros' };
    }

    const fecha = pago.creado_en || new Date();
    const fechaTxt = fecha instanceof Date
      ? fecha.toISOString().slice(0, 10)
      : String(fecha).slice(0, 10);

    return await registrarAsiento({
      tenant_id, fecha: fechaTxt,
      descripcion: `Cobro ${documento || ''}`.trim(),
      modulo: 'pagos', origen_id: pago.id, documento: documento || null,
      lineas: [
        { cuenta_codigo: cuentaDebito, descripcion: `Cobro ${pago.metodo || ''}`, debito: monto, credito: 0 },
        { cuenta_codigo: cuentaCredito, descripcion: `Abono ${documento || ''}`, debito: 0, credito: monto }
      ],
      usuario_id
    });
  } catch (e) {
    console.error('[CONTA-AUTO] asientoPago:', e.message);
    return { ok: false, motivo: e.message };
  }
}

/**
 * NOMINA PROCESADA
 * Gasto de sueldos y aportes patronales contra las obligaciones por pagar
 */
async function asientoNomina({ tenant_id, periodo, detalle, usuario_id }) {
  try {
    const sum = (campo) => r2(detalle.reduce((s, d) => s + (parseFloat(d[campo]) || 0), 0));

    const totalIngresos = sum('total_ingresos');
    const afpEmp = sum('afp_empleado');
    const sfsEmp = sum('sfs_empleado');
    const isr = sum('isr');
    const otrasDed = sum('otras_deducciones');
    const neto = sum('neto_pagar');
    const afpPatr = sum('afp_empleador');
    const sfsPatr = sum('sfs_empleador');
    const srlPatr = sum('srl_empleador');
    const infotep = sum('infotep_empleador');

    if (totalIngresos <= 0) return { ok: false, motivo: 'Nomina sin montos' };

    const cSueldos = await cuentaDe(tenant_id, 'nomina_sueldos');
    const cAportes = await cuentaDe(tenant_id, 'nomina_aportes');
    const cInfotep = await cuentaDe(tenant_id, 'nomina_infotep');
    const cPorPagar = await cuentaDe(tenant_id, 'nomina_por_pagar');
    const cTss = await cuentaDe(tenant_id, 'nomina_tss');
    const cIsr = await cuentaDe(tenant_id, 'nomina_isr');
    const cPrestamo = await cuentaDe(tenant_id, 'prestamo_empleado');

    if (!cSueldos || !cPorPagar || !cTss) {
      return { ok: false, motivo: 'Faltan cuentas configuradas para nomina' };
    }

    const doc = periodo.numero || '';
    const lineas = [];

    // DEBITOS: lo que le cuesta la nomina a la empresa
    lineas.push({ cuenta_codigo: cSueldos, descripcion: `Sueldos ${doc}`, debito: totalIngresos, credito: 0 });

    const aportesTss = r2(afpPatr + sfsPatr + srlPatr);
    if (aportesTss > 0 && cAportes) {
      lineas.push({ cuenta_codigo: cAportes, descripcion: `Aportes patronales ${doc}`, debito: aportesTss, credito: 0 });
    }
    if (infotep > 0 && cInfotep) {
      lineas.push({ cuenta_codigo: cInfotep, descripcion: `INFOTEP ${doc}`, debito: infotep, credito: 0 });
    }

    // CREDITOS: las obligaciones que quedan pendientes
    lineas.push({ cuenta_codigo: cPorPagar, descripcion: `Neto a pagar ${doc}`, debito: 0, credito: neto });

    const tssTotal = r2(afpEmp + sfsEmp + afpPatr + sfsPatr + srlPatr);
    if (tssTotal > 0) {
      lineas.push({ cuenta_codigo: cTss, descripcion: `TSS por pagar ${doc}`, debito: 0, credito: tssTotal });
    }
    if (infotep > 0 && cInfotep) {
      const cInfotepPagar = await cuentaDe(tenant_id, 'nomina_infotep_pagar');
      lineas.push({
        cuenta_codigo: cInfotepPagar || cTss,
        descripcion: `INFOTEP por pagar ${doc}`, debito: 0, credito: infotep
      });
    }
    if (isr > 0 && cIsr) {
      lineas.push({ cuenta_codigo: cIsr, descripcion: `ISR retenido ${doc}`, debito: 0, credito: isr });
    }
    // Los descuentos de prestamo rebajan la cuenta por cobrar al empleado
    if (otrasDed > 0 && cPrestamo) {
      lineas.push({ cuenta_codigo: cPrestamo, descripcion: `Descuentos ${doc}`, debito: 0, credito: otrasDed });
    }

    const fecha = periodo.fecha_fin instanceof Date
      ? periodo.fecha_fin.toISOString().slice(0, 10)
      : String(periodo.fecha_fin).slice(0, 10);

    return await registrarAsiento({
      tenant_id, fecha,
      descripcion: `Nomina ${doc}${periodo.descripcion ? ' - ' + periodo.descripcion : ''}`,
      modulo: 'nomina', origen_id: periodo.id, documento: doc,
      lineas, usuario_id
    });
  } catch (e) {
    console.error('[CONTA-AUTO] asientoNomina:', e.message);
    return { ok: false, motivo: e.message };
  }
}

/**
 * PRESTAMO A EMPLEADO
 * Cuentas por Cobrar Empleados / Caja
 */
async function asientoPrestamo({ tenant_id, prestamo, empleadoNombre, usuario_id }) {
  try {
    const monto = r2(prestamo.monto_original);
    if (monto <= 0) return { ok: false, motivo: 'Prestamo sin monto' };

    const cPrestamo = await cuentaDe(tenant_id, 'prestamo_empleado');
    const cCaja = await cuentaDe(tenant_id, 'cobro_efectivo');
    if (!cPrestamo || !cCaja) {
      return { ok: false, motivo: 'Faltan cuentas configuradas para prestamos' };
    }

    const doc = prestamo.numero || '';
    const fecha = prestamo.fecha instanceof Date
      ? prestamo.fecha.toISOString().slice(0, 10)
      : String(prestamo.fecha || new Date().toISOString()).slice(0, 10);

    return await registrarAsiento({
      tenant_id, fecha,
      descripcion: `Prestamo ${doc} a ${empleadoNombre || 'empleado'}`,
      modulo: 'prestamos', origen_id: prestamo.id, documento: doc,
      lineas: [
        { cuenta_codigo: cPrestamo, descripcion: `Prestamo ${doc}`, debito: monto, credito: 0 },
        { cuenta_codigo: cCaja, descripcion: `Entrega en efectivo`, debito: 0, credito: monto }
      ],
      usuario_id
    });
  } catch (e) {
    console.error('[CONTA-AUTO] asientoPrestamo:', e.message);
    return { ok: false, motivo: e.message };
  }
}

/**
 * COMPRA A PROVEEDOR
 * Inventario o Gasto / ITBIS Adelantado / Cuentas por Pagar
 */
async function asientoCompra({ tenant_id, orden, usuario_id }) {
  try {
    const subtotal = r2(orden.subtotal);
    const itbis = r2(orden.itbis);
    const total = r2(orden.total);
    if (total <= 0) return { ok: false, motivo: 'Compra sin monto' };

    const cInventario = await cuentaDe(tenant_id, 'compra_inventario');
    const cCxp = await cuentaDe(tenant_id, 'compra_cxp');
    const cItbis = await cuentaDe(tenant_id, 'compra_itbis');

    if (!cInventario || !cCxp) {
      return { ok: false, motivo: 'Faltan cuentas configuradas para compras' };
    }

    const doc = orden.numero || orden.ncf || '';
    const lineas = [
      { cuenta_codigo: cInventario, descripcion: `Compra ${doc}`, debito: subtotal, credito: 0 }
    ];
    if (itbis > 0 && cItbis) {
      lineas.push({ cuenta_codigo: cItbis, descripcion: `ITBIS ${doc}`, debito: itbis, credito: 0 });
    }
    lineas.push({ cuenta_codigo: cCxp, descripcion: `Proveedor ${doc}`, debito: 0, credito: total });

    const fecha = orden.fecha || orden.creado_en || new Date();
    const fechaTxt = fecha instanceof Date
      ? fecha.toISOString().slice(0, 10)
      : String(fecha).slice(0, 10);

    return await registrarAsiento({
      tenant_id, fecha: fechaTxt,
      descripcion: `Compra ${doc}`,
      modulo: 'compras', origen_id: orden.id, documento: doc,
      lineas, usuario_id
    });
  } catch (e) {
    console.error('[CONTA-AUTO] asientoCompra:', e.message);
    return { ok: false, motivo: e.message };
  }
}

module.exports = {
  registrarAsiento,
  anularAsientoDe,
  asientoFactura,
  asientoPago,
  asientoNomina,
  asientoPrestamo,
  asientoCompra,
  cuentaDe
};