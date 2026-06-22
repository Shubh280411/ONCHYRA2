// Script to enable maintenance mode on the live site
const admin = require('firebase-admin');
const path = require('path');
const keyPath = path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || './serviceAccountKey.json');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const serviceAccount = require(keyPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  await db.doc('settings/maintenance').set({
    enabled: true,
    message: '🚧 ONCHYRA is currently undergoing scheduled maintenance to upgrade to a faster & more secure system. We will be back by 4 AM IST. Thank you for your patience! 🙏',
    countdown: new Date('2026-06-23T04:00:00+05:30').getTime(),
    updatedAt: Date.now()
  }, { merge: true });
  console.log('✅ Maintenance mode ENABLED on live site');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
