const express = require('express');
const router = express.Router();
const multer = require('multer');
const pg = require('../config/pg');
const { sendCustomBulk, sendManual, sendCsv, previewEmail, campaignStream, dailyStats } = require('../controllers/emailController');

const upload = multer({ storage: multer.memoryStorage() });

async function requireAdmin(req, res, next) {
    try {
        const uid = req.headers['x-auth-uid'];
        if (!uid) return res.status(401).json({ error: 'No uid' });
        const admin = await pg.get('admins', uid);
        if (!admin) return res.status(403).json({ error: 'Not admin' });
        next();
    } catch(e) { res.status(500).json({ error: e.message }); }
}

router.post('/send-custom-bulk', requireAdmin, sendCustomBulk);
router.post('/send-manual', requireAdmin, sendManual);
router.post('/send-csv', requireAdmin, upload.single('csv'), sendCsv);
router.post('/preview-email', requireAdmin, previewEmail);
router.get('/campaign-stream', campaignStream);
router.get('/daily-stats', requireAdmin, dailyStats);

module.exports = router;
