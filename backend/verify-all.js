const {Pool}=require('pg');
(async()=>{
const s=new Pool({connectionString:'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres',ssl:{rejectUnauthorized:false}});
const r=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});

const names=['6AsI8MC5PRTYbCcvW8h0d8uvqt53','z2jgiF1rThOEZ8xNzvhWh0bDyji2','UeQdUfpeW0X7GIFDDHCaAFqjjTd2'];
const labels=['Global Star ⭐','CryptoRomania','Collins ijabor'];

for(let i=0;i<names.length;i++){
  const su=await s.query("SELECT ref_level1,ref_level2,ref_level3,referrals FROM users WHERE uid=$1",[names[i]]);
  const ru=await r.query("SELECT ref_level1,ref_level2,ref_level3,referrals FROM users WHERE uid=$1",[names[i]]);
  console.log(`${labels[i]}:`);
  console.log(`  Supabase → L1=${su.rows[0].ref_level1} L2=${su.rows[0].ref_level2} L3=${su.rows[0].ref_level3} refs=${su.rows[0].referrals}`);
  console.log(`  Render   → L1=${ru.rows[0].ref_level1} L2=${ru.rows[0].ref_level2} L3=${ru.rows[0].ref_level3} refs=${ru.rows[0].referrals}`);
}
await s.end();await r.end()})();