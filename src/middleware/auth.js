const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  try {
   const authHeader = req.headers['authorization'];
    const token = req.query.token || (authHeader && authHeader.split(' ')[1]);

    if (!token) {
      return res.status(401).json({ 
        mensaje: 'Acceso denegado. Token requerido.' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();

  } catch (error) {
    return res.status(401).json({ 
      mensaje: 'Token inválido o expirado.' 
    });
  }
};

module.exports = verifyToken;