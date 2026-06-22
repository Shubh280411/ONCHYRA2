const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres' });
client.connect().then(async () => {
  const r = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position");
  console.log('users columns:');
  r.rows.forEach(c => console.log('  ' + c.column_name + ' (' + c.data_type + ')'));
  
  // Check a sample user
  const u = await client.query("SELECT * FROM users LIMIT 1");
  console.log('\nSample user keys:', Object.keys(u.rows[0]).join(', '));
  
  await client.end();
}).catch(e => console.error(e));
