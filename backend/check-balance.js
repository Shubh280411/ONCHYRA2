const {Pool}=require('pg');
(async()=>{
const p=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});

// Global Star balance in Render DB
const gs=await p.query("SELECT uid, name, balance, wallet_balance FROM users WHERE uid='6AsI8MC5PRTYbCcvW8h0d8uvqt53'");
console.log('Global Star Render DB:', gs.rows[0]);

// Top 10 by balance in Render DB
const top=await p.query("SELECT uid, name, balance FROM users ORDER BY balance DESC LIMIT 10");
console.log('\nTop 10 Render DB:');
top.rows.forEach(r=>console.log(`  ${r.name}: ${Number(r.balance).toFixed(2)}`));

await p.end()})();