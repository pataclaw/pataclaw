const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const dbDir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(config.dbPath));

try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.warn('[DB] WAL mode failed, falling back to DELETE journal mode:', e.code || e.message);
  try { db.pragma('journal_mode = DELETE'); } catch (_) { /* proceed anyway */ }
}
db.pragma('foreign_keys = ON');

module.exports = db;
