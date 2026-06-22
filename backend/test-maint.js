const pg = require("./config/pg");
async function run() {
    const row = await pg.get("settings", "maintenance", "key");
    console.log("Row:", JSON.stringify(row));
    const data = row ? row.value : { enabled: false };
    console.log("Data:", JSON.stringify(data));
    if (data.enabled && data.endAt && Date.now() > data.endAt) {
        data.enabled = false;
        console.log("Auto-disabled (endAt passed)");
    }
    console.log("Response:", JSON.stringify(data));
}
run().catch(e => console.error(e.message));
