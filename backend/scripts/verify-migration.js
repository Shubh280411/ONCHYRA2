require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Try to get all table data
  const tables = ['users','admins','withdrawals','deposits','deposit_wallets','package_purchases','commissions','achievement_bonuses','leadership_rewards','p2p_transfers','claims','notifications','polls','poll_votes','updates','admin_transactions','audit_logs','predictions','prediction_bets','contests','contest_participants','settings','otps','otp_store','otp_logs','powerdrops','powerdrop_participants','poll_logs'];
  let total = 0;
  for (const t of tables) {
    try {
      const r = await pool.query('SELECT COUNT(*) as cnt FROM "' + t + '"');
      const cnt = parseInt(r.rows[0].cnt);
      console.log(t + ': ' + cnt + ' rows');
      total += cnt;
    } catch(e) {
      console.log(t + ': ERROR - ' + e.message);
    }
  }
  console.log('---');
  console.log('Total: ' + total + ' rows');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
