require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const BACKUP_DIR = path.resolve(__dirname, '..', 'backup-2026-06-22T10-34-00-135Z');

async function main() {
  const powerdrops = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'powerdrops.json')));
  let count = 0;
  for (const doc of powerdrops) {
    if (doc._participants && Array.isArray(doc._participants)) {
      for (const p of doc._participants) {
        const joinedAt = p.joinedAt && p.joinedAt._seconds ? new Date(p.joinedAt._seconds * 1000).getTime() : Date.now();
        try {
          await pool.query('INSERT INTO powerdrop_participants (event_id, id, address, joined_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [doc._id, p._id, p.address, joinedAt]);
          count++;
        } catch(e) { console.error('  Error:', e.message); }
      }
    }
  }
  console.log('Migrated ' + count + ' powerdrop participants');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
