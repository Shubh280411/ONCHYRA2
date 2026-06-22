require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const dbSize = await pool.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
  const tableSizes = await pool.query("SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC");
  const rowCounts = await pool.query("SELECT relname as table, n_live_tup as rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC");

  console.log('Database total size:', dbSize.rows[0].size);
  console.log('');
  console.log('Top tables by size:');
  tableSizes.rows.forEach(r => console.log('  ' + r.tablename + ':', r.total));
  console.log('');
  console.log('Row counts:');
  rowCounts.rows.forEach(r => console.log('  ' + r.table + ':', r.rows));
  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
