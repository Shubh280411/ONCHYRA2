const express = require('express');
const router = express.Router();
const { migrateUserStatus } = require('../controllers/emailController');

router.post('/migrate-status', migrateUserStatus);

module.exports = router;
