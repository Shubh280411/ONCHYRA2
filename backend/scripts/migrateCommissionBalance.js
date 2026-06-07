/**
 * One-time script: sets commissionBalance for existing users
 * commissionBalance = totalCommissions - completed withdrawals
 */
require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function migrate() {
    const usersSnap = await db.collection('users').get();
    let updated = 0;

    for (const d of usersSnap.docs) {
        const user = d.data();
        // Skip if already has commissionBalance
        if (user.commissionBalance !== undefined) continue;

        const totalComm = user.totalCommissions || 0;

        // Sum completed withdrawals
        const wdSnap = await db.collection('withdrawals')
            .where('uid', '==', d.id)
            .get();

        let withdrawn = 0;
        wdSnap.forEach(wd => {
            const w = wd.data();
            if (w.status === 'completed' || w.status === 'approved') {
                withdrawn += w.amount || 0;
            }
        });

        const commissionBalance = Math.max(0, totalComm - withdrawn);

        if (totalComm > 0 || withdrawn > 0) {
            await d.ref.update({ commissionBalance });
            console.log(`${d.id}: totalComm=${totalComm}, withdrawn=${withdrawn}, commissionBalance=${commissionBalance}`);
            updated++;
        } else {
            await d.ref.update({ commissionBalance: 0 });
        }
    }

    console.log(`\nDone! ${updated} users updated with commissionBalance.`);
    process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
