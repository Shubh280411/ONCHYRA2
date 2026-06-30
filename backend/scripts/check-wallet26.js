require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Mnemonic, HDNodeWallet, ethers } = require('ethers');

const MNEMONIC = process.env.HD_WALLET_SEED;
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)'
];

(async () => {
  try {
    const m = Mnemonic.fromPhrase(MNEMONIC);
    const masterNode = HDNodeWallet.fromSeed(m.computeSeed());

    // Check wallet #26
    const index = 26;
    const child = masterNode.derivePath(`m/44/60/0/0/${index}`);
    const address = child.address;
    console.log('=== WALLET #' + index + ' ===');
    console.log('Address:', address);

    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    
    // Check native BNB balance
    const nativeBal = await provider.getBalance(address);
    console.log('BNB Balance:', ethers.formatEther(nativeBal));

    // Check USDT balance
    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
    const raw = await token.balanceOf(address);
    const decimals = await token.decimals();
    const usdtBal = Number(ethers.formatUnits(raw, decimals));
    console.log('USDT Balance:', usdtBal);

    if (usdtBal > 0) {
      console.log('\n⚠️ WALLET #26 HAS ' + usdtBal + ' USDT!');
      console.log('This deposit was detected but NOT credited to any user.');
      console.log('The wallet is NOT in deposit_wallets table.');
    } else {
      console.log('\nWallet #26 is empty. The log might be stale or from a different process.');
    }

    // Also check wallets around 26
    console.log('\n=== Checking nearby wallets ===');
    for (const i of [24, 25, 26, 27, 28]) {
      const c = masterNode.derivePath(`m/44/60/0/0/${i}`);
      const t = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
      const r = await t.balanceOf(c.address);
      const d = await t.decimals();
      const bal = Number(ethers.formatUnits(r, d));
      if (bal > 0) {
        console.log('Wallet #' + i + ' (' + c.address + '): ' + bal + ' USDT ⚠️');
      } else {
        console.log('Wallet #' + i + ': empty');
      }
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
