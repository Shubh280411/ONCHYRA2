/**
 * PostgreSQL connection for ONCHYRA backend
 * Uses DATABASE_URL from .env
 */

const { Pool } = require('pg');
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
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
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
  const columns = Object.keys(data).filter(k => data[k] !== undefined);
  const values = columns.map(c => data[c]);
  const placeholders = values.map((_, i) => `$${i + 2}`);
  const setClauses = columns.map((c, i) => `"${c}" = $${i + 2}`);
  await query(
    `INSERT INTO "${table}" ("${idColumn}", ${columns.map(c => `"${c}"`).join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     ON CONFLICT ("${idColumn}") DO UPDATE SET ${setClauses.join(', ')}`,
    [id, ...values]
  );
}

async function update(table, id, data, idColumn = 'uid') {
  const columns = Object.keys(data).filter(k => data[k] !== undefined);
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

async function all(table, orderBy = null, limit = null) {
  let sql = `SELECT * FROM "${table}"`;
  if (orderBy) sql += ` ORDER BY "${orderBy}" DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  const res = await query(sql);
  return res.rows;
}

async function findWhere(table, conditions, orderBy = null, limit = null) {
  const clauses = Object.keys(conditions).map((c, i) => `"${c}" = $${i + 1}`);
  const values = Object.values(conditions);
  let sql = `SELECT * FROM "${table}" WHERE ${clauses.join(' AND ')}`;
  if (orderBy) sql += ` ORDER BY "${orderBy}" DESC`;
  if (limit) sql += ` LIMIT ${limit}`;
  const res = await query(sql, values);
  return res.rows;
}

async function closePool() {
  if (pool) await pool.end();
}

module.exports = { query, get, set, update, remove, all, findWhere, closePool, getPool };
