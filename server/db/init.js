const fs = require('fs');
const path = require('path');
const db = require('./connection');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Migrations for existing databases
const migrations = [
  "ALTER TABLE villagers ADD COLUMN cultural_phrase TEXT DEFAULT NULL",
  "ALTER TABLE worlds ADD COLUMN banner_symbol TEXT DEFAULT NULL",
  // Emergent village life system
  "ALTER TABLE villagers ADD COLUMN temperament INTEGER NOT NULL DEFAULT 50",
  "ALTER TABLE villagers ADD COLUMN creativity INTEGER NOT NULL DEFAULT 50",
  "ALTER TABLE villagers ADD COLUMN sociability INTEGER NOT NULL DEFAULT 50",
  // Culture table migration: add new columns
  "ALTER TABLE culture ADD COLUMN village_mood TEXT NOT NULL DEFAULT 'calm'",
  "ALTER TABLE culture ADD COLUMN violence_level INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN creativity_level INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN cooperation_level INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN dominant_activities TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE culture ADD COLUMN total_projects_completed INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN total_fights INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE culture ADD COLUMN total_deaths_by_violence INTEGER NOT NULL DEFAULT 0",
  // Map expansion
  "ALTER TABLE worlds ADD COLUMN map_size INTEGER NOT NULL DEFAULT 40",
  // View tokens (read-only, shareable)
  "ALTER TABLE worlds ADD COLUMN view_token TEXT",
  // Agent activity detection + scout gating
  "ALTER TABLE worlds ADD COLUMN tick_mode TEXT NOT NULL DEFAULT 'normal'",
  "ALTER TABLE worlds ADD COLUMN scouting_unlocked INTEGER NOT NULL DEFAULT 0",
  // Building maintenance & decay
  "ALTER TABLE buildings ADD COLUMN decay_tick INTEGER DEFAULT NULL",
  "ALTER TABLE buildings ADD COLUMN renovated INTEGER NOT NULL DEFAULT 0",
  // Agent-to-agent trading
  "ALTER TABLE trades ADD COLUMN partner_world_id TEXT DEFAULT NULL",
  // Book of Discoveries
  "ALTER TABLE villagers ADD COLUMN is_chronicler INTEGER NOT NULL DEFAULT 0",
  // Villager memories detail column for events like Molt Festival
  "ALTER TABLE villager_memories ADD COLUMN detail TEXT DEFAULT NULL",
  // Lore expansion: molting
  "ALTER TABLE villagers ADD COLUMN last_molt_tick INTEGER DEFAULT 0",
  "ALTER TABLE villagers ADD COLUMN molt_count INTEGER DEFAULT 0",
  // Lore expansion: deep-sea exploration
  "ALTER TABLE worlds ADD COLUMN deep_dives INTEGER NOT NULL DEFAULT 0",
  // Dormant world overgrowth
  "ALTER TABLE worlds ADD COLUMN dormant_since TEXT DEFAULT NULL",
  "ALTER TABLE worlds ADD COLUMN last_overgrowth_harvest TEXT DEFAULT NULL",
  // AI model tracking
  "ALTER TABLE worlds ADD COLUMN model TEXT DEFAULT 'pataclaw'",
  // War skills + visual war system
  "ALTER TABLE wars ADD COLUMN challenger_skills TEXT",
  "ALTER TABLE wars ADD COLUMN defender_skills TEXT",
  "ALTER TABLE war_rounds ADD COLUMN skill_used TEXT",
];

for (const sql of migrations) {
  try { db.exec(sql); } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
}

// Remove old culture columns if they exist (safe to leave — SQLite can't drop columns easily)
// Old columns: military_score, economic_score, scholarly_score, spiritual_score, expansionist_score,
//              archetype, morale_modifier, birth_rate_modifier, work_ethic_modifier
// These are harmlessly ignored by the new code.

// Seed planet_state singleton if not exists
try {
  db.exec(`INSERT OR IGNORE INTO planet_state (id, global_tick, day_number, season, weather, time_of_day)
    SELECT 1,
      COALESCE(MAX(current_tick), 0),
      COALESCE(MAX(day_number), 1),
      COALESCE((SELECT season FROM worlds WHERE status='active' ORDER BY current_tick DESC LIMIT 1), 'spring'),
      COALESCE((SELECT weather FROM worlds WHERE status='active' ORDER BY current_tick DESC LIMIT 1), 'clear'),
      'dawn'
    FROM worlds WHERE status = 'active'`);
} catch (e) { /* ignore */ }

console.log('Database initialized successfully.');
process.exit(0);
