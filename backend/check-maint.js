const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
    const r = await pool.query("SELECT * FROM settings WHERE key = $1", ["maintenance"]);
    if (r.rows.length) console.log(JSON.stringify(r.rows[0].value, null, 2));
    else console.log("No maintenance setting found");
    await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
