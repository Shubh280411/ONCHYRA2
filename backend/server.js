require('dotenv').config();
const express = require('express');
const cors = require('cors');
const initializeFirebase = require('./config/db');

// Initialize Firebase before importing controllers that use it
initializeFirebase();

const adminRoutes = require('./routes/adminRoutes');
const apiRoutes = require('./routes/apiRoutes');
const rewardScheduler = require('./services/rewardScheduler');

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

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Start background blockchain monitor for auto-deposit detection + sweep
    const monitor = require('./services/blockchainMonitor');
    monitor.start();
    rewardScheduler.start();
});
