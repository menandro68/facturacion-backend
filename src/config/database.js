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
    // Jerarquia de empresas: parent_tenant_id (empresa padre) y quien la creo
    await pool.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS parent_tenant_id UUID REFERENCES tenants(id);
     ALTER TABLE tenants ADD COLUMN IF NOT EXISTS creado_por_usuario_id UUID;
      ALTER TABLE tenants ALTER COLUMN telefono TYPE VARCHAR(60);
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS actividad VARCHAR(120);
      CREATE INDEX IF NOT EXISTS idx_tenants_parent ON tenants(parent_tenant_id);
    `);
    console.log('Columnas parent_tenant_id, creado_por_usuario_id agregadas a tenants');

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

    // Agregar columnas operador_id, anulado_por, anulado_en a invoices
    await pool.query(`
 ALTER TABLE invoices ADD COLUMN IF NOT EXISTS operador_id UUID;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS anulado_por UUID;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMP;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS origen TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS operador_creador_id UUID;
    `);
    console.log('Columnas operador_id, anulado_por, anulado_en agregadas a invoices');

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
    await pool.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS precio_original DECIMAL(12,2)`);

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
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS operador_id UUID;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmado_por UUID;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS conduce_id UUID REFERENCES conduces(id);
      ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL;
    `);
    console.log('✅ Tabla payments creada');
    console.log('Columna operador_id agregada a payments');

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
        condiciones VARCHAR(30) DEFAULT '',
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS condiciones VARCHAR(30) DEFAULT ''`);
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
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS factura_proveedor VARCHAR(50);
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS ncf_proveedor VARCHAR(20);
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

    // Tabla de operadores (personal de oficina con permisos por módulo)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS operadores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        nombre VARCHAR(100) NOT NULL,
        username VARCHAR(50) NOT NULL,
        password VARCHAR(255) NOT NULL,
        activo BOOLEAN DEFAULT true,
        modulos_permitidos TEXT DEFAULT '[]',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, username)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_operadores_tenant ON operadores(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_operadores_username ON operadores(username)`);
    console.log('✅ Tabla operadores creada');

    // Tabla configuracion_sistema (clave de descuentos y otras configuraciones futuras)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracion_sistema (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        clave VARCHAR(100) NOT NULL,
        valor TEXT,
        descripcion VARCHAR(255),
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, clave)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_config_tenant ON configuracion_sistema(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_config_clave ON configuracion_sistema(clave);
    `);
    console.log('✅ Tabla configuracion_sistema creada');

    // Tabla devoluciones (encabezado) - Flujo profesional: almacen registra -> contabilidad aprueba -> NC generada
    await pool.query(`
      CREATE TABLE IF NOT EXISTS devoluciones (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        numero VARCHAR(20) NOT NULL,
        factura_id UUID REFERENCES invoices(id),
        factura_ncf VARCHAR(20),
        customer_id UUID REFERENCES customers(id),
        cliente_nombre VARCHAR(150),
        motivo TEXT,
        estado VARCHAR(20) DEFAULT 'pendiente',
        subtotal DECIMAL(12,2) DEFAULT 0,
        itbis DECIMAL(12,2) DEFAULT 0,
        total DECIMAL(12,2) DEFAULT 0,
        nota_credito_id UUID REFERENCES invoices(id),
        creado_por VARCHAR(150),
        aprobada_por VARCHAR(150),
        procesada_por VARCHAR(150),
        cancelada_por VARCHAR(150),
        aprobada_en TIMESTAMP,
        procesada_en TIMESTAMP,
        cancelada_en TIMESTAMP,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_devoluciones_tenant ON devoluciones(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_devoluciones_factura ON devoluciones(factura_id);
      CREATE INDEX IF NOT EXISTS idx_devoluciones_customer ON devoluciones(customer_id);
      CREATE INDEX IF NOT EXISTS idx_devoluciones_estado ON devoluciones(estado);
      CREATE INDEX IF NOT EXISTS idx_devoluciones_creado ON devoluciones(creado_en);
    `);
    await pool.query(`
      ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS operador_id UUID;
    `);
    console.log('✅ Tabla devoluciones creada');
    console.log('Columna operador_id agregada a devoluciones');

    // Tabla items de devoluciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS devoluciones_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        devolucion_id UUID NOT NULL REFERENCES devoluciones(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        descripcion VARCHAR(255) NOT NULL,
        cantidad DECIMAL(12,2) NOT NULL,
        precio_unitario DECIMAL(12,2) NOT NULL,
        itbis_rate DECIMAL(5,2) DEFAULT 18.00,
        subtotal DECIMAL(12,2) DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_dev_items_devolucion ON devoluciones_items(devolucion_id);
    `);
    console.log('✅ Tabla devoluciones_items creada');

    // Tabla ncf_secuencias_electronicas (E31, E32, E34 - Factura Electrónica DGII)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ncf_secuencias_electronicas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tipo_ncf VARCHAR(3) NOT NULL,
        prefijo VARCHAR(3) NOT NULL,
        secuencia_desde BIGINT NOT NULL DEFAULT 1,
        secuencia_hasta BIGINT NOT NULL DEFAULT 1000,
        secuencia_actual BIGINT NOT NULL DEFAULT 1,
        fecha_vencimiento DATE NOT NULL,
        activo BOOLEAN DEFAULT true,
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ncf_elec_tenant ON ncf_secuencias_electronicas(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ncf_elec_tipo ON ncf_secuencias_electronicas(tipo_ncf);
      CREATE INDEX IF NOT EXISTS idx_ncf_elec_activo ON ncf_secuencias_electronicas(activo);
    `);
    console.log('✅ Tabla ncf_secuencias_electronicas creada');

    // Tabla admin_users (usuarios super-admin que controlan todos los tenants)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nombre VARCHAR(100),
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla admin_users creada');

    // Crear usuario super-admin por defecto si no existe
    const bcrypt = require('bcryptjs');
    const hashAdmin = await bcrypt.hash('132312ml', 10);
    await pool.query(`
      INSERT INTO admin_users (username, password, nombre)
      VALUES ($1, $2, $3)
      ON CONFLICT (username) DO NOTHING
    `, ['menandro68', hashAdmin, 'Super Administrador']);
    console.log('✅ Usuario super-admin verificado');

    // Agregar columnas de Facturacion Electronica (e-CF) a la tabla invoices
    await pool.query(`
      ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS codigo_seguridad VARCHAR(10),
        ADD COLUMN IF NOT EXISTS fecha_vencimiento_encf DATE,
        ADD COLUMN IF NOT EXISTS fecha_firma_digital TIMESTAMP,
        ADD COLUMN IF NOT EXISTS qr_data TEXT
    `);
  console.log('Columnas e-CF agregadas a invoices');

    // Agregar columna primer_login a users (forzar cambio de credenciales en primer acceso)
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS primer_login BOOLEAN DEFAULT FALSE
    `);
    console.log('Columna primer_login agregada a users');

    // ============================================================
    // MIGRACION: Numero de factura consecutivo por tenant
    // ============================================================

    // 1. Agregar columna numero_factura a invoices (no destructivo)
    await pool.query(`
      ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS numero_factura INTEGER
    `);

    // 2. Crear tabla contador secuencial por tenant
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_invoice_counter (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        ultimo_numero INTEGER NOT NULL DEFAULT 0,
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);

    // 3. Indice para busquedas rapidas
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_numero_tenant
      ON invoices(tenant_id, numero_factura)
    `);

    // 4. Backfill: asignar numeros a facturas existentes sin numero (orden cronologico por tenant)
    const facturasSinNumero = await pool.query(`
      SELECT COUNT(*) as total FROM invoices WHERE numero_factura IS NULL
    `);

    if (parseInt(facturasSinNumero.rows[0].total) > 0) {
      await pool.query(`
        WITH numeradas AS (
          SELECT id,
                 ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY creado_en ASC) as nuevo_numero
          FROM invoices
          WHERE numero_factura IS NULL
        )
        UPDATE invoices i
        SET numero_factura = n.nuevo_numero
        FROM numeradas n
        WHERE i.id = n.id
      `);
      console.log('✅ Backfill: numeros asignados a facturas existentes');
    }

    // 5. Inicializar contador con el ultimo numero usado por cada tenant
    await pool.query(`
      INSERT INTO tenant_invoice_counter (tenant_id, ultimo_numero)
      SELECT tenant_id, COALESCE(MAX(numero_factura), 0)
      FROM invoices
      GROUP BY tenant_id
      ON CONFLICT (tenant_id) DO UPDATE
        SET ultimo_numero = GREATEST(tenant_invoice_counter.ultimo_numero, EXCLUDED.ultimo_numero),
            actualizado_en = NOW()
    `);

    console.log('✅ Migracion numero_factura completada');

    // Migracion: agregar columna chofer_id a invoices (entrega chofer)
    await pool.query(`
      ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL
    `);
        console.log('✅ Columna chofer_id agregada a invoices');

    // Caja del POS a la que pertenece la factura (cuadre independiente por cajero)
    await pool.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS caja_id UUID;
      CREATE INDEX IF NOT EXISTS idx_invoices_caja ON invoices(caja_id);
    `);
    console.log('✅ Columna caja_id agregada a invoices');

    // ============ MODULO NOMINA ============
    // 1. Empleados
    await pool.query(`
      CREATE TABLE IF NOT EXISTS empleados (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        codigo VARCHAR(20),
        nombre VARCHAR(150) NOT NULL,
        cedula VARCHAR(20),
        nss VARCHAR(30),
        cargo VARCHAR(100),
        departamento VARCHAR(100),
        fecha_ingreso DATE,
        fecha_salida DATE,
        tipo_contrato VARCHAR(30) DEFAULT 'indefinido',
        salario_base DECIMAL(14,2) DEFAULT 0,
        frecuencia_pago VARCHAR(20) DEFAULT 'mensual',
        forma_pago VARCHAR(20) DEFAULT 'transferencia',
        banco VARCHAR(100),
        cuenta_bancaria VARCHAR(50),
        afp_id VARCHAR(60),
        ars_id VARCHAR(60),
        telefono VARCHAR(20),
        email VARCHAR(100),
        direccion TEXT,
        exento_isr BOOLEAN DEFAULT false,
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_empleados_tenant ON empleados(tenant_id);
    `);
    console.log('✅ Tabla empleados creada');

    // 2. Configuracion de tasas (por tenant, con vigencia)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nomina_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        vigente_desde DATE NOT NULL,
        afp_empleado_pct DECIMAL(6,3) DEFAULT 0,
        afp_empleador_pct DECIMAL(6,3) DEFAULT 0,
        sfs_empleado_pct DECIMAL(6,3) DEFAULT 0,
        sfs_empleador_pct DECIMAL(6,3) DEFAULT 0,
        srl_empleador_pct DECIMAL(6,3) DEFAULT 0,
        infotep_empleador_pct DECIMAL(6,3) DEFAULT 0,
        salario_minimo_cotizable DECIMAL(14,2) DEFAULT 0,
        tope_afp_salarios INTEGER DEFAULT 0,
        tope_sfs_salarios INTEGER DEFAULT 0,
        escala_isr JSONB DEFAULT '[]',
        notas TEXT,
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nomina_config_tenant ON nomina_config(tenant_id, vigente_desde DESC);
    `);
    console.log('✅ Tabla nomina_config creada');

    // 3. Catalogo de conceptos (ingresos y deducciones)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nomina_conceptos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        codigo VARCHAR(20),
        nombre VARCHAR(120) NOT NULL,
        tipo VARCHAR(20) NOT NULL,
        cotizable BOOLEAN DEFAULT true,
        gravable_isr BOOLEAN DEFAULT true,
        formula VARCHAR(30) DEFAULT 'monto',
        valor DECIMAL(14,4) DEFAULT 0,
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nomina_conceptos_tenant ON nomina_conceptos(tenant_id);
    `);
    console.log('✅ Tabla nomina_conceptos creada');

    // 4. Periodos de nomina (cabecera)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nomina_periodos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        numero VARCHAR(20),
        descripcion VARCHAR(150),
        tipo VARCHAR(30) DEFAULT 'ordinaria',
        frecuencia VARCHAR(20) DEFAULT 'mensual',
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL,
        fecha_pago DATE,
        estado VARCHAR(20) DEFAULT 'borrador',
        total_ingresos DECIMAL(14,2) DEFAULT 0,
        total_deducciones DECIMAL(14,2) DEFAULT 0,
        total_neto DECIMAL(14,2) DEFAULT 0,
        total_aportes_empleador DECIMAL(14,2) DEFAULT 0,
        cantidad_empleados INTEGER DEFAULT 0,
        config_snapshot JSONB DEFAULT '{}',
        procesado_por UUID,
        procesado_en TIMESTAMP,
        anulado_por UUID,
        anulado_en TIMESTAMP,
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nomina_periodos_tenant ON nomina_periodos(tenant_id, fecha_inicio DESC);
    `);
    console.log('✅ Tabla nomina_periodos creada');

    // 5. Detalle por empleado (valores congelados al procesar)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nomina_detalle (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        periodo_id UUID NOT NULL REFERENCES nomina_periodos(id) ON DELETE CASCADE,
        empleado_id UUID REFERENCES empleados(id) ON DELETE SET NULL,
        empleado_nombre VARCHAR(150),
        empleado_cedula VARCHAR(20),
        cargo VARCHAR(100),
        salario_base DECIMAL(14,2) DEFAULT 0,
        dias_trabajados DECIMAL(6,2) DEFAULT 0,
        horas_extras DECIMAL(8,2) DEFAULT 0,
        monto_horas_extras DECIMAL(14,2) DEFAULT 0,
        otros_ingresos DECIMAL(14,2) DEFAULT 0,
        total_ingresos DECIMAL(14,2) DEFAULT 0,
        salario_cotizable DECIMAL(14,2) DEFAULT 0,
        afp_empleado DECIMAL(14,2) DEFAULT 0,
        sfs_empleado DECIMAL(14,2) DEFAULT 0,
        isr DECIMAL(14,2) DEFAULT 0,
        otras_deducciones DECIMAL(14,2) DEFAULT 0,
        total_deducciones DECIMAL(14,2) DEFAULT 0,
        neto_pagar DECIMAL(14,2) DEFAULT 0,
        afp_empleador DECIMAL(14,2) DEFAULT 0,
        sfs_empleador DECIMAL(14,2) DEFAULT 0,
        srl_empleador DECIMAL(14,2) DEFAULT 0,
        infotep_empleador DECIMAL(14,2) DEFAULT 0,
        total_aportes_empleador DECIMAL(14,2) DEFAULT 0,
        desglose JSONB DEFAULT '{}',
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nomina_detalle_periodo ON nomina_detalle(periodo_id);
      CREATE INDEX IF NOT EXISTS idx_nomina_detalle_empleado ON nomina_detalle(empleado_id);
    `);
    console.log('✅ Tabla nomina_detalle creada');

    // 6. Movimientos variables del empleado por periodo (ingresos/deducciones puntuales)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nomina_movimientos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        periodo_id UUID REFERENCES nomina_periodos(id) ON DELETE CASCADE,
        empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        concepto_id UUID REFERENCES nomina_conceptos(id) ON DELETE SET NULL,
        concepto_nombre VARCHAR(120),
        tipo VARCHAR(20) NOT NULL,
        cantidad DECIMAL(10,2) DEFAULT 1,
        monto DECIMAL(14,2) DEFAULT 0,
        cotizable BOOLEAN DEFAULT true,
        gravable_isr BOOLEAN DEFAULT true,
        notas TEXT,
        aplicado BOOLEAN DEFAULT false,
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nomina_mov_periodo ON nomina_movimientos(periodo_id);
      CREATE INDEX IF NOT EXISTS idx_nomina_mov_empleado ON nomina_movimientos(empleado_id);
    `);
        console.log('✅ Tabla nomina_movimientos creada');

    // 7. Prestamos a empleados (se amortizan automaticamente en cada nomina)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nomina_prestamos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        numero VARCHAR(20),
        fecha DATE DEFAULT CURRENT_DATE,
        monto_original DECIMAL(14,2) NOT NULL DEFAULT 0,
        cuota DECIMAL(14,2) NOT NULL DEFAULT 0,
        balance DECIMAL(14,2) NOT NULL DEFAULT 0,
        total_descontado DECIMAL(14,2) DEFAULT 0,
        motivo VARCHAR(255),
        notas TEXT,
        estado VARCHAR(20) DEFAULT 'activo',
        saldado_en TIMESTAMP,
        cancelado_en TIMESTAMP,
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nomina_prestamos_tenant ON nomina_prestamos(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_nomina_prestamos_empleado ON nomina_prestamos(empleado_id);
      CREATE INDEX IF NOT EXISTS idx_nomina_prestamos_estado ON nomina_prestamos(estado);
    `);
    console.log('✅ Tabla nomina_prestamos creada');

    // 8. Historial de cuotas descontadas (trazabilidad por periodo)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nomina_prestamos_cuotas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        prestamo_id UUID NOT NULL REFERENCES nomina_prestamos(id) ON DELETE CASCADE,
        periodo_id UUID REFERENCES nomina_periodos(id) ON DELETE SET NULL,
        empleado_id UUID REFERENCES empleados(id) ON DELETE SET NULL,
        monto DECIMAL(14,2) NOT NULL DEFAULT 0,
        balance_anterior DECIMAL(14,2) DEFAULT 0,
        balance_nuevo DECIMAL(14,2) DEFAULT 0,
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_prestamos_cuotas_prestamo ON nomina_prestamos_cuotas(prestamo_id);
      CREATE INDEX IF NOT EXISTS idx_prestamos_cuotas_periodo ON nomina_prestamos_cuotas(periodo_id);
    `);
       console.log('✅ Tabla nomina_prestamos_cuotas creada');
    console.log('🎉 Modulo Nomina: tablas listas');

    // ============ MODULO CONTABILIDAD ============
    // 1. Catalogo de cuentas contables (estructura jerarquica)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cuentas_contables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        codigo VARCHAR(30) NOT NULL,
        nombre VARCHAR(150) NOT NULL,
        tipo VARCHAR(20) NOT NULL,
        naturaleza VARCHAR(10) NOT NULL,
        nivel INTEGER DEFAULT 1,
        padre_codigo VARCHAR(30),
        acepta_movimiento BOOLEAN DEFAULT true,
        es_sistema BOOLEAN DEFAULT false,
        descripcion TEXT,
        estado VARCHAR(20) DEFAULT 'activo',
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, codigo)
      );
      CREATE INDEX IF NOT EXISTS idx_cuentas_tenant ON cuentas_contables(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_cuentas_codigo ON cuentas_contables(tenant_id, codigo);
      CREATE INDEX IF NOT EXISTS idx_cuentas_tipo ON cuentas_contables(tenant_id, tipo);
    `);
    console.log('✅ Tabla cuentas_contables creada');

    // 2. Periodos contables (un mes cerrado no acepta asientos)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS periodos_contables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ano INTEGER NOT NULL,
        mes INTEGER NOT NULL,
        estado VARCHAR(20) DEFAULT 'abierto',
        cerrado_por UUID,
        cerrado_en TIMESTAMP,
        notas TEXT,
        creado_en TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, ano, mes)
      );
      CREATE INDEX IF NOT EXISTS idx_periodos_cont_tenant ON periodos_contables(tenant_id, ano DESC, mes DESC);
    `);
    console.log('✅ Tabla periodos_contables creada');

    // 3. Asientos contables (cabecera)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS asientos_contables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        numero VARCHAR(20),
        fecha DATE NOT NULL,
        tipo VARCHAR(20) DEFAULT 'manual',
        origen_modulo VARCHAR(30),
        origen_id UUID,
        origen_documento VARCHAR(50),
        descripcion VARCHAR(255),
        total_debito DECIMAL(16,2) DEFAULT 0,
        total_credito DECIMAL(16,2) DEFAULT 0,
        estado VARCHAR(20) DEFAULT 'registrado',
        creado_por UUID,
        anulado_por UUID,
        anulado_en TIMESTAMP,
        notas TEXT,
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_asientos_tenant ON asientos_contables(tenant_id, fecha DESC);
      CREATE INDEX IF NOT EXISTS idx_asientos_origen ON asientos_contables(origen_modulo, origen_id);
      CREATE INDEX IF NOT EXISTS idx_asientos_estado ON asientos_contables(tenant_id, estado);
    `);
    console.log('✅ Tabla asientos_contables creada');

    // 4. Detalle del asiento (las lineas de debito y credito)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS asientos_detalle (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        asiento_id UUID NOT NULL REFERENCES asientos_contables(id) ON DELETE CASCADE,
        cuenta_id UUID REFERENCES cuentas_contables(id),
        cuenta_codigo VARCHAR(30),
        cuenta_nombre VARCHAR(150),
        descripcion VARCHAR(255),
        debito DECIMAL(16,2) DEFAULT 0,
        credito DECIMAL(16,2) DEFAULT 0,
        orden INTEGER DEFAULT 0,
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_asientos_det_asiento ON asientos_detalle(asiento_id);
      CREATE INDEX IF NOT EXISTS idx_asientos_det_cuenta ON asientos_detalle(tenant_id, cuenta_codigo);
    `);
    console.log('✅ Tabla asientos_detalle creada');

    // 5. Configuracion: que cuenta usa cada operacion automatica
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contabilidad_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        clave VARCHAR(60) NOT NULL,
        cuenta_codigo VARCHAR(30),
        descripcion VARCHAR(150),
        creado_en TIMESTAMP DEFAULT NOW(),
        actualizado_en TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, clave)
      );
      CREATE INDEX IF NOT EXISTS idx_cont_config_tenant ON contabilidad_config(tenant_id);
    `);
    console.log('✅ Tabla contabilidad_config creada');
        console.log('🎉 Modulo Contabilidad: tablas listas');

    // Precio al detalle (segundo precio de venta por articulo)
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS precio_detalle DECIMAL(14,2) DEFAULT 0
    `);
        console.log('✅ Columna precio_detalle agregada a products');

    // Tipo de precio que aplica a cada cliente (1 = precio principal, 2 = segundo precio)
    await pool.query(`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS tipo_precio SMALLINT DEFAULT 1
    `);

    // Precio al que la empresa entrega el articulo al vendedor
    await pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS precio_vendedor DECIMAL(14,2) DEFAULT 0
    `);
    console.log('Columna precio_vendedor agregada a products');
    console.log('✅ Columna tipo_precio agregada a customers');

    console.log('🎉 Base de datos lista');
  } catch (error) {
    console.error('❌ Error creando tablas:', error.message);
  }
};

module.exports = createTables;