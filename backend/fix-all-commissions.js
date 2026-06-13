/**
 * One-time fix: retroactively process commissions + teamBiz for ALL existing package holders.
 * Run: node backend/fix-all-commissions.js
 * 
 * What it does:
 * - Finds all users who have ever purchased a package
 * - For each, walks up L1/L2/L3 and pays commission (ONC) + updates teamBiz
 * - Creates commission records in history
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
    const usersSnap = await db.collection('users').get();
    const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Find buyers (users with packages)
    const buyers = allUsers.filter(u => (u.packageAmount || 0) > 0 || (u.totalPackageSpend || 0) > 0);
    console.log(`Found ${buyers.length} buyers. Processing commissions + teamBiz...\n`);

    const levels = [
        { level: 1, pct: 0.10 },
        { level: 2, pct: 0.05 },
        { level: 3, pct: 0.03 },
    ];

    let processed = 0, noRef = 0, paid = 0, teamBizUpdates = 0;

    for (const buyer of buyers) {
        const pkgAmount = buyer.packageAmount || buyer.totalPackageSpend || 0;
        let currentRefCode = buyer.referredBy;
        if (!currentRefCode) { noRef++; continue; }

        for (const lv of levels) {
            if (!currentRefCode) break;
            const refSnap = await db.collection('users').where('referralCode', '==', currentRefCode).get();
            if (refSnap.empty) break;
            const refUid = refSnap.docs[0].id;
            const refData = refSnap.docs[0].data();
            currentRefCode = refData.referredBy; // always move up

            // Always update teamBiz
            await db.doc(`users/${refUid}`).update({
                teamBiz: admin.firestore.FieldValue.increment(pkgAmount),
            });
            teamBizUpdates++;

            // Pay commission only if upline has active package
            if (!refData.activePackage || refData.activePackage === 'none' || refData.packageStatus === 'expired') continue;

            const commission = pkgAmount * lv.pct;
            const used = refData.packageUsage || 0;
            const cap = refData.packageCap || Infinity;
            const available = Math.max(0, cap - used);
            const capped = Math.min(commission, available);
            if (capped <= 0) continue;

            const newUsed = used + capped;
            const updates = {
                balance: admin.firestore.FieldValue.increment(capped),
                packageUsage: admin.firestore.FieldValue.increment(capped),
                totalCommissions: admin.firestore.FieldValue.increment(capped),
            };
            if (newUsed >= cap) updates.packageStatus = 'expired';

            const batch = db.batch();
            batch.update(db.doc(`users/${refUid}`), updates);
            batch.create(db.collection('commissions').doc(), {
                fromUid: buyer.id, uid: refUid, amount: capped,
                level: lv.level, type: 'package_commission',
                packageName: buyer.activePackage || 'Package',
                fromName: buyer.name || 'User',
                createdAt: Date.now(),
                adminRetro: true,
            });
            await batch.commit();
            paid++;
        }
        processed++;
        if (processed % 5 === 0) console.log(`  ${processed}/${buyers.length} buyers processed...`);
    }

    console.log(`\n✅ Done!`);
    console.log(`  Buyers processed: ${processed}`);
    console.log(`  No referrer: ${noRef}`);
    console.log(`  teamBiz updates: ${teamBizUpdates}`);
    console.log(`  Commission payments: ${paid}`);
    console.log(`  Commission records created: ${paid}`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
