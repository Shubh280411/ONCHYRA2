// Fix: restore correct db handling
// Instead of importing db from adapter, add `const db = {};` after auth init
// Run: node backend/scripts/fix-db-v3.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BACKUP_DIR = path.join(ROOT, 'backend', 'backup-dbfix3-' + new Date().toISOString().replace(/[:.]/g, '-'));

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const orig = content;

  if (!content.includes('supabase-adapter.js')) return false;

  // 1. Remove `db,` from firebase-app.js imports
  content = content.replace(
    /import\s*\{\s*db,?\s*(initializeApp)\s*\}/g,
    'import { $1 }'
  );

  // 2. Remove `db,` from firebase-app multi-line imports (if any)
  content = content.replace(
    /import\s*\{\s*db\s*,?\s*\n?\s*(initializeApp)/g,
    'import { $1'
  );

  // 3. Add `const db = {};` after `const auth = getAuth(app);` or `const app = initializeApp(firebaseConfig);`
  // Look for `const auth = getAuth(app);` and add `const db = {};` after it
  const authPattern = /(const\s+auth\s*=\s*getAuth\s*\(\s*app\s*\)\s*;)/g;
  if (authPattern.test(content)) {
    content = content.replace(
      /(const\s+auth\s*=\s*getAuth\s*\(\s*app\s*\)\s*;)/,
      '$1\nconst db = {};'
    );
  } else {
    // Fallback: add after app init
    content = content.replace(
      /(const\s+app\s*=\s*initializeApp\s*\([^)]+\)\s*;)/,
      '$1\nconst db = {};'
    );
  }

  if (content !== orig) {
    const relPath = path.relative(ROOT, filePath);
    const backupPath = path.join(BACKUP_DIR, relPath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(filePath, backupPath);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ Fixed ${path.basename(filePath)}`);
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
