// ============================================================
// CARGA DEL PADRON OFICIAL DE RNC DE LA DGII
// Descarga el ZIP oficial, parsea el TXT y carga a PostgreSQL
// Ejecutar con: railway run node scripts/cargar_padron.js
// ============================================================
require('dotenv').config();
const AdmZip = require('adm-zip');
const pool = require('../src/config/db');

const URL_PADRON = 'https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip';
const ESTADOS_CONOCIDOS = ['ACTIVO', 'SUSPENDIDO', 'DADO DE BAJA', 'ANULADO', 'CESE TEMPORAL', 'RECHAZADO', 'CESADO'];

const main = async () => {
  const inicio = Date.now();
  try {
    // 1. DESCARGAR EL ZIP OFICIAL
    console.log('📥 Descargando padrón oficial de la DGII...');
    console.log(`   ${URL_PADRON}`);
    const res = await fetch(URL_PADRON);
    if (!res.ok) throw new Error(`La DGII respondió ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`✅ Descargado: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    // 2. DESCOMPRIMIR
    console.log('📦 Descomprimiendo...');
    const zip = new AdmZip(buffer);
    const entrada = zip.getEntries().find(e => e.entryName.toUpperCase().endsWith('.TXT'));
    if (!entrada) throw new Error('No se encontró el TXT dentro del ZIP');
    const texto = entrada.getData().toString('latin1');
    const lineas = texto.split(/\r?\n/);
    console.log(`✅ Archivo: ${entrada.entryName} — ${lineas.length.toLocaleString()} líneas`);

    // 3. CREAR TABLA
    console.log('🗄️  Creando tabla padron_rnc (si no existe)...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS padron_rnc (
        rnc VARCHAR(20) PRIMARY KEY,
        nombre VARCHAR(300),
        nombre_comercial VARCHAR(300),
        estado VARCHAR(50),
        actualizado TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_padron_rnc_rnc ON padron_rnc(rnc)`);
    console.log('✅ Tabla lista');

    // 4. PARSEAR Y CARGAR POR LOTES
    console.log('🚚 Cargando contribuyentes (esto toma varios minutos)...');
    const LOTE = 1000;
    let batch = [];
    let total = 0;
    let ignoradas = 0;

    const insertarLote = async (filas) => {
      if (filas.length === 0) return;
      const values = [];
      const params = [];
      let i = 1;
      for (const f of filas) {
        values.push(`($${i++}, $${i++}, $${i++}, $${i++}, NOW())`);
        params.push(f.rnc, f.nombre, f.nombre_comercial, f.estado);
      }
      await pool.query(
        `INSERT INTO padron_rnc (rnc, nombre, nombre_comercial, estado, actualizado)
         VALUES ${values.join(',')}
         ON CONFLICT (rnc) DO UPDATE SET
           nombre = EXCLUDED.nombre,
           nombre_comercial = EXCLUDED.nombre_comercial,
           estado = EXCLUDED.estado,
           actualizado = NOW()`,
        params
      );
    };

    for (const linea of lineas) {
      if (!linea.trim()) continue;
      const campos = linea.split('|').map(c => c.trim());
      const rnc = (campos[0] || '').replace(/\D/g, '');
      if (rnc.length !== 9 && rnc.length !== 11) { ignoradas++; continue; }

      // Buscar el estado en cualquier columna (formato de la DGII puede variar)
      let estado = '';
      for (const c of campos) {
        if (ESTADOS_CONOCIDOS.includes(c.toUpperCase())) { estado = c.toUpperCase(); break; }
      }

      batch.push({
        rnc,
        nombre: (campos[1] || '').substring(0, 300),
        nombre_comercial: (campos[2] || '').substring(0, 300),
        estado
      });

      if (batch.length >= LOTE) {
        await insertarLote(batch);
        total += batch.length;
        batch = [];
        if (total % 50000 === 0) {
          console.log(`   ... ${total.toLocaleString()} contribuyentes cargados`);
        }
      }
    }
    // Último lote
    await insertarLote(batch);
    total += batch.length;

    const minutos = ((Date.now() - inicio) / 60000).toFixed(1);
    console.log('============================================');
    console.log(`🎉 PADRÓN CARGADO COMPLETO`);
    console.log(`   Contribuyentes: ${total.toLocaleString()}`);
    console.log(`   Líneas ignoradas: ${ignoradas.toLocaleString()}`);
    console.log(`   Tiempo: ${minutos} minutos`);
    console.log('============================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    process.exit(1);
  }
};

main();