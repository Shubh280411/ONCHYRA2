const {Pool}=require('pg');
(async()=>{
const r=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});
const cols=await r.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users'");
console.log('Render DB users columns:');
cols.rows.forEach(c=>console.log(`  ${c.column_name} (${c.data_type})`));
await r.end()})();