const {Pool}=require('pg');
(async()=>{
const p=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});

const uid='6AsI8MC5PRTYbCcvW8h0d8uvqt53';
const u=await p.query("SELECT * FROM users WHERE uid=$1",[uid]);
if(!u.rows.length){console.log('User not found');process.exit();}
const user=u.rows[0];
const refCode=user.referral_code;
console.log('Referral code:', refCode);

// Count dynamically (same logic as /user/:uid endpoint)
const l1Rows=await p.query("SELECT * FROM users WHERE referred_by=$1",[refCode]);
const refLevel1=l1Rows.rows.length;
console.log('L1 (direct):', refLevel1);

const l1Codes=l1Rows.rows.map(r=>r.referral_code).filter(Boolean);
let refLevel2=0,refLevel3=0;
if(l1Codes.length){
  const l2Rows=await p.query(`SELECT * FROM users WHERE referred_by IN ('${l1Codes.join("','")}')`);
  refLevel2=l2Rows.rows.length;

  const l2Codes=l2Rows.rows.map(r=>r.referral_code).filter(Boolean);
  if(l2Codes.length){
    const l3Rows=await p.query(`SELECT * FROM users WHERE referred_by IN ('${l2Codes.join("','")}')`);
    refLevel3=l3Rows.rows.length;
  }
}
console.log('L2:', refLevel2);
console.log('L3:', refLevel3);
console.log('Total Network:', refLevel1+refLevel2+refLevel3);

// Total commissions
const comm=await p.query('SELECT COALESCE(SUM(amount),0) AS total FROM commissions WHERE uid=$1',[uid]);
console.log('Total Commissions ($):', parseFloat(comm.rows[0].total).toFixed(2));

// Stored values
console.log('\nStored in DB: ref1='+user.ref_level1+' ref2='+user.ref_level2+' ref3='+user.ref_level3+' referrals='+user.referrals);

await p.end()})();