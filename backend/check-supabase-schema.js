const {Pool}=require('pg');
(async()=>{
const s=new Pool({connectionString:'postgresql://postgres:Shubh%40280411@db.kxndpctzygcitgxundnj.supabase.co:5432/postgres',ssl:{rejectUnauthorized:false}});
// Check column names
const cols=await s.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users'");
console.log('Supabase users columns:');
cols.rows.forEach(c=>console.log(`  ${c.column_name} (${c.data_type})`));
// Check if referred_by or referredBy
const hasReferredBy=cols.rows.find(c=>c.column_name==='referred_by');
const hasReferredby=cols.rows.find(c=>c.column_name==='referredBy');
console.log('\nreferred_by:', !!hasReferredBy, 'referredBy:', !!hasReferredby);
await s.end()})();