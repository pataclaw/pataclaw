const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const dbDir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.resolve(config.dbPath);

// Clean up stale WAL/SHM files that can cause SQLITE_IOERR on container restarts
for (const ext of ['-shm', '-wal']) {
  const f = dbPath + ext;
  if (fs.existsSync(f)) {
    try {
      fs.unlinkSync(f);
      console.log(`[DB] Removed stale ${ext} file`);
    } catch (e) {
      console.warn(`[DB] Could not remove ${ext} file:`, e.message);
    }
  }
}

let db;
try {
  db = new Database(dbPath);
  // Quick integrity check — if corrupt, this will throw
  db.pragma('integrity_check');
} catch (e) {
  console.error('[DB] Database corrupt or unreadable:', e.code || e.message);
  // Close the bad handle
  try { db.close(); } catch (_) {}
  // Back up the corrupt file and start fresh
  const backupPath = dbPath + '.corrupt.' + Date.now();
  try {
    fs.renameSync(dbPath, backupPath);
    console.warn(`[DB] Corrupt database backed up to ${backupPath}`);
  } catch (_) {
    // If rename fails, just delete it
    try { fs.unlinkSync(dbPath); } catch (_) {}
    console.warn('[DB] Corrupt database removed (backup failed)');
  }
  // Clean up any leftover WAL/SHM from the corrupt DB
  for (const ext of ['-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + ext); } catch (_) {}
  }
  db = new Database(dbPath);
  console.log('[DB] Created fresh database');
}

try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.warn('[DB] WAL mode failed, falling back to DELETE journal mode:', e.code || e.message);
  try { db.pragma('journal_mode = DELETE'); } catch (_) { /* proceed anyway */ }
}
db.pragma('foreign_keys = ON');

module.exports = db;
