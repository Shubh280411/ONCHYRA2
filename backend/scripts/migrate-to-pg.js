const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const SCHEMA_ONLY = args.includes('--schema-only');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

function findBackupDir() {
  const base = path.resolve(__dirname, '..');
  const dirs = fs.readdirSync(base).filter(d => d.startsWith('backup-')).sort().reverse();
  if (dirs.length === 0) {
    console.error('No backup-* folder found in backend/');
    process.exit(1);
  }
  return path.join(base, dirs[0]);
}

const BACKUP_DIR = findBackupDir();
console.log('Backup folder:', BACKUP_DIR);

const TABLES = {
  'users': { table: 'users', idField: '_id', idColumn: 'uid', fields: {} },
  'admins': { table: 'admins', idField: '_id', idColumn: 'uid', fields: {} },
  'withdrawals': { table: 'withdrawals', idField: '_id', idColumn: 'id', fields: {} },
  'deposits': { table: 'deposits', idField: '_id', idColumn: 'id', fields: {} },
  'depositWallets': { table: 'deposit_wallets', idField: '_id', idColumn: 'id', fields: { packageId: 'package_id' } },
  'packagePurchases': { table: 'package_purchases', idField: '_id', idColumn: 'id', fields: { packageId: 'package_id' } },
  'commissions': { table: 'commissions', idField: '_id', idColumn: 'id', fields: { fromUid: 'from_uid', packageName: 'package_name', fromName: 'from_name' } },
  'achievementBonuses': { table: 'achievement_bonuses', idField: '_id', idColumn: 'id', fields: {} },
  'leadershipRewards': { table: 'leadership_rewards', idField: '_id', idColumn: 'id', fields: {} },
  'transfers': { table: 'p2p_transfers', idField: '_id', idColumn: 'id', fields: { from: 'from_uid', to: 'to_uid', toCode: 'to_code', fromName: 'from_name', toName: 'to_name', amount: 'gross_amount', receive: 'net_amount' } },
  'claims': { table: 'claims', idField: '_id', idColumn: 'id', fields: { userId: 'user_id', previousBalance: 'previous_balance', claimedBalance: 'claimed_balance', claimedAmount: 'claimed_amount', previousStreak: 'previous_streak', claimedStreak: 'claimed_streak', timeSinceLastClaim: 'time_since_last_claim', clientTimestamp: 'client_timestamp' } },
  'notifications': { table: 'notifications', idField: '_id', idColumn: 'id', fields: { userId: 'user_id', readBy: 'read_by', read: 'read_by' } },
  'polls': { table: 'polls', idField: '_id', idColumn: 'id', fields: {} },
  'user_votes': { table: 'poll_votes', idField: '_id', idColumn: 'id', fields: { pollId: 'poll_id' } },
  'updates': { table: 'updates', idField: '_id', idColumn: 'id', fields: {} },
  'admin_transactions': { table: 'admin_transactions', idField: '_id', idColumn: 'id', fields: { adminId: 'admin_id', targetUserId: 'target_user_id', targetUserName: 'target_user_name', previousBalance: 'previous_balance', newBalance: 'new_balance' } },
  'auditLogs': { table: 'audit_logs', idField: '_id', idColumn: 'id', fields: {} },
  'predictions': { table: 'predictions', idField: '_id', idColumn: 'id', fields: { startPrice: 'start_price', endPrice: 'end_price', totalBets: 'total_bets', totalPool: 'total_pool', startTime: 'start_time', endTime: 'end_time', assetId: 'asset_id', upPool: 'up_pool', downPool: 'down_pool', upCount: 'up_count', downCount: 'down_count', createdAt: 'created_at' } },
  'prediction_bets': { table: 'prediction_bets', idField: '_id', idColumn: 'id', fields: { userId: 'user_id', roundId: 'round_id' } },
  'contests': { table: 'contests', idField: '_id', idColumn: 'id', fields: { endTime: 'end_time', startTime: 'start_time', rewardPool: 'reward_pool' } },
  'contestParticipants': { table: 'contest_participants', idField: '_id', idColumn: 'id', fields: { contestId: 'contest_id', userId: 'user_id', walletAddress: 'wallet_address', joinTime: 'join_time', joinReferrals: 'join_referrals', joinRefLevel1: 'join_ref_level1', joinRefLevel2: 'join_ref_level2', joinRefLevel3: 'join_ref_level3', addedByAdmin: 'added_by_admin', scoreType: 'score_type', contestReferrals: 'contest_referrals' } },
  'otps': { table: 'otps', idField: '_id', idColumn: 'id', fields: { expiresAt: 'expires_at', usedAt: 'used_at' } },
  'otpStore': { table: 'otp_store', idField: 'email', idColumn: 'email', fields: { expiresAt: 'expires_at', cooldownUntil: 'cooldown_until' } },
  'otpLogs': { table: 'otp_logs', idField: '_id', idColumn: 'id', fields: {} },
  'powerdrops': { table: 'powerdrops', idField: '_id', idColumn: 'id', fields: { maxParticipants: 'max_participants', participantsCount: 'participants_count', winnersCount: 'winners_count', startTime: 'start_time' } },
  'settings': { table: 'settings', idField: '_id', idColumn: 'key', fields: {} },
  'pollLog': { table: 'poll_logs', idField: '_id', idColumn: 'id', fields: { adminEmail: 'admin_email' } },
};

function mapFields(data, mapping) {
  const row = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === '_participants') continue;
    // Skip _id if a matching idColumn already exists in data
    if (key === '_id') {
      if (!data[mapping.idColumn]) {
        row[mapping.idColumn] = value;
      }
      continue;
    }
    if (key === 'timestamp') continue;
    const pgField = mapping.fields[key] || key.replace(/([A-Z])/g, '_$1').toLowerCase();
    let val = value;
    // Convert Firestore Timestamp objects
    if (val && typeof val === 'object' && val._seconds !== undefined) {
      val = new Date(val._seconds * 1000).getTime();
    } else if (val && typeof val === 'object' && val.seconds !== undefined) {
      val = new Date(val.seconds * 1000).getTime();
    }
    // Convert ISO date strings to milliseconds
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
      val = new Date(val).getTime();
    }
    // Convert booleans to 0/1 for numeric columns
    if (typeof val === 'boolean') {
      val = val ? 1 : 0;
    }
    // Convert string booleans
    if (typeof val === 'string' && (val === 'true' || val === 'false')) {
      val = val === 'true' ? 1 : 0;
    }
    // JSON-stringify objects and arrays for JSONB columns
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date) && typeof val !== 'number' && typeof val !== 'string' && typeof val !== 'boolean') {
      val = JSON.stringify(val);
    }
    if (val && Array.isArray(val)) {
      val = JSON.stringify(val);
    }
    if (val && typeof val === 'object' && val instanceof Date) {
      val = val.getTime();
    }
    row[pgField] = val;
  }
  return row;
}

async function runSchema() {
  console.log('Creating schema...');
  const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schemaSQL);
  console.log('Schema created');
}

async function disableTriggers() {
  await pool.query('SET session_replication_role = replica');
  console.log('Triggers disabled (FK bypass)');
}

async function enableTriggers() {
  await pool.query('SET session_replication_role = DEFAULT');
  console.log('Triggers re-enabled');
}

async function migrateTable(jsonFile, mapping) {
  const filePath = path.join(BACKUP_DIR, jsonFile + '.json');
  if (!fs.existsSync(filePath)) {
    console.log('  SKIP ' + jsonFile + ': file not found');
    return 0;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    console.log('  SKIP ' + jsonFile + ': empty');
    return 0;
  }

  let inserted = 0;
  let errors = 0;
  const table = mapping.table;
  const idCol = mapping.idColumn;
  const idField = mapping.idField;

  for (const doc of raw) {
    try {
      const row = mapFields(doc, mapping);
      const id = row[idCol] || (idField === 'email' ? doc[idField] : doc._id);
      if (!id) continue;

      // Remove idCol from row since we pass it as $1 separately
      delete row[idCol];
      const columns = Object.keys(row).filter(k => row[k] !== undefined);
      const values = columns.map(c => row[c]);
      const placeholders = values.map((_, i) => '$' + (i + 2)); // $2..$N since $1 is uid
      const sql = 'INSERT INTO "' + table + '" ("' + idCol + '", ' + columns.map(c => '"' + c + '"').join(', ') + ') VALUES ($1, ' + placeholders.join(', ') + ') ON CONFLICT ("' + idCol + '") DO NOTHING';
      await pool.query(sql, [id, ...values]);
      inserted++;

      if (doc._participants && Array.isArray(doc._participants)) {
        for (const p of doc._participants) {
          try {
            const ptime = p.joinedAt && p.joinedAt._seconds ? new Date(p.joinedAt._seconds * 1000).getTime() : Date.now();
            await pool.query(
              'INSERT INTO powerdrop_participants ("event_id", "id", "address", "joined_at") VALUES ($1, $2, $3, $4) ON CONFLICT ("id") DO NOTHING',
              [id, p._id, p.address, ptime]
            );
          } catch (e) {}
        }
      }
    } catch (e) {
      errors++;
      if (errors <= 3) console.error('    Error on ' + (doc._id || doc.email) + ': ' + e.message);
    }
  }
  console.log('  ' + jsonFile + ': ' + inserted + ' rows (' + errors + ' errors)');
  return inserted;
}

async function main() {
  const start = Date.now();
  console.log('Starting migration at ' + new Date().toLocaleString());

  try {
    await pool.query('SELECT 1');
    console.log('Connected to PostgreSQL');
  } catch (e) {
    console.error('Cannot connect: ' + e.message);
    process.exit(1);
  }

  await runSchema();

  // Disable FK triggers for migration to avoid orphaned record issues
  await disableTriggers();

  if (SCHEMA_ONLY) {
    console.log('Schema-only mode. Data not migrated.');
    await pool.end();
    return;
  }

  let total = 0;
  for (const [jsonFile, mapping] of Object.entries(TABLES)) {
    const count = await migrateTable(jsonFile, mapping);
    total += count;
  }

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
  console.log('Migration complete! Total: ' + total + ' rows in ' + elapsed + ' min');
  console.log('Backup used: ' + BACKUP_DIR);

  // Re-enable FK triggers
  await enableTriggers();
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
