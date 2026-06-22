const pg = require('../config/pg');

exports.getStatus = async (req, res) => {
    try {
        const row = await pg.get('settings', 'maintenance', 'key');
        const data = row ? row.value : { enabled: false };

        // Auto-disable if end time passed
        if (data.enabled && data.endAt && Date.now() > data.endAt) {
            data.enabled = false;
            data.autoDisabled = true;
            await pg.query(
                `INSERT INTO settings (key, value) VALUES ('maintenance', $1::jsonb)
                 ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
                [JSON.stringify(data)]
            );
        }

        res.json(data);
    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.toggle = async (req, res) => {
    try {
        const { enabled, message, countdown, endAt, durationHours } = req.body;

        const row = await pg.get('settings', 'maintenance', 'key');
        const current = row ? row.value : {};

        current.enabled = !!enabled;
        if (message !== undefined) current.message = message;
        if (endAt !== undefined) current.endAt = endAt;
        if (durationHours !== undefined) current.durationHours = durationHours;
        if (enabled) {
            if (!current.startedAt) current.startedAt = Date.now();
            if (endAt) current.endAt = endAt;
        }
        current.updatedAt = Date.now();

        await pg.query(
            `INSERT INTO settings (key, value) VALUES ('maintenance', $1::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
            [JSON.stringify(current)]
        );

        res.json({ success: true, enabled: !!enabled });
    } catch(e) { res.status(500).json({ error: e.message }); }
};
