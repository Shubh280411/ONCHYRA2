require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const pg = require('../config/pg');
const { Mnemonic, HDNodeWallet, ethers } = require('ethers');

const MNEMONIC = process.env.HD_WALLET_SEED;
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
];

const ADMIN_UID = '6AsI8MC5PRTYbCcvW8h0d8uvqt53';

(async () => {
  try {
    const m = Mnemonic.fromPhrase(MNEMONIC);
    const masterNode = HDNodeWallet.fromSeed(m.computeSeed());
    const masterWallet = new ethers.Wallet(masterNode.derivePath("m/44'/60'/0'/0/0").privateKey);
    const provider = new ethers.JsonRpcProvider(BSC_RPC);

    const masterBal = await provider.getBalance(masterWallet.address);
    console.log('Master BNB:', ethers.formatEther(masterBal));

    const child = masterNode.derivePath('m/44/60/0/0/26');
    const addr = child.address;
    console.log('Wallet #26:', addr);

    const token = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
    const raw = await token.balanceOf(addr);
    const decimals = await token.decimals();
    const bal = Number(ethers.formatUnits(raw, decimals));
    console.log('USDT:', bal);

    const nativeBal = await provider.getBalance(addr);
    console.log('Wallet #26 BNB:', ethers.formatEther(nativeBal));

    // Need just a tiny bit of BNB for USDT transfer gas (~0.0002 BNB)
    const gasNeeded = ethers.parseEther('0.0003');
    if (nativeBal < gasNeeded) {
      const toSend = gasNeeded;
      if (masterBal < toSend + ethers.parseEther('0.0001')) {
        console.log('Master has only', ethers.formatEther(masterBal), 'BNB — too low to fund gas');
        console.log('Trying direct credit without sweep...');
        
        // Just credit the user directly — the USDT stays in wallet #26
        // Mark it as a manual rescue deposit
        await pg.increment('users', ADMIN_UID, 'wallet_balance', bal);
        console.log('Credited $' + bal + ' to admin wallet_balance');
        
        const depId = 'dep_wallet26_manual_' + Date.now();
        await pg.query(
          `INSERT INTO deposits (id, uid, address, network, amount, tx_hash, status, token, detected_at, created_at)
           VALUES ($1, $2, $3, 'BEP20', $4, $5, 'completed', 'USDT', $6, $6)`,
          [depId, ADMIN_UID, addr.toLowerCase(), bal, 'manual_rescue_wallet26_' + Date.now(), Date.now()]
        );
        console.log('Deposit record:', depId);

        // Mark wallet in DB
        await pg.query(
          `INSERT INTO deposit_wallets (id, uid, index, network, address, used, checked_at, created_at)
           VALUES ($1, $2, 26, 'BEP20', $3, true, $4, $4)
           ON CONFLICT (id) DO NOTHING`,
          ['wallet_26_rescue', ADMIN_UID, addr.toLowerCase(), Date.now()]
        );
        
        console.log('\n✅ Credited $' + bal + ' to admin. USDT still in wallet #26 — sweep later when master has gas.');
        process.exit(0);
      }
      
      const masterSigner = masterWallet.connect(provider);
      console.log('Sending', ethers.formatEther(toSend), 'BNB for gas...');
      const fundTx = await masterSigner.sendTransaction({ to: addr, value: toSend });
      await fundTx.wait();
      console.log('Gas funded.');
    }

    // Sweep USDT
    console.log('Sweeping', bal, 'USDT to master...');
    const childSigner = child.connect(provider);
    const tokenWithSigner = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, childSigner);
    const tx = await tokenWithSigner.transfer(masterWallet.address, raw);
    const receipt = await tx.wait();
    console.log('Sweep TX:', receipt.hash);

    await pg.increment('users', ADMIN_UID, 'wallet_balance', bal);
    console.log('Credited $' + bal + ' to admin');

    const depId = 'dep_wallet26_sweep_' + Date.now();
    await pg.query(
      `INSERT INTO deposits (id, uid, address, network, amount, tx_hash, status, token, detected_at, created_at)
       VALUES ($1, $2, $3, 'BEP20', $4, $5, 'completed', 'USDT', $6, $6)`,
      [depId, ADMIN_UID, addr.toLowerCase(), bal, receipt.hash, Date.now()]
    );

    await pg.query(
      `INSERT INTO deposit_wallets (id, uid, index, network, address, used, checked_at, created_at)
       VALUES ($1, $2, 26, 'BEP20', $3, true, $4, $4)
       ON CONFLICT (id) DO NOTHING`,
      ['wallet_26_rescue', ADMIN_UID, addr.toLowerCase(), Date.now()]
    );

    console.log('\n✅ DONE! $' + bal + ' credited. TX: ' + receipt.hash);
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
