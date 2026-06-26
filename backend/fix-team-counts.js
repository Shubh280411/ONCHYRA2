const {Pool}=require('pg');
(async()=>{
const p=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});

const users=await p.query("SELECT uid, name, referral_code, ref_level1, ref_level2, ref_level3, referrals, total_directs FROM users WHERE referral_code IS NOT NULL AND referral_code != ''");

let fixed=[];
for(const u of users.rows){
  const l1=await p.query("SELECT COUNT(*) as cnt FROM users WHERE referred_by=$1",[u.referral_code]);
  const actualL1=parseInt(l1.rows[0].cnt);
  const storedL1=parseInt(u.ref_level1)||0;

  // Count actual referrals (users who directly registered under this user)
  const directRows=await p.query("SELECT uid FROM users WHERE referred_by=$1",[u.referral_code]);
  const actualDirects=directRows.rows.length;
  const storedDirects=parseInt(u.referrals)||0;

  // L2
  const l1Codes=l1.rows.length>0?(await p.query("SELECT referral_code FROM users WHERE referred_by=$1 AND referral_code IS NOT NULL AND referral_code!=''",[u.referral_code])).rows.map(r=>r.referral_code):[];
  let actualL2=0;
  if(l1Codes.length){
    const l2=await p.query(`SELECT COUNT(*) as cnt FROM users WHERE referred_by IN ('${l1Codes.join("','")}')`);
    actualL2=parseInt(l2.rows[0].cnt);
  }
  const storedL2=parseInt(u.ref_level2)||0;

  // L3
  let actualL3=0;
  if(l1Codes.length){
    const l2Codes=await p.query(`SELECT referral_code FROM users WHERE referred_by IN ('${l1Codes.join("','")}') AND referral_code IS NOT NULL AND referral_code!=''`);
    const l2CodeList=l2Codes.rows.map(r=>r.referral_code);
    if(l2CodeList.length){
      const l3=await p.query(`SELECT COUNT(*) as cnt FROM users WHERE referred_by IN ('${l2CodeList.join("','")}')`);
      actualL3=parseInt(l3.rows[0].cnt);
    }
  }
  const storedL3=parseInt(u.ref_level3)||0;

  if(storedL1 !== actualL1 || storedL2 !== actualL2 || storedL3 !== actualL3 || storedDirects !== actualDirects){
    fixed.push({uid:u.uid,name:u.name,storedL1,actualL1,storedL2,actualL2,storedL3,actualL3,storedDirects,actualDirects});
  }
}
console.log('=== MISMATCHED USERS ===');
fixed.forEach(u=>{
  console.log(`\n${u.name}:`);
  if(u.storedL1!==u.actualL1) console.log(`  L1: ${u.storedL1} -> ${u.actualL1}`);
  if(u.storedL2!==u.actualL2) console.log(`  L2: ${u.storedL2} -> ${u.actualL2}`);
  if(u.storedL3!==u.actualL3) console.log(`  L3: ${u.storedL3} -> ${u.actualL3}`);
  if(u.storedDirects!==u.actualDirects) console.log(`  referrals: ${u.storedDirects} -> ${u.actualDirects}`);
});

async function applyFix(apply){
  for(const u of fixed){
    await p.query(`UPDATE users SET ref_level1=$1, ref_level2=$2, ref_level3=$3${u.storedDirects!==u.actualDirects?', referrals=$4, total_directs=$5':''} WHERE uid=$6`,
      [u.actualL1, u.actualL2, u.actualL3].concat(u.storedDirects!==u.actualDirects?[u.actualDirects,u.actualDirects]:[]).concat([u.uid]));
  }
}

if(fixed.length && process.argv[2]==='--apply'){
  await applyFix(true);
  console.log(`\n✓ Updated ${fixed.length} users in Render DB`);
} else {
  console.log(`\nDRY RUN — ${fixed.length} users need fixing`);
  console.log('Run with --apply to apply fixes');
}

await p.end()})();