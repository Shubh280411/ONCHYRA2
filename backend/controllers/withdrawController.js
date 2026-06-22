const pg = require('../config/pg');
const withdrawalWallet = require('../services/withdrawalWallet');
const { verifyOtp } = require('./otpController');

exports.request = async (req, res) => {
    try {
        const { uid, amount, wallet, network, otp } = req.body;
        if (!uid || !amount || !wallet) return res.status(400).json({ error: 'Missing fields' });
        if (amount < 10) return res.status(400).json({ error: 'Minimum withdrawal is 10 USDT' });
        if (!otp) return res.status(400).json({ error: 'OTP is required' });

        const user = await pg.get('users', uid);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const commBal = user.commission_balance || user.balance || 0;
        if (commBal < amount) return res.status(400).json({ error: 'Insufficient balance' });

        const otpResult = await verifyOtp(user.email, otp);
        if (!otpResult.valid) return res.status(400).json({ error: otpResult.error });

        const fee = Math.round(amount * 0.05 * 100) / 100;
        const net = Math.round((amount - fee) * 100) / 100;
        const isAuto = amount >= 10 && amount <= 50;
        const status = isAuto ? 'processing' : 'pending';

        const deductField = user.commission_balance !== undefined && user.commission_balance !== null ? 'commission_balance' : 'balance';
        await pg.increment('users', uid, deductField, -amount);

        const wRes = await pg.query(
            `INSERT INTO withdrawals (uid, amount, fee, net_amount, wallet, network, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [uid, amount, fee, net, wallet, network || 'BEP20', status, Date.now()]
        );
        const wId = wRes.rows[0].id;

        await pg.query(
            `INSERT INTO audit_logs (type, uid, amount, fee, net, wallet, status, created_at)
             VALUES ('withdrawal', $1, $2, $3, $4, $5, $6, $7)`,
            [uid, amount, fee, net, wallet, status, Date.now()]
        );

        if (isAuto) {
            withdrawalWallet.sendUSDT(wallet, net).then(txResult => {
                pg.query(
                    `UPDATE withdrawals SET status = $1, tx_hash = $2, completed_at = $3${txResult.error ? `, error = $4` : ''} WHERE id = $4`,
                    txResult.success
                        ? ['completed', txResult.txHash || null, Date.now(), wId]
                        : ['failed', null, null, txResult.error, wId]
                ).catch(e => console.error('Auto-withdraw update error:', e));
            }).catch(e => {
                console.error('Auto-withdraw send error:', e);
                pg.query(`UPDATE withdrawals SET status = 'failed', error = $1 WHERE id = $2`, [e.message, wId]).catch(() => {});
            });
        }

        res.json({ success: true, amount, fee, received: net, status, id: wId });
    } catch (e) {
        console.error('Withdrawal request error:', e);
        res.status(500).json({ error: e.message });
    }
};

exports.approve = async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Missing withdrawal ID' });

        const rows = await pg.query(`SELECT * FROM withdrawals WHERE id = $1`, [id]);
        if (!rows.rows.length) return res.status(404).json({ error: 'Withdrawal not found' });
        const w = rows.rows[0];

        if (w.status === 'rejected' || w.status === 'completed') {
            return res.status(400).json({ error: 'Already processed' });
        }

        const txResult = await withdrawalWallet.sendUSDT(w.wallet, w.net_amount || (w.amount - w.fee));

        const updates = {
            status: txResult.success ? 'completed' : 'failed',
            approved_at: Date.now(),
            tx_hash: txResult.txHash || null,
        };
        if (txResult.success) updates.completed_at = Date.now();
        if (txResult.error) updates.error = txResult.error;

        await pg.query(
            `UPDATE withdrawals SET status = $1, approved_at = $2, tx_hash = $3${txResult.success ? ', completed_at = $4' : ''}${txResult.error ? ', error = $5' : ''} WHERE id = $6`,
            txResult.success
                ? [updates.status, updates.approved_at, updates.tx_hash, updates.completed_at, id]
                : [updates.status, updates.approved_at, updates.tx_hash, txResult.error, id]
        );

        if (txResult.success) {
            res.json({ success: true, txHash: txResult.txHash, message: 'USDT sent' });
        } else {
            res.status(500).json({ error: 'Send failed', details: txResult.error });
        }
    } catch (e) {
        console.error('Withdrawal approve error:', e);
        res.status(500).json({ error: e.message });
    }
};

exports.reject = async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Missing withdrawal ID' });

        const rows = await pg.query(`SELECT * FROM withdrawals WHERE id = $1`, [id]);
        if (!rows.rows.length) return res.status(404).json({ error: 'Not found' });
        const w = rows.rows[0];

        if (w.status === 'rejected' || w.status === 'completed') {
            return res.status(400).json({ error: 'Already processed' });
        }

        await pg.query(`UPDATE withdrawals SET status = 'rejected', rejected_at = $1 WHERE id = $2`, [Date.now(), id]);

        const wUser = await pg.get('users', w.uid);
        const refundField = wUser && wUser.commission_balance !== undefined && wUser.commission_balance !== null ? 'commission_balance' : 'balance';
        await pg.increment('users', w.uid, refundField, w.amount);

        res.json({ success: true });
    } catch (e) {
        console.error('Withdrawal reject error:', e);
        res.status(500).json({ error: e.message });
    }
};

exports.adminGetAll = async (req, res) => {
    try {
        const rows = await pg.query(`SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT 100`);
        const list = [];
        for (const w of rows.rows) {
            const u = await pg.get('users', w.uid);
            list.push({
                id: w.id, ...w,
                userName: u ? (u.name || u.referral_code) : '?'
            });
        }
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.userHistory = async (req, res) => {
    try {
        const rows = await pg.findWhere('withdrawals', { uid: req.params.uid }, 'created_at', 50);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
