const admin = require('firebase-admin');
const { Mnemonic, HDNodeWallet, ethers } = require('ethers');
const https = require('https');
const db = admin.firestore();

const MNEMONIC = process.env.HD_WALLET_SEED;
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-bor.publicnode.com';
const GAS_AMOUNT = parseFloat(process.env.SWEEP_GAS_AMOUNT || '0.0005');
const CHECK_INTERVAL = parseInt(process.env.MONITOR_INTERVAL || '900000');
const MAX_PER_CYCLE = 20;
const WALLET_TTL_MS = 48 * 60 * 60 * 1000;

const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
];

let polPriceCache = { price: 0, time: 0 };
const MIN_SCAN_INTERVAL = parseInt(process.env.MONITOR_SCAN_INTERVAL || '3600000'); // 1 hour between re-checks of same wallet

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
let masterWallet = null;

function getMaster() {
    if (!masterNode) {
        const m = Mnemonic.fromPhrase(MNEMONIC);
        masterNode = HDNodeWallet.fromSeed(m.computeSeed());
        masterWallet = new ethers.Wallet(masterNode.derivePath("m/44'/60'/0'/0/0").privateKey);
    }
    return { node: masterNode, wallet: masterWallet };
}

function getProvider(network) {
    return new ethers.JsonRpcProvider(network === 'BEP20' ? BSC_RPC : POLYGON_RPC);
}

function getChildWallet(index) {
    const { node } = getMaster();
    const child = node.derivePath(`m/44/60/0/0/${index}`);
    return new ethers.Wallet(child.privateKey);
}

// BEP20: check USDT token balance
async function checkUSDT(index, provider) {
    const child = getChildWallet(index);
    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
    const raw = await token.balanceOf(child.address);
    const decimals = await token.decimals();
    return { address: child.address, balance: Number(ethers.formatUnits(raw, decimals)), raw };
}

// Polygon: check native POL balance
async function checkPOL(index, provider) {
    const child = getChildWallet(index);
    const raw = await provider.getBalance(child.address);
    return { address: child.address, balance: Number(ethers.formatEther(raw)), raw };
}

async function checkBalance(index, network) {
    const provider = getProvider(network);
    if (network === 'BEP20') return checkUSDT(index, provider);
    return checkPOL(index, provider);
}

// Sweep USDT (BEP20) via token transfer
async function sweepUSDT(index, provider, rawBalance) {
    const child = getChildWallet(index);
    const { wallet: master } = getMaster();
    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, child.connect(provider));
    const decimals = await token.decimals();
    const amount = Number(ethers.formatUnits(rawBalance, decimals));
    const tx = await token.transfer(master.address, rawBalance);
    const receipt = await tx.wait();
    return { swept: amount, txHash: receipt.hash };
}

// Sweep POL (Polygon) via native transfer
async function sweepPOL(index, provider, rawBalance) {
    const child = getChildWallet(index);
    const { wallet: master } = getMaster();
    const gasReserve = ethers.parseEther('0.01');
    if (rawBalance <= gasReserve) return { swept: 0, reason: 'Only gas reserve' };
    const sweepAmount = rawBalance - gasReserve;
    const childSigner = child.connect(provider);
    const tx = await childSigner.sendTransaction({ to: master.address, value: sweepAmount });
    const receipt = await tx.wait();
    const amount = Number(ethers.formatEther(sweepAmount));
    return { swept: amount, txHash: receipt.hash };
}

async function sweepWallet(index, network, rawBalance) {
    const provider = getProvider(network);
    if (network === 'BEP20') return sweepUSDT(index, provider, rawBalance);
    return sweepPOL(index, provider, rawBalance);
}

async function fundGasIfNeeded(index, network) {
    const provider = getProvider(network);
    const child = getChildWallet(index);
    const { wallet: master } = getMaster();
    const nativeBal = await provider.getBalance(child.address);
    const needed = ethers.parseEther(GAS_AMOUNT.toString());
    if (nativeBal >= needed) return;
    const masterSigner = master.connect(provider);
    const masterBal = await provider.getBalance(master.address);
    const amount = needed - nativeBal;
    if (masterBal < amount) {
        console.log(`[MONITOR] Master has insufficient BNB for gas: ${ethers.formatEther(masterBal)} < ${ethers.formatEther(amount)}`);
        return;
    }
    const tx = await masterSigner.sendTransaction({ to: child.address, value: amount });
    await tx.wait();
    console.log(`[MONITOR] Funded gas for wallet #${index} on ${network}: ${ethers.formatEther(amount)}`);
}

async function processUnusedWallets() {
    const cutoff = Date.now() - MIN_SCAN_INTERVAL;
    let wallets;
    try {
        const snap = await db.collection('depositWallets')
            .where('used', '==', false)
            .where('checkedAt', '<', cutoff)
            .orderBy('checkedAt')
            .limit(MAX_PER_CYCLE).get();
        wallets = snap.docs;
    } catch (e) {
        // Index might not exist yet; fallback to unindexed query
        const snap = await db.collection('depositWallets')
            .where('used', '==', false)
            .limit(MAX_PER_CYCLE).get();
        wallets = snap.docs;
    }

    // Also fetch wallets that have never been checked (no checkedAt field)
    // Firestore won't return them with the < cutoff query, so fetch separately
    let neverChecked = [];
    try {
        const snap2 = await db.collection('depositWallets')
            .where('used', '==', false)
            .where('checkedAt', '==', 0)
            .limit(MAX_PER_CYCLE).get();
        neverChecked = snap2.docs;
    } catch (e) {
        // fallback — merge manually from wallets list
    }
    const seen = new Set(wallets.map(d => d.id));
    for (const d of neverChecked) {
        if (!seen.has(d.id)) wallets.push(d);
    }
    if (wallets.length > MAX_PER_CYCLE) wallets = wallets.slice(0, MAX_PER_CYCLE);

    let checked = 0;
    for (const d of wallets) {
        const w = d.data();

        // Skip master wallet (index 0) just in case
        if (w.index === 0) {
            await d.ref.update({ used: true, note: 'Master wallet - skipped', checkedAt: Date.now() });
            continue;
        }

        const age = Date.now() - (w.createdAt || 0);

        // Mark wallets older than 48h as expired so they never get checked again
        if (age > WALLET_TTL_MS) {
            await d.ref.update({ used: true, expired: true, expiredAt: Date.now() });
            continue;
        }

        checked++;
        try {
            const info = await checkBalance(w.index, w.network);
            if (info.raw <= 0n) {
                await d.ref.update({ checkedAt: Date.now() });
                continue;
            }

            const symbol = w.network === 'BEP20' ? 'USDT' : 'POL';
            let usdAmount = info.balance;
            let polPrice = 0;
            if (w.network === 'Polygon') {
                polPrice = await getPolUsdPrice();
                usdAmount = info.balance * (polPrice || 0);
            }
            console.log(`[MONITOR] Deposit detected! Wallet #${w.index} on ${w.network}: ${info.balance} ${symbol} ($${usdAmount.toFixed(2)} USD)`);

            const existing = await db.collection('deposits')
                .where('address', '==', info.address.toLowerCase())
                .where('amount', '==', usdAmount).limit(1).get();
            if (!existing.empty) {
                await d.ref.update({ checkedAt: Date.now() });
                continue;
            }

            const batch = db.batch();
            const depDoc = {
                uid: w.uid, address: info.address, network: w.network,
                amount: usdAmount, token: symbol,
                txHash: 'auto:' + Date.now(),
                status: 'completed', detectedAt: Date.now(), createdAt: Date.now()
            };
            if (w.network === 'Polygon') {
                depDoc.polAmount = info.balance;
                depDoc.polPrice = polPrice;
            }
            batch.create(db.collection('deposits').doc(), depDoc);
            batch.update(db.doc(`users/${w.uid}`), {
                walletBalance: admin.firestore.FieldValue.increment(usdAmount),
                totalDeposits: admin.firestore.FieldValue.increment(usdAmount),
            });
            await batch.commit();

            try {
                if (w.network === 'BEP20') {
                    await fundGasIfNeeded(w.index, w.network);
                }
                const sweep = await sweepWallet(w.index, w.network, info.raw);
                await d.ref.update({ used: true, usedAt: Date.now(), sweepTx: sweep.txHash, checkedAt: Date.now() });
                console.log(`[MONITOR] Swept ${sweep.swept} ${symbol} from wallet #${w.index} to master (tx: ${sweep.txHash})`);
            } catch (e) {
                console.error(`[MONITOR] Sweep failed for #${w.index}: ${e.message}`);
                await d.ref.update({ checkedAt: Date.now() });
            }
        } catch (e) {
            // RPC error - still mark checkedAt to avoid re-trying same wallet too quickly
            try { await d.ref.update({ checkedAt: Date.now() }); } catch (_) {}
        }
    }
    if (checked > 0) console.log(`[MONITOR] Checked ${checked} wallets this cycle`);
}

let intervalId = null;

function start() {
    console.log(`[MONITOR] Blockchain monitor starting (interval: ${CHECK_INTERVAL / 1000}s)`);
    processUnusedWallets().catch(e => console.error('[MONITOR] Initial check error:', e.message));
    intervalId = setInterval(() => {
        processUnusedWallets().catch(e => console.error('[MONITOR] Check error:', e.message));
    }, CHECK_INTERVAL);
}

function stop() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('[MONITOR] Blockchain monitor stopped');
    }
}

module.exports = { start, stop };
