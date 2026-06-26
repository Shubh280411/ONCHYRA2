const {Pool}=require('pg');
(async()=>{
const s=new Pool({connectionString:'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres',ssl:{rejectUnauthorized:false}});
const users=await s.query("SELECT uid, name, referral_code, ref_level1 FROM users WHERE referral_code IS NOT NULL AND referral_code!=''");
let bad=0;
for(const u of users.rows){
  const c=await s.query("SELECT COUNT(*) FROM users WHERE referred_by=$1",[u.referral_code]);
  if((parseInt(u.ref_level1)||0)!==parseInt(c.rows[0].count)){bad++;console.log(`❌ ${u.name}: stored=${u.ref_level1} actual=${c.rows[0].count}`)}
}
console.log(bad===0?'✅ Sab sahi hai — Supabase counts match!':`${bad} mismatched`);
await s.end()})();