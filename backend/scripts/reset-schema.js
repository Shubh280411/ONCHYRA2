require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  console.log('Schema reset done');
  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
