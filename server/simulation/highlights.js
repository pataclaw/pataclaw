const db = require('../db/connection');

// ── Highlight scoring by event type ──
// Higher = more shareable / noteworthy
const TYPE_SCORES = {
  // Legendary (100)
  legendary_discovery: 100,
  miracle:            100,
  ancient_forge:      100,
  crystal_spire:      100,
  shadow_keep:        100,
  sunken_temple:      100,
  elder_library:      100,
  // Epic (80)
  monolith:            80,
  deep_sea:            80,
  war_monument:        80,
  // Notable (60)
  project_complete:    60,
  festival:            60,
  prophet:             60,
  chronicle:           60,
  celebration:         60,
  // Significant (40)
  raid:                40,
  death:               40,
  fight:               40,
  omen:                40,
  // Milestone (30)
  birth:               30,
  construction:        30,
  expansion:           30,
  discovery:           30,
  trade:               30,
  molt:                20,
  harvest:             20,
};

// Severity bonus multiplier
const SEVERITY_MULT = {
  celebration: 1.3,
  danger:      1.2,
  warning:     1.1,
  info:        1.0,
};

function scoreEvent(event) {
  const base = TYPE_SCORES[event.type] || 10;
  const mult = SEVERITY_MULT[event.severity] || 1.0;
  return Math.round(base * mult);
}

/**
 * Get top highlights for a single world
 */
function getWorldHighlights(worldId, limit = 10) {
  const events = db.prepare(`
    SELECT e.id, e.tick, e.type, e.title, e.description, e.severity, e.data, e.created_at,
           w.name as world_name, w.town_number, w.day_number, w.season, w.weather
    FROM events e
    JOIN worlds w ON w.id = e.world_id
    WHERE e.world_id = ?
    ORDER BY e.tick DESC
    LIMIT 200
  `).all(worldId);

  return rankHighlights(events, limit);
}

/**
 * Get top highlights across all worlds on the planet
 */
function getPlanetHighlights(limit = 20) {
  const events = db.prepare(`
    SELECT e.id, e.tick, e.type, e.title, e.description, e.severity, e.data, e.created_at,
           w.name as world_name, w.town_number, w.day_number, w.season, w.weather
    FROM events e
    JOIN worlds w ON w.id = e.world_id
    WHERE w.status = 'active'
    ORDER BY e.created_at DESC
    LIMIT 500
  `).all();

  return rankHighlights(events, limit);
}

/**
 * Get a single event by ID with world context
 */
function getHighlightById(eventId) {
  return db.prepare(`
    SELECT e.id, e.world_id, e.tick, e.type, e.title, e.description, e.severity, e.data, e.created_at,
           w.name as world_name, w.town_number, w.day_number, w.season, w.weather,
           (SELECT COUNT(*) FROM villagers v WHERE v.world_id = w.id AND v.status = 'alive') as population
    FROM events e
    JOIN worlds w ON w.id = e.world_id
    WHERE e.id = ?
  `).get(eventId);
}

function rankHighlights(events, limit) {
  const scored = events.map(e => ({
    ...e,
    score: scoreEvent(e),
    data: e.data ? tryParse(e.data) : null,
  }));

  scored.sort((a, b) => b.score - a.score || b.tick - a.tick);
  return scored.slice(0, limit);
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

module.exports = { getWorldHighlights, getPlanetHighlights, getHighlightById, scoreEvent };
