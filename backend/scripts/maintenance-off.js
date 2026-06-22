const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const keyPath = path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || './serviceAccountKey.json');
const serviceAccount = require(keyPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  await db.doc('settings/maintenance').set({ enabled: false, updatedAt: Date.now() }, { merge: true });
  console.log('Maintenance mode OFF! Site is live again.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
