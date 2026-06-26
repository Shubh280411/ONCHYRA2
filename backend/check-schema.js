const {Pool}=require('pg');
(async()=>{
const p=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});
const c=await p.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_name='commissions'");
c.rows.forEach(r=>console.log(r.column_name, r.data_type, r.is_nullable, r.column_default||'-'));
await p.end()})();