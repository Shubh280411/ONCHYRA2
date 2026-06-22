require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const BACKUP_DIR = path.resolve(__dirname, '..', 'backup-2026-06-22T10-34-00-135Z');

function mapFields(data) {
  const row = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === '_id' || key === 'timestamp') continue;
    const pgField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    let val = value;
    if (val && typeof val === 'object' && val._seconds !== undefined) val = new Date(val._seconds * 1000).getTime();
    else if (val && typeof val === 'object' && val.seconds !== undefined) val = new Date(val.seconds * 1000).getTime();
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) val = new Date(val).getTime();
    if (typeof val === 'boolean') val = val ? 1 : 0;
    if (typeof val === 'string' && (val === 'true' || val === 'false')) val = val === 'true' ? 1 : 0;
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) val = JSON.stringify(val);
    if (val && Array.isArray(val)) val = JSON.stringify(val);
    row[pgField] = val;
  }
  return row;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'otps.json')));
  let inserted = 0, errors = 0;
  for (const doc of raw) {
    try {
      const row = mapFields(doc);
      const id = doc._id;
      const columns = Object.keys(row).filter(k => row[k] !== undefined);
      const values = columns.map(c => row[c]);
      const placeholders = values.map((_, i) => '$' + (i + 2));
      await pool.query('INSERT INTO otps (id, ' + columns.map(c => '"' + c + '"').join(', ') + ') VALUES ($1, ' + placeholders.join(', ') + ') ON CONFLICT (id) DO NOTHING', [id, ...values]);
      inserted++;
    } catch (e) { errors++; if (errors <= 3) console.error('Error: ' + e.message); }
  }
  console.log('otps: ' + inserted + ' rows (' + errors + ' errors)');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
