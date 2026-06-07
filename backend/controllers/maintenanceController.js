const admin = require('firebase-admin');
const db = admin.firestore();

exports.getStatus = async (req, res) => {
    try {
        const snap = await db.doc('settings/maintenance').get();
        res.json(snap.exists() ? snap.data() : { enabled: false });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.toggle = async (req, res) => {
    try {
        const { enabled, message, countdown } = req.body;
        await db.doc('settings/maintenance').set({
            enabled: !!enabled,
            message: message || 'We are currently performing scheduled maintenance.',
            countdown: countdown || null,
            updatedAt: Date.now()
        }, { merge: true });
        res.json({ success: true, enabled: !!enabled });
    } catch(e) { res.status(500).json({ error: e.message }); }
};
