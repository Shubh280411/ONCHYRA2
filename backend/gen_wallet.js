const { ethers } = require('ethers');

// Generate random wallet
const temp = ethers.HDNodeWallet.createRandom();
const phrase = temp.mnemonic.phrase;
// Create root node from phrase
const root = ethers.HDNodeWallet.fromPhrase(phrase);

const master = root.derivePath("m/44'/60'/0'/0/0");

console.log('=== NEW WALLET ===');
console.log('Seed phrase:', phrase);
console.log('Master addr:', master.address);
console.log('Child #1  :', root.derivePath("m/44/60/0/0/1").address);
console.log('');
console.log('SafePal me daal ke verify kar lena!');
