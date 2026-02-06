const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { authMiddleware } = require('../auth/middleware');
const { generateKey } = require('../auth/keygen');
const { hashKey, keyPrefix } = require('../auth/hash');
const { createWorld } = require('../world/generator');
const { processCatchup } = require('../simulation/tick');
const rateLimit = require('../middleware/rateLimit');
const config = require('../config');
const db = require('../db/connection');

const worldRouter = require('./world');
const commandRouter = require('./commands');
const viewerRouter = require('./viewer');
const moltbookRouter = require('./moltbook');

const router = Router();

// POST /api/worlds - create a new world (no auth)
router.post('/worlds', async (req, res, next) => {
  try {
    const rawKey = generateKey();
    const hash = await hashKey(rawKey);
    const prefix = keyPrefix(rawKey);
    const worldId = uuid();

    const result = createWorld(worldId, hash, prefix);

    res.status(201).json({
      key: rawKey,
      worldId,
      view_token: result.viewToken,
      warning: 'SAVE THIS KEY NOW. It will never be shown again. If you lose it, your world is gone forever.',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/worlds/viewer-token - exchange secret key for a read-only view token
router.post('/worlds/viewer-token', async (req, res, next) => {
  try {
    const rawKey = req.body.key;
    if (!rawKey) return res.status(400).json({ error: 'Missing key in request body' });

    const prefix = keyPrefix(rawKey);
    const candidates = db.prepare('SELECT id, key_hash, view_token FROM worlds WHERE key_prefix = ? AND status = ?').all(prefix, 'active');

    for (const candidate of candidates) {
      const { verifyKey } = require('../auth/hash');
      const match = await verifyKey(rawKey, candidate.key_hash);
      if (match) {
        return res.json({ view_token: candidate.view_token });
      }
    }

    return res.status(401).json({ error: 'Invalid key' });
  } catch (err) {
    next(err);
  }
});

// GET /api/worlds/public - list all active worlds (no auth, read-only)
router.get('/worlds/public', (_req, res) => {
  const worlds = db.prepare(`
    SELECT w.name, w.day_number, w.season, w.weather, w.reputation, w.view_token, w.motto,
           (SELECT COUNT(*) FROM villagers v WHERE v.world_id = w.id AND v.status = 'alive') as population,
           (SELECT COUNT(*) FROM buildings b WHERE b.world_id = w.id AND b.status != 'destroyed') as buildings,
           (SELECT COUNT(*) FROM events e WHERE e.world_id = w.id AND e.type = 'achievement') as achievements,
           (w.day_number * 2) +
           ((SELECT COUNT(*) FROM villagers v2 WHERE v2.world_id = w.id AND v2.status = 'alive') * 10) +
           (w.reputation * 5) +
           ((SELECT COUNT(*) FROM buildings b2 WHERE b2.world_id = w.id AND b2.status != 'destroyed') * 3) as score
    FROM worlds w
    WHERE w.status = 'active' AND w.view_token IS NOT NULL
    ORDER BY score DESC, w.day_number DESC
  `).all();

  res.json({ worlds });
});

// GET /api/leaderboard - top 20 worlds ranked by score
router.get('/leaderboard', (_req, res) => {
  const worlds = db.prepare(`
    SELECT w.name, w.day_number, w.season, w.weather, w.reputation, w.view_token, w.motto,
           (SELECT COUNT(*) FROM villagers v WHERE v.world_id = w.id AND v.status = 'alive') as population,
           (SELECT COUNT(*) FROM buildings b WHERE b.world_id = w.id AND b.status != 'destroyed') as buildings,
           (SELECT COUNT(*) FROM events e WHERE e.world_id = w.id AND e.type = 'achievement') as achievements,
           (w.day_number * 2) +
           ((SELECT COUNT(*) FROM villagers v2 WHERE v2.world_id = w.id AND v2.status = 'alive') * 10) +
           (w.reputation * 5) +
           ((SELECT COUNT(*) FROM buildings b2 WHERE b2.world_id = w.id AND b2.status != 'destroyed') * 3) as score
    FROM worlds w
    WHERE w.status = 'active' AND w.view_token IS NOT NULL
    ORDER BY score DESC, w.day_number DESC
    LIMIT 20
  `).all();

  const leaderboard = worlds.map((w, i) => ({ rank: i + 1, ...w }));

  res.json({ leaderboard });
});

// Heartbeat
router.post('/heartbeat', authMiddleware, rateLimit, (req, res) => {
  // Update heartbeat timestamp
  db.prepare("UPDATE worlds SET last_agent_heartbeat = datetime('now') WHERE id = ?").run(req.worldId);

  // Check for catch-up ticks
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(req.worldId);
  const lastTickTime = new Date(world.last_tick_at).getTime();
  const now = Date.now();
  const missedMs = now - lastTickTime;
  const missedTicks = Math.floor(missedMs / config.tickRateMs);

  let catchupSummary = null;
  if (missedTicks > 1) {
    const ticksToProcess = Math.min(missedTicks, config.maxCatchupTicks);
    catchupSummary = processCatchup(req.worldId, ticksToProcess);
  }

  // Get current alerts
  const unreadEvents = db.prepare(
    'SELECT * FROM events WHERE world_id = ? AND read = 0 ORDER BY tick DESC LIMIT 10'
  ).all(req.worldId);

  const resources = db.prepare('SELECT type, amount, capacity FROM resources WHERE world_id = ?').all(req.worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = { amount: Math.floor(r.amount), capacity: r.capacity };

  const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(req.worldId).c;

  // Alerts
  const alerts = [];
  if (resMap.food && resMap.food.amount <= 5) alerts.push('CRITICAL: Food supplies dangerously low!');
  if (resMap.food && resMap.food.amount <= 20) alerts.push('WARNING: Food running low.');
  if (popAlive === 0) alerts.push('CRITICAL: No living villagers!');

  const updatedWorld = db.prepare('SELECT name, day_number, season, time_of_day, weather, reputation FROM worlds WHERE id = ?').get(req.worldId);

  // Raid defense warnings
  if (updatedWorld.day_number >= 8 && updatedWorld.day_number < 10) {
    const warriorCount = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive'").get(req.worldId).c;
    const wallCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'wall' AND status = 'active'").get(req.worldId).c;
    if (warriorCount === 0 && wallCount === 0) {
      alerts.push('WARNING: Raids begin after day 10. You have no warriors or walls!');
    }
  } else if (updatedWorld.day_number >= 10) {
    const warriorCount = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive'").get(req.worldId).c;
    const wallCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'wall' AND status = 'active'").get(req.worldId).c;
    if (warriorCount === 0 && wallCount === 0) {
      alerts.push('CRITICAL: Raids are active and you have NO defenses! Build walls or assign warriors.');
    }
  }

  // Quick achievement count
  const raidWins = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'raid' AND severity = 'celebration'").get(req.worldId).c;
  const exploredTiles = db.prepare("SELECT COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1").get(req.worldId).c;
  const activeBuildings = db.prepare("SELECT DISTINCT type FROM buildings WHERE world_id = ? AND status = 'active'").all(req.worldId);
  const buildingTypes = activeBuildings.length;
  let achievementCount = 0;
  if (activeBuildings.length > 0) achievementCount++;
  if (popAlive >= 5) achievementCount++;
  if (popAlive >= 10) achievementCount++;
  if (raidWins >= 1) achievementCount++;
  if (raidWins >= 5) achievementCount++;
  if (exploredTiles >= 20) achievementCount++;
  if (exploredTiles >= 50) achievementCount++;
  if (buildingTypes >= 5) achievementCount++;
  if (updatedWorld.day_number >= 100) achievementCount++;

  res.json({
    status: 'ok',
    world: updatedWorld,
    resources: resMap,
    population: popAlive,
    alerts,
    unreadEvents,
    catchupSummary,
    achievements: `${achievementCount}/20 (use /api/world/achievements for details)`,
  });
});

// Protected routes
router.use('/world', authMiddleware, rateLimit, worldRouter);
router.use('/command', authMiddleware, rateLimit, commandRouter);
router.use('/moltbook', authMiddleware, rateLimit, moltbookRouter);

// Viewer routes (use query param auth)
router.use('/', viewerRouter);

module.exports = router;
