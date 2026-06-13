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
        const maxLevel = parseInt(req.query.maxLevel) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const offset = parseInt(req.query.offset) || 0;
        const userSnap = await admin.firestore().doc(`users/${uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const user = userSnap.data();
        const refCode = user.referralCode;
        if (!refCode) return res.json({ levels: { 1: [], 2: [], 3: [] } });

        const s1 = await admin.firestore().collection('users').where('referredBy', '==', refCode).get();
        const allL1 = s1.docs.map(d => ({ id: d.id, ...d.data() }));
        const total = allL1.length;
        const l1 = allL1.slice(offset, offset + limit);
        let l2 = [], l3 = [];
        let total2 = 0, total3 = 0;

        if (maxLevel >= 2 && l1.length > 0) {
            const l1Codes = l1.map(u => u.referralCode).filter(Boolean);
            for (let i = 0; i < l1Codes.length; i += 10) {
                const s2 = await admin.firestore().collection('users').where('referredBy', 'in', l1Codes.slice(i, i + 10)).get();
                l2.push(...s2.docs.map(d => ({ id: d.id, ...d.data() })));
            }
        }

        if (maxLevel >= 3 && l2.length > 0) {
            const l2Codes = l2.map(u => u.referralCode).filter(Boolean);
            for (let i = 0; i < l2Codes.length; i += 10) {
                const s3 = await admin.firestore().collection('users').where('referredBy', 'in', l2Codes.slice(i, i + 10)).get();
                l3.push(...s3.docs.map(d => ({ id: d.id, ...d.data() })));
            }
        }

        const clean = (list) => list.map(u => ({
            uid: u.id, name: u.name, referralCode: u.referralCode,
            activePackage: u.activePackage, packageStatus: u.packageStatus,
            totalPackageSpend: u.totalPackageSpend || 0,
            createdAt: u.createdAt,
            refLevel1: u.refLevel1 || 0, refLevel2: u.refLevel2 || 0, refLevel3: u.refLevel3 || 0,
        }));

        res.json({ levels: { 1: clean(l1), 2: clean(l2), 3: clean(l3) }, total, total2, total3 });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/referrals/commissions/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const snap = await admin.firestore().collection('commissions')
            .where('uid', '==', uid)
            .limit(30)
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

// Income — all income data in one call
router.get('/income/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const db = admin.firestore();
        const [commSnap, achSnap, rewSnap] = await Promise.all([
            db.collection('commissions').where('uid', '==', uid).limit(200).get(),
            db.collection('achievementBonuses').where('uid', '==', uid).limit(200).get(),
            db.collection('leadershipRewards').where('uid', '==', uid).limit(200).get(),
        ]);
        const commissions = commSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const achievements = achSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const rewards = rewSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ commissions, achievements, rewards });
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

// Admin — Stats (single endpoint replacing 40+ individual reads)
router.get('/admin/stats', async (req, res) => {
    try {
        const db = admin.firestore();
        const [uSnap, depSnap, wdSnap, rewSnap, achSnap, pkgSnap, claimSnap] = await Promise.all([
            db.collection('users').get(),
            db.collection('deposits').where('status', '==', 'completed').get(),
            db.collection('withdrawals').get(),
            db.collection('leadershipRewards').get(),
            db.collection('achievementBonuses').get(),
            db.collection('packagePurchases').get(),
            db.collection('claims').get(),
        ]);

        const users = uSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
        const totalUsers = users.length;
        const totalDeposits = depSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
        const totalWithdrawals = wdSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
        const pendingWithdrawals = wdSnap.docs.filter(d => d.data().status === 'pending').length;
        const completedWithdrawals = wdSnap.docs.filter(d => d.data().status === 'completed').length;
        const totalRewards = rewSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
        const totalBonuses = achSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
        const totalPackageSales = pkgSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
        const packageCount = pkgSnap.docs.length;
        const totalClaims = claimSnap.docs.length;

        // Users by package
        const usersWithPackage = users.filter(u => u.activePackage).length;
        const usersWithoutPackage = totalUsers - usersWithPackage;

        // Rank distribution
        const rankCounts = {};
        for (const u of users) {
            const r = u.rank || 'member';
            rankCounts[r] = (rankCounts[r] || 0) + 1;
        }

        // Deposits top 10 users
        const depositByUser = {};
        for (const d of depSnap.docs) {
            const uid = d.data().uid;
            if (uid) depositByUser[uid] = (depositByUser[uid] || 0) + (d.data().amount || 0);
        }
        const topDepositors = Object.entries(depositByUser)
            .sort((a, b) => b[1] - a[1]).slice(0, 10)
            .map(([uid, amount]) => {
                const u = users.find(x => x.uid === uid);
                return { uid, name: u?.name || 'Unknown', amount };
            });

        res.json({
            totalUsers, usersWithPackage, usersWithoutPackage,
            totalDeposits, totalWithdrawals, pendingWithdrawals, completedWithdrawals,
            totalRewards, totalBonuses, totalPackageSales, packageCount, totalClaims,
            rankCounts, topDepositors, users
        });
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
                teamBiz: admin.firestore.FieldValue.increment(user.totalPackageSpend || 0),
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

// Lightweight leg stats — reads only L1 members, no L2/L3 tree
router.get('/referrals/leg-stats/:uid', async (req, res) => {
    try {
        const userSnap = await admin.firestore().doc(`users/${req.params.uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const refCode = userSnap.data().referralCode;
        if (!refCode) return res.json({ totalDirects: 0, activeDirects: 0, legABiz: 0, legBBiz: 0, teamBiz: 0 });

        const s1 = await admin.firestore().collection('users').where('referredBy', '==', refCode).get();
        const l1 = s1.docs.map(d => d.data());
        const totalDirects = l1.length;
        const activeDirects = l1.filter(u => u.activePackage).length;

        const legBiz = l1.map(u => u.totalPackageSpend || 0).sort((a, b) => b - a);
        const legABiz = legBiz.length > 0 ? legBiz[0] : 0;
        const legBBiz = legBiz.slice(1).reduce((s, x) => s + x, 0);
        const teamBiz = legBiz.reduce((s, x) => s + x, 0);

        res.json({ totalDirects, activeDirects, legABiz, legBBiz, teamBiz });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get user stats for referrals page
router.get('/user/:uid', async (req, res) => {
    try {
        const snap = await admin.firestore().doc(`users/${req.params.uid}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'User not found' });
        const u = snap.data();
        res.json({
            referralCode: u.referralCode,
            refLevel1: u.refLevel1 || 0,
            refLevel2: u.refLevel2 || 0,
            refLevel3: u.refLevel3 || 0,
            totalCommissions: u.totalCommissions || 0,
            totalDirects: u.totalDirects || 0,
            activeDirects: u.activeDirects || 0,
            teamBiz: u.teamBiz || 0,
            legABiz: u.legABiz || 0,
            legBBiz: u.legBBiz || 0,
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Registration Commission
router.post('/register-commission', async (req, res) => {
    try {
        const { uid, referredBy } = req.body;
        if (!uid || !referredBy) return res.status(400).json({ error: 'Missing uid or referredBy' });

        const refSnap = await admin.firestore().collection('users').where('referralCode', '==', referredBy.toUpperCase()).get();
        if (refSnap.empty) return res.status(400).json({ error: 'Invalid referral code' });

        const newUserSnap = await admin.firestore().doc(`users/${uid}`).get();
        const newUserName = newUserSnap.exists ? newUserSnap.data().name : 'New User';

        const l1Ref = refSnap.docs[0].ref;
        const l1Data = refSnap.docs[0].data();
        const l1Uid = refSnap.docs[0].id;
        const batch = admin.firestore().batch();

        batch.update(l1Ref, {
            balance: admin.firestore.FieldValue.increment(0.25),
            referrals: admin.firestore.FieldValue.increment(1),
            refLevel1: admin.firestore.FieldValue.increment(1),
            totalDirects: admin.firestore.FieldValue.increment(1)
        });
        batch.create(admin.firestore().collection('commissions').doc(), {
            uid: l1Uid, fromUid: uid, fromName: newUserName,
            amount: 0.25, level: 1, type: 'registration_bonus',
            packageName: 'Registration Bonus', createdAt: Date.now()
        });

        if (l1Data.referredBy) {
            const l2Snap = await admin.firestore().collection('users').where('referralCode', '==', l1Data.referredBy).get();
            if (!l2Snap.empty) {
                const l2Ref = l2Snap.docs[0].ref;
                const l2Data = l2Snap.docs[0].data();
                const l2Uid = l2Snap.docs[0].id;
                batch.update(l2Ref, {
                    balance: admin.firestore.FieldValue.increment(0.10),
                    refLevel2: admin.firestore.FieldValue.increment(1)
                });
                batch.create(admin.firestore().collection('commissions').doc(), {
                    uid: l2Uid, fromUid: uid, fromName: newUserName,
                    amount: 0.10, level: 2, type: 'registration_bonus',
                    packageName: 'Registration Bonus', createdAt: Date.now()
                });
                if (l2Data.referredBy) {
                    const l3Snap = await admin.firestore().collection('users').where('referralCode', '==', l2Data.referredBy).get();
                    if (!l3Snap.empty) {
                        const l3Uid = l3Snap.docs[0].id;
                        batch.update(l3Snap.docs[0].ref, {
                            balance: admin.firestore.FieldValue.increment(0.05),
                            refLevel3: admin.firestore.FieldValue.increment(1)
                        });
                        batch.create(admin.firestore().collection('commissions').doc(), {
                            uid: l3Uid, fromUid: uid, fromName: newUserName,
                            amount: 0.05, level: 3, type: 'registration_bonus',
                            packageName: 'Registration Bonus', createdAt: Date.now()
                        });
                    }
                }
            }
        }

	await batch.commit();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Retroactive Commission Migration (force process past purchases; ?days=6 for last N days)
router.post('/admin/migrate-commissions', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 0;
        const fixBizOnly = req.query.fixBizOnly === 'true';
        const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
        const usersSnap = await admin.firestore().collection('users').get();
        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        let buyers = allUsers.filter(u => (u.packageAmount || 0) > 0 || (u.totalPackageSpend || 0) > 0);
        if (cutoff > 0) buyers = buyers.filter(u => (u.packagePurchasedAt || 0) >= cutoff);
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

                    // Always move up before any continue
                    currentRefCode = refData.referredBy;

                    // Always update teamBiz
                    const batch = admin.firestore().batch();
                    batch.update(admin.firestore().doc(`users/${refUid}`), {
                        teamBiz: admin.firestore.FieldValue.increment(pkgAmount),
                    });

                    // Only pay commission if upline has active package
                    if (!fixBizOnly && refData.activePackage && refData.activePackage !== 'none' && refData.packageStatus !== 'expired') {
                        const commission = pkgAmount * lv.pct;
                        const used = refData.packageUsage || 0;
                        const cap = refData.packageCap || Infinity;
                        const available = Math.max(0, cap - used);
                        const capped = Math.min(commission, available);
                        if (capped > 0) {
                            const newUsed = used + capped;
                            const updates = {
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
                    }

                    await batch.commit();
                }

                if (levelResults.length > 0 || fixBizOnly) {
                    results.push(`${buyer.name || buyer.id}: ${fixBizOnly ? 'teamBiz updated' : levelResults.join(', ')}`);
                    processed++;
                } else {
                    noUplinePackage++;
                }
            } catch(e) { errors.push(`${buyer.id}: ${e.message}`); }
        }

        res.json({ success: true, processed, noReferrer, noUplinePackage, totalBuyers: buyers.length, results: results.slice(0,50), errors: errors.length, errorDetails: errors.slice(0,10) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Reset all users' teamBiz to 0 (run before fixBizOnly migration)
router.post('/admin/reset-teambiz', async (req, res) => {
    try {
        const snap = await admin.firestore().collection('users').get();
        let batch = admin.firestore().batch();
        let count = 0, committed = 0;
        for (const d of snap.docs) {
            batch.update(d.ref, { teamBiz: 0 });
            count++;
            if (count % 400 === 0) { await batch.commit(); committed += 400; batch = admin.firestore().batch(); }
        }
        if (count % 400 !== 0) { await batch.commit(); committed += count % 400; }
        res.json({ success: true, resetCount: committed });
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

// Trigger commission + teamBiz for a package purchase (used by admin panel after direct Firestore write)
router.post('/admin/process-commission', async (req, res) => {
    try {
        const { uid, packageId } = req.body;
        if (!uid || !packageId) return res.status(400).json({ error: 'Missing uid or packageId' });
        const PACKAGES = {
            starter: { price: 5, name: 'Starter' },
            builder: { price: 10, name: 'Builder' },
            pioneer: { price: 25, name: 'Pioneer' },
            elite: { price: 50, name: 'Elite' },
            titan: { price: 100, name: 'Titan' },
            dominion: { price: 250, name: 'Dominion' },
            legacy: { price: 500, name: 'Legacy' },
        };
        const pkg = PACKAGES[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });
        const packages = require('../controllers/packageController');
        await packages.processReferralCommission(uid, pkg.price, pkg.name);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sweep
router.post('/sweep/check', sweep.check);
router.post('/sweep/execute', sweep.sweep);
router.post('/sweep/auto', sweep.autoSweep);
router.post('/sweep/fund-gas', sweep.fundGas);
router.get('/sweep/status', sweep.status);

module.exports = router;
