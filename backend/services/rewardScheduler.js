const admin = require('firebase-admin');
const db = admin.firestore();

const REWARD_INTERVAL = parseInt(process.env.REWARD_INTERVAL || '60000');
const MAX_PER_CYCLE = 50;

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

function todayStr() { return new Date().toISOString().slice(0,10); }

async function distribute() {
  const today = todayStr();
  const now = Date.now();
  const snap = await db.collection('users').limit(MAX_PER_CYCLE).get();

  console.log(`[REWARD] Checking ${snap.docs.length} users (${today})...`);
  let distributed = 0;

  for (const d of snap.docs) {
    const u = d.data();
    const rank = u.rank || 'Unranked';
    if (rank === 'Unranked') continue;
    if (!u.activePackage || u.activePackage === 'none' || u.packageStatus === 'expired') continue;

    const rd = RANKS.find(r => r.name === rank);
    if (!rd) continue;

    // Already paid today
    if (u.rewardLastPaid === today) continue;

    const paid = u.leadershipRewardPayouts || 0;
    if (paid >= rd.rewardDays) continue;

    const dailyAmt = rd.rewardDay;
    if (dailyAmt <= 0) continue;

    const cap = u.packageCap || Infinity;
    const usage = u.packageUsage || 0;
    const canAdd = Math.min(dailyAmt, cap - usage);
    if (canAdd <= 0) continue;

    await d.ref.update({
      commissionBalance: admin.firestore.FieldValue.increment(canAdd),
      packageUsage: admin.firestore.FieldValue.increment(canAdd),
      leadershipRewardPayouts: admin.firestore.FieldValue.increment(1),
      leadershipRewardRank: rank,
      leadershipRewardDay: dailyAmt,
      leadershipRewardDays: rd.rewardDays,
      rewardLastPaid: today,
    });

    await db.collection('leadershipRewards').add({
      uid: d.id, rank, amount: canAdd, day: paid + 1, createdAt: now
    });

    await payMatchingBonus(d.id, canAdd);
    distributed++;
    console.log(`[REWARD] Credited $${canAdd} to ${u.email || d.id} (${rank}, day ${paid+1}/${rd.rewardDays})`);
  }

  if (distributed > 0) console.log(`[REWARD] Distributed ${distributed} daily rewards today`);
  return distributed;
}

async function payMatchingBonus(uid, rewardAmount) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) return;
  const u = snap.data();
  const refCode = u.referredBy;
  if (!refCode) return;

  const sponsorLookup = await lookupByRefCode(refCode);
  if (!sponsorLookup) return;
  const sponsorUid = sponsorLookup.id;
  const sponsor = sponsorLookup.data;

  if (!sponsor.activePackage || sponsor.packageStatus === 'expired') return;

  const matchAmt = rewardAmount * 0.1;
  if (matchAmt <= 0) return;

  const cap = sponsor.packageCap || Infinity;
  const usage = sponsor.packageUsage || 0;
  const canAdd = Math.min(matchAmt, cap - usage);
  if (canAdd <= 0) return;

  await db.doc(`users/${sponsorUid}`).update({
    commissionBalance: admin.firestore.FieldValue.increment(canAdd),
    totalMatchingBonus: admin.firestore.FieldValue.increment(canAdd),
    packageUsage: admin.firestore.FieldValue.increment(canAdd),
  });

  await db.collection('commissions').add({
    uid: sponsorUid, fromUid: uid, amount: canAdd,
    type: 'matching_bonus', createdAt: Date.now()
  });

  console.log(`[REWARD] Matching bonus $${canAdd} paid to sponsor ${sponsorUid}`);
}

async function lookupByRefCode(refCode) {
  if (!refCode) return null;
  const snap = await db.collection('users').where('referralCode', '==', refCode).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
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
