const pg = require('../config/pg');

(async () => {
  try {
    const uid = 'lw2EsXgFO2hI5Rujl0m8S6zKJbZ2';

    // Check user's referral info
    const user = await pg.query('SELECT uid, name, email, referred_by, referral_code, commission_balance, total_commissions FROM users WHERE uid = $1', [uid]);
    const u = user.rows[0];
    console.log('=== EMMANUEL ===');
    console.log('Referred by:', u.referred_by || 'NONE');
    console.log('Commission balance:', u.commission_balance);
    console.log('Total commissions:', u.total_commissions);

    // Check if any commission was credited
    const comms = await pg.query("SELECT * FROM commissions WHERE from_uid = $1 ORDER BY created_at DESC LIMIT 5", [uid]);
    console.log('\nCommissions FROM Emmanuel:', comms.rows.length);
    for (const c of comms.rows) {
      console.log('  -', c.uid, '|', c.amount, '|', c.level, '|', c.type, '|', new Date(Number(c.created_at)).toLocaleString());
    }

    // Check who referred Emmanuel
    if (u.referred_by) {
      const referrer = await pg.query('SELECT uid, name, email, commission_balance, total_commissions FROM users WHERE uid = $1', [u.referred_by]);
      if (referrer.rows.length) {
        const r = referrer.rows[0];
        console.log('\n=== REFERRER (L1) ===');
        console.log('Name:', r.name);
        console.log('Commission balance:', r.commission_balance);
        console.log('Total commissions:', r.total_commissions);
      }

      // Check L2
      const referrer2 = await pg.query('SELECT referred_by FROM users WHERE uid = $1', [u.referred_by]);
      if (referrer2.rows.length && referrer2.rows[0].referred_by) {
        const r2 = await pg.query('SELECT uid, name, commission_balance FROM users WHERE uid = $1', [referrer2.rows[0].referred_by]);
        if (r2.rows.length) {
          console.log('\n=== REFERRER L2 ===');
          console.log('Name:', r2.rows[0].name);
          console.log('Commission balance:', r2.rows[0].commission_balance);
        }
      }
    }

    console.log('\n⚠️ Commission was NOT triggered — manual credit bypasses purchase flow!');
    console.log('Need to manually credit L1=10%, L2=5%, L3=3% if applicable.');

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
