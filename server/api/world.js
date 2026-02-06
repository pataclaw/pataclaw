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

// GET /api/world/achievements - computed from current state
router.get('/achievements', (req, res) => {
  const world = db.prepare('SELECT day_number FROM worlds WHERE id = ?').get(req.worldId);
  const buildings = db.prepare("SELECT type, status FROM buildings WHERE world_id = ? AND status != 'destroyed'").all(req.worldId);
  const activeBuildings = buildings.filter(b => b.status === 'active');
  const buildingTypes = new Set(activeBuildings.map(b => b.type));
  const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(req.worldId).c;
  const roleCounts = {};
  const roles = db.prepare("SELECT role, COUNT(*) as cnt FROM villagers WHERE world_id = ? AND status = 'alive' GROUP BY role").all(req.worldId);
  for (const r of roles) roleCounts[r.role] = r.cnt;
  const exploredTiles = db.prepare("SELECT COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1").get(req.worldId).c;
  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(req.worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = Math.floor(r.amount);
  const culture = db.prepare('SELECT custom_phrases FROM culture WHERE world_id = ?').get(req.worldId);
  const phrases = culture ? JSON.parse(culture.custom_phrases || '[]') : [];
  const raidWins = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'raid' AND severity = 'celebration'").get(req.worldId).c;
  const projectsDone = db.prepare("SELECT COUNT(*) as c FROM projects WHERE world_id = ? AND status = 'complete'").get(req.worldId).c;

  const allRoles = ['farmer', 'builder', 'warrior', 'scout', 'scholar', 'priest', 'fisherman'];
  const hasAllRoles = allRoles.every(r => (roleCounts[r] || 0) >= 1);

  const ACHIEVEMENTS = [
    { id: 'first_building', name: 'Foundation', desc: 'Build your first structure', unlocked: activeBuildings.length > 0 },
    { id: 'first_farm', name: 'Breadbasket', desc: 'Build a farm', unlocked: buildingTypes.has('farm') },
    { id: 'first_wall', name: 'Fortified', desc: 'Build a wall', unlocked: buildingTypes.has('wall') },
    { id: 'watchtower', name: 'Vigilant', desc: 'Build a watchtower', unlocked: buildingTypes.has('watchtower') },
    { id: 'dockmaster', name: 'Dockmaster', desc: 'Build a dock', unlocked: buildingTypes.has('dock') },
    { id: 'temple_builder', name: 'Divine Favor', desc: 'Build a temple', unlocked: buildingTypes.has('temple') },
    { id: 'grand_architect', name: 'Grand Architect', desc: 'Build 5 different building types', unlocked: buildingTypes.size >= 5 },
    { id: 'growing_village', name: 'Growing Village', desc: 'Reach population of 5', unlocked: popAlive >= 5 },
    { id: 'thriving_town', name: 'Thriving Town', desc: 'Reach population of 10', unlocked: popAlive >= 10 },
    { id: 'diverse_society', name: 'Diverse Society', desc: 'Have all 7 roles filled', unlocked: hasAllRoles },
    { id: 'fisher_king', name: 'Fisher King', desc: 'Have a dock and a fisherman', unlocked: buildingTypes.has('dock') && (roleCounts['fisherman'] || 0) >= 1 },
    { id: 'raid_survivor', name: 'Raid Survivor', desc: 'Repel your first raid', unlocked: raidWins >= 1 },
    { id: 'raid_veteran', name: 'Raid Veteran', desc: 'Repel 5 raids', unlocked: raidWins >= 5 },
    { id: 'explorer', name: 'Explorer', desc: 'Explore 20 tiles', unlocked: exploredTiles >= 20 },
    { id: 'cartographer', name: 'Cartographer', desc: 'Explore 50 tiles', unlocked: exploredTiles >= 50 },
    { id: 'culture_shaper', name: 'Culture Shaper', desc: 'Teach 5 phrases', unlocked: phrases.length >= 5 },
    { id: 'project_builder', name: 'Artisan', desc: 'Complete a villager project', unlocked: projectsDone >= 1 },
    { id: 'wealthy', name: 'Golden Age', desc: 'Accumulate 50 gold', unlocked: (resMap.gold || 0) >= 50 },
    { id: 'scholar_dream', name: "Scholar's Dream", desc: 'Accumulate 50 knowledge', unlocked: (resMap.knowledge || 0) >= 50 },
    { id: 'centurion', name: 'Centurion', desc: 'Reach day 100', unlocked: (world ? world.day_number : 0) >= 100 },
  ];

  const unlocked = ACHIEVEMENTS.filter(a => a.unlocked);
  const locked = ACHIEVEMENTS.filter(a => !a.unlocked);

  res.json({
    total: ACHIEVEMENTS.length,
    unlocked: unlocked.length,
    achievements: ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, desc: a.desc, unlocked: a.unlocked })),
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
