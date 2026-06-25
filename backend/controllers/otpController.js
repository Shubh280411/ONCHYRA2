const pg = require('../config/pg');
const otpTransporter = require('../config/otpMailer');

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;

const otpStore = new Map();
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
  if (email.includes('+')) return res.status(400).json({ error: 'Email aliases (+) are not allowed' });

  try {
    const key = email.toLowerCase();
    const now = Date.now();
    const existing = otpStore.get(key);

    if (existing && !existing.verified && now < existing.cooldownUntil) {
      const wait = Math.ceil((existing.cooldownUntil - now) / 1000);
      return res.status(429).json({ error: `Wait ${wait}s before resending` });
    }

    const otp = generateOtp();
    otpStore.set(key, {
      otp, email, purpose: purpose || 'registration',
      createdAt: now, expiresAt: now + OTP_EXPIRY_MS,
      cooldownUntil: now + COOLDOWN_MS,
      verified: false, attempts: 0
    });

    pg.query(
      `INSERT INTO otp_store (email, otp, purpose, created_at, expires_at, cooldown_until, verified, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, false, 0)
       ON CONFLICT (email) DO UPDATE SET otp = $2, purpose = $3, created_at = $4, expires_at = $5, cooldown_until = $6, verified = false, attempts = 0`,
      [key, otp, purpose || 'registration', now, now + OTP_EXPIRY_MS, now + COOLDOWN_MS]
    ).catch(e => console.warn('[OTP] PG upsert failed:', e.message));
    pg.query(
      `INSERT INTO otp_logs (id, email, purpose, event, provider, created_at)
       VALUES ('otp_' || $1 || '_' || $2, $1, $3, 'sent', $4, $5)`,
      [key, now, purpose || 'registration', otpTransporter.mailSettings.providerLabel, now]
    ).catch(e => console.warn('[OTP] PG log write failed:', e.message));

    const subject = purpose === 'withdrawal' ? 'Withdrawal Verification - ONCHYRA' : 'Email Verification - ONCHYRA';

    console.log(`[OTP] Sending to ${email} via ${otpTransporter.mailSettings.providerLabel}...`);
    try {
      await otpTransporter.sendMail({
        from: otpTransporter.mailSettings.sender,
        to: email,
        subject,
        html: getTemplate(purpose, otp)
      });
      console.log(`[OTP] Sent to ${email}`);

      pg.query(
        `INSERT INTO otp_logs (id, email, purpose, event, provider, created_at)
         VALUES ('otp_delivered_' || $1 || '_' || $2, $1, $3, 'delivered', $4, $5)`,
        [key, now, purpose || 'registration', otpTransporter.mailSettings.providerLabel, Date.now()]
      ).catch(e => console.warn('[OTP] Delivery log write failed:', e.message));

      res.json({ success: true, message: 'OTP sent to your email' });
    } catch (sendErr) {
      console.error('[OTP] Send failed:', sendErr.message);

      pg.query(
        `INSERT INTO otp_logs (id, email, purpose, event, error, provider, created_at)
         VALUES ('otp_failed_' || $1 || '_' || $2, $1, $3, 'failed', $4, $5, $6)`,
        [key, now, purpose || 'registration', sendErr.message, otpTransporter.mailSettings.providerLabel, Date.now()]
      ).catch(e => console.warn('[OTP] Failure log write failed:', e.message));

      throw sendErr;
    }
  } catch (e) {
    console.error('OTP send error:', e.message, e.code);
    res.status(500).json({ error: 'Failed to send OTP', detail: e.message });
  }
};

exports.list = async (_req, res) => {
  try {
    const now = Date.now();
    const map = new Map();

    // 1. Active OTPs from otp_store (have actual codes)
    try {
      const rows = await pg.query(`SELECT * FROM otp_store ORDER BY created_at DESC LIMIT 100`);
      for (const r of rows.rows) {
        const key = (r.email || '').toLowerCase();
        if (!map.has(key) || r.created_at > map.get(key).createdAt) {
          map.set(key, {
            email: r.email || '',
            otp: r.otp || '',
            createdAt: Number(r.created_at) || 0,
            expiresAt: Number(r.expires_at) || 0,
            verified: !!r.verified,
            attempts: Number(r.attempts) || 0,
            usedAt: null,
            event: r.verified ? 'verified' : (now > Number(r.expires_at) ? 'expired' : 'sent'),
            error: ''
          });
        }
      }
    } catch (e) {
      console.warn('[OTP] PG otp_store unavailable:', e.message);
    }

    // 2. Also add in-memory entries not in PG
    for (const [key, entry] of otpStore) {
      if (!map.has(key)) {
        map.set(key, {
          email: key,
          otp: entry.otp,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt,
          verified: entry.verified,
          attempts: entry.attempts,
          usedAt: null,
          event: entry.verified ? 'verified' : (now > entry.expiresAt ? 'expired' : 'sent'),
          error: ''
        });
      }
    }

    const list = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
    res.json(list.slice(0, 200));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function verifyOtp(email, otp) {
  const key = email.toLowerCase();
  let entry = otpStore.get(key);

  if (!entry) {
    try {
      const row = await pg.get('otp_store', key, 'email');
      if (row) {
        entry = {
          otp: row.otp, email: row.email, purpose: row.purpose || 'registration',
          createdAt: row.created_at, expiresAt: row.expires_at || row.created_at + OTP_EXPIRY_MS,
          cooldownUntil: row.cooldown_until || 0, verified: row.verified || false,
          attempts: row.attempts || 0
        };
        otpStore.set(key, entry);
      }
    } catch (e) {
      console.warn('[OTP] PG restore failed:', e.message);
    }
  }

  if (!entry) {
    return { valid: false, error: 'No OTP sent to this email' };
  }

  if (entry.verified) {
    return { valid: false, error: 'OTP already verified' };
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(key);
    return { valid: false, error: 'OTP expired. Request a new one.' };
  }

  entry.attempts++;
  if (entry.otp !== otp) {
    if (entry.attempts >= 5) otpStore.delete(key);
    return { valid: false, error: 'Invalid OTP' };
  }

  entry.verified = true;
  pg.query(
    `UPDATE otp_store SET verified = true, attempts = $1 WHERE email = $2`,
    [entry.attempts, key]
  ).catch(e => console.warn('[OTP] PG verify update failed:', e.message));
  pg.query(
    `INSERT INTO otp_logs (id, email, purpose, event, created_at)
     VALUES ('otp_verified_' || $1 || '_' || $2, $1, $3, 'verified', $4)`,
    [key, Date.now(), entry.purpose || 'registration', Date.now()]
  ).catch(e => console.warn('[OTP] PG verify log write failed:', e.message));
  return { valid: true };
}

exports.verifyOtp = verifyOtp;

exports.verify = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

  const result = await verifyOtp(email, otp);
  if (result.valid) {
    return res.json({ success: true, message: 'OTP verified' });
  }
  return res.status(400).json({ error: result.error });
};
