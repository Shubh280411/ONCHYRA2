// Simulate what the adapter does with real API response
const SUPABASE_URL = "https://kxndpctzygcitgxundnj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bmRwY3R6eWdjaXRneHVuZG5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDMzMDIsImV4cCI6MjA5NzcxOTMwMn0.NUXX9_HNpELPYwpqOqOauzuTBJK_C5sBhINtMGvU8f8";

function snakeToCamel(s) { return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }
function camelToSnake(s) { return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase()); }

function deepCamelize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(deepCamelize);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[snakeToCamel(k)] = deepCamelize(v);
  }
  return out;
}

async function test() {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/users?select=*&limit=1&order=created_at.desc', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log('Status:', r.status);
    const data = await r.json();
    console.log('Raw:', JSON.stringify(data).slice(0, 200));
    const camelized = deepCamelize(data);
    console.log('Camelized keys:', Object.keys(camelized[0]).join(', '));
    console.log('Has activePackage?', 'activePackage' in camelized[0]);
    console.log('Has referredBy?', 'referredBy' in camelized[0]);
    console.log('Has referralCode?', 'referralCode' in camelized[0]);
    console.log('Has packageStatus?', 'packageStatus' in camelized[0]);
    console.log('Has teamBiz?', 'teamBiz' in camelized[0]);
    console.log('Has balance?', 'balance' in camelized[0]);
  } catch (e) {
    console.error('Test error:', e);
  }
}
test();
