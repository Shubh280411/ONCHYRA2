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
    console.log('Fetching all users...');
    const snap = await db.collection('users').get();
    let fixed = 0;
    let batch = db.batch();
    let count = 0;

    for (const d of snap.docs) {
        const u = d.data();
        const hasSpend = u.totalPackageSpend && u.totalPackageSpend > 0;
        const hasAmt = (u.packageAmount || 0) > 0;

        if (!hasSpend && hasAmt) {
            batch.update(d.ref, { totalPackageSpend: u.packageAmount });
            fixed++;
            console.log(`  Fixed ${d.id}: packageAmount=${u.packageAmount} -> totalPackageSpend=${u.packageAmount}`);
        } else if (!hasSpend && u.activePackage && u.activePackage !== 'none' && u.packageStatus === 'active') {
            // Has an active package but no totalPackageSpend — use default $5
            batch.update(d.ref, { totalPackageSpend: 5 });
            fixed++;
            console.log(`  Fixed ${d.id}: active package "${u.activePackage}" -> totalPackageSpend=5`);
        }

        count++;
        if (count % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (count % 400 !== 0) await batch.commit();

    console.log(`\nDone! ${fixed} users fixed.`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
