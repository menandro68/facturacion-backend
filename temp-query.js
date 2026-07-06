const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT p.nombre, inv.stock_actual, inv.stock_minimo as inv_minimo, p.stock_minimo as prod_minimo FROM inventory inv JOIN products p ON inv.product_id=p.id WHERE p.nombre ILIKE '%bacalao%'").then(r=>{console.table(r.rows);p.end()}).catch(e=>{console.log(e.message);p.end()});
