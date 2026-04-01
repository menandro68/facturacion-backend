const tenantGuard = (req, res, next) => {
  try {
    if (!req.user || !req.user.tenant_id) {
      return res.status(403).json({ 
        mensaje: 'Acceso denegado. Tenant no identificado.' 
      });
    }
    next();
  } catch (error) {
    return res.status(403).json({ 
      mensaje: 'Error de autorización.' 
    });
  }
};

module.exports = tenantGuard;