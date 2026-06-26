// Simulate exactly what dashboard.html does: arrayUnion read + deleteAt set, via the SAME path (Supabase REST),
// then read back to see if read_by got the uid.
const path = require('path');
const SUPA = 'https://kxndpctzygcitgxundnj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bmRwY3R6eWdjaXRneHVuZG5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDMzMDIsImV4cCI6MjA5NzcxOTMwMn0.NUXX9_HNpELPYwpqOqOauzuTBJK_C5sBhINtMGvU8f8';

const TEST_UID = 'TEST_READ_USER_123';
const TEST_ID = 'test_notif_read_' + Date.now();

async function main() {
  // 1. Create a test notification (mimics p2p addDoc)
  const createRes = await fetch(`${SUPA}/rest/v1/notifications`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      id: TEST_ID,
      user_id: TEST_UID,
      title: 'Read Test',
      message: 'Testing mark-as-read',
      type: 'transaction',
      link: '',
      read_by: [],
      created_at: Date.now()
    })
  });
  console.log('[1] create:', createRes.status);
  if (!createRes.ok) { console.log(await createRes.text()); return; }

  // 2. Read back current read_by
  const before = await fetch(`${SUPA}/rest/v1/notifications?select=read_by&id=eq.${TEST_ID}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }).then(r => r.json());
  console.log('[2] read_by BEFORE:', JSON.stringify(before));

  // 3. Mimic adapter updateDoc for arrayUnion: GET current array, push uid if absent, PATCH back
  const cur = await fetch(`${SUPA}/rest/v1/notifications?select=read_by&id=eq.${TEST_ID}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }).then(r => r.json());
  let arr = (cur[0] && cur[0].read_by) || [];
  if (!Array.isArray(arr)) arr = [];
  if (!arr.includes(TEST_UID)) arr.push(TEST_UID);
  const patchRes = await fetch(`${SUPA}/rest/v1/notifications?id=eq.${TEST_ID}`, {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ read_by: arr, delete_at: Date.now() + 60000 })
  });
  console.log('[3] patch status:', patchRes.status);

  // 4. Read back after
  const after = await fetch(`${SUPA}/rest/v1/notifications?select=read_by,delete_at&id=eq.${TEST_ID}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }).then(r => r.json());
  console.log('[4] read_by AFTER:', JSON.stringify(after));

  // 5. Cleanup
  const delRes = await fetch(`${SUPA}/rest/v1/notifications?id=eq.${TEST_ID}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  console.log('[5] cleanup delete:', delRes.status);
}
main().catch(e => console.error('ERR', e.message));
