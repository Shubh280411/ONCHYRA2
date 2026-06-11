require('dotenv').config();
const express = require('express');
const cors = require('cors');
const initializeFirebase = require('./config/db');

initializeFirebase();

const emailRoutes = require('./routes/emailRoutes');

const app = express();
const PORT = process.env.EMAIL_PORT || 5001;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.use('/api/email', emailRoutes);

app.get('/', (req, res) => {
    res.json({ status: 'ONCHYRA Email Service running' });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.listen(PORT, () => {
    console.log(`Email service running on port ${PORT}`);
});
