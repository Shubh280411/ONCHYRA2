const {Pool}=require('pg');
(async()=>{
const s=new Pool({connectionString:'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres',ssl:{rejectUnauthorized:false}});
const r=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});

const henryUid='rAnD4dUvDEYvMaieUPJjXaEuc482';
const gsUid='6AsI8MC5PRTYbCcvW8h0d8uvqt53';

// Check if Henry already has commission in Render DB
const existing=await r.query("SELECT id FROM commissions WHERE from_uid=$1 AND type='registration_bonus'",[henryUid]);
if(existing.rows.length>0){
  console.log('Henry already has commission in Render DB:', existing.rows[0].id);
} else {
  const ts=Date.now();
  const commId=`comm_henry_${ts}`;
  // Add commission record in Render DB
  await r.query(`INSERT INTO commissions (id,uid,from_uid,amount,level,type,package_name,from_name,created_at) VALUES ($1,$2,$3,$4,1,'registration_bonus','Registration Bonus','henry',$5)`,
    [commId,gsUid,henryUid,0.25,ts]);
  // Increment Global Star's balance in Render DB
  await r.query("UPDATE users SET balance=balance+0.25, referrals=referrals+1, ref_level1=ref_level1+1, total_directs=total_directs+1 WHERE uid=$1",[gsUid]);
  console.log('✓ Added Henry commission in Render DB');
}

// Same for Supabase
const sExisting=await s.query("SELECT id FROM commissions WHERE from_uid=$1 AND type='registration_bonus'",[henryUid]);
if(sExisting.rows.length>0){
  console.log('Henry already has commission in Supabase:', sExisting.rows[0].id);
} else {
  const ts=Date.now();
  const commId=`comm_henry_supabase_${ts}`;
  await s.query(`INSERT INTO commissions (id,uid,from_uid,amount,level,type,package_name,from_name,created_at) VALUES ($1,$2,$3,$4,1,'registration_bonus','Registration Bonus','henry',$5)`,
    [commId,gsUid,henryUid,0.25,ts]);
  await s.query("UPDATE users SET balance=balance+0.25, referrals=referrals+1, ref_level1=ref_level1+1, total_directs=total_directs+1 WHERE uid=$1",[gsUid]);
  console.log('✓ Added Henry commission in Supabase');
}

// Verify
const gsR=await r.query("SELECT balance,ref_level1,referrals FROM users WHERE uid=$1",[gsUid]);
console.log('\nGlobal Star (Render DB):', gsR.rows[0]);
const gsS=await s.query("SELECT balance,ref_level1,referrals FROM users WHERE uid=$1",[gsUid]);
console.log('Global Star (Supabase):', gsS.rows[0]);

await s.end();await r.end()})();