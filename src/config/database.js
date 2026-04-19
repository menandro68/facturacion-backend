const pool = require('./db');

const createTables = async () => {
  try {
    // 1. Tabla tenants
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre VARCHAR(150) NOT NULL,
        rnc VARCHAR(20) UNIQUE,
        email VARCHAR(100) UNIQUE NOT NULL,
        telefono VARCHAR(20),
        direccion TEXT,
        logo_url TEXT,
        plan VARCHAR(20) DEFAULT 'gratis',
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla tenants creada');

    // 2. Tabla users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        nombre VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        rol VARCHAR(20) DEFAULT 'admin',
        verificado BOOLEAN DEFAULT FALSE,
        token_verificacion VARCHAR(255),
        reset_token VARCHAR(255),
        reset_token_expira TIMESTAMP,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla users creada');

    // 3. Tabla subscriptions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        plan VARCHAR(20) NOT NULL,
        estado VARCHAR(20) DEFAULT 'activo',
        vence_en TIMESTAMP,
        stripe_subscription_id VARCHAR(255),
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla subscriptions creada');

    // 4. Índices
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
    `);
    console.log('✅ Índices creados');

    // 5. Tabla customers
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        rnc_cedula VARCHAR(20),
        email VARCHAR(100),
        telefono VARCHAR(20),
        direccion TEXT,
        tipo VARCHAR(30) DEFAULT 'consumidor_final',
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla customers creada');

    // 6. Tabla products
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        descripcion TEXT,
        precio DECIMAL(12,2) NOT NULL DEFAULT 0,
        itbis_rate DECIMAL(5,2) DEFAULT 18.00,
        unidad VARCHAR(30) DEFAULT 'unidad',
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla products creada');

    // 7. Tabla ncf_sequences
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ncf_sequences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tipo VARCHAR(10) NOT NULL,
        prefijo VARCHAR(10) NOT NULL,
        secuencia_actual INTEGER DEFAULT 0,
        secuencia_max INTEGER DEFAULT 1000,
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla ncf_sequences creada');

    // 8. Tabla invoices
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES customers(id),
        ncf VARCHAR(20),
        ncf_tipo VARCHAR(10) DEFAULT 'B01',
        estado VARCHAR(20) DEFAULT 'borrador',
        subtotal DECIMAL(12,2) DEFAULT 0,
        itbis DECIMAL(12,2) DEFAULT 0,
        total DECIMAL(12,2) DEFAULT 0,
        notas TEXT,
        fecha_emision TIMESTAMP,
        fecha_vencimiento TIMESTAMP,
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla invoices creada');

    // 9. Tabla invoice_items
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        descripcion VARCHAR(255) NOT NULL,
        cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
        precio_unitario DECIMAL(12,2) NOT NULL,
        itbis_rate DECIMAL(5,2) DEFAULT 18.00,
        itbis_monto DECIMAL(12,2) DEFAULT 0,
        subtotal DECIMAL(12,2) DEFAULT 0,
        total DECIMAL(12,2) DEFAULT 0
      )
    `);
    console.log('✅ Tabla invoice_items creada');

    // 10. Tabla payments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        monto DECIMAL(12,2) NOT NULL,
        metodo VARCHAR(30) DEFAULT 'efectivo',
        referencia VARCHAR(100),
        notas TEXT,
        estado VARCHAR(20) DEFAULT 'confirmado',
        vendedor_nombre VARCHAR(150),
        confirmado_en TIMESTAMP,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'confirmado';
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS vendedor_nombre VARCHAR(150);
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmado_en TIMESTAMP;
    `);
    console.log('✅ Tabla payments creada');

    // 11. Tabla proveedores
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        rnc VARCHAR(20),
        email VARCHAR(100),
        telefono VARCHAR(20),
        direccion TEXT,
        contacto VARCHAR(100),
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla suppliers creada');

    // 12. Tabla inventario
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        stock_actual DECIMAL(12,2) DEFAULT 0,
        stock_minimo DECIMAL(12,2) DEFAULT 0,
        stock_maximo DECIMAL(12,2) DEFAULT 0,
        unidad VARCHAR(30) DEFAULT 'unidad',
        ubicacion VARCHAR(100),
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla inventory creada');

    // 13. Tabla movimientos de inventario
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
        tipo VARCHAR(20) NOT NULL,
        cantidad DECIMAL(12,2) NOT NULL,
        stock_anterior DECIMAL(12,2) NOT NULL,
        stock_nuevo DECIMAL(12,2) NOT NULL,
        motivo VARCHAR(255),
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla inventory_movements creada');

    // 14. Tabla cuentas por cobrar
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts_receivable (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES customers(id),
        invoice_id UUID REFERENCES invoices(id),
        descripcion VARCHAR(255) NOT NULL,
        monto_total DECIMAL(12,2) NOT NULL,
        monto_pagado DECIMAL(12,2) DEFAULT 0,
        monto_pendiente DECIMAL(12,2) NOT NULL,
        fecha_vencimiento DATE,
        estado VARCHAR(20) DEFAULT 'pendiente',
        notas TEXT,
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla accounts_receivable creada');
    
    // 15. Tabla cuentas por pagar
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts_payable (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        supplier_id UUID REFERENCES suppliers(id),
        descripcion VARCHAR(255) NOT NULL,
        monto_total DECIMAL(12,2) NOT NULL,
        monto_pagado DECIMAL(12,2) DEFAULT 0,
        monto_pendiente DECIMAL(12,2) NOT NULL,
        fecha_vencimiento DATE,
        estado VARCHAR(20) DEFAULT 'pendiente',
        notas TEXT,
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla accounts_payable creada');

    // 16. Tabla vendedores
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendedores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        cedula VARCHAR(20),
        email VARCHAR(100),
        telefono VARCHAR(20),
        zona_id UUID,
        comision_pct DECIMAL(5,2) DEFAULT 0,
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla vendedores creada');

    // 17. Tabla zonas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS zonas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        descripcion TEXT,
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla zonas creada');

    // 18. Tabla choferes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS choferes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        cedula VARCHAR(20),
        licencia VARCHAR(30),
        telefono VARCHAR(20),
        email VARCHAR(100),
        vehiculo VARCHAR(100),
        placa VARCHAR(20),
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla choferes creada');

    // Tabla ordenes de compra
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        numero VARCHAR(20) NOT NULL,
        supplier_id UUID REFERENCES suppliers(id),
        fecha DATE DEFAULT CURRENT_DATE,
        fecha_entrega DATE,
        estado VARCHAR(20) DEFAULT 'pendiente',
        notas TEXT,
        total DECIMAL(12,2) DEFAULT 0,
        monto_pagado DECIMAL(12,2) DEFAULT 0,
        estado_pago VARCHAR(20) DEFAULT 'pendiente',
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS monto_pagado DECIMAL(12,2) DEFAULT 0;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'pendiente';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS fecha_vencimiento_pago DATE;
    `);
    console.log('✅ Tabla purchase_orders creada');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        descripcion VARCHAR(255),
        cantidad DECIMAL(12,2) NOT NULL,
        precio_unitario DECIMAL(12,2) NOT NULL,
        subtotal DECIMAL(12,2) NOT NULL
      )
    `);
    console.log('✅ Tabla purchase_order_items creada');

    // Tabla historial de pagos de órdenes de compra
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        monto DECIMAL(12,2) NOT NULL,
        metodo VARCHAR(30) DEFAULT 'efectivo',
        notas TEXT,
        fecha_pago TIMESTAMP DEFAULT NOW(),
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_po_payments_tenant ON purchase_order_payments(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_po_payments_order ON purchase_order_payments(order_id);
      CREATE INDEX IF NOT EXISTS idx_po_payments_fecha ON purchase_order_payments(fecha_pago);
    `);
    console.log('✅ Tabla purchase_order_payments creada');

    console.log('🎉 Base de datos lista');
  } catch (error) {
    console.error('❌ Error creando tablas:', error.message);
  }
};

module.exports = createTables;