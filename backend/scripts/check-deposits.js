const pg = require('../config/pg');

(async () => {
  try {
    // Find which user was assigned wallet #26 or the address
    const addr = '0xdDe33A46356A4f1790bD1A0CdD1ce943fd111711';
    
    // Check deposit_wallets for any reference
    const w26 = await pg.query("SELECT * FROM deposit_wallets WHERE index = 26");
    console.log('Wallet #26 in DB:', w26.rows.length ? 'YES' : 'NO');
    
    // Check users table for this wallet address as deposit address
    const users = await pg.query("SELECT uid, name, email FROM users WHERE uid LIKE '%26%'");
    console.log('\nUsers with 26 in UID:', users.rows.length);
    for (const u of users.rows) {
      console.log('  -', u.uid.substring(0,15) + '...', u.name, u.email);
    }

    // Check all deposit wallets that are NOT used yet
    const unused = await pg.query("SELECT * FROM deposit_wallets WHERE used = false");
    console.log('\nUnused wallets:', unused.rows.length);

    // Check recent registrations who might have deposited
    const recent = await pg.query("SELECT uid, name, email, created_at FROM users ORDER BY created_at DESC LIMIT 10");
    console.log('\n=== LATEST 10 USERS ===');
    for (const u of recent.rows) {
      console.log(new Date(Number(u.created_at)).toLocaleString(), '|', u.uid.substring(0,12) + '...', '|', u.name, '|', u.email);
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
