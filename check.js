const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:baOUOsXncczEhQpnDYLjhuCCiEaHQAKk@hopper.proxy.rlwy.net:55178/railway',
  ssl: { rejectUnauthorized: false }
});

async function crearVendedor() {
  const usuario = 'vendedor1';
  const password = '123456';
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);

  await pool.query(
    `UPDATE vendedores SET usuario = $1, password_hash = $2 WHERE id = (SELECT id FROM vendedores LIMIT 1)`,
    [usuario, hash]
  );
  console.log('Vendedor actualizado: usuario=' + usuario + ' password=' + password);
  process.exit(0);
}

crearVendedor().catch(e => { console.error(e.message); process.exit(1); });