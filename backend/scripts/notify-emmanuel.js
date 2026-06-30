const pg = require('../config/pg');
const transporter = require('../config/mailer');

(async () => {
  try {
    const uid = 'lw2EsXgFO2hI5Rujl0m8S6zKJbZ2';
    
    const user = await pg.query('SELECT uid, name, email FROM users WHERE uid = $1', [uid]);
    const u = user.rows[0];
    console.log('Sending to:', u.name, u.email);

    // 1. Create notification in DB
    const notiId = 'noti_deposit_' + Date.now();
    await pg.query(
      `INSERT INTO notifications (id, user_id, type, title, message, read_by, created_at)
       VALUES ($1, $2, 'transaction', $3, $4, '[]', $5)`,
      [notiId, uid, 'Deposit Credited!', 
       'Your deposit of $2.60 USDT (BEP20) has been successfully credited to your account. Sorry for the inconvenience — there was a brief delay in processing. Your wallet balance is now $2.60.',
       Date.now()]
    );
    console.log('✅ Notification created');

    // 2. Send email
    const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0a0e1a;color:white;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#22c55e,#10b981);padding:30px;text-align:center;">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:900;color:#000;">ONCHYRA</div>
      </div>
      <div style="padding:30px;">
        <h2 style="color:#22c55e;font-size:20px;margin:0 0 16px;">Deposit Credited ✅</h2>
        <p style="color:rgba(255,255,255,0.7);font-size:14px;line-height:1.8;margin:0 0 20px;">
          Hi <strong style="color:white;">${u.name}</strong>,
        </p>
        <p style="color:rgba(255,255,255,0.7);font-size:14px;line-height:1.8;margin:0 0 20px;">
          Your deposit of <strong style="color:#22c55e;">$2.60 USDT</strong> (BEP20) has been successfully credited to your ONCHYRA wallet.
        </p>
        <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:16px;margin:0 0 20px;">
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Amount Credited</div>
          <div style="font-size:28px;font-weight:900;color:#22c55e;">$2.60 USDT</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:4px;">Network: BEP20</div>
        </div>
        <p style="color:rgba(255,255,255,0.5);font-size:12px;line-height:1.6;margin:0 0 20px;">
          We apologize for the inconvenience — there was a brief delay in processing your deposit. Your funds are now safe in your account.
        </p>
        <p style="color:rgba(255,255,255,0.5);font-size:12px;line-height:1.6;margin:0 0 20px;">
          If you have any questions, feel free to reach out to our support team.
        </p>
        <div style="text-align:center;margin-top:24px;">
          <a href="https://onchyra.netlify.app/dashboard.html" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#22c55e,#10b981);color:#000;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px;">Go to Dashboard →</a>
        </div>
      </div>
      <div style="padding:16px 30px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:10px;color:rgba(255,255,255,0.2);">© 2026 ONCHYRA PROTOCOL · All Rights Reserved</div>
      </div>
    </div>`;

    const info = await transporter.sendMail({
      from: '"ONCHYRA" <onchyra@gmail.com>',
      to: u.email,
      subject: 'Deposit Credited — $2.60 USDT | ONCHYRA',
      html
    });
    console.log('✅ Email sent:', info.messageId);

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
