const admin = require('firebase-admin');

// In-memory referral code cache (refCode → { uid, name, referredBy })
let refCache = new Map();
let cacheReady = false;

async function buildCache() {
  try {
    const snap = await admin.firestore().collection('users').get();
    refCache.clear();
    snap.forEach(d => {
      const data = d.data();
      if (data.referralCode) {
        refCache.set(data.referralCode.toUpperCase(), {
          uid: d.id,
          name: data.name || '',
          referredBy: data.referredBy || null
        });
      }
    });
    cacheReady = true;
    console.log(`[REF CACHE] Loaded ${refCache.size} referral codes`);
  } catch (e) {
    console.warn('[REF CACHE] Failed to load (quota may be exhausted):', e.message);
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

// Build cache on startup
buildCache();

module.exports = { lookup, add, remove, buildCache, isReady, size };
