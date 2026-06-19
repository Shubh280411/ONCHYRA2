const admin = require('firebase-admin');
const db = admin.firestore();
const withdrawalWallet = require('../services/withdrawalWallet');
const { verifyOtp } = require('./otpController');

exports.request = async (req, res) => {
    try {
        const { uid, amount, wallet, network, otp } = req.body;
        if (!uid || !amount || !wallet) return res.status(400).json({ error: 'Missing fields' });
        if (amount < 10) return res.status(400).json({ error: 'Minimum withdrawal is 10 USDT' });
        if (!otp) return res.status(400).json({ error: 'OTP is required' });

        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const user = userSnap.data();

        const commBal = user.commissionBalance || user.balance || 0;
        if (commBal < amount) return res.status(400).json({ error: 'Insufficient balance' });

        // Verify OTP from in-memory store (with Firestore fallback)
        const otpResult = await verifyOtp(user.email, otp);
        if (!otpResult.valid) return res.status(400).json({ error: otpResult.error });

        const fee = Math.round(amount * 0.05 * 100) / 100;
        const net = Math.round((amount - fee) * 100) / 100;
        const isAuto = amount >= 10 && amount <= 50;
        const status = isAuto ? 'processing' : 'pending';

        const batch = db.batch();
        const deductField = user.commissionBalance !== undefined ? 'commissionBalance' : 'balance';
        batch.update(db.doc(`users/${uid}`), { [deductField]: admin.firestore.FieldValue.increment(-amount) });

        const wRef = db.collection('withdrawals').doc();
        batch.set(wRef, {
            uid, amount, fee, netAmount: net, wallet,
            network: network || 'BEP20',
            status, createdAt: Date.now()
        });

        // Admin audit log
        batch.create(db.collection('auditLogs').doc(), {
            type: 'withdrawal',
            uid, amount, fee, net, wallet, status,
            createdAt: Date.now()
        });

        await batch.commit();

        // Auto-send USDT for processing (10-50 USDT)
        if (isAuto) {
            withdrawalWallet.sendUSDT(wallet, net).then(txResult => {
                db.doc(`withdrawals/${wRef.id}`).update({
                    status: txResult.success ? 'completed' : 'failed',
                    txHash: txResult.txHash || null,
                    completedAt: Date.now(),
                    ...(txResult.error ? { error: txResult.error } : {})
                }).catch(e => console.error('Auto-withdraw update error:', e));
            }).catch(e => {
                console.error('Auto-withdraw send error:', e);
                db.doc(`withdrawals/${wRef.id}`).update({ status: 'failed', error: e.message }).catch(() => {});
            });
        }

        res.json({ success: true, amount, fee, received: net, status, id: wRef.id });
    } catch (e) {
        console.error('Withdrawal request error:', e);
        res.status(500).json({ error: e.message });
    }
};

exports.approve = async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Missing withdrawal ID' });

        const snap = await db.doc(`withdrawals/${id}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'Withdrawal not found' });

        const w = snap.data();
        if (w.status === 'rejected' || w.status === 'completed') {
            return res.status(400).json({ error: 'Already processed' });
        }

        // Send USDT from withdrawal wallet
        const txResult = await withdrawalWallet.sendUSDT(w.wallet, w.netAmount || (w.amount - w.fee));

        const update = {
            status: txResult.success ? 'completed' : 'failed',
            approvedAt: Date.now(),
            txHash: txResult.txHash || null,
            ...(txResult.error ? { error: txResult.error } : {})
        };

        if (txResult.success) update.completedAt = Date.now();

        await db.doc(`withdrawals/${id}`).update(update);

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

        const snap = await db.doc(`withdrawals/${id}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'Not found' });
        const w = snap.data();

        if (w.status === 'rejected' || w.status === 'completed') {
            return res.status(400).json({ error: 'Already processed' });
        }

        const batch = db.batch();
        batch.update(db.doc(`withdrawals/${id}`), { status: 'rejected', rejectedAt: Date.now() });
        const wUserSnap = await db.doc(`users/${w.uid}`).get();
        const wUser = wUserSnap.exists ? wUserSnap.data() : {};
        const refundField = wUser.commissionBalance !== undefined ? 'commissionBalance' : 'balance';
        batch.update(db.doc(`users/${w.uid}`), { [refundField]: admin.firestore.FieldValue.increment(w.amount) });
        await batch.commit();

        res.json({ success: true });
    } catch (e) {
        console.error('Withdrawal reject error:', e);
        res.status(500).json({ error: e.message });
    }
};

exports.adminGetAll = async (req, res) => {
    try {
        const snap = await db.collection('withdrawals')
            .orderBy('createdAt', 'desc').limit(100).get();
        const list = [];
        for (const d of snap.docs) {
            const w = d.data();
            const uSnap = await db.doc(`users/${w.uid}`).get();
            list.push({
                id: d.id, ...w,
                userName: uSnap.exists ? (uSnap.data().name || uSnap.data().referralCode) : '?'
            });
        }
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.userHistory = async (req, res) => {
    try {
        const snap = await db.collection('withdrawals')
            .where('uid', '==', req.params.uid).get();
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        res.json(list.slice(0, 50));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
