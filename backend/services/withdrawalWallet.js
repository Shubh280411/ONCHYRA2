const { ethers } = require('ethers');

const SEED = process.env.WITHDRAWAL_SEED_PHRASE;
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';

const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
];

let _wallet = null;

function getWallet() {
    if (!_wallet) {
        const mnemonic = ethers.Mnemonic.fromPhrase(SEED);
        const hdNode = ethers.HDNodeWallet.fromMnemonic(mnemonic);
        _wallet = new ethers.Wallet(hdNode.privateKey);
    }
    return _wallet;
}

function getProvider() {
    return new ethers.JsonRpcProvider(BSC_RPC);
}

function getSigner() {
    const wallet = getWallet();
    return wallet.connect(getProvider());
}

async function getBalance() {
    try {
        const provider = getProvider();
        const wallet = getWallet();
        const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
        const raw = await token.balanceOf(wallet.address);
        const decimals = await token.decimals();
        return { address: wallet.address, balance: Number(ethers.formatUnits(raw, decimals)), raw: raw.toString() };
    } catch (e) {
        return { address: 'unknown', balance: -1, error: e.message };
    }
}

async function getNativeBalance() {
    try {
        const provider = getProvider();
        const wallet = getWallet();
        const raw = await provider.getBalance(wallet.address);
        return { address: wallet.address, balance: Number(ethers.formatEther(raw)), raw: raw.toString() };
    } catch (e) {
        return { address: 'unknown', balance: -1, error: e.message };
    }
}

async function sendUSDT(to, amount) {
    try {
        const signer = getSigner();
        const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, signer);
        const decimals = await token.decimals();
        const parsedAmount = ethers.parseUnits(amount.toString(), decimals);

        const tx = await token.transfer(to, parsedAmount);
        const receipt = await tx.wait();

        return {
            success: true,
            txHash: receipt.hash,
            from: getWallet().address,
            to,
            amount,
            gasUsed: receipt.gasUsed?.toString()
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { getWallet, getBalance, getNativeBalance, sendUSDT };
