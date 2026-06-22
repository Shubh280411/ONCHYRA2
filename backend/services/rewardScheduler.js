const pg = require('../config/pg');

const REWARD_INTERVAL = parseInt(process.env.REWARD_INTERVAL || '14400000');
const MAX_PER_CYCLE = parseInt(process.env.REWARD_MAX || '50');

const RANKS = [
  { name: 'Ignition',   reqDirect: 3,  reqTeam: 1000,   reqLeg: 500,   bonus: 25,   rewardDay: 5,   rewardDays: 5  },
  { name: 'Momentum',   reqDirect: 5,  reqTeam: 5000,   reqLeg: 2500,  bonus: 100,  rewardDay: 10,  rewardDays: 10 },
  { name: 'Velocity',   reqDirect: 7,  reqTeam: 10000,  reqLeg: 5000,  bonus: 250,  rewardDay: 20,  rewardDays: 15 },
  { name: 'Quantum',    reqDirect: 10, reqTeam: 25000,  reqLeg: 12500, bonus: 500,  rewardDay: 40,  rewardDays: 20 },
  { name: 'Fusion',     reqDirect: 12, reqTeam: 50000,  reqLeg: 25000, bonus: 1000, rewardDay: 75,  rewardDays: 25 },
  { name: 'Infinity',   reqDirect: 15, reqTeam: 100000, reqLeg: 50000, bonus: 2500, rewardDay: 150, rewardDays: 30 },
  { name: 'Titan',      reqDirect: 20, reqTeam: 250000, reqLeg: 125000,bonus: 5000, rewardDay: 300, rewardDays: 30 },
  { name: 'Apex',       reqDirect: 25, reqTeam: 500000, reqLeg: 250000,bonus: 10000,rewardDay: 600, rewardDays: 30 },
  { name: 'Zenith',     reqDirect: 30, reqTeam: 1000000,reqLeg: 500000,bonus: 25000,rewardDay: 1250,rewardDays: 30 },
  { name: 'Legacy',     reqDirect: 40, reqTeam: 2500000,reqLeg: 1250000,bonus: 50000,rewardDay: 3000,rewardDays: 30 },
];

function todayStr() { return new Date().toISOString().slice(0, 10); }

async function distribute() {
  const today = todayStr();
  const now = Date.now();
  const rankNames = RANKS.map(r => r.name);
  const cutoff = Date.now() - REWARD_INTERVAL;

  let rows = [];
  try {
    const rankPlaceholders = rankNames.map((_, i) => `$${i + 2}`).join(',');
    const res = await pg.query(
      `SELECT * FROM users WHERE rank IN (${rankPlaceholders}) AND (reward_checked_at IS NULL OR reward_checked_at < $1) ORDER BY reward_checked_at NULLS FIRST LIMIT $${rankNames.length + 2}`,
      [cutoff, ...rankNames, MAX_PER_CYCLE]
    );
    rows = res.rows;
  } catch (e) {
    const res = await pg.query(
      `SELECT * FROM users WHERE rank IN (${rankNames.map((_, i) => `$${i + 1}`).join(',')}) LIMIT $${rankNames.length + 1}`,
      [...rankNames, MAX_PER_CYCLE]
    );
    rows = res.rows;
  }

  let neverChecked = [];
  try {
    const res = await pg.query(
      `SELECT * FROM users WHERE rank IN (${rankNames.map((_, i) => `$${i + 2}`).join(',')}) AND reward_checked_at IS NULL LIMIT $1`,
      [MAX_PER_CYCLE, ...rankNames]
    );
    neverChecked = res.rows;
  } catch (e) {}

  const seen = new Set(rows.map(r => r.uid));
  for (const r of neverChecked) {
    if (!seen.has(r.uid)) rows.push(r);
  }
  if (rows.length > MAX_PER_CYCLE) rows = rows.slice(0, MAX_PER_CYCLE);

  console.log(`[REWARD] Checking ${rows.length} users (${today})...`);
  let distributed = 0;

  for (const u of rows) {
    const rank = u.rank || 'Unranked';
    if (rank === 'Unranked') continue;
    if (!u.active_package || u.active_package === 'none' || u.package_status === 'expired') continue;

    const rd = RANKS.find(r => r.name === rank);
    if (!rd) continue;

    if (u.reward_last_paid === today) {
      await pg.update('users', u.uid, { reward_checked_at: now }).catch(() => {});
      continue;
    }

    const paid = u.leadership_reward_payouts || 0;
    if (paid >= rd.rewardDays) continue;

    const dailyAmt = rd.rewardDay;
    if (dailyAmt <= 0) continue;

    const cap = u.package_cap || Infinity;
    const usage = u.package_usage || 0;
    const canAdd = Math.min(dailyAmt, cap - usage);
    if (canAdd <= 0) continue;

    await pg.increment('users', u.uid, 'commission_balance', canAdd);
    await pg.increment('users', u.uid, 'package_usage', canAdd);
    await pg.increment('users', u.uid, 'leadership_reward_payouts', 1);

    await pg.update('users', u.uid, {
      leadership_reward_rank: rank,
      leadership_reward_day: dailyAmt,
      leadership_reward_days: rd.rewardDays,
      reward_last_paid: today,
      reward_checked_at: now,
    });

    await pg.query(
      `INSERT INTO leadership_rewards (id, uid, rank, amount, day, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['lr_' + u.uid + '_' + now, u.uid, rank, canAdd, paid + 1, now]
    );

    await payMatchingBonus(u.uid, canAdd);
    distributed++;
    console.log(`[REWARD] Credited $${canAdd} to ${u.email || u.uid} (${rank}, day ${paid + 1}/${rd.rewardDays})`);
  }

  if (distributed > 0) console.log(`[REWARD] Distributed ${distributed} daily rewards today`);
  return distributed;
}

async function payMatchingBonus(uid, rewardAmount) {
  const u = await pg.get('users', uid);
  if (!u) return;
  const refCode = u.referred_by;
  if (!refCode) return;

  const sponsorLookup = await lookupByRefCode(refCode);
  if (!sponsorLookup) return;
  const sponsorUid = sponsorLookup.id;
  const sponsor = sponsorLookup.data;

  if (!sponsor.active_package || sponsor.package_status === 'expired') return;

  const matchAmt = rewardAmount * 0.1;
  if (matchAmt <= 0) return;

  const cap = sponsor.package_cap || Infinity;
  const usage = sponsor.package_usage || 0;
  const canAdd = Math.min(matchAmt, cap - usage);
  if (canAdd <= 0) return;

  await pg.increment('users', sponsorUid, 'commission_balance', canAdd);
  await pg.increment('users', sponsorUid, 'total_matching_bonus', canAdd);
  await pg.increment('users', sponsorUid, 'package_usage', canAdd);

  await pg.query(
    `INSERT INTO commissions (id, uid, from_uid, amount, type, created_at)
     VALUES ($1, $2, $3, $4, 'matching_bonus', $5)`,
    ['mb_' + sponsorUid + '_' + Date.now(), sponsorUid, uid, canAdd, Date.now()]
  );

  console.log(`[REWARD] Matching bonus $${canAdd} paid to sponsor ${sponsorUid}`);
}

async function lookupByRefCode(refCode) {
  if (!refCode) return null;
  const rows = await pg.findWhere('users', { referral_code: refCode });
  if (!rows.length) return null;
  return { id: rows[0].uid, data: rows[0] };
}

let intervalId = null;

function start() {
  console.log(`[REWARD] Scheduler active (every ${REWARD_INTERVAL / 1000}s)`);
  distribute().catch(e => console.error('[REWARD] Error:', e.message));
  intervalId = setInterval(() => {
    distribute().catch(e => console.error('[REWARD] Error:', e.message));
  }, REWARD_INTERVAL);
}

function stop() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; console.log('[REWARD] Stopped'); }
}

module.exports = { start, stop, distribute };
