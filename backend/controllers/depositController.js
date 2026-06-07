const admin = require('firebase-admin');
const { Mnemonic, HDNodeWallet } = require('ethers');
const https = require('https');
const db = admin.firestore();

const MNEMONIC = process.env.HD_WALLET_SEED;
if (!MNEMONIC) console.error('HD_WALLET_SEED not set in .env');

let polPriceCache = { price: 0, time: 0 };

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
    } catch(e) { /* try next source */ }
    try {
        const body = await httpGet('https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT');
        const parsed = JSON.parse(body);
        if (parsed && parsed.price) return parseFloat(parsed.price);
    } catch(e) { /* try next source */ }
    try {
        const body = await httpGet('https://api.binance.com/api/v3/ticker/price?symbol=MATICUSDT');
        const parsed = JSON.parse(body);
        if (parsed && parsed.price) return parseFloat(parsed.price);
    } catch(e) { /* all sources failed */ }
    throw new Error('All price sources failed');
}

async function getPolUsdPrice() {
    if (Date.now() - polPriceCache.time < 300000) return polPriceCache.price;
    try {
        const price = await fetchPolPrice();
        polPriceCache = { price, time: Date.now() };
        return price;
    } catch(e) {
        if (polPriceCache.price > 0) return polPriceCache.price;
        console.warn('[PRICE] All POL price sources failed, using 0');
        return 0;
    }
}

let masterNode = null;

function getMasterNode() {
    if (!masterNode) {
        const mnemonic = Mnemonic.fromPhrase(MNEMONIC);
        const seed = mnemonic.computeSeed();
        masterNode = HDNodeWallet.fromSeed(seed);
    }
    return masterNode;
}

async function getNextIndex() {
    const ref = db.doc('settings/hdWalletCounter');
    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        let next = (snap.exists ? snap.data().nextIndex : 1);
        if (next < 1) next = 1; // never use index 0 (master wallet)
        tx.set(ref, { nextIndex: next + 1 }, { merge: true });
        return next;
    });
    return result;
}

exports.createWallet = async (req, res) => {
    try {
        const { uid, network } = req.body;
        if (!['BEP20', 'Polygon'].includes(network)) return res.status(400).json({ error: 'Invalid network' });

        const index = await getNextIndex();
        const path = `m/44/60/0/0/${index}`;
        const child = getMasterNode().derivePath(path);
        const address = child.address.toLowerCase();

        await db.collection('depositWallets').add({
            uid, network, address, path, index,
            used: false, createdAt: Date.now()
        });

        console.log(`[HD] Generated address ${address} for uid=${uid} network=${network} index=${index}`);
        res.json({ address, network, index });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.getWalletPrivateKey = async (req, res) => {
    try {
        const { index } = req.params;
        const path = `m/44/60/0/0/${index}`;
        const child = getMasterNode().derivePath(path);
        res.json({ index: parseInt(index), address: child.address, privateKey: child.privateKey });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.verifyDeposit = async (req, res) => {
    try {
        const { txHash, address, amount, network } = req.body;
        if (!txHash || !address || !amount || !network) return res.status(400).json({ error: 'Missing fields' });

        const walletSnap = await db.collection('depositWallets')
            .where('address', '==', address.toLowerCase()).limit(1).get();
        if (walletSnap.empty) return res.status(404).json({ error: 'Wallet not found' });

        const walletDoc = walletSnap.docs[0];
        const wallet = walletDoc.data();

        const existing = await db.collection('deposits').where('txHash', '==', txHash).limit(1).get();
        if (!existing.empty) return res.status(400).json({ error: 'Duplicate transaction' });

        const rawAmount = parseFloat(amount);
        let usdAmount = rawAmount;
        let polPrice = 0;
        if (network === 'Polygon') {
            polPrice = await getPolUsdPrice();
            usdAmount = rawAmount * (polPrice || 0);
        }

        const batch = db.batch();
        const depData = {
            uid: wallet.uid, address, network, amount: usdAmount, txHash,
            status: 'completed', confirmedAt: Date.now(), createdAt: Date.now()
        };
        if (network === 'Polygon') {
            depData.polAmount = rawAmount;
            depData.polPrice = polPrice;
        }
        batch.create(db.collection('deposits').doc(), depData);
        batch.update(db.doc(`users/${wallet.uid}`), {
            walletBalance: admin.firestore.FieldValue.increment(usdAmount),
            totalDeposits: admin.firestore.FieldValue.increment(usdAmount),
        });
        batch.update(walletDoc.ref, { used: true, usedAt: Date.now(), txHash });

        await batch.commit();

        // Auto-sweep in background (non-blocking)
        try {
            const sweep = require('./sweepController');
            const index = wallet.index;
            if (index !== undefined) {
                sweep.autoSweepSingle(index, network).catch(e => console.error(`AutoSweep error for index ${index}: ${e.message}`));
            }
        } catch(e) { /* sweep not critical */ }

        res.json({ success: true, amount: usdAmount, network });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.getDeposits = async (req, res) => {
    try {
        const snap = await db.collection('deposits').orderBy('createdAt', 'desc').limit(50).get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.userDeposits = async (req, res) => {
    try {
        const snap = await db.collection('deposits')
            .where('uid', '==', req.params.uid)
            .orderBy('createdAt', 'desc').limit(20).get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.userWallets = async (req, res) => {
    try {
        const snap = await db.collection('depositWallets')
            .where('uid', '==', req.params.uid)
            .orderBy('createdAt', 'desc').limit(50).get();
        res.json(snap.docs.map(d => ({
            id: d.id,
            address: d.data().address,
            network: d.data().network,
            index: d.data().index,
            used: d.data().used,
            createdAt: d.data().createdAt
        })));
    } catch(e) { res.status(500).json({ error: e.message }); }
};
