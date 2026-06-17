const admin = require('firebase-admin');
const otpTransporter = require('../config/otpMailer');

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;

// In-memory OTP store — no Firestore reads needed
const otpStore = new Map();
// Cleanup expired OTPs every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of otpStore) {
    if (now > entry.expiresAt) otpStore.delete(key);
  }
}, 60000);

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
    const key = email.toLowerCase();
    const now = Date.now();
    const existing = otpStore.get(key);

    // Cooldown check from memory
    if (existing && !existing.verified && now < existing.cooldownUntil) {
      const wait = Math.ceil((existing.cooldownUntil - now) / 1000);
      return res.status(429).json({ error: `Wait ${wait}s before resending` });
    }

    const otp = generateOtp();
    otpStore.set(key, {
      otp,
      email,
      createdAt: now,
      expiresAt: now + OTP_EXPIRY_MS,
      cooldownUntil: now + COOLDOWN_MS,
      verified: false,
      attempts: 0
    });

    const subject = purpose === 'withdrawal' ? 'Withdrawal Verification - ONCHYRA' : 'Email Verification - ONCHYRA';

    console.log(`[OTP] Sending to ${email} via ${otpTransporter.mailSettings.providerLabel}...`);
    await otpTransporter.sendMail({
      from: otpTransporter.mailSettings.sender,
      to: email,
      subject,
      html: getTemplate(purpose, otp)
    });
    console.log(`[OTP] Sent to ${email}`);

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (e) {
    console.error('OTP send error:', e.message, e.code);
    res.status(500).json({ error: 'Failed to send OTP', detail: e.message });
  }
};

exports.list = async (_req, res) => {
  try {
    const now = Date.now();
    const list = [];
    for (const [key, entry] of otpStore) {
      if (now > entry.expiresAt) continue;
      list.push({
        email: key,
        otp: entry.otp,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        verified: entry.verified,
        attempts: entry.attempts
      });
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.json(list.slice(0, 100));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.verify = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

  try {
    const key = email.toLowerCase();
    const entry = otpStore.get(key);

    if (!entry) {
      return res.status(400).json({ error: 'No OTP sent to this email' });
    }

    if (entry.verified) {
      return res.status(400).json({ error: 'OTP already verified' });
    }

    if (Date.now() > entry.expiresAt) {
      otpStore.delete(key);
      return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    }

    entry.attempts++;
    if (entry.otp !== otp) {
      if (entry.attempts >= 5) otpStore.delete(key);
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    entry.verified = true;

    res.json({ success: true, message: 'OTP verified' });
  } catch (e) {
    console.error('OTP verify error:', e);
    res.status(500).json({ error: 'Verification failed' });
  }
};
