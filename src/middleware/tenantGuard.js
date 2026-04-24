const pool = require('../config/db');

const tenantGuard = async (req, res, next) => {
  try {
    if (!req.user || !req.user.tenant_id) {
      return res.status(403).json({ 
        mensaje: 'Acceso denegado. Tenant no identificado.' 
      });
    }

    // Verificar que el tenant esté activo
    const result = await pool.query(
      'SELECT estado FROM tenants WHERE id = $1',
      [req.user.tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ 
        success: false,
        mensaje: 'Cuenta no encontrada. Contacte al administrador.' 
      });
    }

    if (result.rows[0].estado !== 'activo') {
      return res.status(403).json({ 
        success: false,
        mensaje: 'Su cuenta está suspendida. Contacte al administrador del sistema.' 
      });
    }

    next();
  } catch (error) {
    return res.status(403).json({ 
      success: false,
      mensaje: 'Error de autorización: ' + error.message 
    });
  }
};

module.exports = tenantGuard;