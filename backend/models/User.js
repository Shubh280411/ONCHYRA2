const admin = require('firebase-admin');

const User = {
    findByStatus: async (status) => {
        const snapshot = await admin.firestore()
            .collection('users')
            .where('status', '==', status)
            .get();

        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
};

module.exports = User;
