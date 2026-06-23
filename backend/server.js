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

// POL price endpoint (server-side fetch avoids CORS)
let polPriceCache = { price: 0, time: 0 };
const POL_PRICE_SOURCES = [
    'https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT',
    'https://api.binance.com/api/v3/ticker/price?symbol=MATICUSDT',
];
async function fetchPolPrice() {
    const https = require('https');
    for (const url of POL_PRICE_SOURCES) {
        try {
            const data = await new Promise((resolve, reject) => {
                const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
                    let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d));
                });
                req.on('error', (e) => { console.error('[PRICE] Request error:', e.message); reject(e); });
                req.setTimeout(5000, () => { req.destroy(); console.error('[PRICE] Timeout for', url); reject(new Error('timeout')); });
            });
            const p = parseFloat(JSON.parse(data).price);
            console.log('[PRICE] Got from', url, '->', p);
            if (p && p > 0.01) return p;
        } catch(e) { console.error('[PRICE] Failed', url, e.message); }
    }
    return polPriceCache.price || 0.5;
}
app.get('/api/pol-price', async (req, res) => {
    try {
        if (Date.now() - polPriceCache.time > 60000) {
            polPriceCache.price = await fetchPolPrice();
            polPriceCache.time = Date.now();
        }
        res.json({ price: polPriceCache.price || 0.5 });
    } catch {
        res.json({ price: polPriceCache.price || 0.5 });
    }
});

rewardScheduler.start();
blockchainMonitor.start();
storageManager.start();

app.listen(PORT, () => {
    console.log(`ONCHYRA API on port ${PORT}`);
});
