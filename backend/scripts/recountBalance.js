const admin = require('firebase-admin');
const https = require('https');

const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function fetchPolPrice() {
    try {
        const body = await httpGet('https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd');
        const parsed = JSON.parse(body);
        if (parsed && parsed['matic-network'] && parsed['matic-network'].usd) return parsed['matic-network'].usd;
    } catch (e) { }
    try {
        const body = await httpGet('https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT');
        const parsed = JSON.parse(body);
        if (parsed && parsed.price) return parseFloat(parsed.price);
    } catch (e) { }
    console.error('Could not fetch POL price');
    process.exit(1);
}

async function recount() {
    const polPrice = await fetchPolPrice();
    console.log(`Current POL price: $${polPrice}`);

    const depositsSnap = await db.collection('deposits').where('status', '==', 'completed').get();
    console.log(`Total completed deposits: ${depositsSnap.size}`);

    const userTotals = {};

    for (const d of depositsSnap.docs) {
        const dep = d.data();
        const uid = dep.uid;
        if (!uid) continue;

        let usdAmount = dep.amount || 0;

        // Fix POL deposits that had wrong price (0 or 1)
        if (dep.network === 'Polygon' && dep.polAmount) {
            const oldPrice = dep.polPrice || 0;
            if (oldPrice === 0 || oldPrice === 1) {
                usdAmount = dep.polAmount * polPrice;
                console.log(`  Fixing deposit ${d.id}: ${dep.polAmount} POL @ $${oldPrice} → $${usdAmount.toFixed(4)}`);
                await d.ref.update({ amount: usdAmount, polPrice });
            }
        }

        if (!userTotals[uid]) userTotals[uid] = 0;
        userTotals[uid] += usdAmount;
    }

    console.log(`\nUpdating ${Object.keys(userTotals).length} users...`);
    for (const [uid, total] of Object.entries(userTotals)) {
        await db.doc(`users/${uid}`).update({
            walletBalance: total,
            totalDeposits: total,
        });
        console.log(`  User ${uid}: walletBalance = $${total.toFixed(2)}`);
    }

    console.log('\nDone!');
    process.exit(0);
}

recount().catch(e => { console.error(e); process.exit(1); });
