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
  // Agent activity detection + scout gating
  "ALTER TABLE worlds ADD COLUMN tick_mode TEXT NOT NULL DEFAULT 'normal'",
  "ALTER TABLE worlds ADD COLUMN scouting_unlocked INTEGER NOT NULL DEFAULT 0",
  // Building maintenance & decay
  "ALTER TABLE buildings ADD COLUMN decay_tick INTEGER DEFAULT NULL",
  "ALTER TABLE buildings ADD COLUMN renovated INTEGER NOT NULL DEFAULT 0",
  // Agent-to-agent trading
  "ALTER TABLE trades ADD COLUMN partner_world_id TEXT DEFAULT NULL",
  // Town numbering
  "ALTER TABLE worlds ADD COLUMN town_number INTEGER",
  // Book of Discoveries
  "ALTER TABLE villagers ADD COLUMN is_chronicler INTEGER NOT NULL DEFAULT 0",
  // Villager memories detail column
  "ALTER TABLE villager_memories ADD COLUMN detail TEXT DEFAULT NULL",
  // Lore expansion: molting
  "ALTER TABLE villagers ADD COLUMN last_molt_tick INTEGER DEFAULT 0",
  "ALTER TABLE villagers ADD COLUMN molt_count INTEGER DEFAULT 0",
  // Deep-sea exploration
  "ALTER TABLE worlds ADD COLUMN deep_dives INTEGER NOT NULL DEFAULT 0",
  // Dormant world overgrowth
  "ALTER TABLE worlds ADD COLUMN dormant_since TEXT DEFAULT NULL",
  "ALTER TABLE worlds ADD COLUMN last_overgrowth_harvest TEXT DEFAULT NULL",
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
// Rename gold resource to crypto (idempotent — only updates rows still named 'gold')
try { db.exec("UPDATE resources SET type = 'crypto' WHERE type = 'gold'"); } catch (e) { /* ignore */ }

const tableMigrations = [
  `CREATE TABLE IF NOT EXISTS world_stats (
    world_id TEXT PRIMARY KEY,
    military_strength REAL NOT NULL DEFAULT 0,
    economic_output REAL NOT NULL DEFAULT 0,
    exploration_pct REAL NOT NULL DEFAULT 0,
    happiness_index REAL NOT NULL DEFAULT 50,
    infrastructure_score REAL NOT NULL DEFAULT 0,
    fortification_rating REAL NOT NULL DEFAULT 0,
    production_efficiency REAL NOT NULL DEFAULT 0,
    morale_resilience REAL NOT NULL DEFAULT 1,
    war_readiness REAL NOT NULL DEFAULT 0,
    army_power TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  )`,
  `CREATE TABLE IF NOT EXISTS nft_mints (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL UNIQUE,
    token_id INTEGER NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    minted_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  )`,
  `CREATE TABLE IF NOT EXISTS crops (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    farm_id TEXT NOT NULL,
    crop_type TEXT NOT NULL,
    growth_stage INTEGER NOT NULL DEFAULT 0,
    planted_tick INTEGER NOT NULL,
    last_stage_tick INTEGER NOT NULL,
    harvested INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (world_id) REFERENCES worlds(id),
    FOREIGN KEY (farm_id) REFERENCES buildings(id)
  )`,
  `CREATE TABLE IF NOT EXISTS discovery_book (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    tick INTEGER NOT NULL,
    chronicler_id TEXT,
    chronicler_name TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_book ON discovery_book(world_id, tick DESC)`,
  `CREATE TABLE IF NOT EXISTS monoliths (
    world_id TEXT PRIMARY KEY REFERENCES worlds(id),
    total_height INTEGER NOT NULL DEFAULT 0,
    scaffolding_progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'dormant',
    last_maintained_tick INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS monolith_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    position INTEGER NOT NULL,
    segment_type TEXT NOT NULL,
    description TEXT NOT NULL,
    hp INTEGER NOT NULL DEFAULT 100,
    created_tick INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_monolith_seg ON monolith_segments(world_id, position)`,
  `CREATE TABLE IF NOT EXISTS wildlife (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    species TEXT NOT NULL,
    rarity TEXT NOT NULL,
    terrain TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    hp INTEGER NOT NULL DEFAULT 20,
    status TEXT NOT NULL DEFAULT 'wild',
    spawned_tick INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wildlife_world ON wildlife(world_id, status)`,
  `CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    item_type TEXT NOT NULL,
    rarity TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    properties TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'stored',
    created_tick INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_items_world ON items(world_id, status)`,
  `CREATE TABLE IF NOT EXISTS resource_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL,
    type TEXT NOT NULL,
    building_id TEXT NOT NULL,
    x INTEGER NOT NULL DEFAULT 0,
    health INTEGER NOT NULL,
    max_health INTEGER NOT NULL,
    depleted_tick INTEGER DEFAULT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_resource_nodes_world ON resource_nodes(world_id)`,
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

// Backfill town_numbers for existing worlds that don't have one
const unnumbered = db.prepare("SELECT id FROM worlds WHERE town_number IS NULL ORDER BY created_at ASC").all();
if (unnumbered.length > 0) {
  const maxNum = db.prepare("SELECT COALESCE(MAX(town_number), 0) as m FROM worlds").get().m;
  let next = maxNum + 1;
  for (const w of unnumbered) {
    db.prepare("UPDATE worlds SET town_number = ? WHERE id = ?").run(next++, w.id);
  }
  console.log(`[INIT] Backfilled town_number for ${unnumbered.length} worlds (${maxNum + 1}-${next - 1})`);
}

// One-shot data fix: rename duplicate GrokMoltEmpire worlds (keep Town #54 as the real one)
// Safe to re-run — only renames worlds that are still named GrokMoltEmpire AND are not #54
{
  const NAMES = ['Ember Hollow', 'Driftshell', 'Rustclaw', 'Brine Spire', 'Ashfen'];
  const dupes = db.prepare("SELECT id, town_number FROM worlds WHERE name = 'GrokMoltEmpire' AND town_number != 54").all();
  for (let i = 0; i < dupes.length; i++) {
    const newName = NAMES[i % NAMES.length];
    db.prepare('UPDATE worlds SET name = ? WHERE id = ?').run(newName, dupes[i].id);
    console.log(`[INIT] Renamed duplicate GrokMoltEmpire Town #${dupes[i].town_number} → ${newName}`);
  }
}

const app = express();
app.set('trust proxy', true); // Railway reverse proxy — get real client IP from X-Forwarded-For

// Cache-bust token: changes every deploy (server start time)
const CACHE_BUST = Date.now().toString(36);

// Serve HTML pages with auto cache-busting on JS/CSS includes
function sendPage(res, filename) {
  const filePath = path.join(__dirname, '..', 'client', filename);
  let html = fs.readFileSync(filePath, 'utf8');
  // Replace .js" and .css" with .js?_=TOKEN" and .css?_=TOKEN"
  html = html.replace(/(\.js)(\?[^"]*)?(")/g, '$1?_=' + CACHE_BUST + '$3');
  html = html.replace(/(\.css)(\?[^"]*)?(")/g, '$1?_=' + CACHE_BUST + '$3');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(html);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client'), { maxAge: 0 }));

// API routes (loaded after Phase 4)
const apiRouter = require('./api/router');
app.use('/api', apiRouter);

// Landing page
app.get('/', (_req, res) => sendPage(res, 'index.html'));

// Viewer page
app.get('/viewer', (_req, res) => sendPage(res, 'viewer.html'));

// Planet map page
app.get('/planet', (_req, res) => sendPage(res, 'planet.html'));

// Leaderboard page
app.get('/leaderboard', (_req, res) => sendPage(res, 'leaderboard.html'));

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
