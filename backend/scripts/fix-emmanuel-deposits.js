require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const pg = require('../config/pg');

(async () => {
    try {
        const uid = 'lw2EsXgFO2hI5Rujl0m8S6zKJbZ2';
        await pg.query(`UPDATE users SET total_deposits = '2.6' WHERE uid = $1`, [uid]);
        const r = await pg.query(`SELECT total_deposits, balance, wallet_balance FROM users WHERE uid = $1`, [uid]);
        console.log('Emmanuel fixed:', r.rows[0]);
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
