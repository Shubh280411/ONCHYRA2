// One-off read-only check of the notifications table columns + a few sample rows
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { Pool } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const p = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const cols = await p.query(
      "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='notifications' ORDER BY ordinal_position"
    );
    console.log('--- notifications columns ---');
    cols.rows.forEach(c => console.log(`  ${c.column_name}  ${c.data_type}  ${c.column_default || ''}`));

    const cnt = await p.query('SELECT COUNT(*) FROM notifications');
    console.log('--- row count ---');
    console.log('  total:', cnt.rows[0].count);

    const sample = await p.query('SELECT id, user_id, title, read_by, delete_at, created_at FROM notifications ORDER BY created_at DESC LIMIT 5');
    console.log('--- sample rows ---');
    console.log(JSON.stringify(sample.rows, null, 2));
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await p.end();
  }
})();
