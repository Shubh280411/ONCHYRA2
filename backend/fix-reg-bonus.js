/**
 * Fix existing users' registration bonus: remove USDT (commissionBalance) part, keep ONC (balance)
 * Run: node backend/fix-reg-bonus.js
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
let serviceAccount;
try {
    serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
} catch(e) {
    console.error('Service account key not found at', keyPath);
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
    // Find all registration_bonus commission records
    const snap = await db.collection('commissions')
        .where('type', '==', 'registration_bonus')
        .get();

    console.log(`Found ${snap.docs.length} registration bonus records.`);

    // Group by uid (the receiver)
    const deductions = {};
    for (const d of snap.docs) {
        const c = d.data();
        const uid = c.uid;
        deductions[uid] = (deductions[uid] || 0) + (c.amount || 0);
    }

    console.log(`\nUsers to fix: ${Object.keys(deductions).length}`);
    
    let batch = db.batch();
    let count = 0, totalFixed = 0;

    for (const [uid, totalAmt] of Object.entries(deductions)) {
        const userRef = db.doc(`users/${uid}`);
        batch.update(userRef, {
            commissionBalance: admin.firestore.FieldValue.increment(-totalAmt),
        });
        count++;
        totalFixed += totalAmt;

        if (count % 400 === 0) {
            await batch.commit();
            batch = db.batch();
            console.log(`  Fixed ${count} users...`);
        }
    }

    if (count % 400 !== 0) await batch.commit();

    // Also delete all registration_bonus commission records from history
    console.log(`\nDeleting ${snap.docs.length} registration_bonus commission records...`);
    let delBatch = db.batch();
    let delCount = 0;
    for (const d of snap.docs) {
        delBatch.delete(d.ref);
        delCount++;
        if (delCount % 400 === 0) {
            await delBatch.commit();
            delBatch = db.batch();
            console.log(`  Deleted ${delCount} records...`);
        }
    }
    if (delCount % 400 !== 0) await delBatch.commit();

    console.log(`\n✅ Done! Fixed ${count} users USDT + deleted ${delCount} history records.`);
    console.log('ONC balance (balance field) was NOT touched — kept as-is.');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
