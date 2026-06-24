require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');

// Firebase Auth init (non-blocking — pg.js handles data)
try { require('./config/db'); } catch(e) { console.warn('Firebase init skipped:', e.message); }

const adminRoutes = require('./routes/adminRoutes');
const apiRoutes = require('./routes/apiRoutes');
const rewardScheduler = require('./services/rewardScheduler');
const storageManager = require('./services/storageManager');
const blockchainMonitor = require('./services/blockchainMonitor');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

app.use((req, _res, next) => {
    console.log('INCOMING:', req.method, req.originalUrl);
    next();
});

app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.json({ status: 'ONCHYRA API running' });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: err.message });
});

// Storage stats endpoint
app.get('/api/admin/storage', async (req, res) => {
    try {
        const stats = await storageManager.getStorageStats();
        res.json(stats);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Manual cleanup trigger
app.post('/api/admin/cleanup', async (req, res) => {
    try {
        const result = await storageManager.runCleanup();
        res.json(result);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

const priceFetcher = require('./config/priceFetcher');

// POL price endpoint
app.get('/api/pol-price', async (req, res) => {
    try { res.json(await priceFetcher.getPriceCached()); }
    catch { res.json({ price: 0 }); }
});

rewardScheduler.start();
blockchainMonitor.start();
storageManager.start();

app.listen(PORT, () => {
    console.log(`ONCHYRA API on port ${PORT}`);
});
