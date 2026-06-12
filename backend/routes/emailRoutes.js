const express = require('express');
const router = express.Router();
const multer = require('multer');
const { sendCustomBulk, sendManual, sendCsv, previewEmail, campaignStream, dailyStats } = require('../controllers/emailController');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/send-custom-bulk', sendCustomBulk);
router.post('/send-manual', sendManual);
router.post('/send-csv', upload.single('csv'), sendCsv);
router.post('/preview-email', previewEmail);
router.get('/campaign-stream', campaignStream);
router.get('/daily-stats', dailyStats);

module.exports = router;
