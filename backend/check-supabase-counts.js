const {Pool}=require('pg');
(async()=>{
const s=new Pool({connectionString:'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres',ssl:{rejectUnauthorized:false}});
const gs=await s.query("SELECT uid, referral_code, ref_level1 FROM users WHERE uid='6AsI8MC5PRTYbCcvW8h0d8uvqt53'");
const code=gs.rows[0].referral_code;
console.log('Global Star ref code:', code);

// Count by referred_by
const byRef=await s.query("SELECT COUNT(*) FROM users WHERE referred_by=$1",[code]);
console.log('Supabase: users with referred_by = ref_code:', byRef.rows[0].count);

// Check difference between stored ref_level1 and actual count
const stored=parseInt(gs.rows[0].ref_level1);
const actual=parseInt(byRef.rows[0].count);
console.log('Stored ref_level1:', stored, 'Actual L1:', actual, 'Diff:', stored-actual);

// Also check L2
const l1Codes=(await s.query("SELECT referral_code FROM users WHERE referred_by=$1 AND referral_code IS NOT NULL AND referral_code!=''",[code])).rows.map(x=>x.referral_code);
if(l1Codes.length){
  const l2=await s.query(`SELECT COUNT(*) FROM users WHERE referred_by IN ('${l1Codes.join("','")}')`);
  console.log('Actual L2:', l2.rows[0].count);
}

// Check Render DB actual count
const r=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});
const rCode=(await r.query("SELECT referral_code FROM users WHERE uid='6AsI8MC5PRTYbCcvW8h0d8uvqt53'")).rows[0].referral_code;
const rL1=await r.query("SELECT COUNT(*) FROM users WHERE referred_by=$1",[rCode]);
console.log('Render DB actual L1:', rL1.rows[0].count);

await s.end();await r.end()})();