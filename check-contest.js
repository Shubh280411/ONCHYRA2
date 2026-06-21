const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.join(__dirname, 'backend', 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
  const snap = await db.collection('contests').get();
  snap.forEach(d => {
    const data = d.data();
    console.log('Contest:', d.id);
    console.log('  Name:', data.name);
    console.log('  Active:', data.active);
    console.log('  Prizes:', JSON.stringify(data.prizes));
    console.log('  EndTime:', data.endTime);
    console.log('');
  });
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
