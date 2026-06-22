const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres' });
c.connect().then(async () => {
  const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
  console.log('Tables:', r.rows.map(t => t.table_name).join(', '));
  await c.end();
}).catch(e => console.error(e));
