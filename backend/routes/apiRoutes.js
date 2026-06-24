const express = require('express');
const router = express.Router();
const pg = require('../config/pg');

const maintenance = require('../controllers/maintenanceController');
const deposit = require('../controllers/depositController');
const packages = require('../controllers/packageController');
const transfer = require('../controllers/transferController');
const withdraw = require('../controllers/withdrawController');
const leadership = require('../controllers/leadershipController');
const sweep = require('../controllers/sweepController');
const otp = require('../controllers/otpController');
const refCache = require('../services/referralCache');

// Convert snake_case object keys to camelCase
function cc(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cc);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}

// Maintenance
router.get('/maintenance', maintenance.getStatus);
router.post('/maintenance/toggle', maintenance.toggle);

// Deposits
router.post('/deposit/create-wallet', deposit.createWallet);
router.post('/deposit/verify', deposit.verifyDeposit);
router.get('/deposits', deposit.getDeposits);
router.get('/deposits/:uid', deposit.userDeposits);
router.get('/deposit/wallets/:uid', deposit.userWallets);

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
router.get('/otp/list', otp.list);

// Referral (uses in-memory cache — no DB read for hot path)
router.get('/check-referral/:code', async (req, res) => {
    try {
        const code = req.params.code.toUpperCase();
        let entry = refCache.lookup(code);
        if (!entry) {
            try {
                const rows = await pg.findWhere('users', { referral_code: code });
                if (rows.length) {
                    const d = rows[0];
                    refCache.add(code, d.uid, d.name, d.referred_by);
                    return res.json({ valid: true, uid: d.uid, name: d.name, referredBy: d.referred_by || null });
                }
            } catch(e) { /* fall through */ }
            // Fallback: check Firestore for old users not yet in PostgreSQL
            try {
                const { admin } = require('../config/db');
                if (admin) {
                    const fsSnap = await admin.firestore().collection('users').where('referralCode', '==', code).limit(1).get();
                    if (!fsSnap.empty) {
                        const d = fsSnap.docs[0].data();
                        refCache.add(code, d.uid, d.name, d.referredBy);
                        return res.json({ valid: true, uid: d.uid, name: d.name, referredBy: d.referredBy || null });
                    }
                }
            } catch(e) { /* Firestore fallback failed */ }
            return res.json({ valid: false });
        }
        res.json({ valid: true, uid: entry.uid, name: entry.name, referredBy: entry.referredBy });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Referrals — Team
router.get('/referrals/team/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const maxLevel = parseInt(req.query.maxLevel) || 1;
        const limitVal = Math.min(parseInt(req.query.limit) || 10, 50);
        const offset = parseInt(req.query.offset) || 0;
        const user = await pg.get('users', uid);
        if (!user) return res.json({ levels: { 1: [], 2: [], 3: [] }, total: 0 });
        const refCode = user.referral_code;
        if (!refCode) return res.json({ levels: { 1: [], 2: [], 3: [] } });

        const l1Rows = await pg.findWhere('users', { referred_by: refCode });
        const total = l1Rows.length;
        const l1 = l1Rows.slice(offset, offset + limitVal);
        let l2 = [], l3 = [];

        if (maxLevel >= 2 && l1.length > 0) {
            const l1Codes = l1.map(u => u.referral_code).filter(Boolean);
            if (l1Codes.length) l2 = await pg.findWhereIn('users', 'referred_by', l1Codes);
        }

        if (maxLevel >= 3 && l2.length > 0) {
            const l2Codes = l2.map(u => u.referral_code).filter(Boolean);
            if (l2Codes.length) l3 = await pg.findWhereIn('users', 'referred_by', l2Codes);
        }

        const clean = (list) => list.map(u => ({
            uid: u.uid, name: u.name, referralCode: u.referral_code,
            activePackage: u.active_package, packageStatus: u.package_status,
            totalPackageSpend: Number(u.total_package_spend) || 0,
            createdAt: u.created_at,
            refLevel1: Number(u.ref_level1) || 0, refLevel2: Number(u.ref_level2) || 0, refLevel3: Number(u.ref_level3) || 0,
        }));

        res.json({ levels: { 1: clean(l1), 2: clean(l2), 3: clean(l3) }, total, total2: l2.length, total3: l3.length });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/referrals/commissions/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const rows = await pg.findWhere('commissions', { uid }, 'created_at', 30);
        const commissions = rows.map(r => ({
            id: r.id, amount: Number(r.amount) || 0, level: Number(r.level) || 0,
            type: r.type, packageName: r.package_name,
            fromName: r.from_name, createdAt: r.created_at,
        }));
        res.json({ commissions });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Income
router.get('/income/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const [commissions, achievements, rewards] = await Promise.all([
            pg.findWhere('commissions', { uid }, 'created_at', 200),
            pg.findWhere('achievement_bonuses', { uid }, 'created_at', 200),
            pg.findWhere('leadership_rewards', { uid }, 'created_at', 200),
        ]);
        res.json({ commissions: commissions.map(cc), achievements: achievements.map(cc), rewards: rewards.map(cc) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Check if user is admin
router.get('/admin/check', async (req, res) => {
    try {
        const uid = req.headers['x-auth-uid'];
        if (!uid) return res.status(401).json({ error: 'No uid' });
        const admin = await pg.get('admins', uid);
        if (!admin) return res.status(403).json({ error: 'Not admin' });
        res.json({ admin: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Users
router.get('/admin/users', async (req, res) => {
    try {
        const maxLimit = Math.min(parseInt(req.query.limit) || 500, 500);
        const rows = await pg.query(`SELECT * FROM users LIMIT $1`, [maxLimit]);
        res.json(rows.rows.map(cc));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/leaders', async (req, res) => {
    try {
        const rankNames = ['Ignition','Momentum','Velocity','Quantum','Fusion','Infinity','Titan','Apex','Zenith','Legacy'];
        const rows = await pg.query(`SELECT * FROM users LIMIT 500`);
        const users = rows.rows
            .map(cc)
            .filter(u => (u.rank && rankNames.includes(u.rank)) || u.verifiedLeader || u.leaderStatus);
        res.json(users);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/user/:uid', async (req, res) => {
    try {
        const user = await pg.get('users', req.params.uid);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(cc(user));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/user/update', async (req, res) => {
    try {
        const { uid, updates } = req.body;
        if (!uid || !updates) return res.status(400).json({ error: 'Missing uid or updates' });
        // Convert camelCase keys to snake_case for the DB
        const dbUpdates = {};
        for (const [k, v] of Object.entries(updates)) {
            dbUpdates[k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())] = v;
        }
        await pg.update('users', uid, dbUpdates);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Sync user status (active/inactive based on 7-day lastClaim)
router.post('/admin/sync-status', async (req, res) => {
    try {
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const rows = await pg.query(`SELECT uid, last_claim, role FROM users`);
        let active = 0, inactive = 0, skipped = 0, total = 0;
        for (const u of rows.rows) {
            total++;
            if (u.role === 'admin') { skipped++; continue; }
            const lastClaim = u.last_claim || 0;
            const claimedRecently = lastClaim > 0 && (now - lastClaim) < SEVEN_DAYS;
            if (claimedRecently) active++; else inactive++;
            await pg.query(`UPDATE users SET status = $1 WHERE uid = $2`, [claimedRecently ? 'active' : 'inactive', u.uid]);
        }
        res.json({ success: true, total, active, inactive, skipped });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Stats
router.get('/admin/stats', async (req, res) => {
    try {
        const [uRes, depRes, wdRes, rewRes, achRes, pkgRes, claimRes] = await Promise.all([
            pg.query(`SELECT * FROM users`),
            pg.query(`SELECT * FROM deposits WHERE status = 'completed'`),
            pg.query(`SELECT * FROM withdrawals`),
            pg.query(`SELECT * FROM leadership_rewards`),
            pg.query(`SELECT * FROM achievement_bonuses`),
            pg.query(`SELECT * FROM package_purchases`),
            pg.query(`SELECT * FROM claims`),
        ]);

        const users = uRes.rows.map(cc);
        const totalUsers = users.length;
        const totalDeposits = depRes.rows.reduce((s, d) => s + (d.amount || 0), 0);
        const totalWithdrawals = wdRes.rows.reduce((s, d) => s + (d.amount || 0), 0);
        const pendingWithdrawals = wdRes.rows.filter(d => d.status === 'pending').length;
        const completedWithdrawals = wdRes.rows.filter(d => d.status === 'completed').length;
        const totalRewards = rewRes.rows.reduce((s, d) => s + (d.amount || 0), 0);
        const totalBonuses = achRes.rows.reduce((s, d) => s + (d.amount || 0), 0);
        const totalPackageSales = pkgRes.rows.reduce((s, d) => s + (d.amount || 0), 0);
        const packageCount = pkgRes.rows.length;
        const totalClaims = claimRes.rows.length;

        const usersWithPackage = users.filter(u => u.activePackage).length;
        const usersWithoutPackage = totalUsers - usersWithPackage;

        const rankCounts = {};
        for (const u of users) rankCounts[u.rank || 'member'] = (rankCounts[u.rank || 'member'] || 0) + 1;

        const nameMap = {};
        for (const u of users) nameMap[u.uid] = u.name || (u.uid || '').slice(0, 8);

        const depositByUser = {};
        for (const d of depRes.rows) {
            if (d.uid) depositByUser[d.uid] = (depositByUser[d.uid] || 0) + (d.amount || 0);
        }
        const topDepositors = Object.entries(depositByUser)
            .sort((a, b) => b[1] - a[1]).slice(0, 10)
            .map(([uid, amount]) => ({ uid, name: nameMap[uid] || 'Unknown', amount }));

        const toMs = (val) => Number(val) || 0;

        const pendingWithdrawalsList = wdRes.rows
            .filter(d => d.status === 'pending')
            .map(d => ({ id: d.id, uid: d.uid, amount: d.amount, wallet: d.wallet, createdAt: d.created_at }))
            .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));

        const packageSales = {};
        pkgRes.rows.forEach(d => {
            const name = d.package_name || d.name || 'unknown';
            if (!packageSales[name]) packageSales[name] = { count: 0, revenue: 0 };
            packageSales[name].count++;
            packageSales[name].revenue += (d.amount || 0);
        });
        const packageBreakdown = Object.entries(packageSales).map(([name, data]) => ({ name, count: data.count, revenue: data.revenue }));

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();
        let todayDeposits = 0, todayWithdrawals = 0, todayRewards = 0, todayRegistrations = 0;
        depRes.rows.forEach(d => { if (toMs(d.created_at) >= todayMs) todayDeposits += (d.amount || 0); });
        wdRes.rows.forEach(d => { if (toMs(d.created_at) >= todayMs) todayWithdrawals += (d.amount || 0); });
        rewRes.rows.forEach(d => { if (toMs(d.created_at) >= todayMs) todayRewards += (d.amount || 0); });
        users.forEach(u => { if (toMs(u.createdAt) >= todayMs) todayRegistrations++; });

        const allRewards = rewRes.rows.map(r => ({ ...cc(r), userName: nameMap[r.uid] || (r.uid || '').slice(0, 8) }));
        allRewards.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
        const recentRewards = allRewards.slice(0, 15);

        const allDeposits = depRes.rows.map(cc);
        allDeposits.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
        const recentDeposits = allDeposits.slice(0, 15);

        const wdByUser = {}, wdCountByUser = {};
        wdRes.rows.forEach(d => {
            if (d.status !== 'completed') return;
            if (!d.uid) return;
            wdByUser[d.uid] = (wdByUser[d.uid] || 0) + (d.amount || 0);
            wdCountByUser[d.uid] = (wdCountByUser[d.uid] || 0) + 1;
        });
        const topWithdrawers = Object.entries(wdByUser)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([uid, amount]) => ({ uid, name: nameMap[uid] || 'Unknown', amount, count: wdCountByUser[uid] || 0 }));

        res.json({
            totalUsers, usersWithPackage, usersWithoutPackage,
            totalDeposits, totalWithdrawals, pendingWithdrawals, completedWithdrawals,
            totalRewards, totalBonuses, totalPackageSales, packageCount, totalClaims,
            rankCounts, topDepositors, users,
            pendingWithdrawalsList, packageBreakdown,
            todayDeposits, todayWithdrawals, todayRewards, todayRegistrations,
            recentRewards, recentDeposits, topWithdrawers
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Notifications
router.post('/admin/notifications/send', async (req, res) => {
    try {
        const { userId, title, message, type, link } = req.body;
        await pg.query(
            `INSERT INTO notifications (user_id, title, message, type, link, read, created_at)
             VALUES ($1, $2, $3, $4, $5, false, $6)`,
            [userId || 'all', title, message, type || 'update', link || '', Date.now()]
        );
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Package Commission
router.post('/commissions/process-package', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });

        const user = await pg.get('users', uid);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!user.referred_by) return res.json({ success: true, commissions: [] });

        const levels = [
            { level: 1, pct: 0.10 },
            { level: 2, pct: 0.05 },
            { level: 3, pct: 0.03 },
        ];

        let currentRefCode = user.referred_by;
        const results = [];
        for (const lv of levels) {
            if (!currentRefCode) break;
            const refRows = await pg.findWhere('users', { referral_code: currentRefCode });
            if (!refRows.length) break;

            const refUid = refRows[0].uid;
            const refData = refRows[0];

            // Update teamBiz
            await pg.increment('users', refUid, 'team_biz', user.total_package_spend || 0);

            if (!refData.active_package || refData.active_package === 'none' || refData.package_status === 'expired') {
                currentRefCode = refData.referred_by;
                continue;
            }

            const pkgAmount = user.package_amount || 0;
            const commission = pkgAmount * lv.pct;
            const used = refData.package_usage || 0;
            const cap = refData.package_cap || 999999;
            const available = Math.max(0, cap - used);
            const capped = Math.min(commission, available);

            if (capped > 0) {
                const newUsed = used + capped;
                const updates = {
                    commission_balance: capped,
                    package_usage: capped,
                    total_commissions: capped,
                };
                await pg.incrementMulti('users', refUid, updates);
                if (newUsed >= cap) {
                    await pg.query(`UPDATE users SET package_status = 'expired' WHERE uid = $1`, [refUid]);
                }
                await pg.query(
                    `INSERT INTO commissions (from_uid, uid, amount, level, type, package_name, from_name, created_at)
                     VALUES ($1, $2, $3, $4, 'package_commission', $5, $6, $7)`,
                    [uid, refUid, capped, lv.level, user.active_package || 'Package', user.name || 'User', Date.now()]
                );
                results.push({ level: lv.level, uid: refUid, amount: capped });
            }

            currentRefCode = refData.referred_by;
        }

        res.json({ success: true, commissions: results });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Leg stats
router.get('/referrals/leg-stats/:uid', async (req, res) => {
    try {
        const user = await pg.get('users', req.params.uid);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const refCode = user.referral_code;
        if (!refCode) return res.json({ totalDirects: 0, activeDirects: 0, legABiz: 0, legBBiz: 0, teamBiz: 0 });

        const l1Rows = await pg.findWhere('users', { referred_by: refCode });
        const totalDirects = l1Rows.length;
        const activeDirects = l1Rows.filter(u => u.active_package).length;

        const legBiz = l1Rows.map(u => Number(u.total_package_spend) || 0).sort((a, b) => b - a);
        const legABiz = legBiz.length > 0 ? legBiz[0] : 0;
        const legBBiz = legBiz.slice(1).reduce((s, x) => s + Number(x), 0);
        const teamBiz = legBiz.reduce((s, x) => s + Number(x), 0);

        res.json({ totalDirects, activeDirects, legABiz: Number(legABiz), legBBiz: Number(legBBiz), teamBiz: Number(teamBiz) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sync/create user in PostgreSQL (called from frontend when user exists in Firestore but not in PG)
router.post('/user/sync', async (req, res) => {
    try {
        const { uid, name, email, referralCode, referredBy } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        const existing = await pg.get('users', uid);
        if (existing) return res.json({ synced: false, reason: 'already_exists' });
        await pg.set('users', uid, {
            name: name || 'User',
            email: email || '',
            referral_code: (referralCode || '').toUpperCase(),
            referred_by: (referredBy || '').toUpperCase(),
            balance: 0,
            status: 'inactive',
            referrals: 0,
            ref_level1: 0,
            ref_level2: 0,
            ref_level3: 0,
            total_package_spend: 0,
            team_biz: 0,
            total_directs: 0,
            active_directs: 0,
            commission_balance: 0,
            created_at: Date.now()
        });
        res.json({ synced: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get user stats for referrals page
router.get('/user/:uid', async (req, res) => {
    try {
        const u = await pg.get('users', req.params.uid);
        if (!u) return res.status(404).json({ error: 'User not found' });

        // Dynamically compute team counts & commissions
        const refCode = u.referral_code;
        let refLevel1 = 0, refLevel2 = 0, refLevel3 = 0;
        let totalCommissions = 0;

        if (refCode) {
            // L1 direct referrals
            const l1Rows = await pg.findWhere('users', { referred_by: refCode });
            refLevel1 = l1Rows.length;

            // L2
            const l1Codes = l1Rows.map(r => r.referral_code).filter(Boolean);
            if (l1Codes.length) {
                const l2Rows = await pg.findWhereIn('users', 'referred_by', l1Codes);
                refLevel2 = l2Rows.length;
                // L3
                const l2Codes = l2Rows.map(r => r.referral_code).filter(Boolean);
                if (l2Codes.length) {
                    const l3Rows = await pg.findWhereIn('users', 'referred_by', l2Codes);
                    refLevel3 = l3Rows.length;
                }
            }

            // Total commissions
            const commRes = await pg.query('SELECT COALESCE(SUM(amount),0) AS total FROM "commissions" WHERE "uid"=$1', [req.params.uid]);
            totalCommissions = parseFloat(commRes.rows?.[0]?.total) || 0;
        }

        res.json({
            referralCode: refCode,
            refLevel1, refLevel2, refLevel3,
            totalCommissions,
            totalDirects: Number(u.total_directs) || 0,
            activeDirects: Number(u.active_directs) || 0,
            teamBiz: Number(u.team_biz) || 0,
            legABiz: Number(u.leg_a_biz) || 0,
            legBBiz: Number(u.leg_b_biz) || 0,
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Registration Commission
router.post('/register-commission', async (req, res) => {
    try {
        const { uid, referredBy } = req.body;
        if (!uid || !referredBy) return res.status(400).json({ error: 'Missing uid or referredBy' });

        // Create user in PostgreSQL
        const { name, email, referralCode } = req.body;
        await pg.set('users', uid, {
            name: name || 'User',
            email: email || '',
            referral_code: (referralCode || '').toUpperCase(),
            referred_by: referredBy.toUpperCase(),
            balance: 0,
            status: 'inactive',
            referrals: 0,
            ref_level1: 0,
            ref_level2: 0,
            ref_level3: 0,
            total_package_spend: 0,
            team_biz: 0,
            total_directs: 0,
            active_directs: 0,
            commission_balance: 0,
            created_at: Date.now()
        });

        const refRows = await pg.findWhere('users', { referral_code: referredBy.toUpperCase() });
        if (!refRows.length) return res.status(400).json({ error: 'Invalid referral code' });

        const newUserRow = await pg.get('users', uid);
        const newUserName = newUserRow ? newUserRow.name : 'User';

        const l1Data = refRows[0];
        const l1Uid = l1Data.uid;

        // L1 bonus
        await pg.incrementMulti('users', l1Uid, { balance: 0.25, referrals: 1, ref_level1: 1, total_directs: 1 });
        await pg.query(
            `INSERT INTO commissions (uid, from_uid, from_name, amount, level, type, package_name, created_at)
             VALUES ($1, $2, $3, $4, 1, 'registration_bonus', 'Registration Bonus', $5)`,
            [l1Uid, uid, newUserName, 0.25, Date.now()]
        );

        // L2 bonus
        if (l1Data.referred_by) {
            const l2Rows = await pg.findWhere('users', { referral_code: l1Data.referred_by });
            if (l2Rows.length) {
                const l2Data = l2Rows[0];
                const l2Uid = l2Data.uid;
                await pg.incrementMulti('users', l2Uid, { balance: 0.10, ref_level2: 1 });
                await pg.query(
                    `INSERT INTO commissions (uid, from_uid, from_name, amount, level, type, package_name, created_at)
                     VALUES ($1, $2, $3, $4, 2, 'registration_bonus', 'Registration Bonus', $5)`,
                    [l2Uid, uid, newUserName, 0.10, Date.now()]
                );

                // L3 bonus
                if (l2Data.referred_by) {
                    const l3Rows = await pg.findWhere('users', { referral_code: l2Data.referred_by });
                    if (l3Rows.length) {
                        const l3Uid = l3Rows[0].uid;
                        await pg.incrementMulti('users', l3Uid, { balance: 0.05, ref_level3: 1 });
                        await pg.query(
                            `INSERT INTO commissions (uid, from_uid, from_name, amount, level, type, package_name, created_at)
                             VALUES ($1, $2, $3, $4, 3, 'registration_bonus', 'Registration Bonus', $5)`,
                            [l3Uid, uid, newUserName, 0.05, Date.now()]
                        );
                    }
                }
            }
        }

        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Retroactive Commission Migration
router.post('/admin/migrate-commissions', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 0;
        const fixBizOnly = req.query.fixBizOnly === 'true';
        const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
        const usersRes = await pg.query(`SELECT * FROM users`);
        const allUsers = usersRes.rows;
        let buyers = allUsers.filter(u => (u.package_amount || 0) > 0 || (u.total_package_spend || 0) > 0);
        if (cutoff > 0) buyers = buyers.filter(u => (u.package_purchased_at || 0) >= cutoff);
        let processed = 0, noReferrer = 0, noUplinePackage = 0, results = [], errors = [];

        const levels = [
            { level: 1, pct: 0.10 },
            { level: 2, pct: 0.05 },
            { level: 3, pct: 0.03 },
        ];

        for (const buyer of buyers) {
            try {
                let currentRefCode = buyer.referred_by;
                if (!currentRefCode) { noReferrer++; continue; }

                const pkgAmount = buyer.package_amount || buyer.total_package_spend || 0;
                let levelResults = [];

                for (const lv of levels) {
                    if (!currentRefCode) break;
                    const refRows = await pg.findWhere('users', { referral_code: currentRefCode });
                    if (!refRows.length) break;

                    const refUid = refRows[0].uid;
                    const refData = refRows[0];

                    currentRefCode = refData.referred_by;

                    await pg.increment('users', refUid, 'team_biz', pkgAmount);

                    if (!fixBizOnly && refData.active_package && refData.active_package !== 'none' && refData.package_status !== 'expired') {
                        const commission = pkgAmount * lv.pct;
                        const used = refData.package_usage || 0;
                        const cap = refData.package_cap || 999999;
                        const available = Math.max(0, cap - used);
                        const capped = Math.min(commission, available);
                        if (capped > 0) {
                            const newUsed = used + capped;
                            await pg.incrementMulti('users', refUid, { commission_balance: capped, package_usage: capped, total_commissions: capped });
                            if (newUsed >= cap) {
                                await pg.query(`UPDATE users SET package_status = 'expired' WHERE uid = $1`, [refUid]);
                            }
                            await pg.query(
                                `INSERT INTO commissions (from_uid, uid, amount, level, type, package_name, from_name, created_at)
                                 VALUES ($1, $2, $3, $4, 'package_commission', $5, $6, $7)`,
                                [buyer.uid, refUid, capped, lv.level, buyer.active_package || 'Package', buyer.name || 'User', Date.now()]
                            );
                            levelResults.push(`${lv.level}: $${capped.toFixed(2)} to ${refData.name || refUid}`);
                        }
                    }
                }

                if (levelResults.length > 0 || fixBizOnly) {
                    results.push(`${buyer.name || buyer.uid}: ${fixBizOnly ? 'teamBiz updated' : levelResults.join(', ')}`);
                    processed++;
                } else {
                    noUplinePackage++;
                }
            } catch(e) { errors.push(`${buyer.uid}: ${e.message}`); }
        }

        res.json({ success: true, processed, noReferrer, noUplinePackage, totalBuyers: buyers.length, results: results.slice(0,50), errors: errors.length, errorDetails: errors.slice(0,10) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Reset all users' teamBiz
router.post('/admin/reset-teambiz', async (req, res) => {
    try {
        await pg.query(`UPDATE users SET team_biz = 0`);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Undo Commission Migration
router.post('/admin/undo-commissions', async (req, res) => {
    try {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const commRes = await pg.query(
            `SELECT * FROM commissions WHERE type = 'package_commission' AND created_at > $1`, [oneHourAgo]
        );
        const records = commRes.rows;

        let reverted = 0, errors = [];
        for (const rec of records) {
            try {
                const user = await pg.get('users', rec.uid);
                if (!user) continue;

                const currentUsage = user.package_usage || 0;
                if (rec.amount > 0 && currentUsage >= rec.amount) {
                    await pg.incrementMulti('users', rec.uid, {
                        balance: -rec.amount,
                        commission_balance: -rec.amount,
                        package_usage: -rec.amount,
                        total_commissions: -rec.amount,
                    });
                    if (currentUsage - rec.amount < (user.package_cap || 999999)) {
                        await pg.query(`UPDATE users SET package_status = 'active' WHERE uid = $1`, [rec.uid]);
                    }
                }
                await pg.query(`DELETE FROM commissions WHERE id = $1`, [rec.id]);
                reverted++;
            } catch(e) { errors.push(`${rec.id}: ${e.message}`); }
        }

        res.json({ success: true, reverted, errors: errors.length, errorDetails: errors.slice(0,10) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Process Commission (triggered by admin panel)
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

// Admin — Leader Management
router.post('/admin/leader/delete', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        await pg.remove('users', uid);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/leader/status', async (req, res) => {
    try {
        const { uid, status } = req.body;
        if (!uid || !status) return res.status(400).json({ error: 'Missing uid or status' });
        const valid = ['active', 'under_review', 'restricted', 'suspended'];
        if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        await pg.update('users', uid, { leader_status: status });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/leader/reset-password', async (req, res) => {
    try {
        const { uid, newPassword } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        const password = newPassword || 'onchyra123';
        const { admin } = require('../config/db');
        if (!admin) return res.status(500).json({ error: 'Auth service unavailable' });
        await admin.auth().updateUser(uid, { password });
        res.json({ success: true, message: `Password reset to: ${password}` });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/leader/notes', async (req, res) => {
    try {
        const { uid, note } = req.body;
        if (!uid || !note) return res.status(400).json({ error: 'Missing uid or note' });
        const entry = { text: note, addedBy: req.ip || 'admin', createdAt: Date.now() };
        await pg.arrayAppend('users', uid, 'admin_notes', entry);
        res.json({ success: true, entry });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/assign-promo', async (req, res) => {
    try {
        const { uid, promoPackage, promoAccount, promoCommExcluded } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        const updates = {};
        if (promoPackage !== undefined) updates.promotional_package = promoPackage;
        if (promoAccount !== undefined) updates.promotional_account = promoAccount;
        if (promoCommExcluded !== undefined) updates.promotional_comm_excluded = promoCommExcluded;
        await pg.update('users', uid, updates);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/leader/verify-toggle', async (req, res) => {
    try {
        const { uid, verified } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        await pg.update('users', uid, { verified_leader: !!verified });
        res.json({ success: true, verified: !!verified });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sweep
router.post('/sweep/check', sweep.check);
router.post('/sweep/execute', sweep.sweep);
router.post('/sweep/auto', sweep.autoSweep);
router.post('/sweep/fund-gas', sweep.fundGas);
router.get('/sweep/status', sweep.status);

module.exports = router;
