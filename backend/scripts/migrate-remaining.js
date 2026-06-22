require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function findBackupDir() {
  const base = path.resolve(__dirname, '..');
  const dirs = fs.readdirSync(base).filter(d => d.startsWith('backup-')).sort().reverse();
  return path.join(base, dirs[0]);
}
const BACKUP_DIR = findBackupDir();

const TABLES = {
  'otpStore': { table: 'otp_store', idField: 'email', idColumn: 'email', fields: { expiresAt: 'expires_at', cooldownUntil: 'cooldown_until' } },
  'otpLogs': { table: 'otp_logs', idField: '_id', idColumn: 'id', fields: {} },
  'settings': { table: 'settings', idField: '_id', idColumn: 'key', fields: {} },
  'powerdrops': { table: 'powerdrops', idField: '_id', idColumn: 'id', fields: { maxParticipants: 'max_participants', participantsCount: 'participants_count', winnersCount: 'winners_count', startTime: 'start_time' } },
  'pollLog': { table: 'poll_logs', idField: '_id', idColumn: 'id', fields: { adminEmail: 'admin_email' } },
};

function mapFields(data, mapping) {
  const row = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === '_participants') continue;
    if (key === '_id') { if (!data[mapping.idColumn]) row[mapping.idColumn] = value; continue; }
    if (key === 'timestamp') continue;
    const pgField = mapping.fields[key] || key.replace(/([A-Z])/g, '_$1').toLowerCase();
    let val = value;
    if (val && typeof val === 'object' && val._seconds !== undefined) val = new Date(val._seconds * 1000).getTime();
    else if (val && typeof val === 'object' && val.seconds !== undefined) val = new Date(val.seconds * 1000).getTime();
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) val = new Date(val).getTime();
    if (typeof val === 'boolean') val = val ? 1 : 0;
    if (typeof val === 'string' && (val === 'true' || val === 'false')) val = val === 'true' ? 1 : 0;
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) val = JSON.stringify(val);
    if (val && Array.isArray(val)) val = JSON.stringify(val);
    if (val && typeof val === 'object' && val instanceof Date) val = val.getTime();
    row[pgField] = val;
  }
  return row;
}

async function migrateTable(jsonFile, mapping) {
  const filePath = path.join(BACKUP_DIR, jsonFile + '.json');
  if (!fs.existsSync(filePath)) { console.log('  SKIP ' + jsonFile); return 0; }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) { console.log('  SKIP ' + jsonFile + ': empty'); return 0; }

  let inserted = 0, errors = 0;
  for (const doc of raw) {
    try {
      let id, value;
      if (jsonFile === 'settings') {
        // Settings: doc _id = key, all other fields = JSONB value
        id = doc._id;
        value = {};
        for (const [k, v] of Object.entries(doc)) {
          if (k === '_id') continue;
          if (v && typeof v === 'object' && v._seconds !== undefined) value[k] = new Date(v._seconds * 1000).getTime();
          else if (typeof v === 'object' && v && v.seconds !== undefined) value[k] = new Date(v.seconds * 1000).getTime();
          else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) value[k] = new Date(v).getTime();
          else value[k] = v;
        }
        await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [id, JSON.stringify(value)]);
      } else {
        const row = mapFields(doc, mapping);
        id = row[mapping.idColumn] || doc._id || doc.email;
        if (!id) continue;
        delete row[mapping.idColumn];
        const columns = Object.keys(row).filter(k => row[k] !== undefined);
        const values = columns.map(c => row[c]);
        const placeholders = values.map((_, i) => '$' + (i + 2));
        await pool.query(
          'INSERT INTO "' + mapping.table + '" ("' + mapping.idColumn + '", ' + columns.map(c => '"' + c + '"').join(', ') + ') VALUES ($1, ' + placeholders.join(', ') + ') ON CONFLICT ("' + mapping.idColumn + '") DO NOTHING',
          [id, ...values]
        );
      }
      inserted++;
    } catch (e) {
      errors++;
      if (errors <= 2) console.error('    Error: ' + e.message);
    }
  }
  console.log('  ' + jsonFile + ': ' + inserted + ' rows (' + errors + ' errors)');
  return inserted;
}

async function main() {
  console.log('Migrating remaining tables...\n');
  let total = 0;
  for (const [jsonFile, mapping] of Object.entries(TABLES)) {
    const count = await migrateTable(jsonFile, mapping);
    total += count;
  }
  console.log('\nDone! ' + total + ' total rows migrated.');
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
