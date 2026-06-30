require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Mnemonic, HDNodeWallet, ethers } = require('ethers');

const MNEMONIC = process.env.HD_WALLET_SEED;
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';

(async () => {
  try {
    const m = Mnemonic.fromPhrase(MNEMONIC);
    const masterNode = HDNodeWallet.fromSeed(m.computeSeed());
    const masterWallet = new ethers.Wallet(masterNode.derivePath("m/44'/60'/0'/0/0").privateKey);
    const provider = new ethers.JsonRpcProvider(BSC_RPC);

    const child = masterNode.derivePath('m/44/60/0/0/26');
    console.log('Wallet #26:', child.address);
    console.log('Master:', masterWallet.address);

    const childBal = await provider.getBalance(child.address);
    const masterBal = await provider.getBalance(masterWallet.address);
    console.log('Wallet #26 BNB:', ethers.formatEther(childBal));
    console.log('Master BNB:', ethers.formatEther(masterBal));

    if (childBal === 0n) {
      console.log('No BNB in wallet #26 to sweep.');
      process.exit(0);
    }

    const gasPrice = await provider.getFeeData();
    const gasLimit = 21000n;
    const gasCost = gasPrice.gasPrice * gasLimit;
    const sweepAmount = childBal - gasCost;

    if (sweepAmount <= 0n) {
      console.log('BNB too low to cover gas. Skipping.');
      process.exit(0);
    }

    console.log('Sweeping', ethers.formatEther(sweepAmount), 'BNB to master...');
    const childSigner = child.connect(provider);
    const tx = await childSigner.sendTransaction({
      to: masterWallet.address,
      value: sweepAmount
    });
    const receipt = await tx.wait();
    console.log('✅ Sweep TX:', receipt.hash);

    const newChildBal = await provider.getBalance(child.address);
    const newMasterBal = await provider.getBalance(masterWallet.address);
    console.log('Wallet #26 BNB after:', ethers.formatEther(newChildBal));
    console.log('Master BNB after:', ethers.formatEther(newMasterBal));

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
