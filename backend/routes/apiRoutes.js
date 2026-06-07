const express = require('express');
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
router.get('/deposit/key/:index', deposit.getWalletPrivateKey);

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

// Sweep
router.post('/sweep/check', sweep.check);
router.post('/sweep/execute', sweep.sweep);
router.post('/sweep/auto', sweep.autoSweep);
router.post('/sweep/fund-gas', sweep.fundGas);
router.get('/sweep/status', sweep.status);

module.exports = router;
