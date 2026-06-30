const pg = require('../config/pg');

(async () => {
  try {
    await pg.query("UPDATE deposit_wallets SET uid = 'ORPHANED', used = false WHERE index = 26 AND network = 'BEP20'");
    console.log('Wallet #26 fixed to ORPHANED');

    // Verify
    const w = await pg.query("SELECT uid, used, expired FROM deposit_wallets WHERE index = 26 AND network = 'BEP20'");
    console.log('Verification:', JSON.stringify(w.rows[0]));

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
