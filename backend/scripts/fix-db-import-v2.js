// Fix: correctly add `db` to supabase-adapter import only
// Run: node backend/scripts/fix-db-import-v2.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const orig = content;

  // 1. Remove `db, ` from firebase-app.js imports (damage from v1)
  content = content.replace(
    /import\s*\{\s*db,?\s*(initializeApp)\s*\}/g,
    'import { $1 }'
  );
  content = content.replace(
    /import\s*\{\s*db\s*,\s*(initializeApp)\s*\}/g,
    'import { $1 }'
  );

  // 2. Check if supabase-adapter import already has db
  // Find the import block that ends with supabase-adapter.js
  const adapterImportMatch = content.match(
    /(import\s*\{)([\s\S]*?)(\}\s*from\s*["']\.\/supabase-adapter\.js["'])/m
  );

  if (!adapterImportMatch) return false;

  const [fullMatch, open, middle, close] = adapterImportMatch;
  
  // Check if db is already in the middle
  if (/\bdb\b/.test(middle)) {
    console.log(`  ✓ db already in adapter import in ${path.basename(filePath)}`);
    return false;
  }

  // Add `db, ` after the opening `{`
  const trimmed = middle.trim();
  const newFull = trimmed 
    ? `${open} db, ${middle} ${close}`
    : `${open} db ${close}`;

  content = content.replace(fullMatch, newFull);

  if (content !== orig) {
    // No backup needed - we have the earlier backups
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ Fixed db import in ${path.basename(filePath)}`);
    return true;
  }
  return false;
}

const htmlFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
let updated = 0;
for (const f of htmlFiles) {
  const fullPath = path.join(ROOT, f);
  if (processFile(fullPath)) updated++;
}

console.log(`\nDone! Fixed ${updated} files.`);
