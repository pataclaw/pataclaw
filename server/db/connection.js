const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const dbDir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.resolve(config.dbPath);

// Clean up stale WAL/SHM files that can cause SQLITE_IOERR_SHMSIZE on container restarts
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

const db = new Database(dbPath);

try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.warn('[DB] WAL mode failed, falling back to DELETE journal mode:', e.code || e.message);
  try { db.pragma('journal_mode = DELETE'); } catch (_) { /* proceed anyway */ }
}
db.pragma('foreign_keys = ON');

module.exports = db;
