// Fix: add `db` to all supabase-adapter imports
// Run: node backend/scripts/fix-db-import.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BACKUP_DIR = path.join(ROOT, 'backend', 'backup-dbfix-' + new Date().toISOString().replace(/[:.]/g, '-'));

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const orig = content;

  // Skip files that don't import from supabase-adapter
  if (!content.includes('supabase-adapter.js')) return false;

  // Check if `db` is already imported
  const hasDb = /[,\s]db[,\s\}]/.test(
    content.split('supabase-adapter.js')[0].split('import').slice(-1)[0] || ''
  );

  if (hasDb) {
    console.log(`  ✓ db already imported in ${path.basename(filePath)}`);
    return false;
  }

  // Add `db, ` after the first `{` in the import
  // Handle: `import { doc, ... } from "./supabase-adapter.js"`
  content = content.replace(
    /(import\s*\{)([\s\S]*?)(\}\s*from\s*["']\.\/supabase-adapter\.js["'])/,
    (match, open, middle, close) => {
      const trimmed = middle.trim();
      if (!trimmed) {
        return `${open} db ${close}`;
      }
      return `${open} db, ${middle} ${close}`;
    }
  );

  if (content !== orig) {
    const relPath = path.relative(ROOT, filePath);
    const backupPath = path.join(BACKUP_DIR, relPath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(filePath, backupPath);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ Added db to ${path.basename(filePath)}`);
    return true;
  }
  return false;
}

// Check all HTML files
const htmlFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
let updated = 0;
for (const f of htmlFiles) {
  const fullPath = path.join(ROOT, f);
  if (processFile(fullPath)) updated++;
}

console.log(`\nDone! Updated ${updated} files. Backups in ${BACKUP_DIR}`);
