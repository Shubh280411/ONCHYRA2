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

// Admin — Retroactive Commission Migration
router.post('/admin/migrate-commissions', async (req, res) => {
    try {
        const usersSnap = await admin.firestore().collection('users').get();
        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const buyers = allUsers.filter(u => u.packageAmount > 0 || (u.totalPackageSpend || 0) > 0);
        let processed = 0, skipped = 0, errors = [];

        for (const buyer of buyers) {
            try {
                const commSnap = await admin.firestore().collection('commissions')
                    .where('fromUid', '==', buyer.id)
                    .where('type', '==', 'package_commission')
                    .get();
                if (!commSnap.empty) { skipped++; continue; }

                let currentRefCode = buyer.referredBy;
                if (!currentRefCode) { skipped++; continue; }

                const levels = [
                    { level: 1, pct: 0.10 },
                    { level: 2, pct: 0.05 },
                    { level: 3, pct: 0.03 },
                ];

                for (const lv of levels) {
                    if (!currentRefCode) break;
                    const refSnap = await admin.firestore().collection('users').where('referralCode', '==', currentRefCode).get();
                    if (refSnap.empty) break;

                    const refUid = refSnap.docs[0].id;
                    const refData = refSnap.docs[0].data();

                    await admin.firestore().doc(`users/${refUid}`).update({
                        teamBusiness: admin.firestore.FieldValue.increment(pkgAmount)
                    });

                    if (!refData.activePackage || refData.activePackage === 'none' || refData.packageStatus === 'expired') {
                        currentRefCode = refData.referredBy;
                        continue;
                    }

                    const pkgAmount = buyer.packageAmount || 0;
                    const commission = pkgAmount * lv.pct;
                    const used = refData.packageUsage || 0;
                    const cap = refData.packageCap || Infinity;
                    const available = Math.max(0, cap - used);
                    const capped = Math.min(commission, available);

                    if (capped > 0) {
                        const batch = admin.firestore().batch();
                        batch.update(admin.firestore().doc(`users/${refUid}`), {
                            balance: admin.firestore.FieldValue.increment(capped),
                            commissionBalance: admin.firestore.FieldValue.increment(capped),
                            packageUsage: admin.firestore.FieldValue.increment(capped),
                            totalCommissions: admin.firestore.FieldValue.increment(capped),
                        });
                        batch.create(admin.firestore().collection('commissions').doc(), {
                            fromUid: buyer.id, uid: refUid, amount: capped,
                            level: lv.level, type: 'package_commission',
                            packageName: buyer.activePackage || 'Package',
                            fromName: buyer.name || 'User', createdAt: Date.now()
                        });
                        await batch.commit();
                    }
                    currentRefCode = refData.referredBy;
                }
                processed++;
            } catch(e) { errors.push(`${buyer.id}: ${e.message}`); }
        }

        res.json({ success: true, processed, skipped, errors: errors.length, errorDetails: errors.slice(0,10) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sweep
router.post('/sweep/check', sweep.check);
router.post('/sweep/execute', sweep.sweep);
router.post('/sweep/auto', sweep.autoSweep);
router.post('/sweep/fund-gas', sweep.fundGas);
router.get('/sweep/status', sweep.status);

module.exports = router;
