// Grant Supabase anon role access to all tables
// Run: node backend/scripts/grant-anon-access.js
const { Client } = require('pg');

const DATABASE_URL = "postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres";

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('Connected to PostgreSQL');

  // Grant schema usage
  await client.query('GRANT USAGE ON SCHEMA public TO anon;');
  console.log('✓ Granted USAGE on schema public TO anon');

  // Grant all on all tables
  await client.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;');
  console.log('✓ Granted ALL on all tables TO anon');

  // Grant all on all sequences
  await client.query('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;');
  console.log('✓ Granted ALL on all sequences TO anon');

  // Also grant to the authenticated role
  await client.query('GRANT USAGE ON SCHEMA public TO authenticated;');
  await client.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;');
  await client.query('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;');
  console.log('✓ Also granted to authenticated role');

  // Disable RLS on all tables (quickest fix for dev)
  const tables = await client.query(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_%'
  `);
  
  for (const row of tables.rows) {
    await client.query(`ALTER TABLE "${row.tablename}" DISABLE ROW LEVEL SECURITY;`);
    console.log(`  DISABLE RLS on ${row.tablename}`);
  }

  await client.end();
  console.log('\nDone! All permissions granted.');
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
