const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

const maintenance = require('../controllers/maintenanceController');
const deposit = require('../controllers/depositController');
const packages = require('../controllers/packageController');
const transfer = require('../controllers/transferController');
const withdraw = require('../controllers/withdrawController');
const leadership = require('../controllers/leadershipController');
const sweep = require('../controllers/sweepController');
const otp = require('../controllers/otpController');

// Maintenance
router.get('/maintenance', maintenance.getStatus);
router.post('/maintenance/toggle', maintenance.toggle);

// Deposits
router.post('/deposit/create-wallet', deposit.createWallet);
router.post('/deposit/verify', deposit.verifyDeposit);
router.get('/deposits', deposit.getDeposits);
router.get('/deposits/:uid', deposit.userDeposits);
router.get('/deposit/wallets/:uid', deposit.userWallets);
// REMOVED - security risk (exposed private keys without auth)
// router.get('/deposit/key/:index', deposit.getWalletPrivateKey);

// Packages
router.get('/packages', packages.list);
router.post('/packages/purchase', packages.purchase);
router.get('/packages/user/:uid', packages.userPackage);
router.get('/packages/cap/:uid', packages.checkCap);
router.post('/admin/package/activate', packages.adminActivate);
router.post('/admin/package/expire', packages.adminExpire);
router.post('/admin/package/upgrade', packages.adminUpgrade);

// Transfers
router.post('/transfer/send', transfer.send);
router.get('/admin/transfers', transfer.adminGetAll);

// Withdrawals
router.post('/withdraw/request', withdraw.request);
router.post('/withdraw/approve', withdraw.approve);
router.post('/withdraw/reject', withdraw.reject);
router.get('/admin/withdrawals', withdraw.adminGetAll);
router.get('/withdrawals/:uid', withdraw.userHistory);

// Leadership
router.get('/leadership/ranks', leadership.ranks);
router.get('/leadership/calculate/:uid', leadership.calculateRank);
router.get('/leadership/progress/:uid', leadership.userRankProgress);
router.get('/leadership/matching-bonus/:uid', leadership.getMatchingBonus);
router.post('/leadership/distribute-rewards', leadership.distributeDailyRewards);
router.post('/admin/leadership/recalc-all', leadership.adminRecalcAllRanks);

// OTP
router.post('/otp/send', otp.send);
router.post('/otp/verify', otp.verify);

// Referral
router.get('/check-referral/:code', async (req, res) => {
    try {
        const snap = await admin.firestore().collection('users').where('referralCode', '==', req.params.code.toUpperCase()).get();
        if (snap.empty) return res.json({ valid: false });
        res.json({ valid: true, uid: snap.docs[0].id, name: snap.docs[0].data().name, referredBy: snap.docs[0].data().referredBy || null });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Referrals — Team & Commissions
router.get('/referrals/team/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const userSnap = await admin.firestore().doc(`users/${uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const user = userSnap.data();
        const refCode = user.referralCode;
        if (!refCode) return res.json({ levels: { 1: [], 2: [], 3: [] } });

        const s1 = await admin.firestore().collection('users').where('referredBy', '==', refCode).get();
        const l1 = s1.docs.map(d => ({ id: d.id, ...d.data() }));
        const l1Codes = l1.map(u => u.referralCode).filter(Boolean);

        let l2 = [];
        for (let i = 0; i < l1Codes.length; i += 10) {
            const s2 = await admin.firestore().collection('users').where('referredBy', 'in', l1Codes.slice(i, i + 10)).get();
            l2.push(...s2.docs.map(d => ({ id: d.id, ...d.data() })));
        }

        const l2Codes = l2.map(u => u.referralCode).filter(Boolean);
        let l3 = [];
        for (let i = 0; i < l2Codes.length; i += 10) {
            const s3 = await admin.firestore().collection('users').where('referredBy', 'in', l2Codes.slice(i, i + 10)).get();
            l3.push(...s3.docs.map(d => ({ id: d.id, ...d.data() })));
        }

        const clean = (list) => list.map(u => ({
            uid: u.id, name: u.name, referralCode: u.referralCode,
            activePackage: u.activePackage, packageStatus: u.packageStatus,
            totalPackageSpend: u.totalPackageSpend || 0,
            createdAt: u.createdAt,
            refLevel1: u.refLevel1 || 0, refLevel2: u.refLevel2 || 0, refLevel3: u.refLevel3 || 0,
        }));

        res.json({ levels: { 1: clean(l1), 2: clean(l2), 3: clean(l3) } });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/referrals/commissions/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const snap = await admin.firestore().collection('commissions')
            .where('uid', '==', uid)
            .limit(100)
            .get();
        const commissions = snap.docs.map(d => {
            const data = d.data();
            return {
                id: d.id, amount: data.amount, level: data.level,
                type: data.type, packageName: data.packageName,
                fromName: data.fromName, createdAt: data.createdAt,
            };
        });
        res.json({ commissions });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Users
router.get('/admin/users', async (req, res) => {
    try {
        const snap = await admin.firestore().collection('users').get();
        const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        res.json(users);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/admin/user/update', async (req, res) => {
    try {
        const { uid, updates } = req.body;
        await admin.firestore().doc(`users/${uid}`).update(updates);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Notifications
router.post('/admin/notifications/send', async (req, res) => {
    try {
        const { userId, title, message, type, link } = req.body;
        await admin.firestore().collection('notifications').add({
            userId: userId || 'all', title, message, type: type || 'update',
            link: link || '', read: false, createdAt: Date.now()
        });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Package Commission
router.post('/commissions/process-package', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });

        const userSnap = await admin.firestore().doc(`users/${uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const user = userSnap.data();

        if (!user.referredBy) return res.json({ success: true, commissions: [] });

        const levels = [
            { level: 1, pct: 0.10 },
            { level: 2, pct: 0.05 },
            { level: 3, pct: 0.03 },
        ];

        let currentRefCode = user.referredBy;
        const results = [];
        for (const lv of levels) {
            if (!currentRefCode) break;
            const refSnap = await admin.firestore().collection('users').where('referralCode', '==', currentRefCode).get();
            if (refSnap.empty) break;

            const refUid = refSnap.docs[0].id;
            const refData = refSnap.docs[0].data();

            const batch = admin.firestore().batch();
            batch.update(admin.firestore().doc(`users/${refUid}`), {
                teamBusiness: admin.firestore.FieldValue.increment(user.totalPackageSpend || 0),
            });

            if (!refData.activePackage || refData.activePackage === 'none' || refData.packageStatus === 'expired') {
                currentRefCode = refData.referredBy;
                continue;
            }

            const pkgAmount = user.packageAmount || 0;
            const commission = pkgAmount * lv.pct;
            const used = refData.packageUsage || 0;
            const cap = refData.packageCap || Infinity;
            const available = Math.max(0, cap - used);
            const capped = Math.min(commission, available);

            if (capped > 0) {
                const newUsed = used + capped;
                const updates = {
                    balance: admin.firestore.FieldValue.increment(capped),
                    commissionBalance: admin.firestore.FieldValue.increment(capped),
                    packageUsage: admin.firestore.FieldValue.increment(capped),
                    totalCommissions: admin.firestore.FieldValue.increment(capped),
                };
                if (newUsed >= cap) updates.packageStatus = 'expired';
                batch.update(admin.firestore().doc(`users/${refUid}`), updates);
                batch.create(admin.firestore().collection('commissions').doc(), {
                    fromUid: uid, uid: refUid, amount: capped,
                    level: lv.level, type: 'package_commission',
                    packageName: user.activePackage || 'Package',
                    fromName: user.name || 'User', createdAt: Date.now()
                });
                results.push({ level: lv.level, uid: refUid, amount: capped });
            }

            await batch.commit();
            currentRefCode = refData.referredBy;
        }

        res.json({ success: true, commissions: results });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Registration Commission
router.post('/register-commission', async (req, res) => {
    try {
        const { uid, referredBy } = req.body;
        if (!uid || !referredBy) return res.status(400).json({ error: 'Missing uid or referredBy' });

        const refSnap = await admin.firestore().collection('users').where('referralCode', '==', referredBy.toUpperCase()).get();
        if (refSnap.empty) return res.status(400).json({ error: 'Invalid referral code' });

        const l1Ref = refSnap.docs[0].ref;
        const l1Data = refSnap.docs[0].data();
        const batch = admin.firestore().batch();

        batch.update(l1Ref, {
            balance: admin.firestore.FieldValue.increment(0.25),
            referrals: admin.firestore.FieldValue.increment(1),
            refLevel1: admin.firestore.FieldValue.increment(1),
            totalDirects: admin.firestore.FieldValue.increment(1)
        });

        if (l1Data.referredBy) {
            const l2Snap = await admin.firestore().collection('users').where('referralCode', '==', l1Data.referredBy).get();
            if (!l2Snap.empty) {
                const l2Ref = l2Snap.docs[0].ref;
                const l2Data = l2Snap.docs[0].data();
                batch.update(l2Ref, {
                    balance: admin.firestore.FieldValue.increment(0.10),
                    refLevel2: admin.firestore.FieldValue.increment(1)
                });
                if (l2Data.referredBy) {
                    const l3Snap = await admin.firestore().collection('users').where('referralCode', '==', l2Data.referredBy).get();
                    if (!l3Snap.empty) {
                        batch.update(l3Snap.docs[0].ref, {
                            balance: admin.firestore.FieldValue.increment(0.05),
                            refLevel3: admin.firestore.FieldValue.increment(1)
                        });
                    }
                }
            }
        }

	await batch.commit();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Retroactive Commission Migration (force process all past purchases)
router.post('/admin/migrate-commissions', async (req, res) => {
    try {
        const usersSnap = await admin.firestore().collection('users').get();
        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const buyers = allUsers.filter(u => (u.packageAmount || 0) > 0 || (u.totalPackageSpend || 0) > 0);
        let processed = 0, noReferrer = 0, noUplinePackage = 0, results = [], errors = [];

        const levels = [
            { level: 1, pct: 0.10 },
            { level: 2, pct: 0.05 },
            { level: 3, pct: 0.03 },
        ];

        for (const buyer of buyers) {
            try {
                let currentRefCode = buyer.referredBy;
                if (!currentRefCode) { noReferrer++; continue; }

                const pkgAmount = buyer.packageAmount || buyer.totalPackageSpend || 0;
                let levelResults = [];

                for (const lv of levels) {
                    if (!currentRefCode) break;
                    const refSnap = await admin.firestore().collection('users').where('referralCode', '==', currentRefCode).get();
                    if (refSnap.empty) break;

                    const refUid = refSnap.docs[0].id;
                    const refData = refSnap.docs[0].data();

                    if (!refData.activePackage || refData.activePackage === 'none' || refData.packageStatus === 'expired') {
                        currentRefCode = refData.referredBy;
                        continue;
                    }

                    const commission = pkgAmount * lv.pct;
                    const used = refData.packageUsage || 0;
                    const cap = refData.packageCap || Infinity;
                    const available = Math.max(0, cap - used);
                    const capped = Math.min(commission, available);

                    const batch = admin.firestore().batch();

                    batch.update(admin.firestore().doc(`users/${refUid}`), {
                        teamBusiness: admin.firestore.FieldValue.increment(pkgAmount),
                    });

                    if (capped > 0) {
                        const newUsed = used + capped;
                        const updates = {
                            balance: admin.firestore.FieldValue.increment(capped),
                            commissionBalance: admin.firestore.FieldValue.increment(capped),
                            packageUsage: admin.firestore.FieldValue.increment(capped),
                            totalCommissions: admin.firestore.FieldValue.increment(capped),
                        };
                        if (newUsed >= cap) updates.packageStatus = 'expired';
                        batch.update(admin.firestore().doc(`users/${refUid}`), updates);
                        batch.create(admin.firestore().collection('commissions').doc(), {
                            fromUid: buyer.id, uid: refUid, amount: capped,
                            level: lv.level, type: 'package_commission',
                            packageName: buyer.activePackage || 'Package',
                            fromName: buyer.name || 'User', createdAt: Date.now()
                        });
                        levelResults.push(`${lv.level}: $${capped.toFixed(2)} to ${refData.name || refUid}`);
                    }

                    await batch.commit();
                    currentRefCode = refData.referredBy;
                }

                if (levelResults.length > 0) {
                    results.push(`${buyer.name || buyer.id}: ${levelResults.join(', ')}`);
                    processed++;
                } else {
                    noUplinePackage++;
                }
            } catch(e) { errors.push(`${buyer.id}: ${e.message}`); }
        }

        res.json({ success: true, processed, noReferrer, noUplinePackage, totalBuyers: buyers.length, results: results.slice(0,50), errors: errors.length, errorDetails: errors.slice(0,10) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Undo Commission Migration (reverts only records from last hour)
router.post('/admin/undo-commissions', async (req, res) => {
    try {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const commSnap = await admin.firestore().collection('commissions')
            .where('type', '==', 'package_commission')
            .get();
        const records = commSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(r => r.createdAt > oneHourAgo);

        let reverted = 0, errors = [];
        for (const rec of records) {
            try {
                const userRef = admin.firestore().doc(`users/${rec.uid}`);
                const userSnap = await userRef.get();
                if (!userSnap.exists) continue;
                const user = userSnap.data();

                const currentUsage = user.packageUsage || 0;
                if (rec.amount > 0 && currentUsage >= rec.amount) {
                    const updates = {
                        balance: admin.firestore.FieldValue.increment(-rec.amount),
                        commissionBalance: admin.firestore.FieldValue.increment(-rec.amount),
                        packageUsage: admin.firestore.FieldValue.increment(-rec.amount),
                        totalCommissions: admin.firestore.FieldValue.increment(-rec.amount),
                    };
                    if (currentUsage - rec.amount < (user.packageCap || Infinity)) {
                        updates.packageStatus = 'active';
                    }
                    await userRef.update(updates);
                }
                await admin.firestore().doc(`commissions/${rec.id}`).delete();
                reverted++;
            } catch(e) { errors.push(`${rec.id}: ${e.message}`); }
        }

        res.json({ success: true, reverted, errors: errors.length, errorDetails: errors.slice(0,10) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sweep
router.post('/sweep/check', sweep.check);
router.post('/sweep/execute', sweep.sweep);
router.post('/sweep/auto', sweep.autoSweep);
router.post('/sweep/fund-gas', sweep.fundGas);
router.get('/sweep/status', sweep.status);

module.exports = router;
