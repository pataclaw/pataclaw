const { Router } = require('express');
const db = require('../db/connection');

const router = Router();

// GET /api/world - full world state
router.get('/', (req, res) => {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(req.worldId);
  const resources = db.prepare('SELECT type, amount, capacity, production_rate, consumption_rate FROM resources WHERE world_id = ?').all(req.worldId);
  const buildings = db.prepare("SELECT * FROM buildings WHERE world_id = ? AND status != 'destroyed'").all(req.worldId);
  const villagers = db.prepare("SELECT * FROM villagers WHERE world_id = ? AND status = 'alive'").all(req.worldId);
  const recentEvents = db.prepare('SELECT * FROM events WHERE world_id = ? ORDER BY tick DESC LIMIT 20').all(req.worldId);

  res.json({ world, resources, buildings, villagers, recentEvents });
});

// GET /api/world/status - compact status
router.get('/status', (req, res) => {
  const world = db.prepare('SELECT name, current_tick, day_number, season, time_of_day, weather, hero_title, motto, reputation, map_size FROM worlds WHERE id = ?').get(req.worldId);
  const resources = db.prepare('SELECT type, amount, capacity FROM resources WHERE world_id = ?').all(req.worldId);
  const popAlive = db.prepare("SELECT COUNT(*) as count FROM villagers WHERE world_id = ? AND status = 'alive'").get(req.worldId).count;
  const buildingCap = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'").get(req.worldId).cap;
  const unreadEvents = db.prepare('SELECT COUNT(*) as count FROM events WHERE world_id = ? AND read = 0').get(req.worldId).count;
  const constructing = db.prepare("SELECT type, construction_ticks_remaining FROM buildings WHERE world_id = ? AND status = 'constructing'").all(req.worldId);

  res.json({
    ...world,
    population: popAlive,
    capacity: buildingCap,
    resources: Object.fromEntries(resources.map((r) => [r.type, { amount: Math.floor(r.amount), capacity: r.capacity }])),
    unreadEvents,
    constructing,
  });
});

// GET /api/world/map - explored tiles
router.get('/map', (req, res) => {
  const x = parseInt(req.query.x) || null;
  const y = parseInt(req.query.y) || null;
  const radius = parseInt(req.query.radius) || null;

  let tiles;
  if (x !== null && y !== null && radius) {
    tiles = db.prepare(
      'SELECT x, y, terrain, elevation, explored, feature, feature_depleted FROM tiles WHERE world_id = ? AND explored = 1 AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?'
    ).all(req.worldId, x - radius, x + radius, y - radius, y + radius);
  } else {
    tiles = db.prepare(
      'SELECT x, y, terrain, elevation, explored, feature, feature_depleted FROM tiles WHERE world_id = ? AND explored = 1'
    ).all(req.worldId);
  }

  res.json({ tiles });
});

// GET /api/world/buildings
router.get('/buildings', (req, res) => {
  const buildings = db.prepare("SELECT * FROM buildings WHERE world_id = ? AND status != 'destroyed'").all(req.worldId);
  res.json({ buildings });
});

// GET /api/world/villagers
router.get('/villagers', (req, res) => {
  const villagers = db.prepare("SELECT * FROM villagers WHERE world_id = ?").all(req.worldId);
  // Include activities
  const activities = db.prepare('SELECT * FROM villager_activities WHERE world_id = ?').all(req.worldId);
  const actMap = {};
  for (const a of activities) actMap[a.villager_id] = a.activity;

  const enriched = villagers.map(v => ({
    ...v,
    current_activity: actMap[v.id] || 'idle',
  }));
  res.json({ villagers: enriched });
});

// GET /api/world/events
router.get('/events', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const events = db.prepare(
    'SELECT * FROM events WHERE world_id = ? AND tick > ? ORDER BY tick DESC LIMIT ?'
  ).all(req.worldId, since, limit);

  res.json({ events });
});

// GET /api/world/events/unread
router.get('/events/unread', (req, res) => {
  const events = db.prepare(
    'SELECT * FROM events WHERE world_id = ? AND read = 0 ORDER BY tick DESC LIMIT 50'
  ).all(req.worldId);

  res.json({ events });
});

// GET /api/world/culture
router.get('/culture', (req, res) => {
  const { getCulture } = require('../simulation/culture');
  const culture = getCulture(req.worldId);
  const world = db.prepare('SELECT banner_symbol FROM worlds WHERE id = ?').get(req.worldId);

  // Compute avg personality stats
  const villagers = db.prepare(
    "SELECT temperament, creativity, sociability FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(req.worldId);
  const avg = { temperament: 50, creativity: 50, sociability: 50 };
  if (villagers.length > 0) {
    avg.temperament = Math.round(villagers.reduce((s, v) => s + (v.temperament || 50), 0) / villagers.length);
    avg.creativity = Math.round(villagers.reduce((s, v) => s + (v.creativity || 50), 0) / villagers.length);
    avg.sociability = Math.round(villagers.reduce((s, v) => s + (v.sociability || 50), 0) / villagers.length);
  }

  res.json({
    mood: culture.village_mood,
    violence_level: culture.violence_level,
    creativity_level: culture.creativity_level,
    cooperation_level: culture.cooperation_level,
    dominant_activities: culture.dominant_activities,
    total_projects_completed: culture.total_projects_completed,
    total_fights: culture.total_fights,
    total_deaths_by_violence: culture.total_deaths_by_violence,
    avg_personality: avg,
    custom_phrases: culture.custom_phrases,
    custom_greetings: culture.custom_greetings,
    cultural_values: [culture.cultural_value_1, culture.cultural_value_2].filter(Boolean),
    laws: culture.custom_laws,
    preferred_trait: culture.preferred_trait,
    banner_symbol: world ? world.banner_symbol : null,
  });
});

// POST /api/world/events/mark-read
router.post('/events/mark-read', (req, res) => {
  const { event_ids } = req.body;
  if (event_ids && Array.isArray(event_ids)) {
    const stmt = db.prepare('UPDATE events SET read = 1 WHERE id = ? AND world_id = ?');
    for (const id of event_ids) {
      stmt.run(id, req.worldId);
    }
  } else {
    db.prepare('UPDATE events SET read = 1 WHERE world_id = ?').run(req.worldId);
  }
  res.json({ ok: true });
});

module.exports = router;
