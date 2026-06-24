const https = require('https');

const SOURCES = [
    { url: 'https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT', parse: d => parseFloat(d.price) },
    { url: 'https://api.binance.com/api/v3/ticker/price?symbol=MATICUSDT', parse: d => parseFloat(d.price) },
    { url: 'https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd', parse: d => d['matic-network']?.usd },
];

let cache = { price: 0, time: 0 };

async function fetchJson(url) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10000);
    try {
        const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
    } finally { clearTimeout(t); }
}

async function fetchPolPrice() {
    for (const src of SOURCES) {
        try {
            const data = await fetchJson(src.url);
            const p = src.parse(data);
            if (p && p > 0.001) return p;
        } catch (e) { console.error('[PRICE] Fail', src.url.split('?')[0], e.message); }
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
