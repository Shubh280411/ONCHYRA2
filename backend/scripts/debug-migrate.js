require('dotenv').config();
const fs = require('fs');

// Read the backup
const users = JSON.parse(fs.readFileSync('backup-2026-06-22T10-34-00-135Z/users.json'));

// First failing user
const target = users.find(x => x._id === '01KNGaFgNzc8Tj7iU94YuWZKE5M2');
if (!target) {
  console.log('User not found, using first user');
  target = users[0];
}

console.log('User _id:', target._id);
console.log('User uid field:', target.uid);
console.log('All fields:', Object.keys(target));
console.log('');

// Simulate mapFields
const row = {};
for (const [key, value] of Object.entries(target)) {
  if (key === '_participants') continue;
  if (key === '_id') {
    // Skip _id since data.uid exists
    continue;
  }
  if (key === 'timestamp') continue;
  const pgField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  row[pgField] = value;
}

// Set uid from the data's uid field
console.log('Row has uid:', 'uid' in row);
console.log('Row uid value:', row.uid);
console.log('target.uid:', target.uid);
console.log('');

// Columns (excluding idCol which is uid)
const id = target.uid || target._id;
console.log('Using id:', id);

// Remove uid from row
const columns = Object.keys(row).filter(k => k !== 'uid' && row[k] !== undefined);
console.log('Number of columns (excluding uid):', columns.length);
console.log('Columns:', columns);

const values = columns.map(c => row[c]);
const placeholders = values.map((_, i) => '$' + (i + 1));

const sql = 'INSERT INTO "users" ("uid", ' + columns.map(c => '"' + c + '"').join(', ') + ') VALUES ($1, ' + placeholders.join(', ') + ')';
console.log('');
console.log('SQL param count:', sql.split('$').length - 1);
console.log('Values count:', [id, ...values].length);
