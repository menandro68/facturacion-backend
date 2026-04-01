const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// REGISTRO
const register = async (req, res) => {
  const { nombre, email, password, nombre_empresa, rnc } = req.body;

  try {
    // Validar campos requeridos
    if (!nombre || !email || !password || !nombre_empresa) {
      return res.status(400).json({ 
        mensaje: 'Todos los campos son requeridos' 
      });
    }

    // Verificar si el email ya existe
    const emailExiste = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email]
    );
    if (emailExiste.rows.length > 0) {
      return res.status(400).json({ 
        mensaje: 'El email ya está registrado' 
      });
    }

    // Crear tenant
    const tenant = await pool.query(
      `INSERT INTO tenants (nombre, rnc, email) 
       VALUES ($1, $2, $3) RETURNING id`,
      [nombre_empresa, rnc || null, email]
    );
    const tenant_id = tenant.rows[0].id;

    // Hashear password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Generar token de verificación
    const token_verificacion = uuidv4();

    // Crear usuario
    const user = await pool.query(
      `INSERT INTO users (tenant_id, nombre, email, password, token_verificacion) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, email, rol`,
      [tenant_id, nombre, email, passwordHash, token_verificacion]
    );

    // Crear suscripción gratis
    await pool.query(
      `INSERT INTO subscriptions (tenant_id, plan, vence_en) 
       VALUES ($1, 'gratis', NOW() + INTERVAL '30 days')`,
      [tenant_id]
    );

    // Generar JWT
    const token = jwt.sign(
      { 
        id: user.rows[0].id, 
        tenant_id, 
        rol: user.rows[0].rol 
      },
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
  const { email, password } = req.body;

  try {
    // Validar campos
    if (!email || !password) {
      return res.status(400).json({ 
        mensaje: 'Email y password son requeridos' 
      });
    }

    // Buscar usuario
    const result = await pool.query(
      `SELECT u.*, t.nombre as empresa, t.estado as tenant_estado 
       FROM users u 
       JOIN tenants t ON u.tenant_id = t.id 
       WHERE u.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        mensaje: 'Credenciales incorrectas' 
      });
    }

    const user = result.rows[0];

    // Verificar que el tenant esté activo
    if (user.tenant_estado !== 'activo') {
      return res.status(401).json({ 
        mensaje: 'Cuenta suspendida. Contacte soporte.' 
      });
    }

    // Verificar password
    const passwordValido = await bcrypt.compare(password, user.password);
    if (!passwordValido) {
      return res.status(401).json({ 
        mensaje: 'Credenciales incorrectas' 
      });
    }

    // Generar JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        tenant_id: user.tenant_id, 
        rol: user.rol 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
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

  } catch (error) {
    console.error('Error en login:', error.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = { register, login };