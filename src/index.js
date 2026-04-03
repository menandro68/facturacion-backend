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
app.use(express.static(path.join(__dirname, '../public')));

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

// Ruta de prueba
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
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