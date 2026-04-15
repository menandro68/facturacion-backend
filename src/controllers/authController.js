const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// REGISTRO
const register = async (req, res) => {
  const { nombre, email, password, nombre_empresa, rnc } = req.body;

  try {
    if (!nombre || !email || !password || !nombre_empresa) {
      return res.status(400).json({ 
        mensaje: 'Todos los campos son requeridos' 
      });
    }

    const emailExiste = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email]
    );
    if (emailExiste.rows.length > 0) {
      return res.status(400).json({ 
        mensaje: 'El email ya está registrado' 
      });
    }

    const tenant = await pool.query(
      `INSERT INTO tenants (nombre, rnc, email) 
       VALUES ($1, $2, $3) RETURNING id`,
      [nombre_empresa, rnc || null, email]
    );
    const tenant_id = tenant.rows[0].id;

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const token_verificacion = uuidv4();

    const user = await pool.query(
      `INSERT INTO users (tenant_id, nombre, email, password, token_verificacion) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, email, rol`,
      [tenant_id, nombre, email, passwordHash, token_verificacion]
    );

    await pool.query(
      `INSERT INTO subscriptions (tenant_id, plan, vence_en) 
       VALUES ($1, 'gratis', NOW() + INTERVAL '30 days')`,
      [tenant_id]
    );

    const token = jwt.sign(
      { id: user.rows[0].id, tenant_id, rol: user.rows[0].rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(201).json({
      mensaje: 'Registro exitoso ✅',
      token,
      usuario: {
        id: user.rows[0].id,
        nombre: user.rows[0].nombre,
        email: user.rows[0].email,
        rol: user.rows[0].rol
      }
    });

  } catch (error) {
    console.error('Error en registro:', error.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// LOGIN
const login = async (req, res) => {
  const { email, usuario, password } = req.body;

  try {
    if ((!email && !usuario) || !password) {
      return res.status(400).json({ 
        mensaje: 'Email y password son requeridos' 
      });
    }

    // ── 1. Buscar en users (admin) ──
    const login_input = email || usuario;
    const resultUser = await pool.query(
      `SELECT u.*, t.nombre as empresa, t.estado as tenant_estado 
       FROM users u 
       JOIN tenants t ON u.tenant_id = t.id 
       WHERE u.email = $1`,
      [login_input]
    );

    if (resultUser.rows.length > 0) {
      const user = resultUser.rows[0];

      if (user.tenant_estado !== 'activo') {
        return res.status(401).json({ mensaje: 'Cuenta suspendida. Contacte soporte.' });
      }

      const passwordValido = await bcrypt.compare(password, user.password);
      if (!passwordValido) {
        return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
      }

      const token = jwt.sign(
        { id: user.id, tenant_id: user.tenant_id, rol: user.rol },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      return res.json({
        mensaje: 'Login exitoso ✅',
        token,
        usuario: {
          id: user.id,
          nombre: user.nombre,
          email: user.email,
          rol: user.rol,
          empresa: user.empresa
        }
      });
    }

    // ── 2. Buscar en vendedores ──
    const resultVendedor = await pool.query(
      `SELECT v.*, t.nombre as empresa, t.estado as tenant_estado
       FROM vendedores v
       JOIN tenants t ON v.tenant_id = t.id
       WHERE v.usuario = $1 AND v.estado = 'activo'`,
      [usuario || email]
    );

    if (resultVendedor.rows.length === 0) {
      return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
    }

    const vendedor = resultVendedor.rows[0];

    if (vendedor.tenant_estado !== 'activo') {
      return res.status(401).json({ mensaje: 'Cuenta suspendida. Contacte soporte.' });
    }

    if (!vendedor.password_hash) {
      return res.status(401).json({ mensaje: 'Vendedor sin contraseña asignada' });
    }

    const passwordValido = await bcrypt.compare(password, vendedor.password_hash);
    if (!passwordValido) {
      return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { id: vendedor.id, tenant_id: vendedor.tenant_id, rol: 'vendedor', vendedor_id: vendedor.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return res.json({
      mensaje: 'Login exitoso ✅',
      token,
      usuario: {
        id: vendedor.id,
        nombre: vendedor.nombre,
        email: vendedor.email,
        rol: 'vendedor',
        empresa: vendedor.empresa
      }
    });

  } catch (error) {
    console.error('Error en login:', error.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = { register, login };