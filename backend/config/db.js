const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const initializeFirebase = () => {
    let serviceAccount;

    // Support both JSON env var (Render) and file path (local)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else {
        const keyPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);

        if (!fs.existsSync(keyPath)) {
            console.error('\n=== SERVICE ACCOUNT KEY MISSING ===');
            console.error('File not found:', keyPath);
            console.error('Step 1: Go to https://console.firebase.google.com');
            console.error('Step 2: Project Settings > Service Accounts');
            console.error('Step 3: Click "Generate new private key"');
            console.error('Step 4: Save the file as "serviceAccountKey.json" in the backend/ folder');
            console.error('================================\n');
            process.exit(1);
        }

        serviceAccount = require(keyPath);
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    const db = admin.firestore();
    console.log('Firebase Admin initialized');
    return db;
};

module.exports = initializeFirebase;
