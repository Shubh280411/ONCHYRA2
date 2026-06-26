const { Client } = require('pg');
const SUPABASE = 'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres';
const RENDER = 'postgresql://onchyra_db_user:ldDzonbYo5QfiMX6cL4YyftBsG2KVn2h@dpg-d8u0p0favr4c73a58vrg-a.singapore-postgres.render.com/onchyra_db';
async function migrate(table, pk = 'uid') {
  const src = new Client({ connectionString: SUPABASE, ssl: { rejectUnauthorized: false } });
  const dst = new Client({ connectionString: RENDER, ssl: { rejectUnauthorized: false } });
  await src.connect();
  await dst.connect();
  try {
    const r = await src.query(`SELECT * FROM "${table}"`);
    if (!r.rows.length) { console.log(table + ': 0 rows'); return; }
    const cols = Object.keys(r.rows[0]).filter(k => r.rows[0][k] !== undefined);
    const ph = cols.map((_, i) => `$${i + 1}`).join(',');
    const cs = cols.map(c => `"${c}"`).join(',');
    let ok = 0, err = 0;
    for (const row of r.rows) {
      try {
        const vals = cols.map(c => row[c] === undefined ? null : row[c]);
        await dst.query(`INSERT INTO "${table}" (${cs}) VALUES (${ph}) ON CONFLICT ("${pk}") DO NOTHING`, vals);
        ok++;
      } catch(e) {
        if (!e.message.includes('violates')) err++;
      }
    }
    console.log(table + ': ' + ok + ' rows, ' + err + ' errors');
  } catch(e) {
    console.log(table + ': FAIL -', e.message.substring(0, 100));
  }
  await src.end();
  await dst.end();
}
(async () => {
  await migrate('users');
  await migrate('admins', 'uid');
  await migrate('settings', 'key');
  await migrate('commissions', 'id');
  await migrate('withdrawals', 'id');
  await migrate('deposits', 'id');
  await migrate('package_purchases', 'id');
  await migrate('deposit_wallets', 'id');
  await migrate('notifications', 'id');
  await migrate('p2p_transfers', 'id');
  await migrate('claims', 'id');
  await migrate('achievement_bonuses', 'id');
  await migrate('leadership_rewards', 'id');
  await migrate('predictions', 'id');
  await migrate('prediction_bets', 'id');
  await migrate('contests', 'id');
  await migrate('contest_participants', 'id');
  console.log('Migration complete!');
})();
