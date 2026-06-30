require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Mnemonic, HDNodeWallet, ethers } = require('ethers');

const MNEMONIC = process.env.HD_WALLET_SEED;
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
];

(async () => {
  try {
    const m = Mnemonic.fromPhrase(MNEMONIC);
    const masterNode = HDNodeWallet.fromSeed(m.computeSeed());
    const masterWallet = new ethers.Wallet(masterNode.derivePath("m/44'/60'/0'/0/0").privateKey);
    const provider = new ethers.JsonRpcProvider(BSC_RPC);

    const masterBal = await provider.getBalance(masterWallet.address);
    console.log('Master:', masterWallet.address);
    console.log('Master BNB:', ethers.formatEther(masterBal));

    const child = masterNode.derivePath('m/44/60/0/0/26');
    console.log('Wallet #26:', child.address);

    const childBal = await provider.getBalance(child.address);
    console.log('Wallet #26 BNB:', ethers.formatEther(childBal));

    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
    const raw = await token.balanceOf(child.address);
    const decimals = await token.decimals();
    const usdt = Number(ethers.formatUnits(raw, decimals));
    console.log('Wallet #26 USDT:', usdt);

    if (usdt <= 0) {
      console.log('No USDT to sweep.');
      process.exit(0);
    }

    const gasNeeded = ethers.parseEther('0.00015');

    // If child has no gas, try to fund from master
    if (childBal < gasNeeded) {
      if (masterBal < gasNeeded + ethers.parseEther('0.00005')) {
        console.log('Master insufficient BNB! Need at least 0.0002 BNB. Current:', ethers.formatEther(masterBal));
        process.exit(1);
      }
      console.log('Funding gas from master...');
      const ms = masterWallet.connect(provider);
      const tx = await ms.sendTransaction({ to: child.address, value: gasNeeded });
      await tx.wait();
      console.log('Gas funded. TX:', tx.hash);
    }

    // Sweep USDT
    console.log('Sweeping', usdt, 'USDT to master...');
    const childSigner = child.connect(provider);
    const tokenContract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, childSigner);
    const sweepTx = await tokenContract.transfer(masterWallet.address, raw);
    const receipt = await sweepTx.wait();
    console.log('✅ Sweep TX:', receipt.hash);
    console.log('✅', usdt, 'USDT swept from wallet #26 to master');

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
