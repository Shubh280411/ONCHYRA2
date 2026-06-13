/**
 * Perfect teamBiz fix: reset ALL users' teamBiz to 0, then re-calculate
 * from every user's upline chain (L1/L2/L3).
 * 
 * Run: node backend/fix-teambiz-perfect.js
 * 
 * Unlike fix-teambiz.js which only processes buyers, this processes
 * ALL users so no one is missed. teamBiz = sum of all L1+L2+L3
 * downline members' totalPackageSpend in memory (minimal reads).
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
    console.log('Fetching all users...');
    const usersSnap = await db.collection('users').get();
    const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log('Total users:', allUsers.length);

    // Build in-memory lookup maps
    const userMap = {};  // id -> user
    const codeMap = {};  // referralCode -> user
    for (const u of allUsers) {
        userMap[u.id] = u;
        if (u.referralCode) codeMap[u.referralCode] = u;
    }

    // Step 1: Reset ALL users' teamBiz to 0
    console.log('\nResetting teamBiz to 0 for all users...');
    let batch = db.batch();
    let count = 0;
    for (const d of usersSnap.docs) {
        batch.update(d.ref, { teamBiz: 0 });
        count++;
        if (count % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (count % 400 !== 0) await batch.commit();
    console.log('Reset complete for', count, 'users');

    // Step 2: For each user, walk up their referral chain and add their totalPackageSpend
    console.log('\nRecalculating teamBiz for all upline levels...');
    let processed = 0, teamBizUpdates = 0;

    // First, collect all pending updates per user
    const pendingUpdates = {}; // uid -> amount to add

    for (const u of allUsers) {
        const amount = u.totalPackageSpend || u.packageAmount || 0;
        if (amount <= 0) { processed++; continue; }

        let refCode = u.referredBy;
        let levels = 0;
        while (refCode && levels < 3) {
            const upline = codeMap[refCode];
            if (!upline) break;
            pendingUpdates[upline.id] = (pendingUpdates[upline.id] || 0) + amount;
            refCode = upline.referredBy;
            levels++;
            teamBizUpdates++;
        }
        processed++;
        if (processed % 100 === 0) console.log(`  ${processed}/${allUsers.length} users processed...`);
    }
    console.log('Total teamBiz updates needed:', teamBizUpdates);

    // Step 3: Apply pending updates via batch writes
    console.log('\nApplying teamBiz updates...');
    batch = db.batch();
    let applied = 0;
    for (const [uid, amount] of Object.entries(pendingUpdates)) {
        batch.update(db.doc(`users/${uid}`), {
            teamBiz: admin.firestore.FieldValue.increment(amount)
        });
        applied++;
        if (applied % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (applied % 400 !== 0) await batch.commit();
    console.log(`Applied ${applied} updates successfully.`);

    // Summary
    const totalBizAll = Object.entries(pendingUpdates).reduce((s, [, v]) => s + v, 0);
    console.log(`\n✅ Done!`);
    console.log(`  Users processed: ${processed}`);
    console.log(`  teamBiz updates: ${teamBizUpdates}`);
    console.log(`  Users who received biz: ${applied}`);
    console.log(`  Total business tracked: $${totalBizAll.toFixed(2)}`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
