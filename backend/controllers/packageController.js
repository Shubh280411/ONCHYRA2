const pg = require('../config/pg');

const PACKAGES = {
    starter:  { price: 5,   boost: 4,   cap: 50,   name: 'Starter' },
    builder:  { price: 10,  boost: 8,   cap: 100,  name: 'Builder' },
    pioneer:  { price: 25,  boost: 15,  cap: 250,  name: 'Pioneer' },
    elite:    { price: 50,  boost: 30,  cap: 500,  name: 'Elite' },
    titan:    { price: 100, boost: 60,  cap: 1000, name: 'Titan' },
    dominion: { price: 250, boost: 120, cap: 2500, name: 'Dominion' },
    legacy:   { price: 500, boost: 300, cap: 5000, name: 'Legacy' },
};

exports.list = (req, res) => res.json(PACKAGES);

exports.purchase = async (req, res) => {
    try {
        const { uid, packageId } = req.body;
        const pkg = PACKAGES[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        const user = await pg.get('users', uid);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.active_package && user.active_package !== 'none' && user.package_status !== 'expired') {
            return res.status(400).json({ error: 'Already has an active package. Upgrade instead.' });
        }

        let credit = 0;
        if (user.active_package && user.active_package !== 'none') {
            const currentPkg = PACKAGES[user.active_package];
            if (currentPkg) {
                const usagePct = (user.package_usage || 0) / currentPkg.cap;
                if (usagePct < 5) credit = currentPkg.price * 0.7;
            }
        }

        const finalPrice = Math.max(0, pkg.price - credit);
        if ((user.wallet_balance || 0) < finalPrice) return res.status(400).json({ error: 'Insufficient wallet balance' });

        const prevCap = user.active_package && user.active_package !== 'none' && PACKAGES[user.active_package]
            ? PACKAGES[user.active_package].cap : 0;

        await pg.increment('users', uid, 'wallet_balance', -finalPrice);
        await pg.update('users', uid, {
            active_package: packageId,
            package_amount: pkg.price,
            package_boost: pkg.boost,
            package_cap: prevCap + pkg.cap,
            package_usage: 0,
            package_status: 'active',
            package_purchased_at: Date.now(),
        });
        await pg.increment('users', uid, 'total_package_spend', pkg.price);

        await pg.query(
            `INSERT INTO package_purchases (id, uid, package_id, name, amount, paid, credit, boost, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            ['pp_' + uid + '_' + Date.now(), uid, packageId, pkg.name, pkg.price, finalPrice, credit, pkg.boost, Date.now()]
        );

        await processReferralCommission(uid, pkg.price, pkg.name);

        res.json({ success: true, package: pkg.name, boost: pkg.boost, credit, paid: finalPrice });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.checkCap = async (req, res) => {
    try {
        const { uid } = req.params;
        const u = await pg.get('users', uid);
        if (!u) return res.status(404).json({ error: 'User not found' });
        res.json({
            activePackage: u.active_package || 'none',
            packageStatus: u.package_status || 'none',
            packageCap: u.package_cap || 0,
            packageUsage: u.package_usage || 0,
            usedCap: u.package_usage || 0,
            maxCap: u.package_cap || 0,
            remainingCap: Math.max(0, (u.package_cap || 0) - (u.package_usage || 0)),
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminActivate = async (req, res) => {
    try {
        const { uid, packageId } = req.body;
        const pkg = PACKAGES[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        await pg.update('users', uid, {
            active_package: packageId,
            package_amount: pkg.price,
            package_boost: pkg.boost,
            package_cap: pkg.cap,
            package_usage: 0,
            package_status: 'active',
            package_purchased_at: Date.now(),
        });
        await pg.increment('users', uid, 'total_package_spend', pkg.price);
        await processReferralCommission(uid, pkg.price, pkg.name);
        res.json({ success: true, package: pkg.name });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminExpire = async (req, res) => {
    try {
        const { uid } = req.body;
        await pg.update('users', uid, { package_status: 'expired', active_package: 'none' });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.adminUpgrade = async (req, res) => {
    try {
        const { uid, packageId } = req.body;
        const pkg = PACKAGES[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        const u = await pg.get('users', uid);
        const prevCap = u ? (u.package_cap || 0) : 0;

        await pg.update('users', uid, {
            active_package: packageId,
            package_amount: pkg.price,
            package_boost: pkg.boost,
            package_cap: prevCap + pkg.cap,
            package_usage: 0,
            package_status: 'active',
            package_purchased_at: Date.now(),
        });
        await pg.increment('users', uid, 'total_package_spend', pkg.price);
        await processReferralCommission(uid, pkg.price, pkg.name);
        res.json({ success: true, package: pkg.name });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.userPackage = async (req, res) => {
    try {
        const u = await pg.get('users', req.params.uid);
        if (!u) return res.status(404).json({ error: 'User not found' });
        res.json({
            activePackage: u.active_package || 'none',
            packageBoost: u.package_boost || 1,
            packageUsage: u.package_usage || 0,
            packageCap: u.package_cap || 0,
            packageStatus: u.package_status || 'none',
            remainingCap: Math.max(0, (u.package_cap || 0) - (u.package_usage || 0)),
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

async function lookupByRefCode(refCode) {
    if (!refCode) return null;
    const rows = await pg.findWhere('users', { referral_code: refCode });
    if (!rows.length) return null;
    return { id: rows[0].uid, data: rows[0] };
}

async function processReferralCommission(uid, amount, pkgName) {
    try {
        const user = await pg.get('users', uid);
        if (!user || !user.referred_by) return;

        const levels = [
            { level: 1, pct: 0.10 },
            { level: 2, pct: 0.05 },
            { level: 3, pct: 0.03 },
        ];

        let currentRefCode = user.referred_by;
        for (const lv of levels) {
            if (!currentRefCode) break;

            const refLookup = await lookupByRefCode(currentRefCode);
            if (!refLookup) break;
            const refUid = refLookup.id;
            const refData = refLookup.data;

            currentRefCode = refData.referred_by;

            await pg.increment('users', refUid, 'team_biz', amount);

            if (!refData.active_package || refData.active_package === 'none' || refData.package_status === 'expired') {
                continue;
            }

            const commission = amount * lv.pct;
            const used = refData.package_usage || 0;
            const cap = refData.package_cap || Infinity;
            const available = Math.max(0, cap - used);
            const capped = Math.min(commission, available);
            if (capped <= 0) continue;

            const newUsed = used + capped;

            await pg.increment('users', refUid, 'commission_balance', capped);
            await pg.increment('users', refUid, 'package_usage', capped);
            await pg.increment('users', refUid, 'total_commissions', capped);

            if (newUsed >= cap) {
                await pg.update('users', refUid, { package_status: 'expired' });
            }

            await pg.query(
                `INSERT INTO commissions (id, from_uid, uid, amount, level, type, package_name, from_name, created_at)
                 VALUES ($1, $2, $3, $4, $5, 'package_commission', $6, $7, $8)`,
                ['comm_' + refUid + '_' + uid + '_' + Date.now(), uid, refUid, capped, lv.level,
                 pkgName || 'Package', user.name || 'User', Date.now()]
            );
        }
    } catch(e) { console.error('Referral commission error:', e); }
}

exports.processReferralCommission = processReferralCommission;
