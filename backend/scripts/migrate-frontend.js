// ONCHYRA Frontend Migration: Firestore → Supabase
// Run: node backend/scripts/migrate-frontend.js
// What it does:
// 1. Replaces firebase-firestore.js imports with supabase-adapter.js
// 2. Removes getFirestore and initializeFirestore from import lists
// 3. Removes const db = getFirestore(app) / initializeFirestore(app, ...) lines
// 4. Creates a backup of each file before modification

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BACKUP_DIR = path.join(ROOT, 'backend', 'backup-frontend-' + new Date().toISOString().replace(/[:.]/g, '-'));

const OLD_IMPORT = /https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js/g;

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const orig = content;

  // Check if file uses firestore
  if (!content.includes('firebase-firestore.js') && 
      !content.includes('import { getFirestore') && 
      !content.includes('import {initializeFirestore') &&
      !content.includes('import {\n  getFirestore') &&
      !content.includes('import {\ninitializeFirestore')) {
    return false;
  }

  console.log(`Processing: ${path.basename(filePath)}`);

  // 1. Replace import source URL
  content = content.replace(OLD_IMPORT, './supabase-adapter.js');

  // 2. Handle single-line imports: remove getFirestore, 
  content = content.replace(
    /import\s*\{\s*getFirestore,\s*/g,
    'import { '
  );
  // Handle single-line: remove getFirestore} (no space before })
  content = content.replace(
    /import\s*\{\s*getFirestore\s*\}/g,
    'import { }'
  );
  // Handle multi-line: remove lines with getFirestore,
  content = content.replace(
    /^\s*getFirestore,\s*$/gm,
    ''
  );
  // Remove standalone getFirestore in multi-line (no comma)
  content = content.replace(
    /^\s*getFirestore\s*$/gm,
    ''
  );
  // Handle getFirestore with a comma in the import
  content = content.replace(
    /,\s*getFirestore\s*}/g,
    ' }'
  );

  // 3. Handle initializeFirestore (same patterns)
  content = content.replace(
    /import\s*\{\s*initializeFirestore,\s*/g,
    'import { '
  );
  content = content.replace(
    /import\s*\{\s*initializeFirestore\s*\}/g,
    'import { }'
  );
  content = content.replace(
    /^\s*initializeFirestore,\s*$/gm,
    ''
  );
  content = content.replace(
    /^\s*initializeFirestore\s*$/gm,
    ''
  );

  // 4. Handle import { } from (empty imports) - remove these lines
  content = content.replace(
    /import\s*\{\s*\}\s*from\s*["']\.\/supabase-adapter\.js["'];\s*\n?/g,
    ''
  );

  // 5. Remove const db = getFirestore(app); (and variations)
  content = content.replace(
    /const\s+db\s*=\s*getFirestore\s*\(\s*app\s*\)\s*;?\s*\n?/g,
    ''
  );
  // Remove const db = initializeFirestore(app, { ... });
  content = content.replace(
    /const\s+db\s*=\s*initializeFirestore\s*\([^;]+\)\s*;?\s*\n?/g,
    ''
  );

  // 6. Remove any import of getFirestore or initializeFirestore from the supabase adapter (shouldn't export them)
  // No action needed since adapter doesn't export these

  // 7. Clean up empty lines from removals
  content = content.replace(/\n{3,}/g, '\n\n');

  if (content !== orig) {
    // Backup original
    const relPath = path.relative(ROOT, filePath);
    const backupPath = path.join(BACKUP_DIR, relPath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(filePath, backupPath);
    
    // Write modified
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ Updated (backup: ${path.relative(ROOT, backupPath)})`);
    return true;
  }
  return false;
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'backend') continue;
      walkDir(fullPath);
    } else if (entry.name.endsWith('.html')) {
      processFile(fullPath);
    }
  }
}

console.log('ONCHYRA Frontend Migration: Firestore → Supabase Adapter\n');
console.log(`Backup directory: ${BACKUP_DIR}\n`);

walkDir(ROOT);

console.log('\nDone! Review changes and test the site.');
