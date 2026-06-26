const {Pool}=require('pg');
(async()=>{
const s=new Pool({connectionString:'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres',ssl:{rejectUnauthorized:false}});
const r=new Pool({connectionString:'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db',ssl:{rejectUnauthorized:false}});

// Common columns in both DBs
const cols=['uid','name','email','referral_code','referred_by','balance','ref_level1','ref_level2','ref_level3','referrals','total_directs','active_directs','total_package_spend','team_biz','team_business','leg_a_biz','leg_b_biz','commission_balance','wallet_balance','total_deposits','total_claimed','total_commissions','total_matching_bonus','streak','last_claim','device_id','active_package','package_amount','package_boost','package_cap','package_usage','package_status','package_purchased_at','rank','rank_calculated_at','rank_achievements','achievement_bonus_claimed','leadership_reward_rank','leadership_reward_day','leadership_reward_days','leadership_reward_payouts','leadership_reward_start','reward_last_paid','reward_checked_at','reward_next_at','reward_processed','banned','is_safe','verified_leader','admin_notes','promotional_package','promotional_account','promotional_comm_excluded','country','email_sent','last_email_sent_at','leader_status','status','role','created_at','updated_at'];

const renderUids=new Set((await r.query("SELECT uid FROM users")).rows.map(x=>x.uid));
const su=await s.query("SELECT * FROM users WHERE uid IS NOT NULL AND uid!=''");

let synced=0;
for(const u of su.rows){
  if(renderUids.has(u.uid)) continue;
  const vals=cols.map(c=>{
    const v=u[c];
    if(v===null||v===undefined) return null;
    if(typeof v==='object') return JSON.stringify(v);
    return v;
  });
  const ph=cols.map((_,i)=>`$${i+1}`).join(',');
  const csl=cols.join(',');
  await r.query(`INSERT INTO users (${csl}) VALUES (${ph}) ON CONFLICT (uid) DO NOTHING`,vals);
  synced++;
}
console.log(`Synced ${synced} users from Supabase → Render DB`);

// Verify Global Star dynamic team count
const g=await r.query("SELECT * FROM users WHERE uid='6AsI8MC5PRTYbCcvW8h0d8uvqt53'");
if(g.rows.length){
  const code=g.rows[0].referral_code;
  const l1=await r.query("SELECT COUNT(*) FROM users WHERE referred_by=$1",[code]);
  const l1Codes=(await r.query("SELECT referral_code FROM users WHERE referred_by=$1 AND referral_code IS NOT NULL AND referral_code!=''",[code])).rows.map(x=>x.referral_code);
  let l2=0,l3=0;
  if(l1Codes.length){
    const l2r=await r.query(`SELECT COUNT(*) FROM users WHERE referred_by IN ('${l1Codes.join("','")}')`);
    l2=parseInt(l2r.rows[0].count);
    const l2Codes=(await r.query(`SELECT referral_code FROM users WHERE referred_by IN ('${l1Codes.join("','")}') AND referral_code IS NOT NULL AND referral_code!=''`)).rows.map(x=>x.referral_code);
    if(l2Codes.length){
      const l3r=await r.query(`SELECT COUNT(*) FROM users WHERE referred_by IN ('${l2Codes.join("','")}')`);
      l3=parseInt(l3r.rows[0].count);
    }
  }
  console.log(`\nGlobal Star team: ${parseInt(l1.rows[0].count)} L1 + ${l2} L2 + ${l3} L3 = ${parseInt(l1.rows[0].count)+l2+l3}`);
  console.log('Supabase stored: ref1='+(await s.query("SELECT ref_level1 FROM users WHERE uid='6AsI8MC5PRTYbCcvW8h0d8uvqt53'")).rows[0].ref_level1);
}
await s.end();await r.end()})();