const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const dbDir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.resolve(config.dbPath);

// Try opening the DB WITH WAL/SHM intact first — deleting them loses unflushed data
let db;
try {
  db = new Database(dbPath);
  db.pragma('integrity_check');
  console.log('[DB] Opened database successfully (WAL intact)');
} catch (e) {
  // First attempt failed — try cleaning WAL/SHM and retrying
  console.warn('[DB] First open failed:', e.code || e.message);
  try { db.close(); } catch (_) {}

  for (const ext of ['-shm', '-wal']) {
    const f = dbPath + ext;
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
        console.log(`[DB] Removed stale ${ext} file`);
      } catch (_) {}
    }
  }

  try {
    db = new Database(dbPath);
    db.pragma('integrity_check');
    console.log('[DB] Opened database after WAL cleanup');
  } catch (e2) {
    console.error('[DB] Database corrupt or unreadable:', e2.code || e2.message);
    try { db.close(); } catch (_) {}
    // Back up the corrupt file and start fresh
    const backupPath = dbPath + '.corrupt.' + Date.now();
    try {
      fs.renameSync(dbPath, backupPath);
      console.warn(`[DB] Corrupt database backed up to ${backupPath}`);
    } catch (_) {
      try { fs.unlinkSync(dbPath); } catch (_) {}
      console.warn('[DB] Corrupt database removed (backup failed)');
    }
    for (const ext of ['-shm', '-wal']) {
      try { fs.unlinkSync(dbPath + ext); } catch (_) {}
    }
    db = new Database(dbPath);
    console.log('[DB] Created fresh database');
  }
}

try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.warn('[DB] WAL mode failed, falling back to DELETE journal mode:', e.code || e.message);
  try { db.pragma('journal_mode = DELETE'); } catch (_) { /* proceed anyway */ }
}
db.pragma('foreign_keys = ON');

module.exports = db;
