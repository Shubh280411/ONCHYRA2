const pg = require('../config/pg');

// Auto-create popups table if not exists
(async () => {
    try {
        await pg.query(`
            CREATE TABLE IF NOT EXISTS popups (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                html_content TEXT NOT NULL,
                active BOOLEAN DEFAULT true,
                created_at BIGINT,
                expires_at BIGINT
            )
        `);
    } catch (e) { console.error('[POPUPS] Table init error:', e.message); }
})();

exports.getActivePopup = async (req, res) => {
    try {
        const now = Date.now();
        const result = await pg.query(
            `SELECT * FROM popups WHERE active = true AND (expires_at IS NULL OR expires_at > $1) LIMIT 1`,
            [now]
        );
        if (!result.rows.length) return res.json(null);
        const p = result.rows[0];
        res.json({
            id: p.id,
            title: p.title,
            html_content: p.html_content,
            active: p.active,
            expires_at: p.expires_at,
            created_at: p.created_at,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getStatus = async (req, res) => {
    try {
        const result = await pg.query(
            `SELECT * FROM popups WHERE active = true LIMIT 1`
        );
        if (!result.rows.length) return res.json({ active: false });
        const p = result.rows[0];
        res.json({
            active: true,
            popup: {
                id: p.id,
                title: p.title,
                html_content: p.html_content,
                expires_at: p.expires_at,
                created_at: p.created_at,
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createPopup = async (req, res) => {
    try {
        const { title, html_content, expires_at } = req.body;
        if (!title || !html_content) return res.status(400).json({ error: 'Title and HTML content required' });

        const existing = await pg.query(`SELECT id FROM popups WHERE active = true LIMIT 1`);
        if (existing.rows.length) {
            return res.status(400).json({ error: 'Pehle se ek active popup hai. Usse pehle deactivate ya delete karo.' });
        }

        const id = 'popup_' + Date.now();
        const ts = Date.now();
        await pg.query(
            `INSERT INTO popups (id, title, html_content, active, created_at, expires_at)
             VALUES ($1, $2, $3, true, $4, $5)`,
            [id, title, html_content, ts, expires_at || null]
        );
        res.json({ success: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updatePopup = async (req, res) => {
    try {
        const { id, title, html_content, expires_at } = req.body;
        if (!id) return res.status(400).json({ error: 'Popup ID required' });

        const existing = await pg.get('popups', id, 'id');
        if (!existing) return res.status(404).json({ error: 'Popup not found' });

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (html_content !== undefined) updates.html_content = html_content;
        if (expires_at !== undefined) updates.expires_at = expires_at;

        if (Object.keys(updates).length) {
            await pg.update('popups', id, updates, 'id');
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.togglePopup = async (req, res) => {
    try {
        const { id, active } = req.body;
        if (!id) return res.status(400).json({ error: 'Popup ID required' });

        if (active) {
            const existing = await pg.query(
                `SELECT id FROM popups WHERE active = true AND id != $1 LIMIT 1`, [id]
            );
            if (existing.rows.length) {
                return res.status(400).json({ error: 'Pehle se ek active popup hai. Usse pehle deactivate ya delete karo.' });
            }
        }

        await pg.update('popups', id, { active: !!active }, 'id');
        res.json({ success: true, active: !!active });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deletePopup = async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Popup ID required' });
        await pg.query(`DELETE FROM popups WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
