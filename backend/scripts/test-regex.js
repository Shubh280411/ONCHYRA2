const str = 'import { db,  initializeApp } from "https://.../firebase-app.js";';
const result = str.replace(/import\s*\{\s*db,?\s*(initializeApp)\s*\}/g, 'import { $1 }');
console.log('Before:', str);
console.log('After:', result);

// Also test with the actual dashboard.html line
const fs = require('fs');
const dash = fs.readFileSync('dashboard.html', 'utf8');
const dashLines = dash.split('\n');
const line695 = dashLines[694]; // 0-indexed
console.log('\nActual line 695:', JSON.stringify(line695));
console.log('Regex test:', /import\s*\{\s*db,?\s*(initializeApp)\s*\}/.test(line695));
const fixed = line695.replace(/import\s*\{\s*db,?\s*(initializeApp)\s*\}/g, 'import { $1 }');
console.log('Fixed:', JSON.stringify(fixed));
