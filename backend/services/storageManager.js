const pg = require('../config/pg');

const CLEANUP_INTERVAL = parseInt(process.env.CLEANUP_INTERVAL || '21600000'); // 6 hrs
const DEPOSIT_RETENTION_MS = parseInt(process.env.DEPOSIT_RETENTION_MS || '2592000000'); // 30 days
const OTP_RETENTION_MS = parseInt(process.env.OTP_RETENTION_MS || '86400000'); // 24 hrs
const NOTIF_RETENTION_MS = parseInt(process.env.NOTIF_RETENTION_MS || '2592000000'); // 30 days
const AUDIT_RETENTION_MS = parseInt(process.env.AUDIT_RETENTION_MS || '7776000000'); // 90 days

async function estimateTableSize() {
    const { rows } = await pg.query(`
        SELECT
            relname AS table_name,
            pg_total_relation_size(relid) AS total_bytes,
            pg_relation_size(relid) AS data_bytes,
            pg_indexes_size(relid) AS index_bytes,
            n_live_tup AS row_count
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
    `);
    return rows;
}

async function getDatabaseSize() {
    const { rows } = await pg.query(`
        SELECT pg_database_size(current_database()) AS total_bytes
    `);
    return rows[0]?.total_bytes || 0;
}

async function archiveOldDeposits() {
    const cutoff = Date.now() - DEPOSIT_RETENTION_MS;
    await pg.query(`
        DELETE FROM deposits WHERE created_at < $1 AND status = 'completed'
    `, [cutoff]);
    const { rowCount } = await pg.query(`SELECT 1`);
    return rowCount;
}

async function cleanupExpiredWallets() {
    await pg.query(`
        DELETE FROM deposit_wallets WHERE expired = true AND expired_at < $1
    `, [Date.now() - 86400000]); // delete expired wallets after 1 day
}

async function cleanupOldOtps() {
    const cutoff = Date.now() - OTP_RETENTION_MS;
    await pg.query(`DELETE FROM otps WHERE created_at < $1`, [cutoff]);
    await pg.query(`DELETE FROM otp_logs WHERE created_at < $1`, [cutoff]);
    await pg.query(`DELETE FROM otp_store WHERE updated_at < $1`, [cutoff]);
}

async function cleanupOldNotifications() {
    const cutoff = Date.now() - NOTIF_RETENTION_MS;
    await pg.query(`DELETE FROM notifications WHERE created_at < $1`, [cutoff]);
}

async function cleanupOldAuditLogs() {
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    await pg.query(`DELETE FROM audit_logs WHERE created_at < $1`, [cutoff]);
}

async function runCleanup() {
    try {
        console.log('[Storage] Cleanup started', new Date().toISOString());
        await archiveOldDeposits();
        await cleanupExpiredWallets();
        await cleanupOldOtps();
        await cleanupOldNotifications();
        await cleanupOldAuditLogs();
        const totalBytes = await getDatabaseSize();
        const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
        console.log(`[Storage] Cleanup done. DB size: ${totalMB} MB`);
        return { totalMB, success: true };
    } catch (e) {
        console.error('[Storage] Cleanup error:', e.message);
        return { error: e.message, success: false };
    }
}

async function getStorageStats() {
    const totalBytes = await getDatabaseSize();
    const tableSizes = await estimateTableSize();
    return {
        totalBytes,
        totalMB: (totalBytes / 1024 / 1024).toFixed(2),
        tableSizes: tableSizes.map(t => ({
            table: t.table_name,
            totalMB: (t.total_bytes / 1024 / 1024).toFixed(2),
            dataMB: (t.data_bytes / 1024 / 1024).toFixed(2),
            indexMB: (t.index_bytes / 1024 / 1024).toFixed(2),
            rows: t.row_count
        }))
    };
}

let intervalId = null;

function start() {
    runCleanup();
    intervalId = setInterval(runCleanup, CLEANUP_INTERVAL);
    console.log(`[Storage] Cleanup scheduler started (every ${CLEANUP_INTERVAL / 60000} min)`);
}

function stop() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

module.exports = { start, stop, runCleanup, getStorageStats };
