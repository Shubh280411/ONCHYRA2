const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { Mnemonic, HDNodeWallet } = ethers;
const db = admin.firestore();

const MNEMONIC = process.env.HD_WALLET_SEED;
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-bor.publicnode.com';
const GAS_AMOUNT = parseFloat(process.env.SWEEP_GAS_AMOUNT || '0.0005');

const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
];

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

// Check USDT balance (BEP20)
async function checkUSDT(index, provider) {
    const child = getChildWallet(index);
    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
    const raw = await token.balanceOf(child.address);
    const decimals = await token.decimals();
    return { address: child.address, balance: Number(ethers.formatUnits(raw, decimals)), raw };
}

// Check POL balance (Polygon native)
async function checkPOL(index, provider) {
    const child = getChildWallet(index);
    const raw = await provider.getBalance(child.address);
    return { address: child.address, balance: Number(ethers.formatEther(raw)), raw };
}

async function checkBalance(index, network) {
    try {
        const provider = getProvider(network);
        if (network === 'BEP20') return checkUSDT(index, provider);
        return checkPOL(index, provider);
    } catch (e) {
        return { address: 'unknown', balance: -1, error: e.message };
    }
}

// Sweep USDT (BEP20) via token transfer
async function sweepUSDT(index, provider) {
    const child = getChildWallet(index);
    const { wallet: master } = getMaster();
    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
    const decimals = await token.decimals();
    const rawBalance = await token.balanceOf(child.address);
    if (rawBalance <= 0n) return { swept: 0, reason: 'No balance' };
    const childSigner = child.connect(provider);
    const tokenSigner = token.connect(childSigner);
    const tx = await tokenSigner.transfer(master.address, rawBalance);
    const receipt = await tx.wait();
    const amount = Number(ethers.formatUnits(rawBalance, decimals));
    return { swept: amount, txHash: receipt.hash, gasUsed: receipt.gasUsed?.toString() };
}

// Sweep POL (Polygon) via native transfer
async function sweepPOL(index, provider) {
    const child = getChildWallet(index);
    const { wallet: master } = getMaster();
    const rawBalance = await provider.getBalance(child.address);
    if (rawBalance <= 0n) return { swept: 0, reason: 'No balance' };
    const childSigner = child.connect(provider);
    // Keep gas reserve (0.01 POL for tx fee)
    const gasReserve = ethers.parseEther('0.01');
    if (rawBalance <= gasReserve) return { swept: 0, reason: 'Only gas reserve' };
    const sweepAmount = rawBalance - gasReserve;
    const tx = await childSigner.sendTransaction({ to: master.address, value: sweepAmount });
    const receipt = await tx.wait();
    const amount = Number(ethers.formatEther(sweepAmount));
    return { swept: amount, txHash: receipt.hash, gasUsed: receipt.gasUsed?.toString() };
}

async function sweepWallet(index, network) {
    const provider = getProvider(network);
    if (network === 'BEP20') return sweepUSDT(index, provider);
    return sweepPOL(index, provider);
}

// Fund a child wallet with native token for gas (BEP20 needs BNB, Polygon already has POL)
async function fundGas(index, network) {
    const provider = getProvider(network);
    const child = getChildWallet(index);
    const { wallet: master } = getMaster();
    const masterSigner = master.connect(provider);
    const nativeBalance = await provider.getBalance(child.address);
    const needed = ethers.parseEther(GAS_AMOUNT.toString());
    if (nativeBalance >= needed) return { funded: false, reason: 'Already has gas' };
    const amount = needed - nativeBalance;
    const masterBal = await provider.getBalance(master.address);
    if (masterBal < amount) return { funded: false, reason: 'Master insufficient: ' + ethers.formatEther(masterBal) + ' < ' + ethers.formatEther(amount) };
    const tx = await masterSigner.sendTransaction({ to: child.address, value: amount });
    await tx.wait();
    return { funded: true, txHash: tx.hash, amount: ethers.formatEther(amount) };
}

exports.autoSweepSingle = async (index, network) => {
    try {
        const info = await checkBalance(index, network);
        if (info.balance > 0) {
            // BEP20 needs BNB for gas; Polygon uses POL so skip funding
if (network === 'BEP20') {
    const funded = await fundGas(index, network).catch(e => { console.error(`[SWEEP] fundGas failed for ${index}: ${e.message}`); return { funded: false, reason: e.message }; });
    if (!funded.funded) console.warn(`[SWEEP] fundGas skipped for ${index}: ${funded.reason}`);
}
            const result = await sweepWallet(index, network);
            if (result.swept > 0) {
                const walletSnap = await db.collection('depositWallets')
                    .where('index', '==', index).where('network', '==', network).limit(1).get();
                if (!walletSnap.empty) {
                    await walletSnap.docs[0].ref.update({ swept: true, sweptAt: Date.now(), sweepTx: result.txHash });
                }
                const symbol = network === 'BEP20' ? 'USDT' : 'POL';
                console.log(`[SWEEP] Index ${index} on ${network}: swept ${result.swept} ${symbol}`);
            }
        }
    } catch (e) { console.error(`[SWEEP] Error index ${index}: ${e.message}`); }
};

exports.check = async (req, res) => {
    try {
        const { network } = req.body;
        if (!network) return res.status(400).json({ error: 'Network required' });

        const wallets = await db.collection('depositWallets')
            .where('network', '==', network)
            .where('used', '==', false).limit(50).get();

        const results = [];
        for (const d of wallets.docs) {
            const w = d.data();
            try {
                const info = await checkBalance(w.index, network);
                if (info.balance > 0) results.push({ index: w.index, address: info.address, balance: info.balance, docId: d.id });
            } catch (e) { console.error(`Check error index ${w.index}: ${e.message}`); }
        }
        res.json({ network, checked: wallets.size, withBalance: results.length, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.sweep = async (req, res) => {
    try {
        const { index, network } = req.body;
        if (index === undefined || !network) return res.status(400).json({ error: 'Index and network required' });

        const result = await sweepWallet(index, network);
        if (result.swept > 0) {
            const walletSnap = await db.collection('depositWallets')
                .where('index', '==', index).where('network', '==', network).limit(1).get();
            if (!walletSnap.empty) {
                await walletSnap.docs[0].ref.update({ swept: true, sweptAt: Date.now(), sweepTx: result.txHash });
            }
        }
        res.json({ index, network, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.autoSweep = async (req, res) => {
    try {
        const networks = ['BEP20', 'Polygon'];
        const all = [];

        for (const network of networks) {
            const wallets = await db.collection('depositWallets')
                .where('network', '==', network)
                .where('used', '==', false).limit(50).get();

            for (const d of wallets.docs) {
                const w = d.data();
                try {
                    const info = await checkBalance(w.index, network);
                    if (info.balance > 0.01) {
                        if (network === 'BEP20') {
                            try { await fundGas(w.index, network); } catch (e) {}
                        }
                        const result = await sweepWallet(w.index, network);
                        const symbol = network === 'BEP20' ? 'USDT' : 'POL';
                        all.push({ index: w.index, network, balance: info.balance, swept: result.swept, txHash: result.txHash || null, symbol });
                        if (result.swept > 0) {
                            await d.ref.update({ swept: true, sweptAt: Date.now(), sweepTx: result.txHash });
                        }
                    }
                } catch (e) { console.error(`AutoSweep error index ${w.index}: ${e.message}`); }
            }
        }
        res.json({ swept: all.length, results: all });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.fundGas = async (req, res) => {
    try {
        const { index, network } = req.body;
        if (index === undefined || !network) return res.status(400).json({ error: 'Index and network required' });

        const result = await fundGas(index, network);
        res.json({ index, network, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.status = async (req, res) => {
    try {
        const { wallet: master } = getMaster();
        const networks = ['BEP20', 'Polygon'];
        const info = {};

        for (const net of networks) {
            try {
                const provider = getProvider(net);
                const bal = await provider.getBalance(master.address);
                if (net === 'BEP20') {
                    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
                    const usdtRaw = await token.balanceOf(master.address);
                    const decimals = await token.decimals();
                    info[net] = {
                        masterAddress: master.address,
                        nativeBalance: ethers.formatEther(bal),
                        tokenBalance: ethers.formatUnits(usdtRaw, decimals),
                        tokenSymbol: 'USDT'
                    };
                } else {
                    info[net] = {
                        masterAddress: master.address,
                        nativeBalance: ethers.formatEther(bal),
                        tokenSymbol: 'POL'
                    };
                }
            } catch (e) {
                info[net] = { masterAddress: master.address, error: e.message };
            }
        }
        res.json(info);
    } catch (e) { res.status(500).json({ error: e.message }); }
};
