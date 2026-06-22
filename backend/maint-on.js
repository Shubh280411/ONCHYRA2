const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
    try {
        const endAt = new Date("2026-06-23T04:00:00+05:30").getTime();
        const val = JSON.stringify({ enabled: true, message: "Scheduled maintenance - back by 4 AM IST", endAt: endAt, startedAt: Date.now(), updatedAt: Date.now() });
        await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb", ["maintenance", val]);
        const diff = endAt - Date.now();
        const mins = Math.floor(diff / 60000);
        console.log("Maintenance ENABLED - ends 4 AM IST (~" + mins + " min remaining)");
    } catch(e) { console.error("Error:", e.message); }
    await pool.end();
    process.exit(0);
}
run();
