const pg = require('../config/pg');

const popupHtml = `
<div style="text-align:center;padding:10px 0;">
  <div style="display:inline-block;font-size:9px;font-weight:900;color:#22c55e;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);padding:4px 14px;border-radius:20px;letter-spacing:2px;margin-bottom:16px;">LIMITED TIME OFFER</div>
  <div style="width:56px;height:56px;border-radius:50%;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
  </div>
  <div style="font-family:'Space Grotesk',sans-serif;font-size:24px;font-weight:900;background:linear-gradient(135deg,#22c55e,#10b981);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px;letter-spacing:-0.5px;">Starter Package</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:20px;line-height:1.6;">Get <span style="color:#22c55e;font-weight:800;">50% OFF</span> on the Starter Package —<br>boost your mining at half price!</div>
  <div style="margin-bottom:20px;">
    <span style="font-size:18px;color:rgba(255,255,255,0.3);text-decoration:line-through;margin-right:8px;font-weight:700;">$5.00</span>
    <span style="font-family:'Space Grotesk',sans-serif;font-size:36px;font-weight:900;color:#22c55e;">$2.50</span>
  </div>
  <a href="packages.html" style="display:block;width:100%;padding:16px;border:none;border-radius:16px;background:linear-gradient(135deg,#22c55e,#10b981);color:#000;font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:900;cursor:pointer;letter-spacing:1px;text-decoration:none;transition:0.2s;">GRAB THIS DEAL →</a>
</div>
`;

(async () => {
  try {
    // Create table if not exists
    await pg.query(`
      CREATE TABLE IF NOT EXISTS popups (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        html_content TEXT NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at BIGINT,
        expires_at BIGINT
      )
    `);
    console.log('✅ popups table ready');

    // First deactivate any existing active popup
    await pg.query(`UPDATE popups SET active = false WHERE active = true`);
    
    const id = 'popup_promo_starter_50';
    const ts = Date.now();
    const expiresAt = ts + (7 * 24 * 60 * 60 * 1000);
    
    await pg.query(
      `INSERT INTO popups (id, title, html_content, active, created_at, expires_at)
       VALUES ($1, $2, $3, true, $4, $5)
       ON CONFLICT (id) DO UPDATE SET html_content = $2, active = true, expires_at = $5`,
      [id, 'Starter Package 50% OFF', popupHtml.trim(), ts, expiresAt]
    );
    
    console.log('✅ Popup inserted! ID:', id);
    console.log('Expires:', new Date(expiresAt).toLocaleString());
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();
