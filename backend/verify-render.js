const {Pool}=require('pg');
(async()=>{
const p=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});

const all=await p.query("SELECT uid, name, referral_code, ref_level1 FROM users WHERE referral_code IS NOT NULL AND referral_code!=''");
let bad=0;
for(const u of all.rows){
  const c=await p.query("SELECT COUNT(*) FROM users WHERE referred_by=$1",[u.referral_code]);
  if((parseInt(u.ref_level1)||0)!==parseInt(c.rows[0].count)){bad++;console.log(`❌ ${u.name}: stored=${u.ref_level1} actual=${c.rows[0].count}`)}
}
if(bad===0) console.log('✅ Sab sahi hai — team counts match karte hain sab users ke liye!');
else console.log(`${bad} users me still mismatch`);
await p.end()})();