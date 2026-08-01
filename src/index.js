require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pool = require('./config/db');
const createTables = require('./config/database');
const authRoutes = require('./routes/auth');
const tenantRoutes = require('./routes/tenants');
const customerRoutes = require('./routes/customers');
const productRoutes = require('./routes/products');
const invoiceRoutes = require('./routes/invoices');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');
const supplierRoutes = require('./routes/suppliers');
const inventoryRoutes = require('./routes/inventory');
const arRoutes = require('./routes/accounts_receivable');
const apRoutes = require('./routes/accounts_payable');
const mantenimientoRoutes = require('./routes/mantenimiento');
const purchaseOrderRoutes = require('./routes/purchase_orders');
const devolucionesRoutes = require('./routes/devoluciones');
const conducesRoutes = require('./routes/conduces');
const operadoresRoutes = require('./routes/operadores');
const superAdminRoutes = require('./routes/superAdmin');
const posRoutes = require('./routes/pos');

const app = express();
app.set('trust proxy', 1)

// Seguridad
app.use(helmet({ contentSecurityPolicy: false }));
// CORS con lista blanca. Los origenes se configuran en la variable
// CORS_ORIGINS de Railway (separados por coma). Si no esta definida,
// se usa la lista por defecto. Peticiones sin origen (APK nativa,
// Postman, server-to-server) se permiten porque no son navegador.
const origenesPermitidos = (process.env.CORS_ORIGINS || [
  'https://facturacion.squidapps.org',
  'https://facturacion-saas-production.up.railway.app',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost:5173'
].join(',')).split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origenesPermitidos.includes(origin)) return callback(null, true);
    console.warn('CORS bloqueado para origen:', origin);
    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true
}));
app.use(express.json());

// Rate limiter ESTRICTO para autenticación (anti brute-force)
// El resto del sistema usa apiLimiter, un techo holgado que no afecta
// a clientes empresariales con múltiples operadores
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // 20 intentos fallidos cada 15 min por IP
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Los logins exitosos NO cuentan
});

// Rate limiter GLOBAL: techo anti-abuso, no control de uso normal.
// 1000 req / 15 min por IP: holgado para oficinas con muchos operadores,
// pero corta scripts automatizados que martillan la API.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { mensaje: 'Demasiadas peticiones. Espere unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/ready'
});

// Archivos estáticos
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
    }
  }
}))

// Rutas
app.use('/auth', authLimiter, authRoutes);
app.use('/tenant', apiLimiter, tenantRoutes);
app.use('/customers', apiLimiter, customerRoutes);
app.use('/products', apiLimiter, productRoutes);
app.use('/invoices', apiLimiter, invoiceRoutes);
app.use('/payments', apiLimiter, paymentRoutes);
app.use('/reports', apiLimiter, reportRoutes);
app.use('/suppliers', apiLimiter, supplierRoutes);
app.use('/inventory', apiLimiter, inventoryRoutes);
app.use('/pos', apiLimiter, posRoutes);
app.use('/accounts-receivable', apiLimiter, arRoutes);
app.use('/accounts-payable', apiLimiter, apRoutes);
app.use('/mantenimiento', apiLimiter, mantenimientoRoutes);
app.use('/purchase-orders', apiLimiter, purchaseOrderRoutes);
app.use('/devoluciones', apiLimiter, devolucionesRoutes);
app.use('/conduces', apiLimiter, conducesRoutes);
app.use('/operadores', apiLimiter, operadoresRoutes);
app.use('/super-admin', apiLimiter, superAdminRoutes);

// === HEALTH CHECK PARA MONITOREO DE RAILWAY (LIVENESS) ===
// Endpoint de "liveness check" estándar profesional (Kubernetes/Cloud Run/AWS).
// Solo verifica que el proceso Node.js está vivo y respondiendo HTTP.
// NO depende de la base de datos: si la BD se cae, el servidor sigue siendo
// "saludable" (la BD se reconectará sola gracias al pool con reintentos).
// Esto evita que Railway reinicie el container por problemas transitorios de BD.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});

// === READINESS CHECK (para diagnóstico manual, no para Railway) ===
// Verifica si el sistema está listo para recibir tráfico (incluye BD).
// Útil para que TÚ revises manualmente si la BD responde.
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'ready',
      database: 'ok',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      database: 'error',
      timestamp: new Date().toISOString(),
      error: 'Base de datos no disponible'
    });
  }
});

// SPA - servir index.html con no-cache
app.get('/{*path}', (req, res) => {
  if (!req.path.startsWith('/auth') && !req.path.startsWith('/invoices') && 
      !req.path.startsWith('/customers') && !req.path.startsWith('/products') &&
      !req.path.startsWith('/payments') && !req.path.startsWith('/reports') &&
      !req.path.startsWith('/suppliers') && !req.path.startsWith('/inventory') &&
      !req.path.startsWith('/accounts') && !req.path.startsWith('/mantenimiento') &&
      !req.path.startsWith('/purchase') && !req.path.startsWith('/tenant') &&
   !req.path.startsWith('/devoluciones') && !req.path.startsWith('/operadores') &&
      !req.path.startsWith('/conduces') &&
      !req.path.startsWith('/db-test') && !req.path.startsWith('/health')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.sendFile(path.join(__dirname, '../public/index.html'))
  }
});

// Ruta de prueba de base de datos
app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as fecha');
    res.json({ 
      mensaje: 'Base de datos conectada ✅', 
      fecha: result.rows[0].fecha 
    });
  } catch (error) {
    res.status(500).json({ 
      mensaje: 'Error de conexión ❌', 
      error: error.message 
    });
  }
});

// === MIDDLEWARE CENTRAL DE ERRORES ===
// Captura cualquier error no manejado en las rutas y devuelve respuesta JSON limpia
// Loguea el error completo en consola para diagnóstico (visible en logs de Railway)
app.use((err, req, res, next) => {
  console.error('❌ Error capturado:', {
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
    message: err.message,
    stack: err.stack
  });

  // Si las cabeceras ya fueron enviadas, delegar al manejador por defecto de Express
  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({
    mensaje: 'Ha ocurrido un error en el servidor',
    error: process.env.NODE_ENV === 'production' ? 'Error interno' : err.message
  });
});

// Crear tablas al iniciar
createTables();

// === MANEJADORES GLOBALES DE ERRORES DEL PROCESO ===
// Capturan errores fuera del ciclo request/response y mantienen el servidor vivo
// (en lugar de crashear y dejar a todas las empresas sin servicio)
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', {
    timestamp: new Date().toISOString(),
    message: err.message,
    stack: err.stack
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ unhandledRejection:', {
    timestamp: new Date().toISOString(),
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : null
  });
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});