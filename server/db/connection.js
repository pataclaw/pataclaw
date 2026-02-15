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
  console.log('[DB] Opened database successfully');
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
    // Clean up old corrupt backups first to avoid filling disk
    const dbDir = path.dirname(dbPath);
    const dbName = path.basename(dbPath);
    try {
      const oldBackups = fs.readdirSync(dbDir).filter(f => f.startsWith(dbName + '.corrupt.'));
      for (const ob of oldBackups) {
        try { fs.unlinkSync(path.join(dbDir, ob)); console.log(`[DB] Removed old backup: ${ob}`); } catch (_) {}
      }
    } catch (_) {}
    // Back up the corrupt file (keep only this one)
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

// Periodic WAL checkpoint — flush WAL to main DB file every 5 minutes
// This prevents data loss if the process is killed, since Railway can
// terminate containers at any time during redeploys
setInterval(() => {
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch (e) {
    console.warn('[DB] WAL checkpoint failed:', e.message);
  }
}, 5 * 60 * 1000);

// Also checkpoint on clean shutdown signals
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try {
      console.log(`[DB] ${sig} received — checkpointing WAL...`);
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (_) {}
    process.exit(0);
  });
}

module.exports = db;
