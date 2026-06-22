const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Load service account
const keyPath = path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || './serviceAccountKey.json');
const serviceAccount = require(keyPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const BACKUP_DIR = path.join(__dirname, '..', 'backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const COLLECTIONS = [
  'users', 'admins', 'withdrawals', 'deposits', 'depositWallets',
  'packagePurchases', 'commissions', 'achievementBonuses', 'leadershipRewards',
  'transfers', 'allTransfers', 'claims', 'notifications',
  'polls', 'pollLog', 'user_votes', 'updates', 'admin_transactions',
  'auditLogs', 'predictions', 'prediction_bets',
  'contests', 'contestParticipants',
  'settings', 'otps', 'otpStore', 'otpLogs',
  'powerdrops'
];

async function exportCollection(name) {
  const snap = await db.collection(name).get();
  if (snap.empty) {
    fs.writeFileSync(path.join(BACKUP_DIR, name + '.json'), '[]');
    console.log(`  ${name}: 0 docs`);
    return [];
  }
  const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  // Handle nested subcollections
  if (name === 'powerdrops') {
    for (const doc of docs) {
      const subSnap = await db.collection('powerdrops').doc(doc._id).collection('participants').get();
      if (!subSnap.empty) {
        doc._participants = subSnap.docs.map(sd => ({ _id: sd.id, ...sd.data() }));
      }
    }
  }
  fs.writeFileSync(path.join(BACKUP_DIR, name + '.json'), JSON.stringify(docs, (key, value) => {
    if (value && typeof value === 'object' && value.toDate) return value.toDate().toISOString();
    if (value && typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000).toISOString();
    return value;
  }, 2));
  console.log(`  ${name}: ${docs.length} docs`);
  return docs;
}

async function main() {
  console.log(`\nBacking up Firestore to: ${BACKUP_DIR}\n`);
  const stats = { total: 0 };
  for (const name of COLLECTIONS) {
    try {
      const docs = await exportCollection(name);
      stats.total += docs.length;
      stats[name] = docs.length;
    } catch (e) {
      console.log(`  ${name}: ERROR - ${e.message}`);
      fs.writeFileSync(path.join(BACKUP_DIR, name + '.json'), JSON.stringify({ error: e.message }));
    }
  }
  // Write stats
  fs.writeFileSync(path.join(BACKUP_DIR, '_stats.json'), JSON.stringify(stats, null, 2));
  console.log(`\nDone! Total docs: ${stats.total}`);
  console.log(`Backup folder: ${BACKUP_DIR}\n`);
}

main().catch(console.error);
