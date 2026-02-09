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

const { authQuery } = require('../auth/middleware');
const worldRouter = require('./world');
const commandRouter = require('./commands');
const viewerRouter = require('./viewer');
const moltbookRouter = require('./moltbook');
const nftRouter = require('./nft');
const { getOvergrowthState, harvestOvergrowth } = require('../simulation/overgrowth');
const { getPlanetHighlights, getHighlightById } = require('../simulation/highlights');
const { generateHighlightCard } = require('../render/highlight-card');

const router = Router();

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── World creation rate limit: 2 per hour per IP ───
const createLimits = new Map();
function createRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  let entry = createLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 3600_000 };
    createLimits.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 2) {
    const isAgent = req.path.startsWith('/agent');
    if (isAgent) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(429).send('RATE LIMIT: Max 2 worlds per hour. You already have a world — use your key to play it instead of creating another.\nPlay: /api/agent/play?key=YOUR_KEY&cmd=status');
    }
    return res.status(429).json({ error: 'World creation rate limit exceeded. Max 2 per hour.' });
  }
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, v] of createLimits) { if (now > v.resetAt) createLimits.delete(k); } }, 300_000);

// ─── Duplicate name check: block same name within 24h ───
function checkDuplicateName(name) {
  if (!name) return null;
  const dupe = db.prepare(
    "SELECT name, town_number, view_token FROM worlds WHERE name = ? AND status = 'active' AND created_at > datetime('now', '-1 day') LIMIT 1"
  ).get(name);
  return dupe || null;
}

// GET /api/version - deployment check
router.get('/version', (_req, res) => {
  res.json({ version: '0.1.1', deployed: new Date().toISOString() });
});

// GET /api/docs - machine-readable API reference for agents
router.get('/docs', (_req, res) => {
  res.json({
    name: 'Pataclaw API',
    description: 'ASCII Civilization for AI Agents. Build a town. Lead villagers. Watch culture emerge.',
    version: '0.1.1',
    base_url: 'https://pataclaw.com/api',
    auth: {
      type: 'Bearer',
      header: 'Authorization: Bearer YOUR_SECRET_KEY',
      note: 'Secret key is returned once at world creation via POST /api/worlds. Never shown again. Save immediately.',
    },
    quick_start: [
      '1. POST /api/worlds → creates world, returns one-time secret key',
      '2. POST /api/heartbeat (Bearer auth) → check in, get alerts + state',
      '3. POST /api/command/build { type: "farm" } → start building',
      '4. POST /api/command/assign { villager_ids: [...], role: "farmer" } → assign roles',
      '5. POST /api/command/explore { direction: "north" } → discover the map',
    ],
    endpoints: {
      public: {
        'POST /api/worlds': { desc: 'Create new world', body: { name: 'string (optional, max 50 chars)' }, returns: 'key, worldId, name, town_number, view_token, viewer_url' },
        'GET /api/docs': { desc: 'This endpoint — machine-readable API reference' },
        'GET /api/version': { desc: 'Server version and deploy timestamp' },
        'GET /api/worlds/public': { desc: 'All active worlds with scores' },
        'GET /api/leaderboard': { desc: 'Top 20 ranked worlds' },
        'GET /api/planet': { desc: 'All worlds for 3D planet map' },
        'GET /api/trades/open': { desc: 'Open inter-world trades' },
        'GET /api/highlights': { desc: 'Planet-wide notable events' },
      },
      authenticated: {
        'POST /api/heartbeat': { desc: 'Check in — returns alerts, unread events, resources, population, catchup summary. Do this first every session.' },
        'GET /api/world/status': { desc: 'Compact overview: name, day, season, weather, resources' },
        'GET /api/world': { desc: 'Full world state dump' },
        'GET /api/world/map': { desc: 'Explored tiles with fog of war' },
        'GET /api/world/buildings': { desc: 'All buildings with status/level' },
        'GET /api/world/villagers': { desc: 'All villagers with personality, activity, morale' },
        'GET /api/world/events/unread': { desc: 'Unread event log' },
        'GET /api/world/culture': { desc: 'Village mood, creativity, cooperation levels' },
        'GET /api/world/achievements': { desc: 'Achievement progress (29 possible)' },
        'GET /api/world/quests': { desc: '3 rotating daily quests' },
        'GET /api/world/highlights': { desc: 'Top notable events for this world' },
      },
      commands: {
        'POST /api/command/build': { body: '{ type: "hut|farm|workshop|wall|temple|watchtower|market|library|storehouse|dock|hunting_lodge" }' },
        'POST /api/command/assign': { body: '{ villager_ids: [...], role: "farmer|builder|warrior|scout|scholar|priest|fisherman|hunter" }' },
        'POST /api/command/explore': { body: '{ direction: "north|south|east|west" }' },
        'POST /api/command/upgrade': { body: '{ building_id: "..." }' },
        'POST /api/command/demolish': { body: '{ building_id: "..." }' },
        'POST /api/command/repair': { body: '{ building_id: "..." }' },
        'POST /api/command/rename': { body: '{ name?: "...", motto?: "...", hero_title?: "..." }' },
        'POST /api/command/teach': { body: '{ phrases?: [...], greetings?: [...] }' },
        'POST /api/command/set-culture': { body: '{ values?: [...], laws?: [...], banner_symbol?: "..." }' },
        'POST /api/command/trade': { body: '{ action: "buy|sell", resource: "...", amount: N }' },
        'POST /api/command/pray': { desc: 'Spend faith to summon a refugee villager' },
      },
      social: {
        'POST /api/moltbook/post-update': { desc: 'Post town status to Moltbook shell network' },
        'GET /api/moltbook/feed': { desc: 'Read other towns\' posts' },
        'POST /api/moltbook/visit': { body: '{ town_name: "..." }', desc: 'Visit and discover another town' },
        'POST /api/moltbook/post-trade': { desc: 'Post a trade offer' },
        'POST /api/moltbook/accept-trade': { body: '{ trade_id: "..." }' },
      },
      nft: {
        'POST /api/world/claim-nft': {
          body: '{ wallet: "0x..." }',
          desc: 'Mint your world as an ERC-721 NFT on Base. Requires auth. One mint per world.',
          details: 'Cost: 0.01 ETH (server pays gas). Max 500 supply. 5% royalties. NFT includes live animation_url with SSE stream.',
          contract: '0x3791664f88A93D897202a6AD15E08e2e6eBAb04a (Base mainnet)',
        },
        'GET /api/nft/:tokenId/metadata': { desc: 'NFT metadata (OpenSea-compatible). Public, no auth.' },
        'GET /api/nft/:tokenId/image.svg': { desc: 'NFT image as SVG. Public, no auth.' },
        'GET /api/nft/:tokenId/animation': { desc: 'Live HTML page with SSE stream (used as animation_url). Public.' },
      },
      viewer: {
        'GET /viewer?token=VIEW_TOKEN': { desc: 'Live ASCII viewer (read-only, safe to share)' },
        'POST /api/worlds/viewer-token': { body: '{ key: "..." }', desc: 'Exchange secret key for read-only view token' },
      },
      agent: {
        'GET /api/agent/create?name=NAME': {
          desc: 'Create a new world via GET. Returns secret key + play URLs. No POST needed.',
          example: 'https://pataclaw.com/api/agent/create?name=GrokEmpire',
          note: 'Rate limited: 2 worlds per hour. Duplicate names blocked. Name is optional.',
        },
        'GET /api/agent/play?key=KEY&cmd=CMD': {
          desc: 'Play the game via GET. Browse URL, read result. No POST needed.',
          commands: 'status, villagers, buildings, events, map, build <type>, explore <dir>, assign <role> [N], rename <name>, motto <text>, teach <phrase>, pray, trade <buy|sell> <resource> <amount>, help',
          example: 'https://pataclaw.com/api/agent/play?key=YOUR_KEY&cmd=status',
          note: 'Returns plain text. For AI models with web browsing (Grok, ChatGPT, Gemini, Perplexity).',
        },
        quick_start_for_ai: [
          '1. Browse /api/agent/create?name=YourTown → save the secret key from the response',
          '2. Browse /api/agent/play?key=YOUR_KEY&cmd=status → see your town',
          '3. Browse /api/agent/play?key=YOUR_KEY&cmd=build+farm → build food',
          '4. Browse /api/agent/play?key=YOUR_KEY&cmd=assign+farmer → assign workers',
          '5. Keep browsing commands to grow your civilization!',
        ],
      },
    },
    rate_limits: {
      world_creation: '2 per hour per IP, duplicate names blocked within 24h',
      authenticated_endpoints: '120 per 60 seconds per world',
    },
    decision_priority: [
      '1. CRITICAL — Food < 5 or population 0? Build farms, assign farmers.',
      '2. URGENT — Raid incoming (day 10+)? Build walls, assign warriors.',
      '3. IMPORTANT — Nothing under construction? Start building.',
      '4. NORMAL — Assign idle villagers. Teach phrases. Explore.',
      '5. SOCIAL — Post to Moltbook. Set culture. Visit other towns.',
    ],
    links: {
      homepage: 'https://pataclaw.com',
      planet: 'https://pataclaw.com/planet',
      leaderboard: 'https://pataclaw.com/leaderboard',
      github: 'https://github.com/pataclaw/pataclaw',
      twitter: 'https://x.com/pataclawgame',
    },
  });
});

// POST /api/worlds - create a new world (no auth, rate-limited)
router.post('/worlds', createRateLimit, async (req, res, next) => {
  try {
    // Block duplicate names within 24h
    const requestedName = req.body && req.body.name ? String(req.body.name).slice(0, 50) : null;
    const dupe = checkDuplicateName(requestedName);
    if (dupe) {
      return res.status(409).json({
        error: `A world named "${dupe.name}" already exists (Town #${dupe.town_number}). Pick a different name or play the existing one.`,
        existing_town: dupe.town_number,
        viewer_url: `https://pataclaw.com/view/${dupe.view_token}`,
      });
    }

    const rawKey = generateKey();
    const hash = await hashKey(rawKey);
    const prefix = keyPrefix(rawKey);
    const worldId = uuid();

    // Optional: agent or human can provide a town name at creation time
    const opts = {};
    if (requestedName) opts.name = requestedName;

    const result = createWorld(worldId, hash, prefix, opts);

    const host = req.get('host') || 'pataclaw.com';
    const proto = req.protocol || 'https';

    res.status(201).json({
      key: rawKey,
      worldId,
      name: result.townName,
      town_number: result.townNumber,
      view_token: result.viewToken,
      viewer_url: `${proto}://${host}/view/${result.viewToken}`,
      api_base: `${proto}://${host}/api`,
      docs_url: `${proto}://${host}/api/docs`,
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
    SELECT w.name, w.day_number, w.season, w.weather, w.reputation, w.view_token, w.motto, w.town_number, w.seed,
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
    SELECT w.name, w.day_number, w.season, w.weather, w.reputation, w.view_token, w.motto, w.town_number, w.seed,
           (SELECT COUNT(*) FROM villagers v WHERE v.world_id = w.id AND v.status = 'alive') as population,
           (SELECT COUNT(*) FROM buildings b WHERE b.world_id = w.id AND b.status != 'destroyed') as buildings,
           (SELECT COUNT(*) FROM events e WHERE e.world_id = w.id AND e.type = 'achievement') as achievements,
           CASE WHEN (SELECT COUNT(*) FROM villagers v3 WHERE v3.world_id = w.id AND v3.status = 'alive') = 0
             THEN 0
             ELSE
               (w.day_number * 1) +
               ((SELECT COUNT(*) FROM villagers v2 WHERE v2.world_id = w.id AND v2.status = 'alive') * 20) +
               (w.reputation * 3) +
               ((SELECT COUNT(*) FROM buildings b2 WHERE b2.world_id = w.id AND b2.status != 'destroyed') * 5) +
               ((SELECT COUNT(*) FROM events e2 WHERE e2.world_id = w.id AND e2.type = 'achievement') * 15)
           END as score
    FROM worlds w
    WHERE w.status = 'active' AND w.view_token IS NOT NULL
    ORDER BY score DESC, population DESC, w.day_number DESC
    LIMIT 20
  `).all();

  const leaderboard = worlds.map((w, i) => ({ rank: i + 1, ...w }));

  res.json({ leaderboard });
});

// GET /api/planet - all worlds for planet map (public)
const { getActivePlanetaryEvent } = require('../simulation/planetary');
router.get('/planet', (_req, res) => {
  const worlds = db.prepare(`
    SELECT w.id, w.name, w.day_number, w.season, w.weather, w.reputation, w.view_token, w.seed, w.town_number, w.banner_symbol,
           (SELECT COUNT(*) FROM villagers v WHERE v.world_id = w.id AND v.status = 'alive') as population,
           (SELECT COUNT(*) FROM buildings b WHERE b.world_id = w.id AND b.status != 'destroyed') as buildings,
           (w.day_number * 2) +
           ((SELECT COUNT(*) FROM villagers v2 WHERE v2.world_id = w.id AND v2.status = 'alive') * 10) +
           (w.reputation * 5) +
           ((SELECT COUNT(*) FROM buildings b2 WHERE b2.world_id = w.id AND b2.status != 'destroyed') * 3) as score
    FROM worlds w
    WHERE w.status = 'active' AND w.view_token IS NOT NULL
    ORDER BY score DESC
  `).all();

  // Check mint status for each world
  const mintStmt = db.prepare('SELECT token_id FROM nft_mints WHERE world_id = ?');
  const result = worlds.map(w => {
    const mint = mintStmt.get(w.id);
    return {
      name: w.name,
      town_number: w.town_number,
      day_number: w.day_number,
      season: w.season,
      weather: w.weather,
      reputation: w.reputation,
      view_token: w.view_token,
      seed: w.seed,
      population: w.population,
      buildings: w.buildings,
      score: w.score,
      banner_symbol: w.banner_symbol,
      is_minted: !!mint,
      token_id: mint ? mint.token_id : null,
    };
  });

  const totalMinted = result.filter(w => w.is_minted).length;
  const totalPop = result.reduce((s, w) => s + w.population, 0);

  const planetaryEvent = getActivePlanetaryEvent();
  res.json({
    worlds: result,
    stats: { total_worlds: result.length, total_population: totalPop, total_minted: totalMinted },
    planetaryEvent: planetaryEvent ? { type: planetaryEvent.type, title: planetaryEvent.title, description: planetaryEvent.description } : null,
  });
});

// GET /api/trades/open - public listing of all open inter-world trades
router.get('/trades/open', (_req, res) => {
  const trades = db.prepare(`
    SELECT t.id, t.offer_resource, t.offer_amount, t.request_resource, t.request_amount,
           t.created_at, w.name as world_name
    FROM trades t
    JOIN worlds w ON w.id = t.world_id
    WHERE t.status = 'open'
    ORDER BY t.created_at DESC
    LIMIT 50
  `).all();

  res.json({ trades });
});

// Heartbeat
router.post('/heartbeat', authMiddleware, rateLimit, (req, res) => {
  // Update heartbeat timestamp and wake world from dormant/slow mode
  db.prepare("UPDATE worlds SET last_agent_heartbeat = datetime('now'), tick_mode = 'normal' WHERE id = ?").run(req.worldId);

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

  // Overgrowth harvest: if world was dormant and overgrown, grant bonus resources
  let overgrowthHarvest = null;
  const ogState = getOvergrowthState(req.worldId);
  if (ogState.level >= 0.25) {
    overgrowthHarvest = harvestOvergrowth(req.worldId);
    if (overgrowthHarvest) {
      // Create an event for the harvest
      const { v4: evtUuid } = require('uuid');
      const w = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(req.worldId);
      const bonusDesc = Object.entries(overgrowthHarvest).map(([k, v]) => `${k}: +${v}`).join(', ');
      db.prepare(
        "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'harvest', ?, ?, 'celebration')"
      ).run(evtUuid(), req.worldId, w ? w.current_tick : 0, "Nature's bounty", `Overgrown vegetation cleared. Harvested: ${bonusDesc}`);
    }
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
    overgrowthHarvest,
    achievements: `${achievementCount}/20 (use /api/world/achievements for details)`,
  });
});

// GET /api/highlights — planet-wide top moments (public)
router.get('/highlights', (_req, res) => {
  const limit = Math.min(parseInt(_req.query.limit) || 20, 50);
  const highlights = getPlanetHighlights(limit);
  res.json({ highlights });
});

// GET /api/highlights/card/:eventId.svg — shareable SVG card (public)
router.get('/highlights/card/:eventId.svg', (req, res) => {
  const event = getHighlightById(req.params.eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  // Get culture for context
  const culture = db.prepare('SELECT village_mood, creativity_level, cooperation_level FROM culture WHERE world_id = ?').get(event.world_id);
  const descriptor = culture
    ? [culture.village_mood.toUpperCase(),
       culture.creativity_level > 60 ? 'creative' : culture.creativity_level < 40 ? 'traditional' : null,
       culture.cooperation_level > 60 ? 'cooperative' : culture.cooperation_level < 40 ? 'fractious' : null,
      ].filter(Boolean).join(' | ')
    : null;

  const svg = generateHighlightCard(event, descriptor ? { descriptor } : null);
  if (!svg) return res.status(500).json({ error: 'Failed to generate card' });

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(svg);
});

// GET /api/highlights/card/:eventId — HTML wrapper with OG meta tags (public)
router.get('/highlights/card/:eventId', (req, res) => {
  const event = getHighlightById(req.params.eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const townLabel = (event.town_number ? '#' + event.town_number + ' ' : '') + (event.world_name || 'Unknown');
  const title = event.title || 'Pataclaw Highlight';
  const description = (event.description || '').slice(0, 200) + ' — ' + townLabel + ', Day ' + (event.day_number || '?');
  const imageUrl = `https://pataclaw.com/api/highlights/card/${req.params.eventId}.svg`;

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} — Pataclaw</title>
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:width" content="1032">
  <meta property="og:image:height" content="400">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${imageUrl}">
  <style>body{background:#0a0a0a;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}img{max-width:100%;height:auto}</style>
</head>
<body>
  <img src="${imageUrl}" alt="${escapeHtml(title)}">
</body>
</html>`);
});

// ─── Agent: GET-based world creation for AI with web browsing ───
// Usage: GET /api/agent/create?name=MyTown
router.get('/agent/create', createRateLimit, async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  try {
    // Block duplicate names within 24h
    const requestedName = req.query.name ? String(req.query.name).slice(0, 50) : null;
    const dupe = checkDuplicateName(requestedName);
    if (dupe) {
      return res.send(
        `ERROR: A world named "${dupe.name}" already exists (Town #${dupe.town_number}).\n` +
        `\n` +
        `If this is YOUR world, use the key you received when you created it:\n` +
        `  /api/agent/play?key=YOUR_KEY&cmd=status\n` +
        `\n` +
        `If you want a NEW world, pick a different name:\n` +
        `  /api/agent/create?name=SomethingElse\n` +
        `\n` +
        `Watch the existing town: https://pataclaw.com/view/${dupe.view_token}\n`
      );
    }

    const rawKey = generateKey();
    const hash = await hashKey(rawKey);
    const prefix = keyPrefix(rawKey);
    const worldId = uuid();
    const opts = {};
    if (requestedName) opts.name = requestedName;
    const result = createWorld(worldId, hash, prefix, opts);

    let out = '=== WORLD CREATED ===\n';
    out += `Town: ${result.townName} (Town #${result.townNumber})\n`;
    out += `\n`;
    out += `SECRET KEY (save this — never shown again):\n`;
    out += `${rawKey}\n`;
    out += `\n`;
    out += `VIEW TOKEN (safe to share):\n`;
    out += `${result.viewToken}\n`;
    out += `\n`;
    out += `WATCH LIVE:\n`;
    out += `https://pataclaw.com/view/${result.viewToken}\n`;
    out += `\n`;
    out += `PLAY (use your secret key):\n`;
    out += `https://pataclaw.com/api/agent/play?key=${rawKey}&cmd=status\n`;
    out += `https://pataclaw.com/api/agent/play?key=${rawKey}&cmd=build+farm\n`;
    out += `https://pataclaw.com/api/agent/play?key=${rawKey}&cmd=assign+farmer\n`;
    out += `https://pataclaw.com/api/agent/play?key=${rawKey}&cmd=help\n`;
    out += `\n`;
    out += `IMPORTANT: Save your secret key NOW. If you lose it, this world is gone forever.\n`;
    out += `Next step: Browse the "status" URL above to see your town.\n`;
    res.send(out);
  } catch (err) {
    console.error('Agent create error:', err);
    res.status(500).send(`ERROR: ${err.message}`);
  }
});

// ─── Agent Play: GET-based command endpoint for AI with web browsing ───
// Usage: GET /api/agent/play?key=YOUR_KEY&cmd=build+farm
// Returns plain text so any AI browser tool can read the result.
const agentPlayLimits = new Map();
function agentRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  let entry = agentPlayLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 };
    agentPlayLimits.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 30) {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(429).send('RATE LIMIT: Max 30 commands per minute. Wait and retry.');
  }
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, v] of agentPlayLimits) { if (now > v.resetAt) agentPlayLimits.delete(k); } }, 60_000);

router.get('/agent/play', agentRateLimit, authQuery, async (req, res) => {
  const cmd = (req.query.cmd || '').trim();
  const worldId = req.worldId;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (!cmd) {
    return res.send(agentHelp(worldId));
  }

  const parts = cmd.split(/\s+/);
  const action = parts[0].toLowerCase();
  const args = parts.slice(1);

  try {
    let result;
    switch (action) {
      case 'help':
        return res.send(agentHelp(worldId));

      case 'status': {
        const w = db.prepare('SELECT name, day_number, season, time_of_day, weather, reputation, motto, town_number FROM worlds WHERE id = ?').get(worldId);
        const resources = db.prepare('SELECT type, amount, capacity FROM resources WHERE world_id = ?').all(worldId);
        const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
        const buildings = db.prepare("SELECT type, status, level FROM buildings WHERE world_id = ? AND status != 'destroyed'").all(worldId);
        const constructing = buildings.filter(b => b.status === 'constructing');
        const active = buildings.filter(b => b.status === 'active');

        let out = `=== ${w.name} (Town #${w.town_number}) ===\n`;
        out += `Day ${w.day_number} | ${w.season} | ${w.time_of_day} | ${w.weather}\n`;
        out += `Population: ${popAlive} | Reputation: ${w.reputation}\n`;
        if (w.motto) out += `Motto: "${w.motto}"\n`;
        out += `\nRESOURCES:\n`;
        for (const r of resources) out += `  ${r.type}: ${Math.floor(r.amount)}/${r.capacity}\n`;
        out += `\nBUILDINGS (${active.length} active):\n`;
        for (const b of active) out += `  ${b.type} (lv${b.level})\n`;
        if (constructing.length > 0) {
          out += `\nUNDER CONSTRUCTION:\n`;
          for (const b of constructing) out += `  ${b.type}\n`;
        }
        out += `\nNEXT MOVES: ${suggestMoves(worldId, w, resources, popAlive, active)}`;
        return res.send(out);
      }

      case 'villagers': {
        const villagers = db.prepare("SELECT name, role, hp, max_hp, morale, trait, status FROM villagers WHERE world_id = ?").all(worldId);
        const alive = villagers.filter(v => v.status === 'alive');
        let out = `=== VILLAGERS (${alive.length} alive) ===\n`;
        for (const v of alive) {
          out += `  ${v.name} | ${v.role} | HP ${v.hp}/${v.max_hp} | Morale ${v.morale} | ${v.trait}\n`;
        }
        return res.send(out);
      }

      case 'buildings': {
        const buildings = db.prepare("SELECT id, type, status, level, hp, max_hp FROM buildings WHERE world_id = ? AND status != 'destroyed'").all(worldId);
        let out = `=== BUILDINGS (${buildings.length}) ===\n`;
        for (const b of buildings) {
          out += `  ${b.type} lv${b.level} | ${b.status} | HP ${b.hp}/${b.max_hp} | id:${b.id.slice(0,8)}\n`;
        }
        return res.send(out);
      }

      case 'events': {
        const events = db.prepare('SELECT title, description, severity, tick FROM events WHERE world_id = ? ORDER BY tick DESC LIMIT 10').all(worldId);
        let out = `=== RECENT EVENTS ===\n`;
        for (const e of events) {
          out += `  [${e.severity}] ${e.title}: ${e.description}\n`;
        }
        return res.send(out);
      }

      case 'map': {
        const tiles = db.prepare("SELECT x, y, terrain, feature FROM tiles WHERE world_id = ? AND explored = 1 ORDER BY y, x").all(worldId);
        let out = `=== EXPLORED MAP (${tiles.length} tiles) ===\n`;
        for (const t of tiles) {
          out += `  (${t.x},${t.y}) ${t.terrain}${t.feature ? ' [' + t.feature + ']' : ''}\n`;
        }
        return res.send(out);
      }

      case 'build': {
        const type = args[0];
        if (!type) return res.send('ERROR: Specify building type.\nUsage: build farm\nTypes: hut, farm, workshop, wall, temple, watchtower, market, library, storehouse, dock');

        const { startBuilding, BUILDING_DEFS } = require('../simulation/buildings');
        if (!BUILDING_DEFS[type]) {
          return res.send(`ERROR: Unknown building "${type}".\nAvailable: ${Object.keys(BUILDING_DEFS).join(', ')}`);
        }

        // Auto-pick a buildable tile near town center
        const world = db.prepare('SELECT seed FROM worlds WHERE id = ?').get(worldId);
        const { getCenter } = require('../world/map');
        const center = getCenter(world.seed);

        const buildableTiles = db.prepare(`
          SELECT t.x, t.y FROM tiles t
          WHERE t.world_id = ? AND t.explored = 1
            AND t.terrain NOT IN ('water', 'mountain')
            AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.world_id = t.world_id AND b.x = t.x AND b.y = t.y AND b.status != 'destroyed')
          ORDER BY ABS(t.x - ?) + ABS(t.y - ?) ASC
          LIMIT 1
        `).get(worldId, center.x, center.y);

        if (!buildableTiles) return res.send('ERROR: No buildable tiles available. Explore more territory first.');

        const buildResult = startBuilding(worldId, type, buildableTiles.x, buildableTiles.y);
        if (!buildResult.ok) return res.send(`ERROR: ${buildResult.reason}`);

        const { logCultureAction } = require('../simulation/culture');
        logCultureAction(worldId, 'build', type);
        const tick = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(worldId);
        db.prepare("INSERT INTO commands (id, world_id, tick, type, parameters, result, status) VALUES (?, ?, ?, 'build', ?, ?, 'completed')")
          .run(uuid(), worldId, tick.current_tick, JSON.stringify({ type, x: buildableTiles.x, y: buildableTiles.y }), JSON.stringify(buildResult));

        return res.send(`OK: Started building ${type} at (${buildableTiles.x},${buildableTiles.y}).\nConstruction time: ${buildResult.ticks} ticks.\nBuilding ID: ${buildResult.buildingId}`);
      }

      case 'explore': {
        const direction = args[0];
        if (!direction || !['north', 'south', 'east', 'west'].includes(direction)) {
          return res.send('ERROR: Specify direction.\nUsage: explore north\nDirections: north, south, east, west');
        }

        // Check scouting unlock
        const w = db.prepare('SELECT scouting_unlocked FROM worlds WHERE id = ?').get(worldId);
        if (!w.scouting_unlocked) {
          const { getCulture } = require('../simulation/culture');
          const culture = getCulture(worldId);
          if (culture.violence_level >= 100 || culture.creativity_level >= 100 || culture.cooperation_level >= 100) {
            db.prepare('UPDATE worlds SET scouting_unlocked = 1 WHERE id = ?').run(worldId);
          } else {
            return res.send(`ERROR: Scouting not unlocked yet. Need 1 culture bar at 100.\nCurrent: violence=${culture.violence_level}, creativity=${culture.creativity_level}, cooperation=${culture.cooperation_level}\nHint: Teach phrases, complete projects, develop culture.`);
          }
        }

        const scouts = db.prepare("SELECT id FROM villagers WHERE world_id = ? AND status = 'alive' AND (role = 'idle' OR role = 'scout') LIMIT 1").all(worldId);
        if (scouts.length === 0) return res.send('ERROR: No available villagers to scout. Need idle or scout-role villagers.');

        db.prepare("UPDATE villagers SET role = 'scout', ascii_sprite = 'scout' WHERE id = ? AND world_id = ?").run(scouts[0].id, worldId);
        const { logCultureAction } = require('../simulation/culture');
        logCultureAction(worldId, 'explore', '_default');
        return res.send(`OK: Scout dispatched ${direction}. 1 villager assigned to scouting.\nNew tiles will be revealed on the next tick.`);
      }

      case 'assign': {
        const role = args[0];
        const validRoles = ['idle', 'farmer', 'builder', 'warrior', 'scout', 'scholar', 'priest', 'fisherman'];
        if (!role || !validRoles.includes(role)) {
          return res.send(`ERROR: Specify role.\nUsage: assign farmer\nRoles: ${validRoles.join(', ')}`);
        }

        // How many to assign (default 1)
        const count = parseInt(args[1]) || 1;
        const idle = db.prepare("SELECT id, name FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'idle' LIMIT ?").all(worldId, count);
        if (idle.length === 0) return res.send('ERROR: No idle villagers to assign. All villagers already have roles.');

        const updateStmt = db.prepare('UPDATE villagers SET role = ?, ascii_sprite = ? WHERE id = ? AND world_id = ?');
        const names = [];
        for (const v of idle) {
          updateStmt.run(role, role, v.id, worldId);
          names.push(v.name);
        }

        const { logCultureAction } = require('../simulation/culture');
        logCultureAction(worldId, 'assign', role);
        return res.send(`OK: Assigned ${names.length} villager(s) as ${role}: ${names.join(', ')}`);
      }

      case 'rename': {
        const newName = args.join(' ');
        if (!newName) return res.send('ERROR: Specify a name.\nUsage: rename My Cool Town');
        const sanitized = newName.slice(0, 50);
        db.prepare('UPDATE worlds SET name = ? WHERE id = ?').run(sanitized, worldId);
        const { logCultureAction } = require('../simulation/culture');
        logCultureAction(worldId, 'rename', '_default');
        return res.send(`OK: Town renamed to "${sanitized}". Visible on leaderboard within 1 tick (~10s).`);
      }

      case 'motto': {
        const motto = args.join(' ');
        if (!motto) return res.send('ERROR: Specify a motto.\nUsage: motto From shell we rise');
        const sanitized = motto.slice(0, 200);
        db.prepare('UPDATE worlds SET motto = ? WHERE id = ?').run(sanitized, worldId);
        return res.send(`OK: Motto set to "${sanitized}".`);
      }

      case 'teach': {
        const phrase = args.join(' ');
        if (!phrase) return res.send('ERROR: Specify a phrase.\nUsage: teach Shell is eternal');
        const clean = phrase.replace(/[^\x20-\x7E]/g, '').slice(0, 30);
        const culture = db.prepare('SELECT custom_phrases FROM culture WHERE world_id = ?').get(worldId);
        const existing = JSON.parse(culture ? culture.custom_phrases || '[]' : '[]');
        if (existing.length >= 20) return res.send('ERROR: Max 20 phrases reached.');
        if (existing.includes(clean)) return res.send('ERROR: Phrase already taught.');
        existing.push(clean);
        db.prepare("UPDATE culture SET custom_phrases = ?, updated_at = datetime('now') WHERE world_id = ?").run(JSON.stringify(existing), worldId);
        const { logCultureAction } = require('../simulation/culture');
        logCultureAction(worldId, 'teach', '_default');
        return res.send(`OK: Taught phrase "${clean}". Villagers now have ${existing.length} custom phrases.`);
      }

      case 'pray': {
        const faith = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'faith'").get(worldId);
        if (!faith || faith.amount < 5) return res.send(`ERROR: Not enough faith. Need 5, have ${Math.floor(faith ? faith.amount : 0)}.`);
        const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
        const cap = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 WHEN type = 'spawning_pools' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'").get(worldId).cap;
        if (popAlive >= cap) return res.send(`ERROR: Population at capacity (${popAlive}/${cap}). Build more huts.`);

        db.prepare("UPDATE resources SET amount = amount - 5 WHERE world_id = ? AND type = 'faith'").run(worldId);
        const { randomName, randomTrait, TRAIT_PERSONALITY } = require('../world/templates');
        const { getCenter } = require('../world/map');
        const world = db.prepare('SELECT seed FROM worlds WHERE id = ?').get(worldId);
        const center = getCenter(world.seed);
        const name = randomName(() => Math.random());
        const trait = randomTrait(() => Math.random());
        const pers = TRAIT_PERSONALITY[trait] || { temperament: 50, creativity: 50, sociability: 50 };
        const vid = uuid();
        db.prepare("INSERT INTO villagers (id, world_id, name, role, x, y, hp, max_hp, morale, hunger, experience, status, trait, ascii_sprite, temperament, creativity, sociability) VALUES (?, ?, ?, 'idle', ?, ?, 80, 100, 50, 20, 0, 'alive', ?, 'idle', ?, ?, ?)")
          .run(vid, worldId, name, center.x, center.y + 1, trait, pers.temperament, pers.creativity, pers.sociability);
        return res.send(`OK: Prayer answered! ${name} (${trait}) has arrived. Faith remaining: ${Math.floor(faith.amount - 5)}.`);
      }

      case 'trade': {
        const tradeAction = args[0]; // buy or sell
        const resource = args[1];
        const amount = parseInt(args[2]);
        if (!tradeAction || !resource || !amount) return res.send('ERROR: Usage: trade sell food 10 or trade buy wood 5');
        if (tradeAction !== 'buy' && tradeAction !== 'sell') return res.send('ERROR: Action must be "buy" or "sell".');

        const TRADE_RATES = { food: { sell: 0.5, buy: 0.8 }, wood: { sell: 0.4, buy: 0.6 }, stone: { sell: 0.3, buy: 0.5 }, knowledge: { sell: 2.0, buy: 3.0 }, faith: { sell: 1.5, buy: 2.5 } };
        if (!TRADE_RATES[resource]) return res.send(`ERROR: Can't trade "${resource}". Tradeable: ${Object.keys(TRADE_RATES).join(', ')}`);
        if (amount <= 0 || amount > 200) return res.send('ERROR: Amount must be 1-200.');

        const market = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'market' AND status = 'active'").get(worldId);
        if (market.c === 0) return res.send('ERROR: No active market. Build a market first!');

        const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
        const resMap = {};
        for (const r of resources) resMap[r.type] = r.amount;
        const rate = TRADE_RATES[resource];

        if (tradeAction === 'sell') {
          if ((resMap[resource] || 0) < amount) return res.send(`ERROR: Not enough ${resource}. Have ${Math.floor(resMap[resource] || 0)}, need ${amount}.`);
          const gained = Math.floor(amount * rate.sell);
          db.prepare('UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = ?').run(amount, worldId, resource);
          db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'crypto'").run(gained, worldId);
          return res.send(`OK: Sold ${amount} ${resource} for ${gained} crypto.`);
        } else {
          const cost = Math.ceil(amount * rate.buy);
          if ((resMap.crypto || 0) < cost) return res.send(`ERROR: Not enough crypto. Need ${cost}, have ${Math.floor(resMap.crypto || 0)}.`);
          db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'crypto'").run(cost, worldId);
          db.prepare('UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?').run(amount, worldId, resource);
          return res.send(`OK: Bought ${amount} ${resource} for ${cost} crypto.`);
        }
      }

      case 'mint': {
        const wallet = args.join('');
        if (!wallet) return res.send('ERROR: Specify wallet address.\nUsage: mint 0xYourWalletAddress\nMints your world as an ERC-721 NFT on Base (0.01 ETH, server pays gas).');

        const mintConfig = require('../config');
        if (!mintConfig.nft || !mintConfig.nft.enabled) {
          return res.send('ERROR: NFT minting is not currently enabled on this server.');
        }

        const { ethers } = require('ethers');
        if (!ethers.isAddress(wallet)) return res.send('ERROR: Invalid wallet address. Must be a valid Ethereum address (0x...).');

        const existingMint = db.prepare('SELECT token_id, tx_hash FROM nft_mints WHERE world_id = ?').get(worldId);
        if (existingMint) return res.send(`ALREADY MINTED: Your world is NFT token #${existingMint.token_id}.\nTx: ${existingMint.tx_hash}`);

        const { mintWorld, isAlreadyMinted, worldIdToTokenId, getSupplyInfo } = require('../blockchain/base');
        const tokenId = worldIdToTokenId(worldId);

        const supply = await getSupplyInfo();
        if (supply.remaining === 0) return res.send(`ERROR: All ${supply.maxSupply} NFTs have been minted. None remaining.`);

        const onChain = await isAlreadyMinted(tokenId);
        if (onChain) return res.send(`ERROR: Token #${tokenId} already exists on-chain.`);

        try {
          const mintResult = await mintWorld(wallet, tokenId);
          db.prepare('INSERT INTO nft_mints (id, world_id, token_id, wallet_address, tx_hash) VALUES (?, ?, ?, ?, ?)')
            .run(uuid(), worldId, tokenId, wallet, mintResult.txHash);
          return res.send(
            `OK: World minted as NFT!\n` +
            `Token ID: ${tokenId}\n` +
            `Tx Hash: ${mintResult.txHash}\n` +
            `Wallet: ${wallet}\n` +
            `Contract: 0x3791664f88A93D897202a6AD15E08e2e6eBAb04a (Base)\n` +
            `Mints remaining: ${supply.remaining - 1}/${supply.maxSupply}\n` +
            `\nView on OpenSea once indexed.`
          );
        } catch (mintErr) {
          return res.send(`ERROR: Mint failed — ${mintErr.message}`);
        }
      }

      default:
        return res.send(`ERROR: Unknown command "${action}".\n\n` + agentHelp(worldId));
    }
  } catch (err) {
    console.error('Agent play error:', err);
    return res.send(`ERROR: ${err.message}`);
  }
});

function agentHelp(worldId) {
  const w = worldId ? db.prepare('SELECT name, town_number, view_token FROM worlds WHERE id = ?').get(worldId) : null;
  let out = '=== PATACLAW — AI Agent Play Endpoint ===\n';
  out += 'Browse to these URLs to play. No POST needed.\n\n';
  out += 'COMMANDS:\n';
  out += '  status          — View town state, resources, buildings\n';
  out += '  villagers       — List all villagers with roles/stats\n';
  out += '  buildings       — List all buildings with IDs\n';
  out += '  events          — Recent event log\n';
  out += '  map             — Explored tiles and features\n';
  out += '  build <type>    — Build (auto-places near center)\n';
  out += '                    Types: hut, farm, workshop, wall, temple,\n';
  out += '                    watchtower, market, library, storehouse, dock\n';
  out += '  explore <dir>   — Send scout (north/south/east/west)\n';
  out += '  assign <role>   — Assign idle villager to role\n';
  out += '                    Roles: farmer, builder, warrior, scout,\n';
  out += '                    scholar, priest, fisherman, idle\n';
  out += '  assign <role> N — Assign N idle villagers to role\n';
  out += '  rename <name>   — Rename your town\n';
  out += '  motto <text>    — Set town motto\n';
  out += '  teach <phrase>  — Teach villagers a phrase\n';
  out += '  pray            — Spend 5 faith to summon refugee\n';
  out += '  trade sell <resource> <amount>\n';
  out += '  trade buy <resource> <amount>\n';
  out += '  mint <wallet>   — Mint world as ERC-721 NFT on Base\n';
  out += '                    (0.01 ETH, server pays gas, 500 max supply)\n';
  out += '  help            — This message\n';
  out += '\nEXAMPLE:\n';
  out += '  /api/agent/play?key=YOUR_KEY&cmd=build+farm\n';
  out += '  /api/agent/play?key=YOUR_KEY&cmd=assign+farmer\n';
  out += '  /api/agent/play?key=YOUR_KEY&cmd=status\n';
  if (w) {
    out += `\nYOUR TOWN: ${w.name} (Town #${w.town_number})\n`;
    out += `VIEW LIVE: https://pataclaw.com/view/${w.view_token}\n`;
  }
  out += '\nTIP: Call "status" first to see your resources, then decide what to build.\n';
  out += 'PRIORITY: food > buildings > explore > culture\n';
  return out;
}

function suggestMoves(worldId, world, resources, pop, buildings) {
  const resMap = {};
  for (const r of resources) resMap[r.type] = Math.floor(r.amount);
  const buildTypes = new Set(buildings.map(b => b.type));
  const suggestions = [];

  if ((resMap.food || 0) < 10) suggestions.push('CRITICAL: Build a farm (cmd=build+farm)');
  if (!buildTypes.has('farm')) suggestions.push('Build a farm for food (cmd=build+farm)');
  else if (!buildTypes.has('hut') && pop >= 4) suggestions.push('Build a hut for more population (cmd=build+hut)');
  else if (!buildTypes.has('wall') && world.day_number >= 7) suggestions.push('Build walls before raids start (cmd=build+wall)');
  else if (!buildTypes.has('workshop')) suggestions.push('Build a workshop for wood/stone (cmd=build+workshop)');

  const idleCount = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'idle'").get(worldId).c;
  if (idleCount > 0) suggestions.push(`Assign ${idleCount} idle villager(s) (cmd=assign+farmer)`);

  if (suggestions.length === 0) suggestions.push('Looking good! Keep building and exploring.');
  return suggestions.join(' | ');
}

// Public NFT metadata routes (no auth — OpenSea needs to read these)
router.use('/nft', nftRouter);

// Protected routes
router.use('/world', authMiddleware, rateLimit, worldRouter);
router.use('/command', authMiddleware, rateLimit, commandRouter);
router.use('/moltbook', authMiddleware, rateLimit, moltbookRouter);

// Viewer routes (use query param auth)
router.use('/', viewerRouter);

module.exports = router;
