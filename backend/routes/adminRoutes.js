const express = require('express');
const router = express.Router();
const pg = require('../config/pg');
const { migrateUserStatus } = require('../controllers/emailController');

async function requireAdmin(req, res, next) {
    try {
        const uid = req.headers['x-auth-uid'];
        if (!uid) return res.status(401).json({ error: 'No uid' });
        const admin = await pg.get('admins', uid);
        if (!admin) return res.status(403).json({ error: 'Not admin' });
        next();
    } catch(e) { res.status(500).json({ error: e.message }); }
}

router.post('/migrate-status', requireAdmin, migrateUserStatus);

module.exports = router;
