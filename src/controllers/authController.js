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
    let login_input = email || usuario;
    // Si el usuario no contiene @, es un usuario simple (ej: casaalberto)
    // Lo convertimos automaticamente a email interno
    if (login_input && !login_input.includes('@')) {
      const usuarioLimpio = login_input.toLowerCase().replace(/[^a-z0-9]/g, '');
      login_input = usuarioLimpio + '@empresa.local';
    }
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
        { id: user.id, tenant_id: user.tenant_id, rol: user.rol, nombre: user.nombre },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

return res.json({
        mensaje: 'Login exitoso ✅',
        token,
        requiere_cambio: user.primer_login === true,
        usuario: {
          id: user.id,
          nombre: user.nombre,
          email: user.email,
          rol: user.rol,
          empresa: user.empresa,
          primer_login: user.primer_login === true
        }
      });
    }

    // ── 2. Buscar en operadores ──
    const resultOperador = await pool.query(
      `SELECT o.*, t.nombre as empresa, t.estado as tenant_estado
       FROM operadores o
       JOIN tenants t ON o.tenant_id = t.id
       WHERE o.username = $1 AND o.activo = true`,
      [(usuario || email || '').toLowerCase().trim()]
    );

    if (resultOperador.rows.length > 0) {
      const operador = resultOperador.rows[0];

      if (operador.tenant_estado !== 'activo') {
        return res.status(401).json({ mensaje: 'Cuenta suspendida. Contacte soporte.' });
      }

      const passwordValido = await bcrypt.compare(password, operador.password);
      if (!passwordValido) {
        return res.status(401).json({ mensaje: 'Credenciales incorrectas' });
      }

      let modulosPermitidos = [];
      try {
        modulosPermitidos = JSON.parse(operador.modulos_permitidos || '[]');
      } catch (e) {
        modulosPermitidos = [];
      }

      const token = jwt.sign(
        {
          id: operador.id,
          tenant_id: operador.tenant_id,
          rol: 'operador',
          operador_id: operador.id,
          nombre: operador.nombre,
          modulos_permitidos: modulosPermitidos
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      return res.json({
        mensaje: 'Login exitoso ✅',
        token,
        usuario: {
          id: operador.id,
          nombre: operador.nombre,
          username: operador.username,
          rol: 'operador',
          empresa: operador.empresa,
          modulos_permitidos: modulosPermitidos
        }
      });
    }

    // ── 3. Buscar en vendedores ──
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
      { id: vendedor.id, tenant_id: vendedor.tenant_id, rol: 'vendedor', vendedor_id: vendedor.id, nombre: vendedor.nombre },
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

// CAMBIAR CREDENCIALES (forzar en primer login)
const cambiarCredenciales = async (req, res) => {
  const { nuevo_usuario, nueva_password, repetir_password } = req.body;
  const userId = req.user.id;

  try {
    // Validaciones basicas
    if (!nuevo_usuario || !nueva_password || !repetir_password) {
      return res.status(400).json({ 
        mensaje: 'Todos los campos son requeridos' 
      });
    }

    if (nueva_password !== repetir_password) {
      return res.status(400).json({ 
        mensaje: 'Las contraseñas no coinciden' 
      });
    }

    // Convertir el usuario simple en email interno
    const usuarioLimpio = nuevo_usuario.toLowerCase().replace(/[^a-z0-9]/g, '');
    const emailInterno = usuarioLimpio + '@empresa.local';

    // Verificar que el nuevo usuario no exista ya
    const existe = await pool.query(
      `SELECT id FROM users WHERE email = $1 AND id != $2`,
      [emailInterno, userId]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ 
        mensaje: 'Ese usuario ya está en uso. Elija otro.' 
      });
    }

    // Encriptar nueva contraseña
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(nueva_password, salt);

    // Actualizar usuario, contraseña y marcar primer_login = false
    await pool.query(
      `UPDATE users 
       SET email = $1, password = $2, primer_login = FALSE
       WHERE id = $3`,
      [emailInterno, passwordHash, userId]
    );

    res.json({ 
      mensaje: 'Credenciales actualizadas correctamente. Inicie sesión con sus nuevas credenciales.' 
    });

  } catch (error) {
    console.error('Error al cambiar credenciales:', error.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = { register, login, cambiarCredenciales };