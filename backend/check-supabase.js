const {Pool}=require('pg');
(async()=>{
const p=new Pool({connectionString:'postgresql://postgres:dbpassword@db.kxndpctzygcitgxundnj.supabase.co:6543/postgres',ssl:{rejectUnauthorized:false}});
const users=await p.query("SELECT uid, name, referral_code, ref_level1, ref_level2, ref_level3, referrals FROM users WHERE referral_code IS NOT NULL AND referral_code!=''");
let mismatched=[];
for(const u of users.rows){
  const l1=await p.query("SELECT COUNT(*) as cnt FROM users WHERE referred_by=$1",[u.referral_code]);
  const actualL1=parseInt(l1.rows[0].cnt);
  const storedL1=parseInt(u.ref_level1||u.referrals)||0;
  if(storedL1!==actualL1) mismatched.push({name:u.name,storedL1,actualL1,code:u.referral_code});
}
console.log('Supabase DB mismatched L1:', mismatched.length);
mismatched.slice(0,10).forEach(u=>console.log(`${u.name}: stored=${u.storedL1} actual=${u.actualL1}`));
await p.end()})();