const admin = require('firebase-admin');
const transporter = require('../config/mailer');

const MAX_EMAILS_PER_CAMPAIGN = 450;
const DAILY_LIMIT = 450;
const FIRESTORE_TIMEOUT = 5000;

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms))
    ]);
}

let campaignState = { running: false, logs: [], sent: 0, failed: 0, skipped: 0, total: 0 };
let sseClients = [];

function todayStr() { return new Date().toISOString().slice(0,10); }

async function getDailyDoc(dateStr) {
    const ref = admin.firestore().doc(`emailCounts/${dateStr}`);
    const snap = await withTimeout(ref.get(), FIRESTORE_TIMEOUT);
    if (!snap.exists) {
        try {
            await withTimeout(ref.set({ count: 0, limit: DAILY_LIMIT, date: dateStr }), FIRESTORE_TIMEOUT);
        } catch (e) {
            console.log('[getDailyDoc] Failed to create doc:', e.message);
        }
        return { count: 0, limit: DAILY_LIMIT, ref };
    }
    return { count: snap.data().count || 0, limit: snap.data().limit || DAILY_LIMIT, ref };
}

async function incrementDailyCount(amount) {
    const { ref } = await getDailyDoc(todayStr());
    await withTimeout(ref.update({ count: admin.firestore.FieldValue.increment(amount) }), FIRESTORE_TIMEOUT);
}

const dailyStats = async (req, res) => {
    try {
        let today = { count: 0, limit: DAILY_LIMIT };
        try { today = await getDailyDoc(todayStr()); } catch (e) { console.log('[Stats] Firestore unavailable:', e.message); }
        const history = [];
        for (let i = 1; i <= 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const ds = d.toISOString().slice(0,10);
            try {
                const snap = await withTimeout(admin.firestore().doc(`emailCounts/${ds}`).get(), FIRESTORE_TIMEOUT);
                history.push({ date: ds, count: snap.exists ? (snap.data().count || 0) : 0, limit: snap.exists ? (snap.data().limit || DAILY_LIMIT) : DAILY_LIMIT });
            } catch (e) {
                history.push({ date: ds, count: 0, limit: DAILY_LIMIT });
            }
        }
        res.json({ today: { date: todayStr(), count: today.count, limit: today.limit, remaining: today.limit - today.count }, history });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

function broadcast(data) {
    sseClients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

function usernameReplace(html, name) {
    return html.replace(/\{\{\s*USERNAME\s*\}\}/gi, name || 'User');
}

function isOnCooldown(user) {
    if (!user.lastEmailSentAt) return false;
    const lastSent = user.lastEmailSentAt.toDate ? user.lastEmailSentAt.toDate() : new Date(user.lastEmailSentAt);
    return Date.now() - lastSent.getTime() < 24 * 60 * 60 * 1000;
}

async function runCampaign(recipients, subject, customHtml, label) {
    campaignState = { running: true, logs: [], sent: 0, failed: 0, skipped: 0, total: recipients.length };
    broadcast({ type: 'start', total: recipients.length, label });

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        const html = usernameReplace(customHtml, r.name);

        try {
            await transporter.sendMail({
                from: transporter.mailSettings.sender,
                to: r.email,
                subject,
                html
            });
            campaignState.sent++;
            campaignState.logs.push({ email: r.email, name: r.name, status: 'sent' });
            broadcast({ type: 'sent', email: r.email, name: r.name, sent: campaignState.sent, failed: campaignState.failed });
            console.log(`[SENT] ${r.email} — ${r.name}`);

            if (r.docId) {
                admin.firestore().collection('users').doc(r.docId).update({
                    lastEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
                }).catch(() => {});
            }
        } catch (err) {
            campaignState.failed++;
            campaignState.logs.push({ email: r.email, name: r.name, status: 'failed', error: err.message });
            broadcast({ type: 'failed', email: r.email, name: r.name, sent: campaignState.sent, failed: campaignState.failed, error: err.message });
            console.error(`[FAILED] ${r.email} — ${err.message}`);
        }

        if (i < recipients.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }

    campaignState.running = false;
    broadcast({ type: 'done', sent: campaignState.sent, failed: campaignState.failed, skipped: campaignState.skipped });
}

const sendCustomBulk = async (req, res) => {
    try {
        const { userType, subject, customHtml, skipCooldown } = req.body;

        if (!userType || !subject || !customHtml) {
            return res.status(400).json({ success: false, message: 'Missing required fields: userType, subject, customHtml' });
        }

        if (!['active', 'inactive', 'all'].includes(userType)) {
            return res.status(400).json({ success: false, message: 'userType must be "active", "inactive", or "all"' });
        }

        if (campaignState.running) {
            return res.status(429).json({ success: false, message: 'A campaign is already running. Wait for it to finish.' });
        }

        const { count: todayCount, limit: todayLimit } = await getDailyDoc(todayStr());
        if (todayCount >= todayLimit) {
            return res.status(429).json({ success: false, message: `Daily limit reached (${todayCount}/${todayLimit}). Try again tomorrow.` });
        }

        const snapshot = await withTimeout(admin.firestore().collection('users').get(), FIRESTORE_TIMEOUT);
        const users = snapshot.docs
            .map(d => ({ docId: d.id, ...d.data() }))
            .filter(u => {
                if (userType === 'all') return true;
                return u.status && u.status.toLowerCase() === userType.toLowerCase();
            });

        let recipients = users.map(u => ({ email: u.email, name: u.name, docId: u.docId }));

        let cooldownSkipped = 0;
        if (!skipCooldown) {
            const filtered = [];
            for (const r of recipients) {
                const userDoc = users.find(u => u.docId === r.docId);
                if (userDoc && isOnCooldown(userDoc)) {
                    cooldownSkipped++;
                    continue;
                }
                filtered.push(r);
            }
            recipients = filtered;
        }

        let safetyTrimmed = 0;
        if (recipients.length > MAX_EMAILS_PER_CAMPAIGN) {
            safetyTrimmed = recipients.length - MAX_EMAILS_PER_CAMPAIGN;
            recipients = recipients.slice(0, MAX_EMAILS_PER_CAMPAIGN);
        }

        if (!recipients.length) {
            return res.status(200).json({ success: true, message: cooldownSkipped > 0 ? `All ${cooldownSkipped} users are on cooldown (received email in last 24hrs)` : `No ${userType} users found`, sent: 0, failed: 0, skipped: cooldownSkipped });
        }

        const totalSkipped = cooldownSkipped + safetyTrimmed;
        campaignState = { running: true, logs: [], sent: 0, failed: 0, skipped: totalSkipped, total: recipients.length };
        res.json({ success: true, message: `Campaign started for ${recipients.length} users${totalSkipped > 0 ? ` (${totalSkipped} skipped — ${cooldownSkipped > 0 ? 'cooldown, ' : ''}${safetyTrimmed > 0 ? 'safety limit)' : 'cooldown)'}` : '.'}` });
        broadcast({ type: 'start', total: recipients.length, label: `Bulk — ${userType}` });

        for (let i = 0; i < recipients.length; i++) {
            const r = recipients[i];
            const html = usernameReplace(customHtml, r.name);

            try {
                await transporter.sendMail({
                    from: transporter.mailSettings.sender,
                    to: r.email,
                    subject,
                    html
                });
                campaignState.sent++;
                await incrementDailyCount(1);
                campaignState.logs.push({ email: r.email, name: r.name, status: 'sent' });
                broadcast({ type: 'sent', email: r.email, name: r.name, sent: campaignState.sent, failed: campaignState.failed });
                console.log(`[SENT] ${r.email} — ${r.name}`);

                if (r.docId) {
                    admin.firestore().collection('users').doc(r.docId).update({
                        lastEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
                    }).catch(() => {});
                }
            } catch (err) {
                campaignState.failed++;
                campaignState.logs.push({ email: r.email, name: r.name, status: 'failed', error: err.message });
                broadcast({ type: 'failed', email: r.email, name: r.name, sent: campaignState.sent, failed: campaignState.failed, error: err.message });
                console.error(`[FAILED] ${r.email} — ${err.message}`);
            }

            if (i < recipients.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }

        campaignState.running = false;
        broadcast({ type: 'done', sent: campaignState.sent, failed: campaignState.failed, skipped: campaignState.skipped });
    } catch (err) {
        campaignState.running = false;
        broadcast({ type: 'error', message: err.message });
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
};

const sendManual = async (req, res) => {
    try {
        const { emails, subject, customHtml } = req.body;

        if (!emails || !Array.isArray(emails) || !emails.length) {
            return res.status(400).json({ success: false, message: 'Provide a non-empty emails array' });
        }
        if (!subject || !customHtml) {
            return res.status(400).json({ success: false, message: 'Missing subject or customHtml' });
        }
        if (campaignState.running) {
            return res.status(429).json({ success: false, message: 'A campaign is already running. Wait for it to finish.' });
        }

        // Try to check daily limit, but proceed if Firestore is unavailable
        try {
            const { count: todayCount, limit: todayLimit } = await getDailyDoc(todayStr());
            if (todayCount >= todayLimit) {
                return res.status(429).json({ success: false, message: `Daily limit reached (${todayCount}/${todayLimit}). Try again tomorrow.` });
            }
        } catch (e) {
            console.log('[Manual] Firestore unavailable, skipping daily limit check:', e.message);
        }

        const recipients = emails.map(e => {
            if (typeof e === 'string') return { email: e, name: 'User' };
            return { email: e.email, name: e.name || 'User' };
        });

        let safetyTrimmed = 0;
        if (recipients.length > MAX_EMAILS_PER_CAMPAIGN) {
            safetyTrimmed = recipients.length - MAX_EMAILS_PER_CAMPAIGN;
            recipients = recipients.slice(0, MAX_EMAILS_PER_CAMPAIGN);
        }

        campaignState = { running: true, logs: [], sent: 0, failed: 0, skipped: safetyTrimmed, total: recipients.length };
        res.json({ success: true, message: `Manual send started for ${recipients.length} recipient(s)${safetyTrimmed > 0 ? ` (${safetyTrimmed} trimmed — safety limit)` : ''}`, total: recipients.length });
        broadcast({ type: 'start', total: recipients.length, label: 'Manual' });

        for (let i = 0; i < recipients.length; i++) {
            const r = recipients[i];
            const html = usernameReplace(customHtml, r.name);

            try {
                await transporter.sendMail({
                    from: transporter.mailSettings.sender,
                    to: r.email,
                    subject,
                    html
                });
                campaignState.sent++;
                try { await incrementDailyCount(1); } catch (e) { console.log('[Manual] daily count increment failed:', e.message); }
                campaignState.logs.push({ email: r.email, name: r.name, status: 'sent' });
                broadcast({ type: 'sent', email: r.email, name: r.name, sent: campaignState.sent, failed: campaignState.failed });
                console.log(`[SENT][MANUAL] ${r.email} — ${r.name}`);
            } catch (err) {
                campaignState.failed++;
                campaignState.logs.push({ email: r.email, name: r.name, status: 'failed', error: err.message });
                broadcast({ type: 'failed', email: r.email, name: r.name, sent: campaignState.sent, failed: campaignState.failed, error: err.message });
                console.error(`[FAILED][MANUAL] ${r.email} — ${err.message}`);
            }

            if (i < recipients.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }

        campaignState.running = false;
        broadcast({ type: 'done', sent: campaignState.sent, failed: campaignState.failed });
    } catch (err) {
        campaignState.running = false;
        broadcast({ type: 'error', message: err.message });
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
};

const sendCsv = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Upload a CSV file' });
        }

        const subject = req.body.subject;
        const customHtml = req.body.customHtml;

        if (!subject || !customHtml) {
            return res.status(400).json({ success: false, message: 'Missing subject or customHtml' });
        }
        if (campaignState.running) {
            return res.status(429).json({ success: false, message: 'A campaign is already running. Wait for it to finish.' });
        }

        // Try to check daily limit, but proceed if Firestore is unavailable
        try {
            const { count: todayCount, limit: todayLimit } = await getDailyDoc(todayStr());
            if (todayCount >= todayLimit) {
                return res.status(429).json({ success: false, message: `Daily limit reached (${todayCount}/${todayLimit}). Try again tomorrow.` });
            }
        } catch (e) {
            console.log('[CSV] Firestore unavailable, skipping daily limit check:', e.message);
        }

        const text = req.file.buffer.toString('utf-8');
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const recipients = [];

        for (const line of lines) {
            const parts = line.split(',');
            const email = parts[0].trim().toLowerCase();
            if (!email || !email.includes('@')) continue;
            recipients.push({ email, name: parts[1] ? parts[1].trim() : 'User' });
        }

        if (!recipients.length) {
            return res.status(400).json({ success: false, message: 'No valid emails found in CSV' });
        }

        let safetyTrimmed = 0;
        if (recipients.length > MAX_EMAILS_PER_CAMPAIGN) {
            safetyTrimmed = recipients.length - MAX_EMAILS_PER_CAMPAIGN;
            recipients = recipients.slice(0, MAX_EMAILS_PER_CAMPAIGN);
        }

        campaignState = { running: true, logs: [], sent: 0, failed: 0, skipped: safetyTrimmed, total: recipients.length };
        res.json({ success: true, message: `CSV campaign started for ${recipients.length} recipient(s)${safetyTrimmed > 0 ? ` (${safetyTrimmed} trimmed — safety limit)` : ''}`, total: recipients.length });
        broadcast({ type: 'start', total: recipients.length, label: 'CSV' });

        for (let i = 0; i < recipients.length; i++) {
            const r = recipients[i];
            const html = usernameReplace(customHtml, r.name);

            try {
                await transporter.sendMail({
                    from: transporter.mailSettings.sender,
                    to: r.email,
                    subject,
                    html
                });
                campaignState.sent++;
                try { await incrementDailyCount(1); } catch (e) { console.log('[CSV] daily count increment failed:', e.message); }
                campaignState.logs.push({ email: r.email, name: r.name, status: 'sent' });
                broadcast({ type: 'sent', email: r.email, name: r.name, sent: campaignState.sent, failed: campaignState.failed });
                console.log(`[SENT][CSV] ${r.email} — ${r.name}`);
            } catch (err) {
                campaignState.failed++;
                campaignState.logs.push({ email: r.email, name: r.name, status: 'failed', error: err.message });
                broadcast({ type: 'failed', email: r.email, name: r.name, sent: campaignState.sent, failed: campaignState.failed, error: err.message });
                console.error(`[FAILED][CSV] ${r.email} — ${err.message}`);
            }

            if (i < recipients.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }

        campaignState.running = false;
        broadcast({ type: 'done', sent: campaignState.sent, failed: campaignState.failed });
    } catch (err) {
        campaignState.running = false;
        broadcast({ type: 'error', message: err.message });
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
};

const previewEmail = (req, res) => {
    try {
        const { customHtml } = req.body;
        if (!customHtml) {
            return res.status(400).json({ success: false, message: 'customHtml is required' });
        }
        const html = usernameReplace(customHtml, 'John Doe');
        res.json({ success: true, html });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const campaignStream = (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const dailyDoc = admin.firestore().doc(`emailCounts/${todayStr()}`);
    withTimeout(dailyDoc.get(), FIRESTORE_TIMEOUT).then(snap => {
        const count = snap.exists ? (snap.data().count || 0) : 0;
        const dailylimit = snap.exists ? (snap.data().limit || DAILY_LIMIT) : DAILY_LIMIT;
        broadcast({ type: 'daily', count, limit: dailylimit, remaining: dailylimit - count });
    }).catch(() => {
        broadcast({ type: 'daily', count: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT });
    });

    const initData = {
        type: 'init',
        running: campaignState.running,
        sent: campaignState.sent,
        failed: campaignState.failed,
        skipped: campaignState.skipped,
        total: campaignState.total,
        logs: campaignState.logs
    };
    res.write(`data: ${JSON.stringify(initData)}\n\n`);

    sseClients.push(res);
    req.on('close', () => {
        sseClients = sseClients.filter(c => c !== res);
    });
};

const migrateUserStatus = async (req, res) => {
    try {
        const snapshot = await admin.firestore().collection('users').get();
        const batch = admin.firestore().batch();
        let count = 0;

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (!data.status) {
                batch.update(doc.ref, { status: 'active' });
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
        }

        res.json({ success: true, message: `${count} users updated with status: active` });
    } catch (err) {
        console.error('migrate error:', err);
        res.status(500).json({ success: false, message: 'Migration failed' });
    }
};

module.exports = { sendCustomBulk, sendManual, sendCsv, previewEmail, campaignStream, migrateUserStatus, dailyStats };
