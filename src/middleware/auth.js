const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = req.query.token || (authHeader && authHeader.split(' ')[1]);

    if (!token) {
      return res.status(401).json({ 
        mensaje: 'Acceso denegado. Token requerido.' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Validar que el usuario siga activo (para operadores y vendedores)
    if (decoded.rol === 'operador' && decoded.operador_id) {
      const result = await pool.query(
        'SELECT activo FROM operadores WHERE id = $1',
        [decoded.operador_id]
      );
      if (result.rows.length === 0 || result.rows[0].activo !== true) {
        return res.status(401).json({ 
          mensaje: 'Usuario inactivo. Contacte al administrador.' 
        });
      }
    } else if (decoded.rol === 'vendedor' && decoded.vendedor_id) {
      const result = await pool.query(
        'SELECT estado FROM vendedores WHERE id = $1',
        [decoded.vendedor_id]
      );
      if (result.rows.length === 0 || result.rows[0].estado !== 'activo') {
        return res.status(401).json({ 
          mensaje: 'Usuario inactivo. Contacte al administrador.' 
        });
      }
    }

    req.user = decoded;
    next();

  } catch (error) {
    return res.status(401).json({ 
      mensaje: 'Token inválido o expirado.' 
    });
  }
};

module.exports = verifyToken;