const dns = require('dns');
const https = require('https');

const SOURCES = [
    'https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT',
    'https://api.binance.com/api/v3/ticker/price?symbol=MATICUSDT',
    'https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd',
];

let cache = { price: 0, time: 0 };

function httpsGet(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        dns.lookup(u.hostname, { family: 4 }, (err, addr) => {
            if (err) return reject(err);
            const opts = {
                hostname: addr, path: u.pathname + u.search,
                headers: { 'User-Agent': 'Mozilla/5.0' },
                servername: u.hostname,
                rejectUnauthorized: false,
            };
            const req = https.get(opts, (res) => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => resolve(d));
            });
            req.on('error', reject);
            req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
        });
    });
}

async function fetchPolPrice() {
    for (const url of SOURCES) {
        try {
            const body = await httpsGet(url);
            const data = JSON.parse(body);
            let p;
            if (url.includes('coingecko')) p = data['matic-network']?.usd;
            else p = parseFloat(data.price);
            if (p && p > 0.001) return p;
        } catch (e) { console.error('[PRICE] Fail', url.split('?')[0], e.message); }
    }
    return null;
}

async function getPrice() {
    if (Date.now() - cache.time < 60000 && cache.price > 0) return cache.price;
    const p = await fetchPolPrice();
    if (p) { cache = { price: p, time: Date.now() }; return p; }
    return cache.price || 0;
}

async function getPriceCached() {
    const p = await getPrice();
    return { price: p };
}

module.exports = { getPrice, getPriceCached };
