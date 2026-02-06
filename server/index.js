const express = require('express');
const path = require('path');
const config = require('./config');
const db = require('./db/connection');
const errorHandler = require('./middleware/errorHandler');

// Initialize DB schema
const fs = require('fs');

// Run column migrations BEFORE schema.sql so indexes on new columns succeed
const migrations = [
  "ALTER TABLE villagers ADD COLUMN cultural_phrase TEXT DEFAULT NULL",
  "ALTER TABLE worlds ADD COLUMN banner_symbol TEXT DEFAULT NULL",
  "ALTER TABLE villagers ADD COLUMN temperament INTEGER NOT NULL DEFAULT 50",
  "ALTER TABLE villagers ADD COLUMN creativity INTEGER NOT NULL DEFAULT 50",
  "ALTER TABLE villagers ADD COLUMN sociability INTEGER NOT NULL DEFAULT 50",
  "ALTER TABLE culture ADD COLUMN village_mood TEXT NOT NULL DEFAULT 'calm'",
  "ALTER TABLE culture ADD COLUMN violence_level INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN creativity_level INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN cooperation_level INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN dominant_activities TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE culture ADD COLUMN total_projects_completed INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN total_fights INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN total_deaths_by_violence INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE worlds ADD COLUMN map_size INTEGER NOT NULL DEFAULT 40",
  "ALTER TABLE worlds ADD COLUMN view_token TEXT",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (e) {
    // ignore duplicate column errors
  }
}

// Now load schema (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf-8');
db.exec(schema);

// Table migrations (CREATE TABLE IF NOT EXISTS is safe to re-run)
const tableMigrations = [
  `CREATE TABLE IF NOT EXISTS nft_mints (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL UNIQUE,
    token_id INTEGER NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    minted_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  )`,
];
for (const sql of tableMigrations) {
  try { db.exec(sql); } catch (e) { /* ignore */ }
}

// Backfill view_tokens for existing worlds that don't have one
const { v4: uuidV4 } = require('uuid');
const worldsWithoutToken = db.prepare("SELECT id FROM worlds WHERE view_token IS NULL").all();
for (const w of worldsWithoutToken) {
  db.prepare("UPDATE worlds SET view_token = ? WHERE id = ?").run(uuidV4(), w.id);
}

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// API routes (loaded after Phase 4)
const apiRouter = require('./api/router');
app.use('/api', apiRouter);

// Landing page
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Viewer page
app.get('/viewer', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'viewer.html'));
});

// Pretty URL: /view/:token -> /viewer?token=:token
app.get('/view/:token', (req, res) => {
  res.redirect('/viewer?token=' + encodeURIComponent(req.params.token));
});

app.use(errorHandler);

// Start simulation engine
const engine = require('./simulation/engine');
engine.start();

app.listen(config.port, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║         PATACLAW SERVER v0.1          ║
  ║   ASCII Civilization for AI Agents    ║
  ╠═══════════════════════════════════════╣
  ║  Port: ${String(config.port).padEnd(30)}║
  ║  Tick: ${String(config.tickRateMs + 'ms').padEnd(30)}║
  ╚═══════════════════════════════════════╝
  `);
});
