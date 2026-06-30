require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { Mnemonic, HDNodeWallet, ethers } = require('ethers');

const MNEMONIC = process.env.HD_WALLET_SEED;
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

(async () => {
  try {
    const m = Mnemonic.fromPhrase(MNEMONIC);
    const masterNode = HDNodeWallet.fromSeed(m.computeSeed());
    const child = masterNode.derivePath('m/44/60/0/0/26');
    const addr = child.address;
    const addrPadded = '0x000000000000000000000000' + addr.slice(2).toLowerCase();

    console.log('Wallet #26:', addr);

    // Use multiple RPCs to avoid rate limits
    const RPCS = [
      'https://bsc-rpc.publicnode.com',
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
      'https://bsc-dataseed1.defibit.io',
    ];

    const provider = new ethers.JsonRpcProvider(RPCS[0]);
    const currentBlock = await provider.getBlockNumber();
    console.log('Current block:', currentBlock);

    const pg = require('../config/pg');
    
    // Scan in large chunks using different RPCs
    const CHUNK = 200000;
    let allLogs = [];
    let rpcIdx = 0;

    for (let start = currentBlock - 2000000; start < currentBlock; start += CHUNK) {
      const end = Math.min(start + CHUNK - 1, currentBlock);
      
      // Rotate RPCs
      const p = new ethers.JsonRpcProvider(RPCS[rpcIdx % RPCS.length]);
      rpcIdx++;
      
      try {
        const filter = {
          address: USDT_CONTRACT,
          topics: [TRANSFER_TOPIC, null, addrPadded],
          fromBlock: start,
          toBlock: end
        };
        const logs = await p.getLogs(filter);
        if (logs.length) {
          allLogs = allLogs.concat(logs);
          console.log(`Found ${logs.length} in blocks ${start}-${end}`);
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.log(`Error in blocks ${start}-${end}: ${e.message.substring(0, 80)}`);
        await new Promise(r => setTimeout(r, 3000));
        // Retry with different RPC
        try {
          const p2 = new ethers.JsonRpcProvider(RPCS[rpcIdx % RPCS.length]);
          rpcIdx++;
          const logs = await p2.getLogs({
            address: USDT_CONTRACT,
            topics: [TRANSFER_TOPIC, null, addrPadded],
            fromBlock: start,
            toBlock: end
          });
          if (logs.length) allLogs = allLogs.concat(logs);
          await new Promise(r => setTimeout(r, 500));
        } catch (e2) {}
      }
    }

    console.log('\n=== INCOMING USDT TRANSFERS: ' + allLogs.length + ' ===');

    for (const log of allLogs) {
      const from = '0x' + log.topics[1].slice(26);
      const amount = Number(ethers.formatUnits(log.data, 18));
      const block = await provider.getBlock(log.blockNumber);
      const date = new Date(block.timestamp * 1000).toLocaleString();

      console.log('\n📥 DEPOSIT:');
      console.log('  From:', from);
      console.log('  Amount:', amount, 'USDT');
      console.log('  TX:', log.transactionHash);
      console.log('  Date:', date);

      const match = await pg.query(
        'SELECT uid, name, email, "index" FROM deposit_wallets WHERE LOWER(address) = $1',
        [from.toLowerCase()]
      );
      if (match.rows.length) {
        console.log('  ✅ USER FOUND:', match.rows[0].name, '(' + match.rows[0].email + ')');
      } else {
        console.log('  ❌ Not in deposit_wallets');
      }
    }

    if (!allLogs.length) {
      console.log('No deposits found. Checking if the USDT arrived via internal tx or different method...');
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
