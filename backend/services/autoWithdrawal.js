const pg = require('../config/pg');
const withdrawalWallet = require('./withdrawalWallet');

const CHECK_INTERVAL = 5 * 60 * 1000;
const AUTO_MIN = 10;
const AUTO_MAX = 50;
let intervalId = null;

async function processPendingWithdrawals() {
    try {
        const rows = await pg.query(
            `SELECT * FROM withdrawals WHERE status = 'pending' AND amount >= $1 AND amount <= $2 ORDER BY created_at ASC LIMIT 5`,
            [AUTO_MIN, AUTO_MAX]
        );
        const pending = rows.rows;
        if (!pending.length) return;

        console.log(`[AutoWD] Processing ${pending.length} pending withdrawals (${AUTO_MIN}-${AUTO_MAX} USDT)`);

        for (const w of pending) {
            try {
                const net = Number(w.net_amount || (Number(w.amount) - Number(w.fee || 0)));
                const txResult = await withdrawalWallet.sendUSDT(w.wallet, net);

                if (txResult.success) {
                    await pg.query(
                        `UPDATE withdrawals SET status = 'completed', approved_at = $1, tx_hash = $2, completed_at = $3 WHERE id = $4`,
                        [Date.now(), txResult.txHash, Date.now(), w.id]
                    );
                    console.log(`[AutoWD] Approved ${w.id}: ${net} USDT → ${w.wallet} (tx: ${txResult.txHash})`);
                } else {
                    await pg.query(
                        `UPDATE withdrawals SET status = 'failed', approved_at = $1, error = $2 WHERE id = $3`,
                        [Date.now(), txResult.error || 'Send failed', w.id]
                    );
                    console.log(`[AutoWD] Failed ${w.id}: ${txResult.error}`);
                }
            } catch (e) {
                console.error(`[AutoWD] Error processing ${w.id}:`, e.message);
            }
        }
    } catch (e) {
        console.error('[AutoWD] Check error:', e.message);
    }
}

function start() {
    console.log(`[AutoWD] Started — auto-processing ${AUTO_MIN}-${AUTO_MAX} USDT every ${CHECK_INTERVAL / 1000}s`);
    intervalId = setInterval(processPendingWithdrawals, CHECK_INTERVAL);
    processPendingWithdrawals();
}

function stop() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

module.exports = { start, stop };
