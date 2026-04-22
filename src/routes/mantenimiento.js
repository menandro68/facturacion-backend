const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');
const tenantGuard = require('../middleware/tenantGuard');

// ==========================================
// ZONAS
// ==========================================
router.get('/zonas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM zonas WHERE tenant_id = $1 AND estado = 'activo' ORDER BY nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.post('/zonas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    const result = await pool.query(
      `INSERT INTO zonas (tenant_id, nombre, descripcion) VALUES ($1, $2, $3) RETURNING *`,
      [tenant_id, nombre, descripcion || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.put('/zonas/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, descripcion } = req.body;
    const result = await pool.query(
      `UPDATE zonas SET nombre=$1, descripcion=$2, actualizado_en=NOW() WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [nombre, descripcion, id, tenant_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.delete('/zonas/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await pool.query(
      `UPDATE zonas SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Zona eliminada' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// VENDEDORES
// ==========================================
router.get('/vendedores', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT v.*, z.nombre as zona_nombre 
       FROM vendedores v
       LEFT JOIN zonas z ON v.zona_id = z.id
       WHERE v.tenant_id = $1 AND v.estado = 'activo' ORDER BY v.nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.post('/vendedores', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, cedula, email, telefono, zona_id, comision_pct, usuario, password } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });

    let password_hash = null;
    if (password) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      password_hash = await bcrypt.hash(password, salt);
    }

    const result = await pool.query(
      `INSERT INTO vendedores (tenant_id, nombre, cedula, email, telefono, zona_id, comision_pct, usuario, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tenant_id, nombre, cedula || null, email || null, telefono || null, zona_id || null, comision_pct || 0, usuario || null, password_hash]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.put('/vendedores/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, cedula, email, telefono, zona_id, comision_pct, usuario, password } = req.body;

    let password_hash_update = '';
    let params = [nombre, cedula, email, telefono, zona_id || null, comision_pct, usuario || null];

    if (password) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      password_hash_update = ', password_hash=$8';
      params.push(hash, id, tenant_id);
    } else {
      params.push(id, tenant_id);
    }

    const result = await pool.query(
      `UPDATE vendedores SET nombre=$1, cedula=$2, email=$3, telefono=$4, zona_id=$5, comision_pct=$6, usuario=$7${password_hash_update}, actualizado_en=NOW()
       WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.delete('/vendedores/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await pool.query(
      `UPDATE vendedores SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Vendedor eliminado' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// CHOFERES
// ==========================================
router.get('/choferes', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT * FROM choferes WHERE tenant_id = $1 AND estado = 'activo' ORDER BY nombre`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.post('/choferes', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, cedula, licencia, telefono, email, vehiculo, placa } = req.body;
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    const result = await pool.query(
      `INSERT INTO choferes (tenant_id, nombre, cedula, licencia, telefono, email, vehiculo, placa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenant_id, nombre, cedula || null, licencia || null, telefono || null, email || null, vehiculo || null, placa || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.put('/choferes/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { nombre, cedula, licencia, telefono, email, vehiculo, placa } = req.body;
    const result = await pool.query(
      `UPDATE choferes SET nombre=$1, cedula=$2, licencia=$3, telefono=$4, email=$5, vehiculo=$6, placa=$7, actualizado_en=NOW()
       WHERE id=$8 AND tenant_id=$9 RETURNING *`,
      [nombre, cedula, licencia, telefono, email, vehiculo, placa, id, tenant_id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.delete('/choferes/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    await pool.query(
      `UPDATE choferes SET estado='inactivo', actualizado_en=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenant_id]
    );
    res.json({ success: true, mensaje: 'Chofer eliminado' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// CLAVE DE DESCUENTO (autorización de precios menores al oficial)
// ==========================================

// GET clave actual - solo admin
router.get('/clave-descuento', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    let result = await pool.query(
      `SELECT valor FROM configuracion_sistema WHERE tenant_id = $1 AND clave = 'clave_descuento'`,
      [tenant_id]
    );
    // Si no existe, la creamos con valor por defecto
    if (result.rows.length === 0) {
      await pool.query(
        `INSERT INTO configuracion_sistema (tenant_id, clave, valor, descripcion)
         VALUES ($1, 'clave_descuento', 'ADMIN123', 'Clave de autorización para vender productos por debajo del precio oficial')`,
        [tenant_id]
      );
      return res.json({ success: true, data: { valor: 'ADMIN123' } });
    }
    res.json({ success: true, data: { valor: result.rows[0].valor } });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT cambiar clave - solo admin
router.put('/clave-descuento', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nueva_clave } = req.body;
    if (!nueva_clave || nueva_clave.trim().length < 4) {
      return res.status(400).json({ success: false, mensaje: 'La clave debe tener al menos 4 caracteres' });
    }
    await pool.query(
      `INSERT INTO configuracion_sistema (tenant_id, clave, valor, descripcion)
       VALUES ($1, 'clave_descuento', $2, 'Clave de autorización para vender productos por debajo del precio oficial')
       ON CONFLICT (tenant_id, clave)
       DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`,
      [tenant_id, nueva_clave.trim()]
    );
    res.json({ success: true, mensaje: 'Clave actualizada correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST validar clave - lo usa el frontend cuando un vendedor intenta dar descuento
router.post('/validar-clave-descuento', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { clave } = req.body;
    if (!clave) return res.status(400).json({ success: false, mensaje: 'Clave requerida' });
    const result = await pool.query(
      `SELECT valor FROM configuracion_sistema WHERE tenant_id = $1 AND clave = 'clave_descuento'`,
      [tenant_id]
    );
    const claveActual = result.rows.length > 0 ? result.rows[0].valor : 'ADMIN123';
    if (clave.trim() === claveActual) {
      return res.json({ success: true, valido: true });
    }
    res.json({ success: true, valido: false });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// ==========================================
// NCF SECUENCIAS ELECTRÓNICAS (E31, E32, E34)
// Facturación Electrónica DGII
// ==========================================

// GET - Listar todas las secuencias NCF electrónicas
router.get('/ncf-electronicas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const result = await pool.query(
      `SELECT *, 
              (secuencia_hasta - secuencia_actual + 1) as disponibles,
              (secuencia_actual - secuencia_desde) as usados
       FROM ncf_secuencias_electronicas 
       WHERE tenant_id = $1 
       ORDER BY tipo_ncf, creado_en DESC`,
      [tenant_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// POST - Crear nueva secuencia NCF electrónica
router.post('/ncf-electronicas', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { tipo_ncf, secuencia_desde, secuencia_hasta, fecha_vencimiento } = req.body;

    // Validaciones
    if (!tipo_ncf) return res.status(400).json({ success: false, mensaje: 'El tipo de NCF es requerido' });

    const tiposValidos = ['B01', 'B02', 'B15', 'E31', 'E32', 'E34'];
    if (!tiposValidos.includes(tipo_ncf)) {
      return res.status(400).json({ success: false, mensaje: 'Tipo NCF debe ser B01, B02, B15, E31, E32 o E34' });
    }

    const esElectronico = ['E31', 'E32', 'E34'].includes(tipo_ncf);

    if (!secuencia_desde || !secuencia_hasta) {
      return res.status(400).json({ success: false, mensaje: 'Secuencia desde y hasta son requeridos' });
    }
    if (parseInt(secuencia_desde) >= parseInt(secuencia_hasta)) {
      return res.status(400).json({ success: false, mensaje: 'Secuencia desde debe ser menor a hasta' });
    }
    // Fecha de vencimiento: obligatoria para e-CF, opcional para tradicionales
    if (esElectronico && !fecha_vencimiento) {
      return res.status(400).json({ success: false, mensaje: 'La fecha de vencimiento es requerida para NCF electronicos (E31, E32, E34)' });
    }

    const result = await pool.query(
      `INSERT INTO ncf_secuencias_electronicas 
       (tenant_id, tipo_ncf, prefijo, secuencia_desde, secuencia_hasta, secuencia_actual, fecha_vencimiento, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
      [tenant_id, tipo_ncf, tipo_ncf, secuencia_desde, secuencia_hasta, secuencia_desde, fecha_vencimiento || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// PUT - Editar secuencia NCF electrónica
router.put('/ncf-electronicas/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const { tipo_ncf, secuencia_desde, secuencia_hasta, fecha_vencimiento, activo } = req.body;

    const tiposValidos = ['B01', 'B02', 'B15', 'E31', 'E32', 'E34'];
    if (!tiposValidos.includes(tipo_ncf)) {
      return res.status(400).json({ success: false, mensaje: 'Tipo NCF debe ser B01, B02, B15, E31, E32 o E34' });
    }

    const result = await pool.query(
      `UPDATE ncf_secuencias_electronicas 
       SET tipo_ncf=$1, prefijo=$2, secuencia_desde=$3, secuencia_hasta=$4, 
           fecha_vencimiento=$5, activo=$6, actualizado_en=NOW()
       WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [tipo_ncf, tipo_ncf, secuencia_desde, secuencia_hasta, fecha_vencimiento || null, activo !== false, id, tenant_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Secuencia no encontrada' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// DELETE - Eliminar secuencia NCF electrónica
router.delete('/ncf-electronicas/:id', verifyToken, tenantGuard, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM ncf_secuencias_electronicas WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [id, tenant_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Secuencia no encontrada' });
    }
    res.json({ success: true, mensaje: 'Secuencia eliminada' });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

module.exports = router;