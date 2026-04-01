const pool = require('../config/db');

// VER PERFIL DE EMPRESA
const getProfile = async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const result = await pool.query(
      `SELECT id, nombre, rnc, email, telefono, 
              direccion, logo_url, plan, estado, creado_en 
       FROM tenants WHERE id = $1`,
      [tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Empresa no encontrada' });
    }

    res.json({ empresa: result.rows[0] });

  } catch (error) {
    console.error('Error en getProfile:', error.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// ACTUALIZAR PERFIL DE EMPRESA
const updateProfile = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { nombre, rnc, telefono, direccion } = req.body;

    const result = await pool.query(
      `UPDATE tenants 
       SET nombre = COALESCE($1, nombre),
           rnc = COALESCE($2, rnc),
           telefono = COALESCE($3, telefono),
           direccion = COALESCE($4, direccion)
       WHERE id = $5
       RETURNING id, nombre, rnc, email, telefono, direccion, plan`,
      [nombre, rnc, telefono, direccion, tenant_id]
    );

    res.json({ 
      mensaje: 'Perfil actualizado ✅', 
      empresa: result.rows[0] 
    });

  } catch (error) {
    console.error('Error en updateProfile:', error.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// LISTAR USUARIOS DEL TENANT
const getUsers = async (req, res) => {
  try {
    const { tenant_id } = req.user;

    const result = await pool.query(
      `SELECT id, nombre, email, rol, verificado, creado_en 
       FROM users WHERE tenant_id = $1 ORDER BY creado_en DESC`,
      [tenant_id]
    );

    res.json({ usuarios: result.rows });

  } catch (error) {
    console.error('Error en getUsers:', error.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = { getProfile, updateProfile, getUsers };