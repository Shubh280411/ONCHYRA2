// Test Supabase REST API connection
const SUPABASE_URL = "https://kxndpctzygcitgxundnj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bmRwY3R6eWdjaXRneHVuZG5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDMzMDIsImV4cCI6MjA5NzcxOTMwMn0.NUXX9_HNpELPYwpqOqOauzuTBJK_C5sBhINtMGvU8f8";

async function test() {
  // Test 1: Get user count
  console.log('Test 1: GET /users?select=count');
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/users?select=count', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      }
    });
    const d = await r.json();
    console.log('  Status:', r.status, 'Count:', JSON.stringify(d));
  } catch (e) { console.error('  FAIL:', e.message); }

  // Test 2: Get first user
  console.log('Test 2: GET /users?select=*&limit=1');
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/users?select=*&limit=1', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      }
    });
    const d = await r.json();
    console.log('  Status:', r.status, 'First user:', d.length ? d[0].email || d[0].uid : 'none');
  } catch (e) { console.error('  FAIL:', e.message); }

  // Test 3: Settings
  console.log('Test 3: GET /settings?key=eq.maintenance');
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/settings?key=eq.maintenance&select=*', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      }
    });
    const d = await r.json();
    console.log('  Status:', r.status, 'Data:', JSON.stringify(d).slice(0, 100));
  } catch (e) { console.error('  FAIL:', e.message); }
}

test();
