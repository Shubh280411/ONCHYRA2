const admin = require('firebase-admin');
const otpTransporter = require('../config/otpMailer');

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getTemplate(purpose, otp) {
    const base = `
        <div style="font-family:Arial;max-width:480px;margin:0 auto;padding:24px;background:#0b0b20;border-radius:16px;border:1px solid rgba(255,255,255,0.08);">
            <div style="text-align:center;margin-bottom:20px;">
                <img src="https://onchyra.netlify.app/logo.png" alt="ONCHYRA" style="height:40px;" />
            </div>`;

    if (purpose === 'withdrawal') {
        return base + `
            <div style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center;margin-bottom:4px;">Withdrawal Verification</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.2);text-align:center;margin-bottom:24px;">Confirm your withdrawal request</div>
            <div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#a78bfa;text-align:center;padding:20px;border:1px solid rgba(167,139,250,0.2);border-radius:12px;background:rgba(167,139,250,0.04);margin-bottom:20px;">${otp}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.3);text-align:center;">Use this code to verify your withdrawal request. It expires in <strong style="color:#a78bfa;">5 minutes</strong>.</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.15);text-align:center;margin-top:16px;">If you did not request a withdrawal, ignore this email.</div>
        </div>`;
    }

    return base + `
            <div style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center;margin-bottom:24px;">Email Verification</div>
            <div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#a78bfa;text-align:center;padding:20px;border:1px solid rgba(167,139,250,0.2);border-radius:12px;background:rgba(167,139,250,0.04);margin-bottom:20px;">${otp}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.3);text-align:center;">Use this code to verify your email. It expires in <strong style="color:#a78bfa;">5 minutes</strong>.</div>
        </div>`;
}

exports.send = async (req, res) => {
    const { email, purpose } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const db = admin.firestore();
        const existing = await db.collection('otps').where('email', '==', email).where('verified', '==', false).get();

        let latest = null;
        existing.forEach(doc => {
            const d = doc.data();
            if (!latest || d.createdAt > latest.createdAt) latest = { id: doc.id, ...d };
        });

        if (latest) {
            const elapsed = Date.now() - latest.createdAt;
            if (elapsed < COOLDOWN_MS) {
                return res.status(429).json({ error: `Wait ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s before resending` });
            }
            if (elapsed < OTP_EXPIRY_MS) {
                await db.collection('otps').doc(latest.id).delete();
            }
        }

        const otp = generateOtp();
        const docRef = await db.collection('otps').add({
            email,
            otp,
            createdAt: Date.now(),
            expiresAt: Date.now() + OTP_EXPIRY_MS,
            verified: false,
            attempts: 0
        });

        const subject = purpose === 'withdrawal' ? 'Withdrawal Verification - ONCHYRA' : 'Email Verification - ONCHYRA';

        await otpTransporter.sendMail({
            from: `"ONCHYRA Verify" <${process.env.OTP_GMAIL_USER}>`,
            to: email,
            subject,
            html: getTemplate(purpose, otp)
        });

        res.json({ success: true, message: 'OTP sent to your email' });
    } catch (e) {
        console.error('OTP send error:', e);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};

exports.verify = async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    try {
        const db = admin.firestore();
        const snap = await db.collection('otps')
            .where('email', '==', email)
            .where('verified', '==', false)
            .where('otp', '==', otp)
            .get();

        if (snap.empty) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        let matched = null;
        snap.forEach(doc => {
            const d = doc.data();
            if (!matched || d.createdAt > matched.createdAt) matched = { id: doc.id, ...d };
        });

        if (Date.now() > matched.expiresAt) {
            await db.collection('otps').doc(matched.id).delete();
            return res.status(400).json({ error: 'OTP expired. Request a new one.' });
        }

        await db.collection('otps').doc(matched.id).update({ verified: true });

        res.json({ success: true, message: 'OTP verified' });
    } catch (e) {
        console.error('OTP verify error:', e);
        res.status(500).json({ error: 'Verification failed' });
    }
};
