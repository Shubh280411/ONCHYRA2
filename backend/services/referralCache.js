const pg = require('../config/pg');

let refCache = new Map();
let cacheReady = false;

async function buildCache() {
  try {
    const rows = await pg.all('users');
    refCache.clear();
    for (const row of rows) {
      if (row.referral_code) {
        refCache.set(row.referral_code.toUpperCase(), {
          uid: row.uid,
          name: row.name || '',
          referredBy: row.referred_by || null
        });
      }
    }
    cacheReady = true;
    console.log(`[REF CACHE] Loaded ${refCache.size} referral codes from PostgreSQL`);
  } catch (e) {
    console.warn('[REF CACHE] Failed to load from PostgreSQL:', e.message);
    cacheReady = false;
  }
}

function lookup(code) {
  if (!code) return null;
  return refCache.get(code.toUpperCase()) || null;
}

function add(code, uid, name, referredBy) {
  if (code) refCache.set(code.toUpperCase(), { uid, name, referredBy: referredBy || null });
}

function remove(code) {
  if (code) refCache.delete(code.toUpperCase());
}

function isReady() { return cacheReady; }
function size() { return refCache.size; }

buildCache();

module.exports = { lookup, add, remove, buildCache, isReady, size };
