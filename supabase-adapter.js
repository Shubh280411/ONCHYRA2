// ONCHYRA Supabase Adapter
// Drop-in replacement for Firebase Firestore API using Supabase
// Firebase Auth stays, Firestore replaced with Supabase PostgreSQL

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://kxndpctzygcitgxundnj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bmRwY3R6eWdjaXRneHVuZG5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDMzMDIsImV4cCI6MjA5NzcxOTMwMn0.NUXX9_HNpELPYwpqOqOauzuTBJK_C5sBhINtMGvU8f8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Dummy db reference for API compatibility — adapter ignores it
const db = { _adapter: 'supabase' };

// Map collection names to their primary key column
const PK_MAP = {
  users: 'uid',
  admins: 'uid',
  settings: 'key',
  otpStore: 'email',  // Actually otp_store in DB, but code uses 'otpStore'
};

function getTableName(collection) {
  // Handle camelCase → snake_case for collection names
  const map = {
    otpStore: 'otp_store',
    otpLogs: 'otp_logs',
    depositWallets: 'deposit_wallets',
    packagePurchases: 'package_purchases',
    achievementBonuses: 'achievement_bonuses',
    leadershipRewards: 'leadership_rewards',
    user_votes: 'poll_votes',
    pollLog: 'poll_logs',
    prediction_bets: 'prediction_bets',
    contestParticipants: 'contest_participants',
    allTransfers: 'all_transfers',
    admin_transactions: 'admin_transactions',
    auditLogs: 'audit_logs',
  };
  return map[collection] || collection;
}

function getPK(collection) {
  return PK_MAP[collection] || 'id';
}

// --- Firestore-compatible wrappers ---

// doc(db, collection, id) -> reference object
function doc(db, collection, id) {
  return { _collection: collection, _id: id, _isDoc: true };
}

// collection(db, name) -> reference object
function collection(db, name) {
  return { _collection: name, _isCollection: true };
}

// Snapshot class mimicking Firestore's getDoc result
class DocSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
  }
  exists() { return this._data != null; }
  data() { return this._data; }
}

// Query snapshot mimicking Firestore getDocs result
class QuerySnapshot {
  constructor(docs) {
    this.docs = docs.map(d => new DocSnapshot(d.id, d));
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(fn) { this.docs.forEach(fn); }
}

// --- Read Operations ---

async function getDoc(ref) {
  if (!ref._isDoc) throw new Error('getDoc requires a doc reference');
  const table = getTableName(ref._collection);
  const pk = getPK(ref._collection);
  const { data, error } = await supabase.from(table).select('*').eq(pk, ref._id).maybeSingle();
  if (error) { console.error('getDoc error:', error); return new DocSnapshot(ref._id, null); }
  return new DocSnapshot(ref._id, data || null);
}

async function getDocs(queryRef) {
  // Handle both raw collection ref and query objects
  let table, filters = [], orders = [], limitVal = null;
  
  if (queryRef._isCollection) {
    table = getTableName(queryRef._collection);
  } else if (queryRef._isQuery) {
    table = getTableName(queryRef._collection);
    filters = queryRef._filters || [];
    orders = queryRef._orders || [];
    limitVal = queryRef._limit || null;
  } else {
    throw new Error('getDocs requires a collection or query reference');
  }

  let q = supabase.from(table).select('*');
  
  for (const f of filters) {
    if (f.op === '==') q = q.eq(f.field, f.val);
    else if (f.op === '<') q = q.lt(f.field, f.val);
    else if (f.op === '<=') q = q.lte(f.field, f.val);
    else if (f.op === '>') q = q.gt(f.field, f.val);
    else if (f.op === '>=') q = q.gte(f.field, f.val);
    else if (f.op === '!=') q = q.neq(f.field, f.val);
    else if (f.op === 'in') q = q.in(f.field, f.val);
    else if (f.op === 'array-contains') q = q.contains(f.field, f.val);
  }
  
  for (const o of orders) {
    q = q.order(o.field, { ascending: o.dir !== 'desc' });
  }

  if (queryRef._startAfter && queryRef._startAfter.docRef) {
    const cursorSnap = await getDoc(queryRef._startAfter.docRef);
    if (cursorSnap.exists()) {
      const cursorData = cursorSnap.data();
      if (orders.length > 0) {
        const orderField = orders[0].field;
        const cursorVal = cursorData[orderField];
        if (cursorVal !== undefined) {
          q = q.gt(orderField, cursorVal);
        }
      }
    }
  }
  
  if (limitVal) q = q.limit(limitVal);

  const { data, error } = await q;
  if (error) { console.error('getDocs error:', error); return new QuerySnapshot([]); }
  return new QuerySnapshot(data || []);
}

// --- Write Operations ---

async function setDoc(ref, data, options) {
  if (!ref._isDoc) throw new Error('setDoc requires a doc reference');
  const table = getTableName(ref._collection);
  const pk = getPK(ref._collection);
  
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    // Skip increment markers in setDoc
    if (v && v._isIncrement) continue;
    clean[k] = v;
  }
  clean[pk] = ref._id;
  
  // Handle Timestamp objects
  for (const [k, v] of Object.entries(clean)) {
    if (v && typeof v === 'object' && v.seconds !== undefined) {
      clean[k] = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    }
  }

  const { error } = await supabase.from(table).upsert(clean, { onConflict: pk });
  if (error) console.error('setDoc error:', error);
}

async function updateDoc(ref, data) {
  if (!ref._isDoc) throw new Error('updateDoc requires a doc reference');
  const table = getTableName(ref._collection);
  const pk = getPK(ref._collection);
  
  const regular = {};
  const increments = [];
  const arrayUnions = [];
  const arrayRemoves = [];
  
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && v._isIncrement) {
      increments.push({ field: k, amount: v.value });
    } else if (v && v._isArrayUnion) {
      arrayUnions.push({ field: k, values: v.values });
    } else if (v && v._isArrayRemove) {
      arrayRemoves.push({ field: k, values: v.values });
    } else {
      regular[k] = v;
    }
  }
  
  // Handle Timestamp objects
  for (const [k, v] of Object.entries(regular)) {
    if (v && typeof v === 'object' && v.seconds !== undefined) {
      regular[k] = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    }
  }

  // Apply regular updates
  if (Object.keys(regular).length > 0) {
    const { error } = await supabase.from(table).update(regular).eq(pk, ref._id);
    if (error) console.error('updateDoc error:', error);
  }
  
  // Handle increments (read current + add)
  for (const inc of increments) {
    const { data: row, error: readErr } = await supabase
      .from(table).select(inc.field).eq(pk, ref._id).maybeSingle();
    if (readErr) { console.error('increment read error:', readErr); continue; }
    const current = row ? (Number(row[inc.field]) || 0) : 0;
    const { error: updErr } = await supabase
      .from(table).update({ [inc.field]: current + inc.amount }).eq(pk, ref._id);
    if (updErr) console.error('increment update error:', updErr);
  }
  
  // Handle arrayUnion (read current array + add unique values)
  for (const au of arrayUnions) {
    const { data: row, error: readErr } = await supabase
      .from(table).select(au.field).eq(pk, ref._id).maybeSingle();
    if (readErr) { console.error('arrayUnion read error:', readErr); continue; }
    let arr = row?.[au.field] || [];
    if (!Array.isArray(arr)) arr = [];
    for (const v of au.values) {
      if (!arr.includes(v)) arr.push(v);
    }
    const { error: updErr } = await supabase
      .from(table).update({ [au.field]: arr }).eq(pk, ref._id);
    if (updErr) console.error('arrayUnion update error:', updErr);
  }
  
  // Handle arrayRemove (read current array + remove values)
  for (const ar of arrayRemoves) {
    const { data: row, error: readErr } = await supabase
      .from(table).select(ar.field).eq(pk, ref._id).maybeSingle();
    if (readErr) { console.error('arrayRemove read error:', readErr); continue; }
    let arr = row?.[ar.field] || [];
    if (!Array.isArray(arr)) arr = [];
    arr = arr.filter(v => !ar.values.includes(v));
    const { error: updErr } = await supabase
      .from(table).update({ [ar.field]: arr }).eq(pk, ref._id);
    if (updErr) console.error('arrayRemove update error:', updErr);
  }
}

async function deleteDoc(ref) {
  if (!ref._isDoc) throw new Error('deleteDoc requires a doc reference');
  const table = getTableName(ref._collection);
  const pk = getPK(ref._collection);
  const { error } = await supabase.from(table).delete().eq(pk, ref._id);
  if (error) console.error('deleteDoc error:', error);
}

async function addDoc(collectionRef, data) {
  const table = getTableName(collectionRef._collection);
  const pk = getPK(collectionRef._collection);
  
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && v._isIncrement) continue;
    clean[k] = v;
  }
  
  // Handle Timestamp objects
  for (const [k, v] of Object.entries(clean)) {
    if (v && typeof v === 'object' && v.seconds !== undefined) {
      clean[k] = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    }
  }
  
  // If no ID provided, let Supabase generate one (UUID)
  if (!clean[pk]) clean[pk] = crypto.randomUUID();

  const { error } = await supabase.from(table).insert(clean);
  if (error) console.error('addDoc error:', error);
  return { id: clean[pk] };
}

// --- Query builder ---

function query(collectionRef, ...args) {
  const q = { _isQuery: true, _collection: collectionRef._collection, _filters: [], _orders: [], _limit: null, _startAfter: null };
  for (const a of args) {
    if (a._isWhere) q._filters.push(a);
    else if (a._isOrderBy) q._orders.push(a);
    else if (a._isLimit) q._limit = a._val;
    else if (a._isStartAfter) q._startAfter = a;
  }
  return q;
}

function where(field, op, val) {
  return { field, op, val, _isWhere: true };
}

function orderBy(field, dir = 'asc') {
  return { field, dir, _isOrderBy: true };
}

function limit(n) {
  return { _isLimit: true, _val: n };
}

// --- Real-time (polling fallback) ---
// Firestore's onSnapshot uses realtime; we poll every 2 seconds
// For document changes
function onSnapshot(ref, callback) {
  let lastData = null;
  let lastJson = '';
  
  async function poll() {
    try {
      let result;
      if (ref._isDoc) {
        result = await getDoc(ref);
        const json = JSON.stringify(result._data);
        if (json !== lastJson) {
          lastJson = json;
          callback(result);
        }
      } else {
        result = await getDocs(ref);
        callback(result);
      }
    } catch(e) { console.error('poll error:', e); }
  }
  
  poll();
  const interval = setInterval(poll, 2000);
  return () => clearInterval(interval);
}

// --- Server Timestamp ---
function serverTimestamp() {
  return Date.now();
}

// --- Increment helper (returns marker for updateDoc to handle atomically) ---
function increment(n = 1) {
  return { _isIncrement: true, value: Number(n) };
}

// --- getCountFromServer stub ---
async function getCountFromServer(q) {
  const snap = await getDocs(q);
  const count = snap.docs.length;
  return { data: () => ({ count }) };
}

// --- writeBatch stub (sequential updates) ---
function writeBatch(db) {
  const ops = [];
  return {
    update(ref, data) { ops.push({ type: 'update', ref, data }); return this; },
    delete(ref) { ops.push({ type: 'delete', ref }); return this; },
    set(ref, data) { ops.push({ type: 'set', ref, data }); return this; },
    async commit() {
      for (const op of ops) {
        if (op.type === 'update') await updateDoc(op.ref, op.data);
        else if (op.type === 'delete') await deleteDoc(op.ref);
        else if (op.type === 'set') await setDoc(op.ref, op.data);
      }
    }
  };
}

// --- startAfter stub ---
function startAfter(docRef) {
  return { _isStartAfter: true, docRef };
}

// --- Timestamp stub ---
const Timestamp = {
  fromDate(date) { return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0, toMillis: () => date.getTime(), toDate: () => date }; },
  now() { const d = new Date(); return this.fromDate(d); },
  fromMillis(ms) { return this.fromDate(new Date(ms)); }
};

// --- arrayUnion / arrayRemove (markers for updateDoc to handle) ---
function arrayUnion(...vals) {
  return { _isArrayUnion: true, values: vals };
}
function arrayRemove(...vals) {
  return { _isArrayRemove: true, values: vals };
}

// Export all functions matching Firestore API
export {
  supabase,
  db,
  doc,
  collection,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  getCountFromServer,
  writeBatch,
  startAfter,
  Timestamp,
  arrayUnion,
  arrayRemove,
};
