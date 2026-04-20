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
const operadoresRoutes = require('./routes/operadores');

const app = express();
app.set('trust proxy', 1)

// Seguridad
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

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
app.use('/auth', authRoutes);
app.use('/tenant', tenantRoutes);
app.use('/customers', customerRoutes);
app.use('/products', productRoutes);
app.use('/invoices', invoiceRoutes);
app.use('/payments', paymentRoutes);
app.use('/reports', reportRoutes);
app.use('/suppliers', supplierRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/accounts-receivable', arRoutes);
app.use('/accounts-payable', apRoutes);
app.use('/mantenimiento', mantenimientoRoutes);
app.use('/purchase-orders', purchaseOrderRoutes);
app.use('/devoluciones', devolucionesRoutes);
app.use('/operadores', operadoresRoutes);

// SPA - servir index.html con no-cache
app.get('/{*path}', (req, res) => {
  if (!req.path.startsWith('/auth') && !req.path.startsWith('/invoices') && 
      !req.path.startsWith('/customers') && !req.path.startsWith('/products') &&
      !req.path.startsWith('/payments') && !req.path.startsWith('/reports') &&
      !req.path.startsWith('/suppliers') && !req.path.startsWith('/inventory') &&
      !req.path.startsWith('/accounts') && !req.path.startsWith('/mantenimiento') &&
      !req.path.startsWith('/purchase') && !req.path.startsWith('/tenant') &&
      !req.path.startsWith('/devoluciones') && !req.path.startsWith('/operadores') &&
      !req.path.startsWith('/db-test')) {
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

// Crear tablas al iniciar
createTables();

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});