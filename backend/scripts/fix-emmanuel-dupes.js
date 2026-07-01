require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const pg = require('../config/pg');

(async () => {
    try {
        const uid = 'lw2EsXgFO2hI5Rujl0m8S6zKJbZ2';
        const realDeposit = 2.60;

        const allDeps = await pg.query(`SELECT * FROM deposits WHERE uid = $1 ORDER BY created_at ASC`, [uid]);
        const deps = allDeps.rows;
        console.log(`Total deposits for Emmanuel: ${deps.length}`);

        const totalAmount = deps.reduce((s, d) => s + Number(d.amount || 0), 0);
        console.log(`Total credited: $${totalAmount.toFixed(2)}`);
        console.log(`Real deposit should be: $${realDeposit}`);

        if (deps.length <= 1) {
            console.log('No duplicates to clean.');
            process.exit(0);
        }

        const toDelete = deps.slice(1);
        console.log(`\nDeleting ${toDelete.length} duplicate deposits...`);

        for (const d of toDelete) {
            await pg.query(`DELETE FROM deposits WHERE id = $1`, [d.id]);
            console.log(`  Deleted: ${d.id} ($${Number(d.amount)})`);
        }

        const excessAmount = totalAmount - realDeposit;
        console.log(`\nExcess amount credited: $${excessAmount.toFixed(2)}`);
        console.log(`Deducting from user balance and total_deposits...`);

        await pg.query(`UPDATE users SET total_deposits = $1 WHERE uid = $2`, [realDeposit.toString(), uid]);

        const userRes = await pg.query(`SELECT balance, wallet_balance, total_deposits FROM users WHERE uid = $1`, [uid]);
        const user = userRes.rows[0];
        const currentBal = Number(user.balance || 0);
        const newBal = Math.max(0, currentBal - excessAmount);
        await pg.query(`UPDATE users SET balance = $1 WHERE uid = $2`, [newBal.toFixed(2), uid]);
        console.log(`Balance: $${currentBal.toFixed(2)} → $${newBal.toFixed(2)}`);

        console.log('\n✅ Done!');
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
