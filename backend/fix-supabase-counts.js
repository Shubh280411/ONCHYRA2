const {Pool}=require('pg');
(async()=>{
const s=new Pool({connectionString:'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres',ssl:{rejectUnauthorized:false}});

const users=await s.query("SELECT uid, name, referral_code, ref_level1, ref_level2, ref_level3, referrals, total_directs FROM users WHERE referral_code IS NOT NULL AND referral_code!=''");

let fixed=[];
for(const u of users.rows){
  const l1=await s.query("SELECT COUNT(*) FROM users WHERE referred_by=$1",[u.referral_code]);
  const actualL1=parseInt(l1.rows[0].count);
  const storedL1=parseInt(u.ref_level1)||0;

  const directs=await s.query("SELECT COUNT(*) FROM users WHERE referred_by=$1",[u.referral_code]);
  const actualRefs=parseInt(directs.rows[0].count);
  const storedRefs=parseInt(u.referrals)||0;

  const l1Codes=(await s.query("SELECT referral_code FROM users WHERE referred_by=$1 AND referral_code IS NOT NULL AND referral_code!=''",[u.referral_code])).rows.map(x=>x.referral_code);
  let actualL2=0;
  if(l1Codes.length){
    const l2r=await s.query(`SELECT COUNT(*) FROM users WHERE referred_by IN ('${l1Codes.join("','")}')`);
    actualL2=parseInt(l2r.rows[0].count);
  }
  const storedL2=parseInt(u.ref_level2)||0;

  let actualL3=0;
  if(l1Codes.length){
    const l2Codes=(await s.query(`SELECT referral_code FROM users WHERE referred_by IN ('${l1Codes.join("','")}') AND referral_code IS NOT NULL AND referral_code!=''`)).rows.map(x=>x.referral_code);
    if(l2Codes.length){
      const l3r=await s.query(`SELECT COUNT(*) FROM users WHERE referred_by IN ('${l2Codes.join("','")}')`);
      actualL3=parseInt(l3r.rows[0].count);
    }
  }
  const storedL3=parseInt(u.ref_level3)||0;

  if(storedL1!==actualL1||storedL2!==actualL2||storedL3!==actualL3||storedRefs!==actualRefs){
    fixed.push({uid:u.uid,name:u.name,storedL1,actualL1,storedL2,actualL2,storedL3,actualL3,storedRefs,actualRefs});
  }
}
console.log(`Users with mismatched counts: ${fixed.length}`);
fixed.forEach(f=>{
  console.log(`\n${f.name}:`);
  if(f.storedL1!==f.actualL1) console.log(`  L1: ${f.storedL1} -> ${f.actualL1}`);
  if(f.storedL2!==f.actualL2) console.log(`  L2: ${f.storedL2} -> ${f.actualL2}`);
  if(f.storedL3!==f.actualL3) console.log(`  L3: ${f.storedL3} -> ${f.actualL3}`);
  if(f.storedRefs!==f.actualRefs) console.log(`  referrals: ${f.storedRefs} -> ${f.actualRefs}`);
});

async function applyFix(){
  for(const f of fixed){
    await s.query(`UPDATE users SET ref_level1=$1, ref_level2=$2, ref_level3=$3, referrals=$4, total_directs=$5 WHERE uid=$6`,
      [f.actualL1,f.actualL2,f.actualL3,f.actualRefs,f.actualRefs,f.uid]);
  }
}
if(fixed.length&&process.argv[2]==='--apply'){
  await applyFix();
  console.log(`\n✓ Updated ${fixed.length} users in Supabase DB`);
} else {
  console.log(`\nDRY RUN — ${fixed.length} users need fixing`);
  console.log('Run with --apply to apply fixes');
}

await s.end()})();