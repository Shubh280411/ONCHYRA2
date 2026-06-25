// ONCHYRA Supabase Adapter — REST API (no CDN dependency)
// Firebase Auth stays, all data reads/writes go to Supabase PostgreSQL via fetch()

const SUPABASE_URL = "https://kxndpctzygcitgxundnj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bmRwY3R6eWdjaXRneHVuZG5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDMzMDIsImV4cCI6MjA5NzcxOTMwMn0.NUXX9_HNpELPYwpqOqOauzuTBJK_C5sBhINtMGvU8f8";
const REST_URL = SUPABASE_URL + "/rest/v1/";

function rest(path, opts = {}) {
  const { headers: extraHeaders, ...restOpts } = opts;
  const url = new URL(path, REST_URL);
  if (restOpts.params) {
    for (const [k, v] of Object.entries(restOpts.params)) url.searchParams.set(k, v);
  }
  return fetch(url, {
    method: restOpts.method || 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders,
    },
    body: restOpts.body,
  }).then(async r => {
    if (!r.ok && r.status !== 204) {
      const text = await r.text().catch(() => '');
      console.error('REST error:', r.status, r.statusText, text.slice(0, 200));
      throw new Error(r.status + ' ' + r.statusText);
    }
    if (r.status === 204) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) {
      try {
        return deepCamelize(await r.json());
      } catch (e) {
        console.error('REST parse error:', e);
        throw e;
      }
    }
    const text = await r.text();
    if (text) try { return JSON.parse(text); } catch(e) { console.error('REST text parse error:', e); return null; }
    return null;
  }).catch(e => { throw e; });
}

// Convert snake_case keys to camelCase recursively (Firestore compatibility)
function deepCamelize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(deepCamelize);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[snakeToCamel(k)] = deepCamelize(v);
  }
  return out;
}

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function camelToSnake(s) {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
}

// Convert object keys camelCase → snake_case for PostgreSQL writes
function deepSnake(obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepSnake);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[camelToSnake(k)] = deepSnake(v);
  }
  return out;
}

const supabase = { _rest: true };
const db = { _adapter: 'supabase' };

const PK_MAP = { users: 'uid', admins: 'uid', settings: 'key', otpStore: 'email' };

function getTableName(c) {
  const m = { otpStore: 'otp_store', otpLogs: 'otp_logs', depositWallets: 'deposit_wallets', packagePurchases: 'package_purchases', achievementBonuses: 'achievement_bonuses', leadershipRewards: 'leadership_rewards', user_votes: 'poll_votes', pollLog: 'poll_logs', prediction_bets: 'prediction_bets', contestParticipants: 'contest_participants', allTransfers: 'all_transfers', admin_transactions: 'admin_transactions', auditLogs: 'audit_logs' };
  return m[c] || c;
}
function getPK(c) { return PK_MAP[c] || 'id'; }

function doc(_, collection, id) { return { _collection: collection, _id: id, _isDoc: true }; }
function collection(_, name) { return { _collection: name, _isCollection: true }; }

class DocSnapshot {
  constructor(id, data) { this.id = id; this._data = data; }
  exists() { return this._data != null; }
  data() { return this._data; }
}
class QuerySnapshot {
  constructor(docs, pk) { 
    this.docs = docs.map(d => new DocSnapshot(d[pk] || d.id, d));
    this.size = docs.length; this.empty = docs.length === 0;
  }
  forEach(fn) { this.docs.forEach(fn); }
}

function buildUrl(table, filters, orders, limitVal, startAfterCursor) {
  const params = { select: '*' };
  for (const f of filters) {
    const sfield = camelToSnake(f.field);
    if (f.op === '==') params[sfield] = 'eq.' + f.val;
    else if (f.op === '<') params[sfield] = 'lt.' + f.val;
    else if (f.op === '<=') params[sfield] = 'lte.' + f.val;
    else if (f.op === '>') params[sfield] = 'gt.' + f.val;
    else if (f.op === '>=') params[sfield] = 'gte.' + f.val;
    else if (f.op === '!=') params[sfield] = 'neq.' + f.val;
    else if (f.op === 'in') params[sfield] = 'in.(' + f.val.map(encodeURIComponent).join(',') + ')';
  }
  if (orders.length) {
    params.order = orders.map(o => camelToSnake(o.field) + (o.dir === 'desc' ? '.desc' : '.asc')).join(',');
  }
  if (limitVal) params.limit = limitVal;
  return { _table: table, _params: params, _filters: filters };
}

async function getDoc(ref) {
  const table = getTableName(ref._collection);
  const pk = getPK(ref._collection);
  try {
    const data = await rest(table, { params: { select: '*', [pk]: 'eq.' + ref._id } });
    return new DocSnapshot(ref._id, Array.isArray(data) && data.length ? data[0] : null);
  } catch (e) { console.error('getDoc error:', e); return new DocSnapshot(ref._id, null); }
}

async function getDocs(queryRef) {
  let table, filters = [], orders = [], limitVal = null, startAfterCursor = null;
  if (queryRef._isCollection) { table = getTableName(queryRef._collection); }
  else if (queryRef._isQuery) { table = getTableName(queryRef._collection); filters = queryRef._filters || []; orders = queryRef._orders || []; limitVal = queryRef._limit || null; startAfterCursor = queryRef._startAfter; }
  else throw new Error('getDocs requires a collection or query');

  if (startAfterCursor && startAfterCursor.docRef) {
    const cursorSnap = await getDoc(startAfterCursor.docRef);
    if (cursorSnap.exists()) {
      const cursorData = cursorSnap.data();
      if (orders.length > 0) {
        const val = cursorData[orders[0].field];
        if (val !== undefined) filters.push({ field: orders[0].field, op: '>', val });
      }
    }
  }

  try {
    const params = { select: '*' };
    for (const f of filters) {
      const sfield = camelToSnake(f.field);
      if (f.op === '==') params[sfield] = 'eq.' + f.val;
      else if (f.op === '<') params[sfield] = 'lt.' + f.val;
      else if (f.op === '<=') params[sfield] = 'lte.' + f.val;
      else if (f.op === '>') params[sfield] = 'gt.' + f.val;
      else if (f.op === '>=') params[sfield] = 'gte.' + f.val;
      else if (f.op === '!=') params[sfield] = 'neq.' + f.val;
      else if (f.op === 'in') params[sfield] = 'in.(' + f.val.map(encodeURIComponent).join(',') + ')';
      else if (f.op === 'array-contains') params[sfield] = 'cs.{"' + f.val + '"}';
    }
    if (orders.length) params.order = orders.map(o => camelToSnake(o.field) + (o.dir === 'desc' ? '.desc' : '.asc')).join(',');
    params.limit = limitVal || 100000;

    const pk = getPK(table);
    const data = await rest(table, { params });
    return new QuerySnapshot(Array.isArray(data) ? data : [], pk);
  } catch (e) { console.error('getDocs error:', e); return new QuerySnapshot([], 'id'); }
}

async function setDoc(ref, data) {
  const table = getTableName(ref._collection);
  const pk = getPK(ref._collection);
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || (v && v._isIncrement)) continue;
    clean[k] = v;
  }
  clean[pk] = ref._id;
  for (const [k, v] of Object.entries(clean)) {
    if (v && typeof v === 'object' && v.seconds !== undefined) clean[k] = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  }
  try {
    await rest(table, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(deepSnake(clean)) });
  } catch (e) { console.error('setDoc error:', e); }
}

async function updateDoc(ref, data) {
  const table = getTableName(ref._collection);
  const pk = getPK(ref._collection);
  const regular = {}; const increments = []; const arrayUnions = []; const arrayRemoves = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && v._isIncrement) increments.push({ field: camelToSnake(k), cfield: k, amount: v.value });
    else if (v && v._isArrayUnion) arrayUnions.push({ field: camelToSnake(k), cfield: k, values: v.values });
    else if (v && v._isArrayRemove) arrayRemoves.push({ field: camelToSnake(k), cfield: k, values: v.values });
    else regular[camelToSnake(k)] = v;
  }
  for (const [k, v] of Object.entries(regular)) {
    if (v && typeof v === 'object' && v.seconds !== undefined) regular[k] = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  }
  try {
    if (Object.keys(regular).length > 0) await rest(table, { method: 'PATCH', params: { [pk]: 'eq.' + ref._id }, body: JSON.stringify(regular) });
    for (const inc of increments) {
      const rows = await rest(table, { params: { select: inc.field, [pk]: 'eq.' + ref._id } });
      const current = rows && rows.length ? (Number(rows[0][inc.cfield]) || 0) : 0;
      await rest(table, { method: 'PATCH', params: { [pk]: 'eq.' + ref._id }, body: JSON.stringify({ [inc.field]: current + inc.amount }) });
    }
    for (const au of arrayUnions) {
      const rows = await rest(table, { params: { select: au.field, [pk]: 'eq.' + ref._id } });
      let arr = rows && rows.length ? rows[0][au.cfield] : [];
      if (!Array.isArray(arr)) arr = [];
      for (const v of au.values) { if (!arr.includes(v)) arr.push(v); }
      await rest(table, { method: 'PATCH', params: { [pk]: 'eq.' + ref._id }, body: JSON.stringify({ [au.field]: arr }) });
    }
    for (const ar of arrayRemoves) {
      const rows = await rest(table, { params: { select: ar.field, [pk]: 'eq.' + ref._id } });
      let arr = rows && rows.length ? rows[0][ar.cfield] : [];
      if (!Array.isArray(arr)) arr = [];
      arr = arr.filter(v => !ar.values.includes(v));
      await rest(table, { method: 'PATCH', params: { [pk]: 'eq.' + ref._id }, body: JSON.stringify({ [ar.field]: arr }) });
    }
  } catch (e) { console.error('updateDoc error:', e); }
}

async function deleteDoc(ref) {
  try { await rest(getTableName(ref._collection), { method: 'DELETE', params: { [getPK(ref._collection)]: 'eq.' + ref._id } }); }
  catch (e) { console.error('deleteDoc error:', e); }
}

async function addDoc(collectionRef, data) {
  const table = getTableName(collectionRef._collection);
  const pk = getPK(collectionRef._collection);
  const clean = {};
  for (const [k, v] of Object.entries(data)) { if (v !== undefined && !(v && v._isIncrement)) clean[k] = v; }
  for (const [k, v] of Object.entries(clean)) { if (v && typeof v === 'object' && v.seconds !== undefined) clean[k] = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6); }
  if (!clean[pk]) clean[pk] = crypto.randomUUID();
  try { await rest(table, { method: 'POST', body: JSON.stringify(deepSnake(clean)) }); } catch (e) { console.error('addDoc error:', e); }
  return { id: clean[pk] };
}

function query(collectionRef, ...args) {
  const q = { _isQuery: true, _collection: collectionRef._collection, _filters: [], _orders: [], _limit: null, _startAfter: null };
  for (const a of args) { if (a._isWhere) q._filters.push(a); else if (a._isOrderBy) q._orders.push(a); else if (a._isLimit) q._limit = a._val; else if (a._isStartAfter) q._startAfter = a; }
  return q;
}
function where(field, op, val) { return { field, op, val, _isWhere: true }; }
function orderBy(field, dir = 'asc') { return { field, dir, _isOrderBy: true }; }
function limit(n) { return { _isLimit: true, _val: n }; }

function onSnapshot(ref, callback) {
  let lastJson = '';
  async function poll() {
    try {
      let result;
      if (ref._isDoc) { result = await getDoc(ref); const j = JSON.stringify(result._data); if (j !== lastJson) { lastJson = j; callback(result); } }
      else { result = await getDocs(ref); callback(result); }
    } catch (e) { console.error('poll error:', e); }
  }
  poll(); const interval = setInterval(poll, 2000);
  return () => clearInterval(interval);
}

function serverTimestamp() { return Date.now(); }
function increment(n = 1) { return { _isIncrement: true, value: Number(n) }; }

async function getCountFromServer(q) {
  try {
    const snap = await getDocs(q);
    return { data: () => ({ count: snap.docs.length }) };
  } catch (e) {
    console.error('getCountFromServer error:', e);
    return { data: () => ({ count: 0 }) };
  }
}

function writeBatch(db) {
  const ops = [];
  return {
    update(ref, data) { ops.push({ type: 'update', ref, data }); return this; },
    delete(ref) { ops.push({ type: 'delete', ref }); return this; },
    set(ref, data) { ops.push({ type: 'set', ref, data }); return this; },
    async commit() { for (const op of ops) { if (op.type === 'update') await updateDoc(op.ref, op.data); else if (op.type === 'delete') await deleteDoc(op.ref); else if (op.type === 'set') await setDoc(op.ref, op.data); } }
  };
}
function startAfter(docRef) { return { _isStartAfter: true, docRef }; }

const Timestamp = {
  fromDate(d) { return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toMillis: () => d.getTime(), toDate: () => d }; },
  now() { const d = new Date(); return this.fromDate(d); },
  fromMillis(ms) { return this.fromDate(new Date(ms)); }
};

function arrayUnion(...vals) { return { _isArrayUnion: true, values: vals }; }
function arrayRemove(...vals) { return { _isArrayRemove: true, values: vals }; }

export {
  supabase, db, doc, collection,
  getDoc, setDoc, updateDoc, deleteDoc, getDocs, addDoc,
  query, where, orderBy, limit,
  onSnapshot, serverTimestamp, increment,
  getCountFromServer, writeBatch, startAfter, Timestamp,
  arrayUnion, arrayRemove,
};
