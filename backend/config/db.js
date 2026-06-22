/**
 * Firebase Admin initialization — used ONLY for Auth operations (password reset, etc.)
 * All DATA operations use PostgreSQL via ./pg.js
 */
let admin = null;
try {
    admin = require('firebase-admin');
    const path = require('path');
    const fs = require('fs');

    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
        const keyPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
        if (fs.existsSync(keyPath)) {
            serviceAccount = require(keyPath);
        }
    }

    if (serviceAccount) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('Firebase Admin initialized (Auth only)');
    } else {
        console.warn('Firebase service account not found — Auth operations (password reset) will be unavailable');
    }
} catch (e) {
    console.warn('Firebase Admin initialization skipped:', e.message);
}

module.exports = function initializeFirebase() { return admin ? admin.firestore() : null; };
module.exports.admin = admin;
