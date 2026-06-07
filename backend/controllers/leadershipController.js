const admin = require('firebase-admin');
const db = admin.firestore();

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

const RANK_INDEX = RANKS.reduce((m, r, i) => { m[r.name] = i; return m; }, {});

exports.ranks = (req, res) => res.json(RANKS);

const getDownlineVolume = async (refCode, depth = 0, maxDepth = 10) => {
    if (depth >= maxDepth || !refCode) return 0;
    const snap = await db.collection('users').where('referredBy', '==', refCode).get();
    let vol = 0;
    for (const d of snap.docs) {
        const u = d.data();
        vol += u.totalPackageSpend || 0;
        vol += await getDownlineVolume(u.referralCode, depth + 1, maxDepth);
    }
    return vol;
};

const getLegsVolume = async (refCode) => {
    if (!refCode) return [];
    const snap = await db.collection('users').where('referredBy', '==', refCode).get();
    const legs = [];
    for (const d of snap.docs) {
        const u = d.data();
        const subVol = await getDownlineVolume(u.referralCode);
        legs.push((u.totalPackageSpend || 0) + subVol);
    }
    legs.sort((a, b) => b - a);
    return legs;
};

const lookupByRefCode = async (refCode) => {
    if (!refCode) return null;
    const snap = await db.collection('users').where('referralCode', '==', refCode).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, data: snap.docs[0].data() };
};

exports.calculateRank = async (req, res) => {
    try {
        const { uid } = req.params;
        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const user = userSnap.data();

        if (!user.activePackage || user.activePackage === 'none' || user.packageStatus === 'expired') {
            return res.json({ rank: 'Unranked', reason: 'No active package' });
        }

        const refCode = user.referralCode;
        const directSnap = refCode ? await db.collection('users').where('referredBy', '==', refCode).get() : { size: 0 };
        const directCount = directSnap.size;
        const legs = await getLegsVolume(refCode);
        const totalTeamVolume = legs.reduce((a, b) => a + b, 0);
        const topLeg = legs[0] || 0;
        const otherLegs = totalTeamVolume - topLeg;
        const weakLeg = Math.min(topLeg, otherLegs);

        let newRank = 'Unranked';
        let newRankIdx = -1;
        for (let i = RANKS.length - 1; i >= 0; i--) {
            const r = RANKS[i];
            if (directCount >= r.reqDirect && totalTeamVolume >= r.reqTeam && weakLeg >= r.reqLeg) {
                newRank = r.name;
                newRankIdx = i;
                break;
            }
        }

        const currentRank = user.rank || 'Unranked';
        const currentIdx = RANK_INDEX[currentRank] !== undefined ? RANK_INDEX[currentRank] : -1;
        let rankAchieved = currentRank;
        let newAchievement = false;

        if (newRankIdx > currentIdx) {
            rankAchieved = newRank;
            newAchievement = true;
        } else if (newRankIdx >= 0 && newRankIdx === currentIdx) {
            rankAchieved = newRank;
        }

        const updates = { rank: rankAchieved, rankCalculatedAt: Date.now() };

        // Grant one-time achievement bonus if eligible and not yet claimed
        if (newRankIdx >= 0 && !user.achievementBonusClaimed) {
            const r = RANKS[newRankIdx];
            if (r && r.bonus > 0) {
                updates.commissionBalance = admin.firestore.FieldValue.increment(r.bonus);
                updates.achievementBonusClaimed = true;
                await db.collection('achievementBonuses').add({
                    uid, rank: rankAchieved, amount: r.bonus, createdAt: Date.now(), type: 'achievement'
                });
            }
        }

        if (newAchievement || (newRankIdx >= 0 && !user.leadershipRewardRank)) {
            const r = RANKS[newRankIdx];
            updates.leadershipRewardRank = rankAchieved;
            updates.leadershipRewardDay = r.rewardDay;
            updates.leadershipRewardDays = r.rewardDays;
            updates.leadershipRewardPayouts = 0;
            updates.leadershipRewardStart = Date.now();
        }

        await db.doc(`users/${uid}`).update(updates);

        res.json({
            rank: rankAchieved, directCount, totalTeamVolume,
            weakLeg, topLeg, otherLegs, legs: legs.slice(0, 5),
            newAchievement
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.userRankProgress = async (req, res) => {
    try {
        const { uid } = req.params;
        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const user = userSnap.data();

        const refCode = user.referralCode;
        const directSnap = refCode ? await db.collection('users').where('referredBy', '==', refCode).get() : { size: 0 };
        const directCount = directSnap.size;
        const legs = await getLegsVolume(refCode);
        const totalTeamVolume = legs.reduce((a, b) => a + b, 0);
        const topLeg = legs[0] || 0;
        const otherLegs = totalTeamVolume - topLeg;
        const weakLeg = Math.min(topLeg, otherLegs);

        const currentRank = user.rank || 'Unranked';
        const currentIdx = RANK_INDEX[currentRank] !== undefined ? RANK_INDEX[currentRank] : -1;
        const nextIdx = currentIdx + 1;
        const nextRank = nextIdx < RANKS.length ? RANKS[nextIdx] : null;

        res.json({
            currentRank, currentRankIndex: currentIdx,
            directCount, totalTeamVolume,
            topLeg, otherLegs, weakLeg,
            legs: legs.slice(0, 5),
            achievementBonusClaimed: user.achievementBonusClaimed || false,
            leadershipReward: user.leadershipRewardRank ? {
                rank: user.leadershipRewardRank,
                dayAmount: user.leadershipRewardDay || 0,
                totalDays: user.leadershipRewardDays || 0,
                payoutsDone: user.leadershipRewardPayouts || 0,
                startDate: user.leadershipRewardStart || 0,
            } : null,
            totalMatchingBonus: user.totalMatchingBonus || 0,
            nextRank: nextRank ? {
                name: nextRank.name,
                reqDirect: nextRank.reqDirect,
                reqTeam: nextRank.reqTeam,
                reqLeg: nextRank.reqLeg,
                bonus: nextRank.bonus,
                rewardDay: nextRank.rewardDay,
                rewardDays: nextRank.rewardDays,
                directProgress: Math.min(100, (directCount / nextRank.reqDirect) * 100),
                teamProgress: Math.min(100, (totalTeamVolume / nextRank.reqTeam) * 100),
                legProgress: Math.min(100, (weakLeg / nextRank.reqLeg) * 100),
            } : null,
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.getMatchingBonus = async (req, res) => {
    try {
        const { uid } = req.params;
        const userSnap = await db.doc(`users/${uid}`).get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const user = userSnap.data();

        const directSnap = user.referralCode ? await db.collection('users').where('referredBy', '==', user.referralCode).get() : { docs: [] };
        let total = 0;
        for (const d of directSnap.docs) {
            const u = d.data();
            if (u.leadershipRewardPayouts > 0 && u.leadershipRewardDay > 0) {
                const earned = u.leadershipRewardPayouts * u.leadershipRewardDay;
                total += earned * 0.1;
            }
        }
        res.json({ success: true, matchingBonus: Math.round(total * 100) / 100 });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const payMatchingBonus = async (uid, rewardAmount) => {
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
};

exports.distributeDailyRewards = async (req, res) => {
    try {
        const snap = await db.collection('users').where('leadershipRewardStart', '>', 0).get();
        let distributed = 0;
        for (const d of snap.docs) {
            const u = d.data();
            const maxDays = u.leadershipRewardDays || 0;
            const paid = u.leadershipRewardPayouts || 0;
            if (paid >= maxDays) continue;
            if (!u.activePackage || u.activePackage === 'none' || u.packageStatus === 'expired') continue;

            const dailyAmt = u.leadershipRewardDay || 0;
            const cap = u.packageCap || Infinity;
            const usage = u.packageUsage || 0;
            const canAdd = Math.min(dailyAmt, cap - usage);
            if (canAdd <= 0) continue;

            await db.doc(d.id).update({
                commissionBalance: admin.firestore.FieldValue.increment(canAdd),
                packageUsage: admin.firestore.FieldValue.increment(canAdd),
                leadershipRewardPayouts: admin.firestore.FieldValue.increment(1),
            });
            await db.collection('leadershipRewards').add({
                uid: d.id, rank: u.leadershipRewardRank,
                amount: canAdd, day: paid + 1,
                createdAt: Date.now()
            });
            await payMatchingBonus(d.id, canAdd);
            distributed++;
        }
        res.json({ success: true, distributed });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminRecalcAllRanks = async (req, res) => {
    try {
        const snap = await db.collection('users').get();
        let updated = 0;
        for (const d of snap.docs) {
            const u = d.data();
            if (!u.activePackage || u.activePackage === 'none') continue;

            const refCode = u.referralCode;
            const directSnap = refCode ? await db.collection('users').where('referredBy', '==', refCode).get() : { size: 0 };
            const directCount = directSnap.size;
            const legs = await getLegsVolume(refCode);
            const totalTeamVolume = legs.reduce((a, b) => a + b, 0);
            const topLeg = legs[0] || 0;
            const otherLegs = totalTeamVolume - topLeg;
            const weakLeg = Math.min(topLeg, otherLegs);

            let rankAchieved = 'Unranked';
            for (let i = RANKS.length - 1; i >= 0; i--) {
                const r = RANKS[i];
                if (directCount >= r.reqDirect && totalTeamVolume >= r.reqTeam && weakLeg >= r.reqLeg) {
                    rankAchieved = r.name;
                    break;
                }
            }

            const updates = { rank: rankAchieved, rankCalculatedAt: Date.now() };

            const currentRank = u.rank || 'Unranked';
            const currentIdx = RANK_INDEX[currentRank] !== undefined ? RANK_INDEX[currentRank] : -1;
            const newIdx = RANK_INDEX[rankAchieved] !== undefined ? RANK_INDEX[rankAchieved] : -1;

            if (newIdx > currentIdx && !u.achievementBonusClaimed) {
                const r = RANKS[newIdx];
                if (r && r.bonus > 0) {
                    updates.commissionBalance = admin.firestore.FieldValue.increment(r.bonus);
                    updates.achievementBonusClaimed = true;
                    await db.collection('achievementBonuses').add({
                        uid: d.id, rank: rankAchieved, amount: r.bonus, createdAt: Date.now(), type: 'achievement'
                    });
                }
                updates.leadershipRewardRank = rankAchieved;
                updates.leadershipRewardDay = r.rewardDay;
                updates.leadershipRewardDays = r.rewardDays;
                updates.leadershipRewardPayouts = 0;
                updates.leadershipRewardStart = Date.now();
            }

            await db.doc(`users/${d.id}`).update(updates);
            updated++;
        }
        res.json({ success: true, updated });
    } catch(e) { res.status(500).json({ error: e.message }); }
};
