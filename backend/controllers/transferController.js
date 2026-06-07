const admin = require('firebase-admin');
const db = admin.firestore();

exports.send = async (req, res) => {
    try {
        const { fromUid, referralCode, amount } = req.body;
        if (!fromUid || !referralCode || !amount) return res.status(400).json({ error: 'Missing fields' });
        if (amount < 1) return res.status(400).json({ error: 'Minimum transfer is 1 ONC' });

        const senderSnap = await db.doc(`users/${fromUid}`).get();
        if (!senderSnap.exists) return res.status(404).json({ error: 'Sender not found' });
        const sender = senderSnap.data();

        if ((sender.balance || 0) < amount) return res.status(400).json({ error: 'Insufficient balance' });

        const receiverSnap = await db.collection('users').where('referralCode', '==', referralCode.toUpperCase()).limit(1).get();
        if (receiverSnap.empty) return res.status(404).json({ error: 'Receiver not found' });
        const receiverDoc = receiverSnap.docs[0];
        const receiver = receiverDoc.data();

        if (receiverDoc.id === fromUid) return res.status(400).json({ error: 'Cannot send to yourself' });

        const burn = Math.round(amount * 0.1 * 100) / 100;
        const net = Math.round((amount - burn) * 100) / 100;

        const batch = db.batch();
        batch.update(db.doc(`users/${fromUid}`), { balance: admin.firestore.FieldValue.increment(-amount) });
        batch.update(db.doc(`users/${receiverDoc.id}`), { balance: admin.firestore.FieldValue.increment(net) });
        batch.create(db.collection('allTransfers').doc(), {
            fromUid, toUid: receiverDoc.id,
            fromCode: sender.referralCode || '?', toCode: referralCode.toUpperCase(),
            grossAmount: amount, burn, netAmount: net, createdAt: Date.now()
        });
        await batch.commit();

        res.json({ success: true, amount, burn, received: net });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminGetAll = async (req, res) => {
    try {
        const snap = await db.collection('allTransfers').orderBy('createdAt', 'desc').limit(100).get();
        const transfers = [];
        for (const d of snap.docs) {
            const t = d.data();
            const fromSnap = await db.doc(`users/${t.fromUid}`).get();
            const toSnap = await db.doc(`users/${t.toUid}`).get();
            transfers.push({
                id: d.id, ...t,
                fromName: fromSnap.exists ? (fromSnap.data().name || fromSnap.data().referralCode) : '?',
                toName: toSnap.exists ? (toSnap.data().name || toSnap.data().referralCode) : '?',
            });
        }
        res.json(transfers);
    } catch(e) { res.status(500).json({ error: e.message }); }
};
