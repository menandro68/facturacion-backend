const p=require('./src/config/db');
p.query("SELECT estado, DATE_TRUNC('month', fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo') as mes, COUNT(*) as cant, SUM(total) as total FROM invoices WHERE fecha_emision IS NOT NULL GROUP BY estado, mes ORDER BY mes, estado").then(r=>{console.table(r.rows);process.exit()}).catch(e=>{console.error(e.message);process.exit(1)})
