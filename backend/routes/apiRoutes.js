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
const popup = require('../controllers/popupController');
const refCache = require('../services/referralCache');
const transporter = require('../config/mailer');

async function requireAdmin(req, res, next) {
    try {
        const uid = req.headers['x-auth-uid'];
        if (!uid) return res.status(401).json({ error: 'No uid' });
        const admin = await pg.get('admins', uid);
        if (!admin) return res.status(403).json({ error: 'Not admin' });
        next();
    } catch(e) { res.status(500).json({ error: e.message }); }
}

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
router.post('/maintenance/toggle', requireAdmin, maintenance.toggle);

// Deposits
router.post('/deposit/create-wallet', deposit.createWallet);
router.post('/deposit/verify', deposit.verifyDeposit);
router.get('/deposits', deposit.getDeposits);
router.get('/deposits/:uid', deposit.userDeposits);
router.get('/deposit/wallets/:uid', deposit.userWallets);
router.post('/deposit/manual', async (req, res) => {
    try {
        const { uid, address, amount, network, token, polAmount, polPrice, usdAmount, fixDepositId } = req.body;
        if (!uid || !address || !network) return res.status(400).json({ error: 'Missing fields' });
        const ts = Date.now();
        const polAmt = Number(polAmount) || 0;
        const usdAmt = Number(usdAmount) || Number(amount) || 0;
        const pPrice = Number(polPrice) || 0;
        const tok = token || (network === 'Polygon' ? 'POL' : 'USDT');
        
        if (fixDepositId) {
            const old = await pg.query("SELECT amount FROM deposits WHERE id=$1", [fixDepositId]);
            if (!old.rows.length) return res.status(404).json({ error: 'Deposit not found' });
            const oldAmt = parseFloat(old.rows[0].amount) || 0;
            await pg.query("UPDATE deposits SET amount=$1, pol_price=$2 WHERE id=$3", [usdAmt.toFixed(2), pPrice, fixDepositId]);
            const diff = usdAmt - oldAmt;
            if (diff !== 0) await pg.query("UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE uid = $2", [diff.toFixed(2), uid]);
            console.log(`[MANUAL FIX] ${fixDepositId}: $${oldAmt} → $${usdAmt}, balance adj: ${diff.toFixed(2)}`);
            return res.json({ success: true, fixed: fixDepositId, oldAmount: oldAmt, newAmount: usdAmt, balanceAdjustment: diff });
        }
        
        const depId = 'dep_manual_' + uid.slice(0, 8) + '_' + ts;
        const tx = 'manual_' + ts;
        await pg.query(
            `INSERT INTO deposits (id, uid, address, network, amount, tx_hash, status, token, pol_amount, pol_price, detected_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, $10)`,
            [depId, uid, address, network, usdAmt.toFixed(2), tx, tok, polAmt, pPrice, ts]
        );
        await pg.query(`UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE uid = $2`,
            [usdAmt.toFixed(2), uid]);
        console.log(`[MANUAL DEPOSIT] ${polAmt||usdAmt} ${tok} for ${uid}`);
        res.json({ success: true, depositId: depId });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete a deposit (admin/manual cleanup)
router.post('/deposit/delete', async (req, res) => {
    try {
        const { depositId, uid } = req.body;
        if (!depositId || !uid) return res.status(400).json({ error: 'Missing depositId or uid' });
        const dep = await pg.query("SELECT amount FROM deposits WHERE id=$1 AND uid=$2", [depositId, uid]);
        if (!dep.rows.length) return res.status(404).json({ error: 'Deposit not found' });
        const amt = parseFloat(dep.rows[0].amount) || 0;
        // Reverse the balance effect
        if (amt !== 0) await pg.query("UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) - $1 WHERE uid = $2", [amt.toFixed(2), uid]);
        await pg.query("DELETE FROM deposits WHERE id=$1", [depositId]);
        console.log(`[MANUAL DELETE] ${depositId}: reversed $${amt} from ${uid}`);
        res.json({ success: true, deleted: depositId, reversedAmount: amt });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Packages
router.get('/packages', packages.list);
router.post('/packages/purchase', packages.purchase);
router.get('/packages/user/:uid', packages.userPackage);
router.get('/packages/cap/:uid', packages.checkCap);
router.get('/packages/starter-promo/:uid', packages.starterPromoStatus);
router.post('/admin/package/activate', requireAdmin, packages.adminActivate);
router.post('/admin/package/expire', requireAdmin, packages.adminExpire);
router.post('/admin/package/upgrade', requireAdmin, packages.adminUpgrade);
router.post('/admin/starter-promo/toggle', requireAdmin, packages.adminToggleStarterPromo);

// Transfers
router.post('/transfer/send', transfer.send);
router.get('/admin/transfers', requireAdmin, transfer.adminGetAll);

// Withdrawals
router.post('/withdraw/request', withdraw.request);
router.post('/withdraw/approve', withdraw.approve);
router.post('/withdraw/reject', withdraw.reject);
router.get('/admin/withdrawals', requireAdmin, withdraw.adminGetAll);
router.get('/withdrawals/:uid', withdraw.userHistory);

// Leadership
router.get('/leadership/ranks', leadership.ranks);
router.get('/leadership/calculate/:uid', leadership.calculateRank);
router.get('/leadership/progress/:uid', leadership.userRankProgress);
router.get('/leadership/matching-bonus/:uid', leadership.getMatchingBonus);
router.post('/leadership/distribute-rewards', leadership.distributeDailyRewards);
router.post('/admin/leadership/recalc-all', requireAdmin, leadership.adminRecalcAllRanks);

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
            uid: u.uid, name: u.name, email: u.email, referralCode: u.referral_code,
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
router.get('/admin/users', requireAdmin, async (req, res) => {
    try {
        const maxLimit = Math.min(parseInt(req.query.limit) || 500, 500);
        const rows = await pg.query(`SELECT * FROM users LIMIT $1`, [maxLimit]);
        res.json(rows.rows.map(cc));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/leaders', requireAdmin, async (req, res) => {
    try {
        const rankNames = ['Ignition','Momentum','Velocity','Quantum','Fusion','Infinity','Titan','Apex','Zenith','Legacy'];
        const rows = await pg.query(`SELECT * FROM users LIMIT 500`);
        const users = rows.rows
            .map(cc)
            .filter(u => (u.rank && rankNames.includes(u.rank)) || u.verifiedLeader || u.leaderStatus);
        res.json(users);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/user/:uid', requireAdmin, async (req, res) => {
    try {
        const user = await pg.get('users', req.params.uid);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(cc(user));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/user/update', requireAdmin, async (req, res) => {
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
router.post('/admin/sync-status', requireAdmin, async (req, res) => {
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
router.get('/admin/stats', requireAdmin, async (req, res) => {
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
        const totalDeposits = depRes.rows.reduce((s, d) => s + Number(d.amount || 0), 0);
        const totalWithdrawals = wdRes.rows.reduce((s, d) => s + Number(d.amount || 0), 0);
        const pendingWithdrawals = wdRes.rows.filter(d => d.status === 'pending').length;
        const completedWithdrawals = wdRes.rows.filter(d => d.status === 'completed').length;
        const totalRewards = rewRes.rows.reduce((s, d) => s + Number(d.amount || 0), 0);
        const totalBonuses = achRes.rows.reduce((s, d) => s + Number(d.amount || 0), 0);
        const totalPackageSales = pkgRes.rows.reduce((s, d) => s + Number(d.amount || 0), 0);
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
            if (d.uid) depositByUser[d.uid] = (depositByUser[d.uid] || 0) + Number(d.amount || 0);
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
            packageSales[name].revenue += Number(d.amount || 0);
        });
        const packageBreakdown = Object.entries(packageSales).map(([name, data]) => ({ name, count: data.count, revenue: data.revenue }));

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();
        let todayDeposits = 0, todayWithdrawals = 0, todayRewards = 0, todayRegistrations = 0;
        depRes.rows.forEach(d => { if (toMs(d.created_at) >= todayMs) todayDeposits += Number(d.amount || 0); });
        wdRes.rows.forEach(d => { if (toMs(d.created_at) >= todayMs) todayWithdrawals += Number(d.amount || 0); });
        rewRes.rows.forEach(d => { if (toMs(d.created_at) >= todayMs) todayRewards += Number(d.amount || 0); });
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
            wdByUser[d.uid] = (wdByUser[d.uid] || 0) + Number(d.amount || 0);
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

// Notifications — fetch a user's notifications (user_id = uid OR 'all')
router.get('/notifications/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        // Auto-delete any expired notifications (read >1min ago, delete_at < now)
        await pg.query(`DELETE FROM notifications WHERE delete_at IS NOT NULL AND delete_at < $1`, [Date.now()]);
        const result = await pg.query(
            `SELECT * FROM notifications WHERE user_id = $1 OR user_id = 'all' ORDER BY created_at DESC LIMIT 50`,
            [uid]
        );
        res.json({ notifications: result.rows.map(cc) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Notifications — mark one as read (append uid to read_by + schedule auto-delete)
router.post('/notifications/read/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        const expiry = Date.now() + 60000;
        await pg.query(
            `UPDATE notifications SET read_by = read_by || $1::jsonb, delete_at = $2 WHERE id = $3`,
            [JSON.stringify(uid), expiry, id]
        );
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Notifications — mark all of the user's unread notifications as read
router.post('/notifications/read-all', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        const expiry = Date.now() + 60000;
        await pg.query(
            `UPDATE notifications SET read_by = read_by || $1::jsonb, delete_at = $2
             WHERE (user_id = $3 OR user_id = 'all') AND NOT read_by @> $1::jsonb`,
            [JSON.stringify(uid), expiry, uid]
        );
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Notifications — delete a single notification
router.post('/notifications/delete/:id', async (req, res) => {
    try {
        await pg.query(`DELETE FROM notifications WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Notifications (send)
router.post('/admin/notifications/send', requireAdmin, async (req, res) => {
    try {
        const { userId, title, message, type, link } = req.body;
        await pg.query(
            `INSERT INTO notifications (user_id, title, message, type, link, read_by, created_at)
             VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6)`,
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

            if (!refData.active_package || refData.active_package === 'none') {
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
                const commId = 'cpp_' + refUid + '_' + uid + '_' + lv.level;
                const existing = await pg.findWhere('commissions', { id: commId });
                if (!existing.length) {
                    await pg.incrementMulti('users', refUid, {
                        commission_balance: capped,
                        package_usage: capped,
                        total_commissions: capped,
                    });
                    await pg.query(
                        `INSERT INTO commissions (id, from_uid, uid, amount, level, type, package_name, from_name, created_at)
                         VALUES ($1, $2, $3, $4, $5, 'package_commission', $6, $7, $8)`,
                        [commId, uid, refUid, capped, lv.level, user.active_package || 'Package', user.name || 'User', Date.now()]
                    );
                    results.push({ level: lv.level, uid: refUid, amount: capped });
                }
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
            wallet_balance: 0,
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

// Sync package purchase data from Firestore to PostgreSQL (before commission processing)
router.post('/user/sync-package', async (req, res) => {
    try {
        const { uid, name, email, activePackage, packageAmount, packageBoost, packageCap, packageUsage, packageStatus, totalPackageSpend, walletBalance } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;
        if (activePackage !== undefined) updates.active_package = activePackage;
        if (packageAmount !== undefined) updates.package_amount = packageAmount;
        if (packageBoost !== undefined) updates.package_boost = packageBoost;
        if (packageCap !== undefined) updates.package_cap = packageCap;
        if (packageUsage !== undefined) updates.package_usage = packageUsage;
        if (packageStatus !== undefined) updates.package_status = packageStatus;
        if (totalPackageSpend !== undefined) updates.total_package_spend = totalPackageSpend;
        if (walletBalance !== undefined) updates.wallet_balance = walletBalance;
        updates.updated_at = Date.now();
        await pg.update('users', uid, updates);
        res.json({ synced: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Leaderboard — top 100 users by balance
router.get('/leaderboard', async (req, res) => {
    try {
        const limitVal = Math.min(parseInt(req.query.limit) || 100, 200);
        const myUid = req.query.myUid || null;

        const rows = await pg.query(
            `SELECT uid, name, referral_code, balance, ref_level1, ref_level2, ref_level3
             FROM "users" WHERE balance > 0 ORDER BY balance DESC LIMIT $1`, [limitVal]
        );

        const total = await pg.query('SELECT COUNT(*) FROM "users"');
        const totalUsers = parseInt(total.rows[0].count);

        let myRank = null;
        let myUserData = null;
        if (myUid) {
            const myRow = await pg.get('users', myUid);
            if (myRow) {
                const ahead = await pg.query(
                    'SELECT COUNT(*) FROM "users" WHERE balance > $1', [myRow.balance || 0]
                );
                myRank = parseInt(ahead.rows[0].count) + 1;
                myUserData = {
                    uid: myUid, name: myRow.name, balance: Number(myRow.balance) || 0,
                    refLevel1: Number(myRow.ref_level1) || 0,
                    refLevel2: Number(myRow.ref_level2) || 0,
                    refLevel3: Number(myRow.ref_level3) || 0,
                };
            }
        }

        const leaders = rows.rows.map((r, i) => ({
            uid: r.uid, name: r.name || 'Anonymous', rank: i + 1,
            balance: Number(r.balance) || 0,
            refLevel1: Number(r.ref_level1) || 0,
            refLevel2: Number(r.ref_level2) || 0,
            refLevel3: Number(r.ref_level3) || 0,
        }));

        res.json({ leaders, totalUsers, myRank, myUserData });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
            walletBalance: Number(u.wallet_balance) || 0,
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
            wallet_balance: 0,
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
            `INSERT INTO commissions (id, uid, from_uid, from_name, amount, level, type, package_name, created_at)
             VALUES ($1, $2, $3, $4, $5, 1, 'registration_bonus', 'Registration Bonus', $6)`,
            ['reg_' + l1Uid + '_' + uid + '_' + Date.now(), l1Uid, uid, newUserName, 0.25, Date.now()]
        );

        // L2 bonus
        if (l1Data.referred_by) {
            const l2Rows = await pg.findWhere('users', { referral_code: l1Data.referred_by });
            if (l2Rows.length) {
                const l2Data = l2Rows[0];
                const l2Uid = l2Data.uid;
                await pg.incrementMulti('users', l2Uid, { balance: 0.10, ref_level2: 1 });
                await pg.query(
                    `INSERT INTO commissions (id, uid, from_uid, from_name, amount, level, type, package_name, created_at)
                     VALUES ($1, $2, $3, $4, $5, 2, 'registration_bonus', 'Registration Bonus', $6)`,
                    ['reg_' + l2Uid + '_' + uid + '_' + Date.now(), l2Uid, uid, newUserName, 0.10, Date.now()]
                );

                // L3 bonus
                if (l2Data.referred_by) {
                    const l3Rows = await pg.findWhere('users', { referral_code: l2Data.referred_by });
                    if (l3Rows.length) {
                        const l3Uid = l3Rows[0].uid;
                        await pg.incrementMulti('users', l3Uid, { balance: 0.05, ref_level3: 1 });
                        await pg.query(
                            `INSERT INTO commissions (id, uid, from_uid, from_name, amount, level, type, package_name, created_at)
                             VALUES ($1, $2, $3, $4, $5, 3, 'registration_bonus', 'Registration Bonus', $6)`,
                            ['reg_' + l3Uid + '_' + uid + '_' + Date.now(), l3Uid, uid, newUserName, 0.05, Date.now()]
                        );
                    }
                }
            }
        }

        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Retroactive Commission Migration
router.post('/admin/migrate-commissions', requireAdmin, async (req, res) => {
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

                    if (!fixBizOnly && refData.active_package && refData.active_package !== 'none') {
                        const commission = pkgAmount * lv.pct;
                        const used = refData.package_usage || 0;
                        const cap = refData.package_cap || 999999;
                        const available = Math.max(0, cap - used);
                        const capped = Math.min(commission, available);
                        if (capped > 0) {
                            await pg.incrementMulti('users', refUid, { commission_balance: capped, package_usage: capped, total_commissions: capped });
                            await pg.query(
                                `INSERT INTO commissions (id, from_uid, uid, amount, level, type, package_name, from_name, created_at)
                                 VALUES ($1, $2, $3, $4, $5, 'package_commission', $6, $7, $8)`,
                                ['adm_' + refUid + '_' + buyer.uid + '_' + Date.now(), buyer.uid, refUid, capped, lv.level, buyer.active_package || 'Package', buyer.name || 'User', Date.now()]
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
router.post('/admin/reset-teambiz', requireAdmin, async (req, res) => {
    try {
        await pg.query(`UPDATE users SET team_biz = 0`);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Global Recalculate Referrals (recalculates ref_level1/2/3, team_biz, leg_a_biz, leg_b_biz, total_directs, active_directs)
router.post('/admin/recalculate-referrals', requireAdmin, async (req, res) => {
    try {
        const allUsersRes = await pg.query(`SELECT * FROM users`);
        const allUsers = allUsersRes.rows;
        const byRefCode = {};
        for (const u of allUsers) {
            if (u.referral_code) byRefCode[u.referral_code.toUpperCase()] = u;
        }

        let updated = 0;
        for (const u of allUsers) {
            const code = u.referral_code ? u.referral_code.toUpperCase() : null;
            if (!code) continue;

            const l1Rows = allUsers.filter(x => (x.referred_by || '').toUpperCase() === code);
            const refLevel1 = l1Rows.length;

            const l1Codes = l1Rows.map(x => (x.referral_code || '').toUpperCase()).filter(Boolean);
            const l2Rows = l1Codes.length ? allUsers.filter(x => l1Codes.includes((x.referred_by || '').toUpperCase())) : [];
            const refLevel2 = l2Rows.length;

            const l2Codes = l2Rows.map(x => (x.referral_code || '').toUpperCase()).filter(Boolean);
            const l3Rows = l2Codes.length ? allUsers.filter(x => l2Codes.includes((x.referred_by || '').toUpperCase())) : [];
            const refLevel3 = l3Rows.length;

            const totalDirects = refLevel1;
            const activeDirects = l1Rows.filter(x => x.active_package && x.active_package !== 'none').length;

            const l1Biz = l1Rows.map(x => Number(x.total_package_spend) || 0);
            const teamBiz = l1Biz.reduce((a, b) => a + b, 0);

            let legABiz = 0, legBBiz = 0;
            if (l1Biz.length > 0) {
                const sorted = [...l1Biz].sort((a, b) => b - a);
                legABiz = sorted[0];
                legBBiz = sorted.slice(1).reduce((a, b) => a + b, 0);
            }

            const needsUpdate = refLevel1 !== Number(u.ref_level1) || refLevel2 !== Number(u.ref_level2) || refLevel3 !== Number(u.ref_level3) ||
                teamBiz !== Number(u.team_biz) || legABiz !== Number(u.leg_a_biz) || legBBiz !== Number(u.leg_b_biz) ||
                totalDirects !== Number(u.total_directs) || activeDirects !== Number(u.active_directs);
            if (needsUpdate) {
                await pg.query(
                    `UPDATE users SET ref_level1=$1, ref_level2=$2, ref_level3=$3, team_biz=$4, leg_a_biz=$5, leg_b_biz=$6, total_directs=$7, active_directs=$8 WHERE uid=$9`,
                    [refLevel1, refLevel2, refLevel3, teamBiz, legABiz, legBBiz, totalDirects, activeDirects, u.uid]
                );
                updated++;
            }
        }

        const commSumRes = await pg.query(`SELECT uid, COALESCE(SUM(amount),0) AS total FROM commissions GROUP BY uid`);
        let commUpdated = 0;
        for (const row of commSumRes.rows) {
            await pg.query(`UPDATE users SET total_commissions = $1 WHERE uid = $2`, [row.total, row.uid]);
            commUpdated++;
        }

        res.json({ success: true, totalUsers: allUsers.length, updated, commSynced: commUpdated });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — Undo Commission Migration
router.post('/admin/undo-commissions', requireAdmin, async (req, res) => {
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
router.post('/admin/process-commission', requireAdmin, async (req, res) => {
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
router.post('/admin/leader/delete', requireAdmin, async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });
        await pg.remove('users', uid);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/leader/status', requireAdmin, async (req, res) => {
    try {
        const { uid, status } = req.body;
        if (!uid || !status) return res.status(400).json({ error: 'Missing uid or status' });
        const valid = ['active', 'under_review', 'restricted', 'suspended'];
        if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        await pg.update('users', uid, { leader_status: status });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/leader/reset-password', requireAdmin, async (req, res) => {
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

router.post('/admin/leader/notes', requireAdmin, async (req, res) => {
    try {
        const { uid, note } = req.body;
        if (!uid || !note) return res.status(400).json({ error: 'Missing uid or note' });
        const entry = { text: note, addedBy: req.ip || 'admin', createdAt: Date.now() };
        await pg.arrayAppend('users', uid, 'admin_notes', entry);
        res.json({ success: true, entry });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/assign-promo', requireAdmin, async (req, res) => {
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

router.post('/admin/leader/verify-toggle', requireAdmin, async (req, res) => {
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

// Email inactive users (3+ days no claim + never claimed)
router.post('/admin/email-inactive', requireAdmin, async (req, res) => {
    try {
        const { subject: customSubject, html: customHtml } = req.body;
        const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
        const result = await pg.query(
            `SELECT uid, email, name FROM users WHERE (last_claim IS NULL OR last_claim < $1) AND email IS NOT NULL AND email != ''`,
            [threeDaysAgo]
        );
        const users = result.rows;
        if (!users.length) return res.json({ success: true, sent: 0, failed: 0, total: 0, message: 'No inactive users found' });

        const subject = customSubject || '⛏️ Hey {{NAME}}, Your Mining Rewards Are Waiting!';
        const htmlTemplate = customHtml || `
<div style="font-family:Arial;max-width:520px;margin:0 auto;padding:32px;background:#0b0b20;border-radius:16px;border:1px solid rgba(255,255,255,0.08);">
  <div style="text-align:center;margin-bottom:24px;">
    <img src="https://onchyra.netlify.app/logo.png" alt="ONCHYRA" style="height:40px;" />
    <div style="font-size:11px;color:rgba(255,255,255,0.25);margin-top:4px;">Decentralised Mining Platform</div>
  </div>
  <div style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center;margin-bottom:4px;">We Miss You! ⛏️</div>
  <div style="font-size:22px;font-weight:700;color:#a78bfa;text-align:center;margin-bottom:20px;">Hey {{NAME}}!</div>
  <div style="background:rgba(167,139,250,0.06);border:1px solid rgba(167,139,250,0.15);border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:6px;">Your Daily Mining Reward</div>
    <div style="font-size:28px;font-weight:900;color:#22c55e;letter-spacing:1px;">IS WAITING</div>
  </div>
  <p style="font-size:13px;color:rgba(255,255,255,0.55);line-height:1.7;text-align:center;margin:0 0 20px;">
    You haven't mined in a while — your rewards are piling up!<br>
    Log in now to claim your daily mining, build your streak, and unlock bigger power. 🚀
  </p>
  <div style="text-align:center;margin-bottom:24px;">
    <a href="https://onchyra.netlify.app/dashboard" style="display:inline-block;background:#a78bfa;color:#000;font-weight:700;font-size:14px;padding:12px 36px;border-radius:8px;text-decoration:none;">🔥 Start Mining Now</a>
  </div>
  <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:20px 0;">
  <p style="font-size:10px;color:rgba(255,255,255,0.2);text-align:center;margin:0;">
    ONCHYRA &bull; <a href="https://onchyra.netlify.app" style="color:rgba(167,139,250,0.6);text-decoration:none;">onchyra.com</a><br>
    You received this because you registered on ONCHYRA.
  </p>
</div>`;

        let sent = 0, failed = 0;
        for (const u of users) {
            try {
                const html = htmlTemplate.replace(/\{\{NAME\}\}/g, u.name || 'Miner');
                const subj = subject.replace(/\{\{NAME\}\}/g, u.name || 'Miner');
                await transporter.sendMail({
                    from: transporter.mailSettings?.sender || '"ONCHYRA Updates" <onchyra@gmail.com>',
                    to: u.email,
                    subject: subj,
                    html
                });
                sent++;
                pg.update('users', u.uid, { last_email_sent_at: Date.now() }).catch(() => {});
            } catch (err) {
                failed++;
                console.error(`[EMAIL-INACTIVE] Failed: ${u.email} — ${err.message}`);
            }
            if (sent + failed < users.length) {
                await new Promise(r => setTimeout(r, 250));
            }
        }
        res.json({ success: true, sent, failed, total: users.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ──────────────── POPUPS ────────────────
router.get('/popups/active', popup.getActivePopup);
router.get('/admin/popup/status', requireAdmin, popup.getStatus);
router.post('/admin/popup/create', requireAdmin, popup.createPopup);
router.post('/admin/popup/update', requireAdmin, popup.updatePopup);
router.post('/admin/popup/toggle', requireAdmin, popup.togglePopup);
router.post('/admin/popup/delete', requireAdmin, popup.deletePopup);

router.get('/admin/commissions', requireAdmin, async (req, res) => {
    try {
        const rows = await pg.query(`SELECT * FROM commissions ORDER BY created_at DESC LIMIT 200`);
        res.json(rows.rows.map(r => ({
            id: r.id, fromUid: r.from_uid, uid: r.uid, amount: Number(r.amount || 0),
            level: r.level, type: r.type, packageName: r.package_name, fromName: r.from_name,
            createdAt: r.created_at
        })));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
