/**
 * PostgreSQL connection for ONCHYRA backend
 * Enhanced with helpers for Firestore-compatible operations
 */

const { Pool } = require('pg');
const dns = require('dns');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

function getPool() {
  if (!pool) {
    if (!DATABASE_URL) {
      console.warn('WARN: DATABASE_URL not set, PostgreSQL not available');
      return null;
    }
    const url = new URL(DATABASE_URL);
    pool = new Pool({
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: url.pathname.replace(/^\//, ''),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      lookup: (host, opts, cb) => {
        dns.lookup(host, { ...opts, family: 4 }, cb);
      },
    });
    pool.on('error', (e) => console.error('PG pool error:', e.message));
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  if (!p) return { rows: [] };
  return p.query(text, params);
}

async function get(table, id, idColumn = 'uid') {
  const res = await query(`SELECT * FROM "${table}" WHERE "${idColumn}" = $1`, [id]);
  return res.rows[0] || null;
}

async function set(table, id, data, idColumn = 'uid') {
  data[idColumn] = id;
  const columns = Object.keys(data).filter(k => data[k] !== undefined);
  const values = columns.map(c => data[c]);
  const placeholders = values.map((_, i) => `$${i + 2}`);
  const setClauses = columns.map((c, i) => `"${c}" = $${i + 2}`);
  const colList = columns.map(c => `"${c}"`);
  await query(
    `INSERT INTO "${table}" ("${idColumn}", ${colList.join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     ON CONFLICT ("${idColumn}") DO UPDATE SET ${setClauses.join(', ')}`,
    [id, ...values]
  );
}

async function update(table, id, data, idColumn = 'uid') {
  const columns = Object.keys(data).filter(k => data[k] !== undefined);
  if (!columns.length) return;
  const setClauses = columns.map((c, i) => `"${c}" = $${i + 2}`);
  const values = columns.map(c => data[c]);
  await query(
    `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "${idColumn}" = $1`,
    [id, ...values]
  );
}

async function remove(table, id, idColumn = 'uid') {
  await query(`DELETE FROM "${table}" WHERE "${idColumn}" = $1`, [id]);
}

async function all(table, orderByCol = null, limitVal = null) {
  let sql = `SELECT * FROM "${table}"`;
  if (orderByCol) sql += ` ORDER BY "${orderByCol}" DESC`;
  if (limitVal) sql += ` LIMIT ${limitVal}`;
  const res = await query(sql);
  return res.rows;
}

async function findWhere(table, conditions, orderByCol = null, limitVal = null) {
  const clauses = Object.keys(conditions).map((c, i) => `"${c}" = $${i + 1}`);
  const values = Object.values(conditions);
  let sql = `SELECT * FROM "${table}" WHERE ${clauses.join(' AND ')}`;
  if (orderByCol) sql += ` ORDER BY "${orderByCol}" DESC`;
  if (limitVal) sql += ` LIMIT ${limitVal}`;
  const res = await query(sql, values);
  return res.rows;
}

// Increment a field by amount
async function increment(table, id, field, amount, idColumn = 'uid') {
  await query(
    `UPDATE "${table}" SET "${field}" = COALESCE("${field}", 0) + $1 WHERE "${idColumn}" = $2`,
    [amount, id]
  );
}

// Multiple increments in a single query
async function incrementMulti(table, id, fields, idColumn = 'uid') {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined && v !== 0);
  if (!entries.length) return;
  const setClauses = entries.map(([f], i) => `"${f}" = COALESCE("${f}", 0) + $${i + 2}`);
  const values = entries.map(([, v]) => v);
  await query(
    `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "${idColumn}" = $1`,
    [id, ...values]
  );
}

// Array append (PostgreSQL array or JSONB)
async function arrayAppend(table, id, field, value, idColumn = 'uid') {
  const str = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
  await query(
    `UPDATE "${table}" SET "${field}" = COALESCE("${field}", '[]'::jsonb) || $1::jsonb WHERE "${idColumn}" = $2`,
    [JSON.stringify(value == null ? null : value), id]
  );
}

// WHERE IN query
async function findWhereIn(table, field, values, orderByCol = null, limitVal = null) {
  if (!values || !values.length) return [];
  const placeholders = values.map((_, i) => `$${i + 1}`);
  let sql = `SELECT * FROM "${table}" WHERE "${field}" IN (${placeholders.join(',')})`;
  if (orderByCol) sql += ` ORDER BY "${orderByCol}" DESC`;
  if (limitVal) sql += ` LIMIT ${limitVal}`;
  const res = await query(sql, values);
  return res.rows;
}

// Get count
async function countWhere(table, conditions = {}) {
  const clauses = Object.keys(conditions).map((c, i) => `"${c}" = $${i + 1}`);
  const values = Object.values(conditions);
  let sql = `SELECT COUNT(*) as cnt FROM "${table}"`;
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  const res = await query(sql, values);
  return parseInt(res.rows[0]?.cnt || 0);
}

// Paginated query
async function findPaginated(table, conditions, orderByCol, limitVal, offsetVal) {
  const clauses = Object.keys(conditions).map((c, i) => `"${c}" = $${i + 1}`);
  const values = Object.values(conditions);
  let sql = `SELECT * FROM "${table}"`;
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  if (orderByCol) sql += ` ORDER BY "${orderByCol}" DESC`;
  sql += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  const res = await query(sql, [...values, limitVal, offsetVal]);
  return res.rows;
}

async function closePool() {
  if (pool) await pool.end();
}

module.exports = {
  query, get, set, update, remove, all, findWhere,
  findWhereIn, increment, incrementMulti, arrayAppend,
  countWhere, findPaginated, closePool, getPool
};
