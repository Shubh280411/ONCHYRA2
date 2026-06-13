const admin = require('firebase-admin');
const db = admin.firestore();

const PACKAGES = {
    starter:  { price: 5,   boost: 4,   cap: 50,   name: 'Starter' },
    builder:  { price: 10,  boost: 8,   cap: 100,  name: 'Builder' },
    pioneer:  { price: 25,  boost: 15,  cap: 250,  name: 'Pioneer' },
    elite:    { price: 50,  boost: 30,  cap: 500,  name: 'Elite' },
    titan:    { price: 100, boost: 60,  cap: 1000, name: 'Titan' },
    dominion: { price: 250, boost: 120, cap: 2500, name: 'Dominion' },
    legacy:   { price: 500, boost: 300, cap: 5000, name: 'Legacy' },
};

exports.list = (req, res) => res.json(PACKAGES);

exports.purchase = async (req, res) => {
    try {
        const { uid, packageId } = req.body;
        const pkg = PACKAGES[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const user = userSnap.data();

        if (user.activePackage && user.activePackage !== 'none' && user.packageStatus !== 'expired') {
            return res.status(400).json({ error: 'Already has an active package. Upgrade instead.' });
        }

        let credit = 0;
        if (user.activePackage && user.activePackage !== 'none') {
            const currentPkg = PACKAGES[user.activePackage];
            if (currentPkg) {
                const usagePct = (user.packageUsage || 0) / currentPkg.cap;
                if (usagePct < 5) credit = currentPkg.price * 0.7;
            }
        }

        const finalPrice = Math.max(0, pkg.price - credit);
        if ((user.walletBalance || 0) < finalPrice) return res.status(400).json({ error: 'Insufficient wallet balance' });

        const batch = db.batch();
        const prevCap = user.activePackage && user.activePackage !== 'none' && PACKAGES[user.activePackage]
            ? PACKAGES[user.activePackage].cap : 0;

        batch.update(db.doc(`users/${uid}`), {
            walletBalance: admin.firestore.FieldValue.increment(-finalPrice),
            activePackage: packageId,
            packageAmount: pkg.price,
            packageBoost: pkg.boost,
            packageCap: prevCap + pkg.cap,
            packageUsage: 0,
            packageStatus: 'active',
            packagePurchasedAt: Date.now(),
            totalPackageSpend: admin.firestore.FieldValue.increment(pkg.price),
        });

        batch.create(db.collection('packagePurchases').doc(), {
            uid, packageId: pkg.name, amount: pkg.price, paid: finalPrice, credit,
            boost: pkg.boost, createdAt: Date.now()
        });

        await batch.commit();
        await processReferralCommission(uid, pkg.price, pkg.name);

        res.json({ success: true, package: pkg.name, boost: pkg.boost, credit, paid: finalPrice });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.checkCap = async (req, res) => {
    try {
        const { uid } = req.params;
        const snap = await db.doc(`users/${uid}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'User not found' });
        const u = snap.data();
        res.json({
            activePackage: u.activePackage || 'none',
            packageStatus: u.packageStatus || 'none',
            packageCap: u.packageCap || 0,
            packageUsage: u.packageUsage || 0,
            usedCap: u.packageUsage || 0,
            maxCap: u.packageCap || 0,
            remainingCap: Math.max(0, (u.packageCap || 0) - (u.packageUsage || 0)),
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminActivate = async (req, res) => {
    try {
        const { uid, packageId } = req.body;
        const pkg = PACKAGES[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        await db.doc(`users/${uid}`).update({
            activePackage: packageId,
            packageAmount: pkg.price,
            packageBoost: pkg.boost,
            packageCap: pkg.cap,
            packageUsage: 0,
            packageStatus: 'active',
            packagePurchasedAt: Date.now(),
            totalPackageSpend: admin.firestore.FieldValue.increment(pkg.price),
        });
        await processReferralCommission(uid, pkg.price, pkg.name);
        res.json({ success: true, package: pkg.name });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminExpire = async (req, res) => {
    try {
        const { uid } = req.body;
        await db.doc(`users/${uid}`).update({ packageStatus: 'expired', activePackage: 'none' });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminUpgrade = async (req, res) => {
    try {
        const { uid, packageId } = req.body;
        const pkg = PACKAGES[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        const prevCap = await db.doc(`users/${uid}`).get().then(d => d.data().packageCap || 0);

        await db.doc(`users/${uid}`).update({
            activePackage: packageId,
            packageAmount: pkg.price,
            packageBoost: pkg.boost,
            packageCap: prevCap + pkg.cap,
            packageUsage: 0,
            packageStatus: 'active',
            packagePurchasedAt: Date.now(),
            totalPackageSpend: admin.firestore.FieldValue.increment(pkg.price),
        });
        await processReferralCommission(uid, pkg.price, pkg.name);
        res.json({ success: true, package: pkg.name });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const lookupByRefCode = async (refCode) => {
    if (!refCode) return null;
    const snap = await db.collection('users').where('referralCode', '==', refCode).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, data: snap.docs[0].data() };
};

async function processReferralCommission(uid, amount, pkgName) {
    try {
        const userSnap = await db.doc(`users/${uid}`).get();
        const user = userSnap.data();
        if (!user.referredBy) return;

        const levels = [
            { level: 1, pct: 0.10 },
            { level: 2, pct: 0.05 },
            { level: 3, pct: 0.03 },
        ];

        let currentRefCode = user.referredBy;
        for (const lv of levels) {
            if (!currentRefCode) break;

            const refLookup = await lookupByRefCode(currentRefCode);
            if (!refLookup) break;
            const refUid = refLookup.id;
            const refData = refLookup.data;

            // Always move up before any continue
            currentRefCode = refData.referredBy;

            // Always update teamBiz for this upline (downline's purchase counts regardless of package)
            await db.doc(`users/${refUid}`).update({
                teamBiz: admin.firestore.FieldValue.increment(amount)
            });

            // Only pay commission if upline has active package with remaining cap
            if (!refData.activePackage || refData.activePackage === 'none' || refData.packageStatus === 'expired') {
                continue;
            }

            const commission = amount * lv.pct;
            const used = refData.packageUsage || 0;
            const cap = refData.packageCap || Infinity;
            const available = Math.max(0, cap - used);
            const capped = Math.min(commission, available);
            if (capped <= 0) continue;

            const newUsed = used + capped;
            const updates = {
                balance: admin.firestore.FieldValue.increment(capped),
                packageUsage: admin.firestore.FieldValue.increment(capped),
                totalCommissions: admin.firestore.FieldValue.increment(capped),
            };

            if (newUsed >= cap) {
                updates.packageStatus = 'expired';
            }

            const batch = db.batch();
            batch.update(db.doc(`users/${refUid}`), updates);
            batch.create(db.collection('commissions').doc(), {
                fromUid: uid, uid: refUid, amount: capped,
                level: lv.level, type: 'package_commission',
                packageName: pkgName || 'Package',
                fromName: user.name || 'User',
                createdAt: Date.now()
            });
            await batch.commit();
        }
    } catch(e) { console.error('Referral commission error:', e); }
}

exports.userPackage = async (req, res) => {
    try {
        const snap = await db.doc(`users/${req.params.uid}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'User not found' });
        const data = snap.data();
        res.json({
            activePackage: data.activePackage || 'none',
            packageBoost: data.packageBoost || 1,
            packageUsage: data.packageUsage || 0,
            packageCap: data.packageCap || 0,
            packageStatus: data.packageStatus || 'none',
            remainingCap: Math.max(0, (data.packageCap || 0) - (data.packageUsage || 0)),
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.processReferralCommission = processReferralCommission;
