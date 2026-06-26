// Compare notification counts in Render PG vs Supabase REST
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { Pool } = require('pg');

(async () => {
  // 1. Render PG
  try {
    const url = process.env.DATABASE_URL;
    const p = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
    const r = await p.query('SELECT COUNT(*) FROM notifications');
    console.log('[Render PG] notifications count:', r.rows[0].count);
    const s = await p.query('SELECT id, user_id, title, read_by, delete_at, created_at FROM notifications ORDER BY created_at DESC LIMIT 10');
    console.log('[Render PG] sample:', JSON.stringify(s.rows, null, 2));
    await p.end();
  } catch (e) { console.error('[Render PG] ERR:', e.message); }

  // 2. Supabase REST
  try {
    const SUPA = 'https://kxndpctzygcitgxundnj.supabase.co';
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bmRwY3R6eWdjaXRneHVuZG5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDMzMDIsImV4cCI6MjA5NzcxOTMwMn0.NUXX9_HNpELPYwpqOqOauzuTBJK_C5sBhINtMGvU8f8';
    const res = await fetch(`${SUPA}/rest/v1/notifications?select=id,user_id,title,read_by,delete_at,created_at&order=created_at.desc&limit=10`, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
    });
    const data = await res.json();
    console.log('[Supabase] notifications sample count:', Array.isArray(data) ? data.length : 'N/A', '(HTTP', res.status + ')');
    console.log('[Supabase] sample:', JSON.stringify(data, null, 2));

    const head = await fetch(`${SUPA}/rest/v1/notifications?select=id&limit=1000`, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
    });
    const headData = await head.json();
    console.log('[Supabase] total (fetched up to 1000):', Array.isArray(headData) ? headData.length : 'N/A');
  } catch (e) { console.error('[Supabase] ERR:', e.message); }
})();
