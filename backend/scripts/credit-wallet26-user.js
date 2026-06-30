const pg = require('../config/pg');

(async () => {
  try {
    const uid = 'lw2EsXgFO2hI5Rujl0m8S6zKJbZ2';

    // 1. Get user info
    const user = await pg.query('SELECT uid, name, email, wallet_balance, package_status FROM users WHERE uid = $1', [uid]);
    if (!user.rows.length) {
      console.log('User NOT FOUND!');
      process.exit(1);
    }
    const u = user.rows[0];
    console.log('=== USER FOUND ===');
    console.log('Name:', u.name);
    console.log('Email:', u.email);
    console.log('Balance before:', u.wallet_balance);
    console.log('Package:', u.package_status);

    // 2. Credit 2.60 USDT
    await pg.increment('users', uid, 'wallet_balance', 2.60);
    const after = await pg.query('SELECT wallet_balance FROM users WHERE uid = $1', [uid]);
    console.log('Balance after:', after.rows[0].wallet_balance);

    // 3. Update deposit record
    await pg.query(
      "UPDATE deposits SET uid = $1, status = 'completed' WHERE uid IN ('ORPHANED', 'PENDING_WALLET26') AND address = '0xdde33a46356a4f1790bd1a0cdd1ce943fd111711'",
      [uid]
    );
    console.log('Deposit record updated to:', uid);

    // 4. Update wallet ownership
    await pg.query(
      "UPDATE deposit_wallets SET uid = $1, used = true WHERE index = 26 AND network = 'BEP20'",
      [uid]
    );
    console.log('Wallet #26 ownership fixed to:', uid);

    // 5. Verify
    const final = await pg.query('SELECT wallet_balance FROM users WHERE uid = $1', [uid]);
    console.log('\n✅ DONE! User:', u.name, '| New balance:', final.rows[0].wallet_balance);

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
