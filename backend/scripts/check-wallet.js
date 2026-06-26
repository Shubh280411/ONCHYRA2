require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await pool.query("SELECT COUNT(*) as cnt FROM users");
    console.log('Total users (PG):', r.rows[0].cnt);
  } catch(e) { console.log('Error:', e.message); }
  pool.end();
})();
