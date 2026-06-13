/**
 * CLI script: Fix teamBiz for all users based on downline purchases.
 * Run: node fix-teambiz.js
 */
const admin = require('firebase-admin');
const path = require('path');

// Find service account key
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
    // 1. Reset teamBiz to 0 for all users
    console.log('Resetting teamBiz to 0 for all users...');
    const usersSnap = await db.collection('users').get();
    let batch = db.batch();
    let count = 0;
    for (const d of usersSnap.docs) {
        batch.update(d.ref, { teamBiz: 0 });
        count++;
        if (count % 400 === 0) { await batch.commit(); batch = db.batch(); console.log(`  Reset ${count} users...`); }
    }
    if (count % 400 !== 0) await batch.commit();
    console.log(`Reset ${count} users done.`);

    // 2. Find all buyers (users with packages)
    const buyers = usersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => (u.packageAmount || 0) > 0 || (u.totalPackageSpend || 0) > 0);
    console.log(`Found ${buyers.length} buyers with packages.`);

    // 3. For each buyer, walk up L1-L3 and increment teamBiz
    const levels = [1, 2, 3];
    let processed = 0, noRef = 0, skipped = 0;

    for (const buyer of buyers) {
        const pkgAmount = buyer.packageAmount || buyer.totalPackageSpend || 0;
        let currentRefCode = buyer.referredBy;
        if (!currentRefCode) { noRef++; continue; }

        for (const lvl of levels) {
            if (!currentRefCode) break;
            const refSnap = await db.collection('users').where('referralCode', '==', currentRefCode).get();
            if (refSnap.empty) break;
            const refDoc = refSnap.docs[0];
            const refUid = refDoc.id;
            const refData = refDoc.data();

            if (!refData.activePackage || refData.activePackage === 'none' || refData.packageStatus === 'expired') {
                currentRefCode = refData.referredBy;
                skipped++;
                continue;
            }

            await refDoc.ref.update({ teamBiz: admin.firestore.FieldValue.increment(pkgAmount) });
            currentRefCode = refData.referredBy;
            processed++;
        }
    }

    console.log(`\nDone!`);
    console.log(`  Updated teamBiz entries: ${processed}`);
    console.log(`  No referrer: ${noRef}`);
    console.log(`  Skipped (no package): ${skipped}`);
    console.log(`\n✅ All done! Refresh referrals page.`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
