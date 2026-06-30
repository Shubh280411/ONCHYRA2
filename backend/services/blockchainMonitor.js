const pg = require('../config/pg');
const priceFetcher = require('../config/priceFetcher');
const { Mnemonic, HDNodeWallet, ethers } = require('ethers');

const MNEMONIC = process.env.HD_WALLET_SEED;
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-bor.publicnode.com';
const GAS_AMOUNT = parseFloat(process.env.SWEEP_GAS_AMOUNT || '0.0005');
const CHECK_INTERVAL = parseInt(process.env.MONITOR_INTERVAL || '60000');
const MAX_PER_CYCLE = 20;
const WALLET_TTL_MS = 48 * 60 * 60 * 1000;

const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
];

const MIN_SCAN_INTERVAL = parseInt(process.env.MONITOR_SCAN_INTERVAL || '60000');

async function getPolUsdPrice() {
    const p = await priceFetcher.getPrice();
    if (p > 0) return p;
    console.warn('[PRICE] All POL price sources failed, using 0');
    return 0;
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

async function checkUSDT(index, provider) {
    const child = getChildWallet(index);
    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
    const raw = await token.balanceOf(child.address);
    const decimals = await token.decimals();
    return { address: child.address, balance: Number(ethers.formatUnits(raw, decimals)), raw };
}

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
        wallets = await pg.query(
            `SELECT * FROM deposit_wallets WHERE used = false AND (checked_at IS NULL OR checked_at < $1) ORDER BY checked_at NULLS FIRST LIMIT $2`,
            [cutoff, MAX_PER_CYCLE]
        );
        wallets = wallets.rows;
    } catch (e) {
        wallets = await pg.findWhere('deposit_wallets', { used: false }, null, MAX_PER_CYCLE);
    }

    let neverChecked = [];
    try {
        const res = await pg.query(
            `SELECT * FROM deposit_wallets WHERE used = false AND checked_at IS NULL LIMIT $1`,
            [MAX_PER_CYCLE]
        );
        neverChecked = res.rows;
    } catch (e) {}
    const seen = new Set(wallets.map(r => r.id));
    for (const r of neverChecked) {
        if (!seen.has(r.id)) wallets.push(r);
    }
    if (wallets.length > MAX_PER_CYCLE) wallets = wallets.slice(0, MAX_PER_CYCLE);

    let checked = 0;
    for (const w of wallets) {
        if (w.index === 0) {
            await pg.update('deposit_wallets', w.id, { used: true, note: 'Master wallet - skipped', checked_at: Date.now() }, 'id');
            continue;
        }

        const age = Date.now() - (w.created_at || 0);
        if (age > WALLET_TTL_MS) {
            await pg.update('deposit_wallets', w.id, { used: true, expired: true, expired_at: Date.now() }, 'id');
            continue;
        }

        checked++;
        try {
            const info = await checkBalance(w.index, w.network);
            if (info.raw <= 0n) {
                await pg.update('deposit_wallets', w.id, { checked_at: Date.now() }, 'id');
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

            const existing = await pg.findWhere('deposits', { address: info.address.toLowerCase() });
            if (existing.length) {
                await pg.update('deposit_wallets', w.id, { checked_at: Date.now() }, 'id');
                continue;
            }

            const depId = 'dep_auto_' + w.index + '_' + Date.now();
            const depFields = {
                uid: w.uid, address: info.address, network: w.network,
                amount: usdAmount, token: symbol,
                tx_hash: 'auto:' + Date.now(),
                status: 'completed', detected_at: Date.now(), created_at: Date.now()
            };
            if (w.network === 'Polygon') {
                depFields.pol_amount = info.balance;
                depFields.pol_price = polPrice;
            }
            await pg.query(
                `INSERT INTO deposits (id, uid, address, network, amount, tx_hash, status, token, pol_amount, pol_price, detected_at, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, $10)`,
                [depId, w.uid, info.address, w.network, usdAmount, depFields.tx_hash, symbol, depFields.pol_amount || 0, depFields.pol_price || 0, Date.now()]
            );

            await pg.increment('users', w.uid, 'wallet_balance', usdAmount);
            await pg.increment('users', w.uid, 'total_deposits', usdAmount);

            try {
                if (w.network === 'BEP20') {
                    await fundGasIfNeeded(w.index, w.network);
                }
                const sweep = await sweepWallet(w.index, w.network, info.raw);
                await pg.update('deposit_wallets', w.id, { used: true, used_at: Date.now(), sweep_tx: sweep.txHash, checked_at: Date.now() }, 'id');
                console.log(`[MONITOR] Swept ${sweep.swept} ${symbol} from wallet #${w.index} to master (tx: ${sweep.txHash})`);
            } catch (e) {
                console.error(`[MONITOR] Sweep failed for #${w.index}: ${e.message}`);
                await pg.update('deposit_wallets', w.id, { checked_at: Date.now() }, 'id');
            }
        } catch (e) {
            try { await pg.update('deposit_wallets', w.id, { checked_at: Date.now() }, 'id'); } catch (_) {}
        }
    }
    if (checked > 0) console.log(`[MONITOR] Checked ${checked} wallets this cycle`);
}

const ORPHAN_SCAN_RANGE = 100;

async function scanOrphanedWallets() {
    let maxIndex = 0;
    try {
        const res = await pg.query('SELECT MAX(index) as mx FROM deposit_wallets');
        maxIndex = res.rows[0]?.mx || 0;
    } catch (e) {}

    const scanTo = Math.max(maxIndex + 10, ORPHAN_SCAN_RANGE);
    let orphansFound = 0;

    for (const network of ['BEP20', 'Polygon']) {
      for (let i = 1; i <= scanTo; i++) {
        try {
            const inDb = await pg.query('SELECT id FROM deposit_wallets WHERE index = $1 AND network = $2', [i, network]);
            if (inDb.rows.length) continue;

            const info = await checkBalance(i, network);
            if (info.raw <= 0n) continue;

            orphansFound++;
            const symbol = network === 'BEP20' ? 'USDT' : 'POL';
            console.log(`[MONITOR] ⚠️ Orphaned wallet #${i} on ${network} has ${info.balance} ${symbol}!`);

            const walletId = 'dw_orphan_' + network + '_' + i + '_' + Date.now();
            await pg.query(
                `INSERT INTO deposit_wallets (id, uid, index, network, address, used, checked_at, created_at)
                 VALUES ($1, 'ORPHANED', $2, $3, $4, false, $5, $5)
                 ON CONFLICT (id) DO NOTHING`,
                [walletId, i, network, info.address.toLowerCase(), Date.now()]
            ).catch(() => {});

            const existing = await pg.findWhere('deposits', { address: info.address.toLowerCase() });
            if (existing.length) continue;

            let usdAmount = info.balance;
            let polPrice = 0;
            if (network === 'Polygon') {
                polPrice = await getPolUsdPrice();
                usdAmount = info.balance * (polPrice || 0);
            }

            const depId = 'dep_orphan_' + network + '_' + i + '_' + Date.now();
            await pg.query(
                `INSERT INTO deposits (id, uid, address, network, amount, tx_hash, status, token, pol_amount, pol_price, detected_at, created_at)
                 VALUES ($1, 'ORPHANED', $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $9)`,
                [depId, info.address, network, usdAmount, 'orphan:' + Date.now(), symbol, network === 'Polygon' ? info.balance : 0, polPrice || 0, Date.now()]
            );
            console.log(`[MONITOR] Orphan deposit recorded: ${depId} — $${usdAmount.toFixed(2)} pending manual credit`);
        } catch (e) {}
      }
    }

    if (orphansFound > 0) console.log(`[MONITOR] Found ${orphansFound} orphaned wallets with balance`);
}

let orphanScanCount = 0;

let intervalId = null;

function start() {
    console.log(`[MONITOR] Blockchain monitor starting (interval: ${CHECK_INTERVAL / 1000}s)`);
    processUnusedWallets().catch(e => console.error('[MONITOR] Initial check error:', e.message));
    intervalId = setInterval(() => {
        processUnusedWallets().catch(e => console.error('[MONITOR] Check error:', e.message));
        orphanScanCount++;
        if (orphanScanCount % 5 === 0) {
            scanOrphanedWallets().catch(e => console.error('[MONITOR] Orphan scan error:', e.message));
        }
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
