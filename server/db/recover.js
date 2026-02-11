/**
 * Attempts to recover data from a corrupt database backup.
 * Looks for .corrupt.* files next to the main DB and tries to copy rows.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const TABLES_TO_RECOVER = [
  'worlds',
  'villagers',
  'buildings',
  'resources',
  'culture',
  'events',
  'trades',
  'villager_memories',
  'exploration',
  'discovery_book',
  'monoliths',
  'monolith_segments',
  'wildlife',
  'items',
  'resource_nodes',
  'planet_state',
  'world_stats',
  'crops',
  'wars',
  'war_rounds',
  'spectators',
  'bets',
  'nft_mints',
];

function attemptRecovery(db) {
  const dbPath = path.resolve(config.dbPath);
  const dbDir = path.dirname(dbPath);
  const dbName = path.basename(dbPath);

  // Find corrupt backup files
  let files;
  try {
    files = fs.readdirSync(dbDir).filter(f => f.startsWith(dbName + '.corrupt.'));
  } catch (e) {
    return;
  }

  if (files.length === 0) return;

  // Check if current DB already has data (don't overwrite)
  const worldCount = db.prepare("SELECT COUNT(*) as c FROM worlds").get().c;
  if (worldCount > 0) {
    console.log(`[RECOVERY] Skipping — current DB already has ${worldCount} worlds`);
    return;
  }

  console.log(`[RECOVERY] Found ${files.length} corrupt backup(s), attempting recovery...`);

  for (const file of files) {
    const corruptPath = path.join(dbDir, file);
    let corruptDb;
    try {
      corruptDb = new Database(corruptPath, { readonly: true, fileMustExist: true });
    } catch (e) {
      console.warn(`[RECOVERY] Cannot open ${file}: ${e.message}`);
      continue;
    }

    let totalRecovered = 0;

    for (const table of TABLES_TO_RECOVER) {
      try {
        // Get rows from corrupt DB
        const rows = corruptDb.prepare(`SELECT * FROM ${table}`).all();
        if (rows.length === 0) continue;

        // Get column names from the fresh DB's table
        const cols = db.pragma(`table_info(${table})`).map(c => c.name);
        if (cols.length === 0) continue;

        // Filter to only columns that exist in both
        const sampleKeys = Object.keys(rows[0]);
        const commonCols = cols.filter(c => sampleKeys.includes(c));
        if (commonCols.length === 0) continue;

        const placeholders = commonCols.map(() => '?').join(', ');
        const insert = db.prepare(
          `INSERT OR IGNORE INTO ${table} (${commonCols.join(', ')}) VALUES (${placeholders})`
        );

        const insertMany = db.transaction((rows) => {
          let count = 0;
          for (const row of rows) {
            try {
              insert.run(...commonCols.map(c => row[c] !== undefined ? row[c] : null));
              count++;
            } catch (_) { /* skip bad rows */ }
          }
          return count;
        });

        const count = insertMany(rows);
        if (count > 0) {
          console.log(`[RECOVERY] Restored ${count}/${rows.length} rows in ${table}`);
          totalRecovered += count;
        }
      } catch (e) {
        // Table might not exist or be unreadable in corrupt DB
        console.warn(`[RECOVERY] Could not read ${table}: ${e.message}`);
      }
    }

    try { corruptDb.close(); } catch (_) {}

    if (totalRecovered > 0) {
      console.log(`[RECOVERY] Total: ${totalRecovered} rows recovered from ${file}`);
      // Rename to .recovered so we don't try again
      try {
        fs.renameSync(corruptPath, corruptPath + '.recovered');
      } catch (_) {}
    } else {
      console.warn(`[RECOVERY] No data could be recovered from ${file}`);
    }
  }
}

module.exports = { attemptRecovery };
