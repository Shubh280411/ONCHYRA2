const pg = require('../config/pg');

exports.send = async (req, res) => {
    try {
        const { fromUid, referralCode, amount } = req.body;
        if (!fromUid || !referralCode || !amount) return res.status(400).json({ error: 'Missing fields' });
        if (amount < 1) return res.status(400).json({ error: 'Minimum transfer is 1 ONC' });

        const sender = await pg.get('users', fromUid);
        if (!sender) return res.status(404).json({ error: 'Sender not found' });

        if ((sender.balance || 0) < amount) return res.status(400).json({ error: 'Insufficient balance' });

        const receivers = await pg.findWhere('users', { referral_code: referralCode.toUpperCase() });
        if (!receivers.length) return res.status(404).json({ error: 'Receiver not found' });
        const receiver = receivers[0];

        if (receiver.uid === fromUid) return res.status(400).json({ error: 'Cannot send to yourself' });

        const burn = Math.round(amount * 0.1 * 100) / 100;
        const net = Math.round((amount - burn) * 100) / 100;

        await pg.increment('users', fromUid, 'balance', -amount);
        await pg.increment('users', receiver.uid, 'balance', net);

        await pg.query(
            `INSERT INTO p2p_transfers (id, from_uid, to_uid, from_code, to_code, from_name, to_name, gross_amount, burn, net_amount, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11)`,
            ['trf_' + fromUid + '_' + Date.now(), fromUid, receiver.uid,
             sender.referral_code || '?', referralCode.toUpperCase(),
             sender.name || '?', receiver.name || '?',
             amount, burn, net, Date.now()]
        );

        res.json({ success: true, amount, burn, received: net });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminGetAll = async (req, res) => {
    try {
        const rows = await pg.query(`SELECT * FROM p2p_transfers ORDER BY created_at DESC LIMIT 100`);
        const transfers = [];
        for (const t of rows.rows) {
            const fromUser = await pg.get('users', t.from_uid);
            const toUser = await pg.get('users', t.to_uid);
            transfers.push({
                ...t,
                fromName: fromUser ? (fromUser.name || fromUser.referral_code) : '?',
                toName: toUser ? (toUser.name || toUser.referral_code) : '?',
            });
        }
        res.json(transfers);
    } catch(e) { res.status(500).json({ error: e.message }); }
};
