const pg = require('../config/pg');

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
    const rows = await pg.findWhere('users', { referred_by: refCode });
    let vol = 0;
    for (const u of rows) {
        vol += u.total_package_spend || 0;
        vol += await getDownlineVolume(u.referral_code, depth + 1, maxDepth);
    }
    return vol;
};

const getLegsVolume = async (refCode) => {
    if (!refCode) return [];
    const rows = await pg.findWhere('users', { referred_by: refCode });
    const legs = [];
    for (const u of rows) {
        const subVol = await getDownlineVolume(u.referral_code);
        legs.push((u.total_package_spend || 0) + subVol);
    }
    legs.sort((a, b) => b - a);
    return legs;
};

const lookupByRefCode = async (refCode) => {
    if (!refCode) return null;
    const rows = await pg.findWhere('users', { referral_code: refCode });
    if (!rows.length) return null;
    return { id: rows[0].uid, data: rows[0] };
};

exports.calculateRank = async (req, res) => {
    try {
        const { uid } = req.params;
        const user = await pg.get('users', uid);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!user.active_package || user.active_package === 'none' || user.package_status === 'expired') {
            return res.json({ rank: 'Unranked', reason: 'No active package' });
        }

        const refCode = user.referral_code;
        const directRows = refCode ? await pg.findWhere('users', { referred_by: refCode }) : [];
        const directCount = directRows.length;
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

        const updates = { rank: rankAchieved, rank_calculated_at: Date.now() };

        if (newRankIdx >= 0 && !user.achievement_bonus_claimed) {
            const r = RANKS[newRankIdx];
            if (r && r.bonus > 0) {
                await pg.increment('users', uid, 'commission_balance', r.bonus);
                await pg.update('users', uid, { achievement_bonus_claimed: true });
                await pg.query(
                    `INSERT INTO achievement_bonuses (id, uid, rank, amount, type, created_at)
                     VALUES ($1, $2, $3, $4, 'achievement', $5)`,
                    ['ab_' + uid + '_' + Date.now(), uid, rankAchieved, r.bonus, Date.now()]
                );
            }
        }

        if (newAchievement || (newRankIdx >= 0 && !user.leadership_reward_rank)) {
            const r = RANKS[newRankIdx];
            updates.leadership_reward_rank = rankAchieved;
            updates.leadership_reward_day = r.rewardDay;
            updates.leadership_reward_days = r.rewardDays;
            updates.leadership_reward_payouts = 0;
            updates.leadership_reward_start = Date.now();
        }

        await pg.update('users', uid, updates);

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
        const user = await pg.get('users', uid);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const refCode = user.referral_code;
        const directRows = refCode ? await pg.findWhere('users', { referred_by: refCode }) : [];
        const directCount = directRows.length;
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
            achievementBonusClaimed: user.achievement_bonus_claimed || false,
            leadershipReward: user.leadership_reward_rank ? {
                rank: user.leadership_reward_rank,
                dayAmount: user.leadership_reward_day || 0,
                totalDays: user.leadership_reward_days || 0,
                payoutsDone: user.leadership_reward_payouts || 0,
                startDate: user.leadership_reward_start || 0,
            } : null,
            totalMatchingBonus: user.total_matching_bonus || 0,
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
        const user = await pg.get('users', uid);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const directRows = user.referral_code ? await pg.findWhere('users', { referred_by: user.referral_code }) : [];
        let total = 0;
        for (const u of directRows) {
            if (u.leadership_reward_payouts > 0 && u.leadership_reward_day > 0) {
                const earned = u.leadership_reward_payouts * u.leadership_reward_day;
                total += earned * 0.1;
            }
        }
        res.json({ success: true, matchingBonus: Math.round(total * 100) / 100 });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const payMatchingBonus = async (uid, rewardAmount) => {
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
};

exports.distributeDailyRewards = async (req, res) => {
    try {
        const rows = await pg.query(
            `SELECT * FROM users WHERE leadership_reward_start > 0 AND leadership_reward_start IS NOT NULL`
        );
        let distributed = 0;
        for (const u of rows.rows) {
            const maxDays = u.leadership_reward_days || 0;
            const paid = u.leadership_reward_payouts || 0;
            if (paid >= maxDays) continue;
            if (!u.active_package || u.active_package === 'none' || u.package_status === 'expired') continue;

            const dailyAmt = u.leadership_reward_day || 0;
            const cap = u.package_cap || Infinity;
            const usage = u.package_usage || 0;
            const canAdd = Math.min(dailyAmt, cap - usage);
            if (canAdd <= 0) continue;

            await pg.increment('users', u.uid, 'commission_balance', canAdd);
            await pg.increment('users', u.uid, 'package_usage', canAdd);
            await pg.increment('users', u.uid, 'leadership_reward_payouts', 1);

            await pg.query(
                `INSERT INTO leadership_rewards (id, uid, rank, amount, day, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                ['lr_' + u.uid + '_' + Date.now(), u.uid, u.leadership_reward_rank, canAdd, paid + 1, Date.now()]
            );

            await payMatchingBonus(u.uid, canAdd);
            distributed++;
        }
        res.json({ success: true, distributed });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminRecalcAllRanks = async (req, res) => {
    try {
        const rows = await pg.all('users');
        let updated = 0;
        for (const u of rows) {
            if (!u.active_package || u.active_package === 'none') continue;

            const refCode = u.referral_code;
            const directRows = refCode ? await pg.findWhere('users', { referred_by: refCode }) : [];
            const directCount = directRows.length;
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

            const updates = { rank: rankAchieved, rank_calculated_at: Date.now() };

            const currentRank = u.rank || 'Unranked';
            const currentIdx = RANK_INDEX[currentRank] !== undefined ? RANK_INDEX[currentRank] : -1;
            const newIdx = RANK_INDEX[rankAchieved] !== undefined ? RANK_INDEX[rankAchieved] : -1;

            if (newIdx > currentIdx && !u.achievement_bonus_claimed) {
                const r = RANKS[newIdx];
                if (r && r.bonus > 0) {
                    await pg.increment('users', u.uid, 'commission_balance', r.bonus);
                    await pg.update('users', u.uid, { achievement_bonus_claimed: true });
                    await pg.query(
                        `INSERT INTO achievement_bonuses (id, uid, rank, amount, type, created_at)
                         VALUES ($1, $2, $3, $4, 'achievement', $5)`,
                        ['ab_recalc_' + u.uid + '_' + Date.now(), u.uid, rankAchieved, r.bonus, Date.now()]
                    );
                }
                updates.leadership_reward_rank = rankAchieved;
                updates.leadership_reward_day = r.rewardDay;
                updates.leadership_reward_days = r.rewardDays;
                updates.leadership_reward_payouts = 0;
                updates.leadership_reward_start = Date.now();
            }

            await pg.update('users', u.uid, updates);
            updated++;
        }
        res.json({ success: true, updated });
    } catch(e) { res.status(500).json({ error: e.message }); }
};
