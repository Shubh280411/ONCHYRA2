const pg = require('../config/pg');
const { Mnemonic, HDNodeWallet } = require('ethers');
const https = require('https');

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
    } catch(e) { }
    try {
        const body = await httpGet('https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT');
        const parsed = JSON.parse(body);
        if (parsed && parsed.price) return parseFloat(parsed.price);
    } catch(e) { }
    try {
        const body = await httpGet('https://api.binance.com/api/v3/ticker/price?symbol=MATICUSDT');
        const parsed = JSON.parse(body);
        if (parsed && parsed.price) return parseFloat(parsed.price);
    } catch(e) { }
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

let memCounter = null;
let counterInitialized = false;

async function getNextIndex() {
    if (!counterInitialized) {
        try {
            const row = await pg.get('settings', 'hdWalletCounter', 'key');
            memCounter = row ? parseInt(row.value?.nextIndex || row.next_index || 1) : 1;
        } catch(e) {
            console.warn('[HD] PG counter unavailable, starting from index 1');
            memCounter = 1;
        }
        counterInitialized = true;
    }
    const next = memCounter;
    memCounter++;
    pg.query(
        `INSERT INTO settings (key, value) VALUES ('hdWalletCounter', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
        [JSON.stringify({ nextIndex: memCounter })]
    ).catch(e => console.warn('[HD] Failed to persist counter:', e.message));
    if (next < 1) return 1;
    return next;
}

exports.createWallet = async (req, res) => {
    try {
        const { uid, network } = req.body;
        if (!['BEP20', 'Polygon'].includes(network)) return res.status(400).json({ error: 'Invalid network' });

        const index = await getNextIndex();
        const path = `m/44/60/0/0/${index}`;
        const child = getMasterNode().derivePath(path);
        const address = child.address.toLowerCase();

        await pg.query(
            `INSERT INTO deposit_wallets (id, uid, network, address, path, "index", used, created_at)
             VALUES ('dw_' || $1 || '_' || $2, $1, $3, $4, $5, $6, false, $7)`,
            [uid, Date.now(), network, address, path, index, Date.now()]
        );

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

        const wallets = await pg.findWhere('deposit_wallets', { address: address.toLowerCase() });
        if (!wallets.length) return res.status(404).json({ error: 'Wallet not found' });
        const wallet = wallets[0];

        const existing = await pg.findWhere('deposits', { tx_hash: txHash });
        if (existing.length) return res.status(400).json({ error: 'Duplicate transaction' });

        const rawAmount = parseFloat(amount);
        let usdAmount = rawAmount;
        let polPrice = 0;
        if (network === 'Polygon') {
            polPrice = await getPolUsdPrice();
            usdAmount = rawAmount * (polPrice || 0);
        }

        await pg.query(
            `INSERT INTO deposits (id, uid, address, network, amount, tx_hash, status, pol_amount, pol_price, confirmed_at, created_at)
             VALUES ('dep_' || $1 || '_' || $2, $1, $3, $4, $5, $6, 'completed', $7, $8, $9, $9)`,
            [wallet.uid, txHash.slice(0, 8), address, network, usdAmount, txHash,
             network === 'Polygon' ? rawAmount : 0, polPrice, Date.now()]
        );

        await pg.increment('users', wallet.uid, 'wallet_balance', usdAmount);
        await pg.increment('users', wallet.uid, 'total_deposits', usdAmount);

        await pg.update('deposit_wallets', wallet.id, {
            used: true, used_at: Date.now(), tx_hash: txHash
        }, 'id');

        try {
            const sweep = require('./sweepController');
            const idx = wallet.index;
            if (idx !== undefined) {
                sweep.autoSweepSingle(idx, network).catch(e => console.error(`AutoSweep error for index ${idx}: ${e.message}`));
            }
        } catch(e) { }

        res.json({ success: true, amount: usdAmount, network });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.getDeposits = async (req, res) => {
    try {
        const rows = await pg.query(`SELECT * FROM deposits ORDER BY created_at DESC LIMIT 50`);
        res.json(rows.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.userDeposits = async (req, res) => {
    try {
        const rows = await pg.findWhere('deposits', { uid: req.params.uid }, 'created_at', 20);
        res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.userWallets = async (req, res) => {
    try {
        const rows = await pg.findWhere('deposit_wallets', { uid: req.params.uid }, 'created_at', 50);
        res.json(rows.map(r => ({
            id: r.id,
            address: r.address,
            network: r.network,
            index: r.index,
            used: r.used,
            createdAt: r.created_at
        })));
    } catch(e) { res.status(500).json({ error: e.message }); }
};
