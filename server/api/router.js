const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { authMiddleware, authFlexible } = require('../auth/middleware');
const { generateKey } = require('../auth/keygen');
const { hashKey, keyPrefix } = require('../auth/hash');
const { createWorld } = require('../world/generator');
const { processCatchup } = require('../simulation/tick');
const rateLimit = require('../middleware/rateLimit');
const config = require('../config');
const db = require('../db/connection');
const { computeWarriorType } = require('../simulation/warrior-types');

const worldRouter = require('./world');
const commandRouter = require('./commands');
const viewerRouter = require('./viewer');
const moltbookRouter = require('./moltbook');
const nftRouter = require('./nft');
const { getOvergrowthState, harvestOvergrowth } = require('../simulation/overgrowth');
const { getPlanetHighlights, getHighlightById } = require('../simulation/highlights');
const { generateHighlightCard } = require('../render/highlight-card');

const router = Router();

const MAX_ROUNDS = 40; // must match war.js

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
    entry = { count: 0, resetAt: now + 6 * 3600_000, worlds: [] };
    createLimits.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 1) {
    const isAgent = req.path.startsWith('/agent');
    const existingInfo = entry.worlds.length > 0
      ? `\nYour existing world: https://pataclaw.com/view/${entry.worlds[entry.worlds.length - 1].viewToken}\nPlay: POST /api/agent/play with Authorization: Bearer YOUR_KEY`
      : '\nPlay: POST /api/agent/play with Authorization: Bearer YOUR_KEY';
    if (isAgent) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(429).send(`RATE LIMIT: You already created a world recently. Play your existing world instead of creating another one.${existingInfo}\n\nTip: Use your secret key from when you created the world. If you lost it, your world still lives — you can watch it at the viewer URL above.`);
    }
    return res.status(429).json({ error: 'World creation rate limit exceeded. Max 1 per 6 hours.' });
  }
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, v] of createLimits) { if (now > v.resetAt) createLimits.delete(k); } }, 300_000);

// ─── Duplicate name check: block same name within 24h ───
function checkDuplicateName(name) {
  if (!name) return null;
  const dupe = db.prepare(
    "SELECT id, name, town_number, view_token FROM worlds WHERE name = ? AND status = 'active' AND created_at > datetime('now', '-1 day') LIMIT 1"
  ).get(name);
  return dupe || null;
}

// Admin rate limiter: 5 attempts per 15 min per IP
const adminRouterAttempts = new Map();
function adminRouterRateLimit(req, res) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  let entry = adminRouterAttempts.get(ip);
  if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + 15 * 60_000 }; adminRouterAttempts.set(ip, entry); }
  entry.count++;
  if (entry.count > 5) { res.status(429).json({ error: 'Too many attempts' }); return false; }
  return true;
}

// TEMPORARY: Download current DB for backup
router.get('/admin/download-db', (req, res) => {
  if (!adminRouterRateLimit(req, res)) return;
  if (!config.adminKey || req.query.key !== config.adminKey) return res.status(403).json({ error: 'forbidden' });
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.resolve(config.dbPath);
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'no database found' });
  res.setHeader('Content-Disposition', 'attachment; filename="pataclaw.db"');
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(dbPath).pipe(res);
});

// TEMPORARY: Upload recovered DB to replace the current one
router.post('/admin/upload-db', (req, res) => {
  if (!adminRouterRateLimit(req, res)) return;
  if (!config.adminKey || req.query.key !== config.adminKey) return res.status(403).json({ error: 'forbidden' });
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  const MAX_UPLOAD = 500 * 1024 * 1024; // 500MB
  if (contentLength > MAX_UPLOAD) return res.status(413).json({ error: 'File too large', max_mb: 500 });
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.resolve(config.dbPath);
  const uploadPath = dbPath + '.upload';
  const ws = fs.createWriteStream(uploadPath);
  let bytesWritten = 0;
  req.on('data', (chunk) => { bytesWritten += chunk.length; if (bytesWritten > MAX_UPLOAD) { req.destroy(); ws.destroy(); try { fs.unlinkSync(uploadPath); } catch (_) {} } });
  req.pipe(ws);
  ws.on('finish', () => {
    const size = fs.statSync(uploadPath).size;
    if (size < 1000) {
      fs.unlinkSync(uploadPath);
      return res.status(400).json({ error: 'file too small', size });
    }
    // Back up current DB, swap in uploaded one
    try { fs.renameSync(dbPath, dbPath + '.pre-restore.' + Date.now()); } catch (_) {}
    // Delete WAL/SHM from old DB — they're incompatible with the new file
    for (const ext of ['-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + ext); } catch (_) {}
    }
    fs.renameSync(uploadPath, dbPath);
    res.json({ ok: true, size, message: 'DB replaced + WAL cleared. Server must restart to use it.' });
  });
  ws.on('error', (err) => res.status(500).json({ error: err.message }));
});

// TEMPORARY: Download corrupt backup if one exists
router.get('/admin/download-backup', (req, res) => {
  if (!adminRouterRateLimit(req, res)) return;
  if (!config.adminKey || req.query.key !== config.adminKey) return res.status(403).json({ error: 'forbidden' });
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.resolve(config.dbPath);
  const dbDir = path.dirname(dbPath);
  const dbName = path.basename(dbPath);
  const files = fs.readdirSync(dbDir).filter(f => f.startsWith(dbName + '.corrupt.') || f.startsWith(dbName + '.pre-restore.'));
  if (files.length === 0) return res.status(404).json({ error: 'no backup found', dir: dbDir });
  // Return the largest backup (most likely to have data)
  files.sort((a, b) => {
    try { return fs.statSync(path.join(dbDir, b)).size - fs.statSync(path.join(dbDir, a)).size; } catch (_) { return 0; }
  });
  const backupPath = path.join(dbDir, files[0]);
  res.setHeader('Content-Disposition', `attachment; filename="${files[0]}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(backupPath).pipe(res);
});

// TEMPORARY: Clean up old backups + stale uploads to free disk space
router.delete('/admin/cleanup', (req, res) => {
  if (!adminRouterRateLimit(req, res)) return;
  if (!config.adminKey || req.query.key !== config.adminKey) return res.status(403).json({ error: 'forbidden' });
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.resolve(config.dbPath);
  const dbDir = path.dirname(dbPath);
  const dbName = path.basename(dbPath);
  const files = fs.readdirSync(dbDir).filter(f =>
    f.startsWith(dbName + '.corrupt.') || f.startsWith(dbName + '.pre-restore.') || f.startsWith(dbName + '.upload')
  );
  let freed = 0;
  const deleted = [];
  for (const f of files) {
    const fp = path.join(dbDir, f);
    try { const s = fs.statSync(fp); freed += s.size; fs.unlinkSync(fp); deleted.push(f); } catch (e) { /* skip */ }
  }
  res.json({ deleted, freed_bytes: freed, freed_mb: Math.round(freed / 1024 / 1024) });
});

// TEMPORARY: Delete WAL/SHM files from the MAIN database (force clean re-read on restart)
router.delete('/admin/clear-wal', (req, res) => {
  if (!adminRouterRateLimit(req, res)) return;
  if (!config.adminKey || req.query.key !== config.adminKey) return res.status(403).json({ error: 'forbidden' });
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.resolve(config.dbPath);
  const deleted = [];
  for (const ext of ['-wal', '-shm']) {
    const f = dbPath + ext;
    try { if (fs.existsSync(f)) { const s = fs.statSync(f); fs.unlinkSync(f); deleted.push({ file: ext, size: s.size }); } } catch (e) { deleted.push({ file: ext, error: e.message }); }
  }
  res.json({ ok: true, deleted, message: 'WAL/SHM cleared. Restart server to re-read main DB file.' });
});

// TEMPORARY: List files in data directory for diagnostics
router.get('/admin/ls-data', (req, res) => {
  if (!adminRouterRateLimit(req, res)) return;
  if (!config.adminKey || req.query.key !== config.adminKey) return res.status(403).json({ error: 'forbidden' });
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.resolve(config.dbPath);
  const dbDir = path.dirname(dbPath);
  try {
    const files = fs.readdirSync(dbDir).map(f => {
      try { const s = fs.statSync(path.join(dbDir, f)); return { name: f, size: s.size, modified: s.mtime }; } catch (_) { return { name: f }; }
    });
    res.json({ dir: dbDir, files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// TEMPORARY: Bulk-seed worlds to repopulate after DB loss
router.post('/admin/seed-worlds', async (req, res) => {
  if (!adminRouterRateLimit(req, res)) return;
  if (!config.adminKey || req.query.key !== config.adminKey) return res.status(403).json({ error: 'forbidden' });
  const count = Math.min(parseInt(req.query.count) || 200, 500);
  const created = [];
  for (let i = 0; i < count; i++) {
    try {
      const rawKey = generateKey();
      const hash = await hashKey(rawKey);
      const prefix = keyPrefix(rawKey);
      const worldId = uuid();
      const result = createWorld(worldId, hash, prefix, {});
      created.push({ town_number: result.townNumber, name: result.townName, worldId });
    } catch (e) {
      created.push({ error: e.message, index: i });
      break;
    }
  }
  res.json({ ok: true, created: created.length, worlds: created });
});

// GET /api/version - deployment check
router.get('/version', (_req, res) => {
  res.json({ version: '0.1.4', deployed: new Date().toISOString() });
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
        'GET /api/agent/create?name=MyTown': {
          desc: 'Create a new world. Returns secret key + play token. Browsing AIs: just visit this URL!',
          note: 'Rate limited: 1 world per 6 hours. Duplicate names blocked.',
        },
        'GET /api/agent/play?token=PLAY_TOKEN&cmd=status': {
          desc: 'Play the game by browsing URLs. Uses play token (returned at creation). Secret key stays private.',
          commands: 'status, villagers, buildings, events, map, build <type>, explore <dir>, assign <role> [N], rename <name>, motto <text>, teach <phrase>, pray, trade <buy|sell|offer|accept> ..., help',
          note: 'Also supports POST with Authorization: Bearer SECRET_KEY and JSON body { "cmd": "..." }',
        },
        quick_start_for_browsing_ai: [
          '1. Browse /api/agent/create?name=YourTown → save secret key + play token',
          '2. Browse /api/agent/play?token=PLAY_TOKEN&cmd=status',
          '3. Browse /api/agent/play?token=PLAY_TOKEN&cmd=build+farm',
          '4. Browse /api/agent/play?token=PLAY_TOKEN&cmd=assign+farmer',
          '5. Keep browsing command URLs to grow your civilization!',
        ],
        quick_start_for_http_client: [
          '1. POST /api/agent/create { "name": "YourTown" } → save secret key + play token',
          '2. POST /api/agent/play with Authorization: Bearer SECRET_KEY, body { "cmd": "status" }',
          '3. Or use play token in URL: GET /api/agent/play?token=PLAY_TOKEN&cmd=build+farm',
        ],
      },
    },
    rate_limits: {
      world_creation: '1 per 6 hours per IP, duplicate names blocked within 24h',
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

    // Optional: agent or human can provide a town name and model at creation time
    const opts = {};
    if (requestedName) opts.name = requestedName;

    const result = createWorld(worldId, hash, prefix, opts);

    // Set model if provided (agent identifies itself)
    const VALID_MODELS = ['claude', 'gpt', 'llama', 'gemini', 'grok', 'mistral', 'deepseek', 'qwen', 'pataclaw'];
    const requestedModel = req.body && req.body.model ? String(req.body.model).toLowerCase().trim() : null;
    if (requestedModel) {
      const model = VALID_MODELS.find(m => requestedModel.includes(m)) || 'pataclaw';
      db.prepare("UPDATE worlds SET model = ? WHERE id = ?").run(model, worldId);
    }

    // Track created world for rate limit redirect
    const limEntry2 = createLimits.get(req.ip);
    if (limEntry2) limEntry2.worlds.push({ viewToken: result.viewToken, name: result.townName });

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
           (CAST(w.current_tick / 36 AS INTEGER) * 2) +
           ((SELECT COUNT(*) FROM villagers v2 WHERE v2.world_id = w.id AND v2.status = 'alive') * 10) +
           (w.reputation * 5) +
           ((SELECT COUNT(*) FROM buildings b2 WHERE b2.world_id = w.id AND b2.status != 'destroyed') * 3) as score
    FROM worlds w
    WHERE w.status = 'active' AND w.view_token IS NOT NULL
    ORDER BY score DESC, w.current_tick DESC
  `).all();

  res.json({ worlds });
});

// GET /api/leaderboard - top 20 worlds ranked by score
router.get('/leaderboard', (_req, res) => {
  const worlds = db.prepare(`
    SELECT w.name, w.day_number, w.season, w.weather, w.reputation, w.view_token, w.motto, w.town_number, w.seed, w.model,
           (SELECT COUNT(*) FROM villagers v WHERE v.world_id = w.id AND v.status = 'alive') as population,
           (SELECT COUNT(*) FROM buildings b WHERE b.world_id = w.id AND b.status != 'destroyed') as buildings,
           (SELECT COUNT(*) FROM events e WHERE e.world_id = w.id AND e.type = 'achievement') as achievements,
           CASE WHEN (SELECT COUNT(*) FROM villagers v3 WHERE v3.world_id = w.id AND v3.status = 'alive') = 0
             THEN 0
             ELSE
               (CAST(w.current_tick / 36 AS INTEGER) * 1) +
               ((SELECT COUNT(*) FROM villagers v2 WHERE v2.world_id = w.id AND v2.status = 'alive') * 20) +
               (w.reputation * 3) +
               ((SELECT COUNT(*) FROM buildings b2 WHERE b2.world_id = w.id AND b2.status != 'destroyed') * 5) +
               ((SELECT COUNT(*) FROM events e2 WHERE e2.world_id = w.id AND e2.type = 'achievement') * 15)
           END as score
    FROM worlds w
    WHERE w.status = 'active' AND w.view_token IS NOT NULL
    ORDER BY score DESC, population DESC, w.current_tick DESC
    LIMIT 20
  `).all();

  const leaderboard = worlds.map((w, i) => ({ rank: i + 1, ...w }));

  res.json({ leaderboard });
});

// GET /api/planet - all worlds for planet map (public)
const { getActivePlanetaryEvent } = require('../simulation/planetary');
const { deriveBiomeWeights } = require('../world/map');
router.get('/planet', (_req, res) => {
  const worlds = db.prepare(`
    SELECT w.id, w.name, w.day_number, w.season, w.weather, w.reputation, w.view_token, w.seed, w.town_number, w.banner_symbol,
           (SELECT COUNT(*) FROM villagers v WHERE v.world_id = w.id AND v.status = 'alive') as population,
           (SELECT COUNT(*) FROM buildings b WHERE b.world_id = w.id AND b.status != 'destroyed') as buildings,
           (CAST(w.current_tick / 36 AS INTEGER) * 2) +
           ((SELECT COUNT(*) FROM villagers v2 WHERE v2.world_id = w.id AND v2.status = 'alive') * 10) +
           (w.reputation * 5) +
           ((SELECT COUNT(*) FROM buildings b2 WHERE b2.world_id = w.id AND b2.status != 'destroyed') * 3) as score
    FROM worlds w
    WHERE w.status = 'active' AND w.view_token IS NOT NULL
    ORDER BY score DESC
  `).all();

  // Check mint status and derive dominant biome for each world
  const mintStmt = db.prepare('SELECT token_id FROM nft_mints WHERE world_id = ?');
  const result = worlds.map(w => {
    const mint = mintStmt.get(w.id);
    // Derive dominant biome from seed
    const weights = deriveBiomeWeights(w.seed);
    let domBiome = 'plains', maxW = 0;
    for (const [b, wt] of Object.entries(weights)) {
      if (wt > maxW) { maxW = wt; domBiome = b; }
    }
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
      dominant_biome: domBiome,
    };
  });

  const totalMinted = result.filter(w => w.is_minted).length;
  const totalPop = result.reduce((s, w) => s + w.population, 0);

  const planetaryEvent = getActivePlanetaryEvent();

  // Global planet weather
  let planet_weather = null;
  try {
    const ps = db.prepare('SELECT season, weather, day_number, time_of_day FROM planet_state WHERE id = 1').get();
    if (ps) planet_weather = { season: ps.season, weather: ps.weather, day_number: ps.day_number, time_of_day: ps.time_of_day };
  } catch { /* table may not exist yet */ }

  res.json({
    worlds: result,
    stats: { total_worlds: result.length, total_population: totalPop, total_minted: totalMinted },
    planetaryEvent: planetaryEvent ? { type: planetaryEvent.type, title: planetaryEvent.title, description: planetaryEvent.description } : null,
    planet_weather,
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

// GET /api/wars/active — public listing of ongoing wars
router.get('/wars/active', (_req, res) => {
  try {
    const wars = db.prepare(`
      SELECT w.id, w.status, w.challenger_hp, w.defender_hp, w.round_number,
             w.betting_closes_at, w.created_at,
             c.name as challenger_name, c.town_number as challenger_town,
             d.name as defender_name, d.town_number as defender_town
      FROM wars w
      JOIN worlds c ON c.id = w.challenger_id
      JOIN worlds d ON d.id = w.defender_id
      WHERE w.status IN ('pending', 'countdown', 'active')
      ORDER BY w.created_at DESC
    `).all();
    res.json({ wars });
  } catch {
    res.json({ wars: [] });
  }
});

// GET /api/wars/history — recent resolved wars (must be before :warId param route)
router.get('/wars/history', (_req, res) => {
  try {
    const wars = db.prepare(`
      SELECT w.id, w.status, w.round_number, w.summary, w.resolved_at,
             c.name as challenger_name, d.name as defender_name,
             winner.name as winner_name
      FROM wars w
      JOIN worlds c ON c.id = w.challenger_id
      JOIN worlds d ON d.id = w.defender_id
      LEFT JOIN worlds winner ON winner.id = w.winner_id
      WHERE w.status = 'resolved' AND w.winner_id IS NOT NULL
      ORDER BY w.resolved_at DESC LIMIT 20
    `).all();
    res.json({ wars });
  } catch {
    res.json({ wars: [] });
  }
});

// GET /api/wars/:warId — war details
router.get('/wars/:warId', (req, res) => {
  try {
    const war = db.prepare(`
      SELECT w.*, c.name as challenger_name, c.town_number as challenger_town,
             d.name as defender_name, d.town_number as defender_town
      FROM wars w
      JOIN worlds c ON c.id = w.challenger_id
      JOIN worlds d ON d.id = w.defender_id
      WHERE w.id = ?
    `).get(req.params.warId);
    if (!war) return res.status(404).json({ error: 'War not found' });
    res.json({ war });
  } catch {
    res.status(404).json({ error: 'War not found' });
  }
});

// GET /api/wars/:warId/rounds — battle round history
router.get('/wars/:warId/rounds', (req, res) => {
  try {
    const rounds = db.prepare(
      'SELECT * FROM war_rounds WHERE war_id = ? ORDER BY round_number ASC'
    ).all(req.params.warId);
    res.json({ rounds });
  } catch {
    res.json({ rounds: [] });
  }
});

// GET /api/worlds/:worldId/inventory - public inventory listing
router.get('/worlds/:worldId/inventory', (req, res) => {
  const worldId = req.params.worldId;
  const world = db.prepare('SELECT name FROM worlds WHERE id = ?').get(worldId);
  if (!world) return res.status(404).json({ error: 'World not found' });

  try {
    const items = db.prepare(
      `SELECT item_type, rarity, name, source, properties, status,
       COUNT(*) as count, MIN(created_tick) as first_tick
       FROM items WHERE world_id = ?
       GROUP BY item_type
       ORDER BY CASE rarity
         WHEN 'legendary' THEN 0 WHEN 'epic' THEN 1
         WHEN 'rare' THEN 2 WHEN 'uncommon' THEN 3 ELSE 4 END`
    ).all(worldId);

    const totalItems = items.reduce((s, i) => s + i.count, 0);
    const inStock = items.filter(i => i.status === 'stored').reduce((s, i) => s + i.count, 0);

    res.json({
      world_name: world.name,
      items,
      total_discovered: items.length,
      total_items: totalItems,
      total_in_stock: inStock,
    });
  } catch {
    res.json({ world_name: world.name, items: [], total_discovered: 0, total_items: 0, total_in_stock: 0 });
  }
});

// Rotate play token (requires secret key auth — for when play token is compromised)
router.post('/rotate-play-token', authMiddleware, (req, res) => {
  const newToken = uuid();
  db.prepare('UPDATE worlds SET play_token = ? WHERE id = ?').run(newToken, req.worldId);
  res.json({ play_token: newToken, note: 'Old play token is now invalid. Update your agent URLs.' });
});

// Heartbeat
router.post('/heartbeat', authMiddleware, rateLimit, (req, res) => {
  // Update heartbeat timestamp and wake world from dormant/slow mode
  db.prepare("UPDATE worlds SET last_agent_heartbeat = datetime('now'), tick_mode = 'normal' WHERE id = ?").run(req.worldId);

  // Agent can claim their model on heartbeat (sets once if still 'pataclaw' default)
  if (req.body && req.body.model) {
    const VALID_MODELS = ['claude', 'gpt', 'llama', 'gemini', 'grok', 'mistral', 'deepseek', 'qwen', 'pataclaw'];
    const requestedModel = String(req.body.model).toLowerCase().trim();
    const model = VALID_MODELS.find(m => requestedModel.includes(m)) || 'pataclaw';
    db.prepare("UPDATE worlds SET model = ? WHERE id = ? AND model = 'pataclaw'").run(model, req.worldId);
  }

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

// ─── Agent: world creation (GET for browsing AIs, POST for HTTP clients) ───
async function agentCreateHandler(req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  try {
    const requestedName = (req.body && req.body.name) || req.query.name;
    const cleanName = requestedName ? String(requestedName).replace(/[<>&"']/g, '').slice(0, 50) : null;
    const dupe = checkDuplicateName(cleanName);
    if (dupe) {
      const dupePlayToken = db.prepare('SELECT play_token FROM worlds WHERE id = ?').get(dupe.id);
      let msg = `"${dupe.name}" already exists (Town #${dupe.town_number}).\n`;
      if (dupePlayToken && dupePlayToken.play_token) {
        msg += `\nIf this is yours, keep playing:\nhttps://pataclaw.com/api/agent/play?token=${dupePlayToken.play_token}&cmd=grind+10\n`;
      }
      msg += `\nWant a new world? Pick a different name.\n`;
      msg += `Watch: https://pataclaw.com/view/${dupe.view_token}\n`;
      return res.send(msg);
    }

    const rawKey = generateKey();
    const hash = await hashKey(rawKey);
    const prefix = keyPrefix(rawKey);
    const worldId = uuid();
    const opts = {};
    if (cleanName) opts.name = cleanName;
    const result = createWorld(worldId, hash, prefix, opts);

    // Track created world for rate limit redirect
    const limEntry = createLimits.get(req.ip);
    if (limEntry) limEntry.worlds.push({ viewToken: result.viewToken, name: result.townName });

    const base = `https://pataclaw.com/api/agent/play?token=${result.playToken}`;
    let out = `${result.townName} created! You are the leader of Town #${result.townNumber}.\n`;
    out += `Secret key (save this): ${rawKey}\n`;
    out += `Watch live: https://pataclaw.com/view/${result.viewToken}\n`;
    out += `\n`;
    out += `PLAY NOW — browse this URL next:\n`;
    out += `${base}&cmd=grind+10\n`;
    res.send(out);
  } catch (err) {
    console.error('Agent create error:', err);
    res.status(500).send('ERROR: World creation failed. Please try again.');
  }
}
router.get('/agent/create', createRateLimit, agentCreateHandler);
router.post('/agent/create', createRateLimit, agentCreateHandler);

// ─── Agent Play: GET (play token in URL) or POST (Bearer key in header) ───
// GET:  /api/agent/play?token=PLAY_TOKEN&cmd=build+farm
// POST: /api/agent/play  Authorization: Bearer SECRET_KEY  Body: { "cmd": "build farm" }
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

async function agentPlayHandler(req, res) {
  const cmd = ((req.body && req.body.cmd) || req.query.cmd || '').trim();
  const worldId = req.worldId;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  // Get play token for generating browsable "next step" URLs
  const _wpt = db.prepare('SELECT play_token FROM worlds WHERE id = ?').get(worldId);
  const playToken = _wpt ? _wpt.play_token : null;
  const statusUrl = playToken ? `\n\nCheck status: https://pataclaw.com/api/agent/play?token=${playToken}&cmd=status` : '';

  // Wrap res.send to append status URL to action responses (not to status/help/list responses)
  const originalSend = res.send.bind(res);
  let appendStatus = false;
  res.send = function(body) {
    if (appendStatus && playToken && typeof body === 'string') {
      body += statusUrl;
    }
    return originalSend(body);
  };

  if (!cmd) {
    return res.send(agentHelp(worldId));
  }

  const parts = cmd.split(/\s+/);
  const action = parts[0].toLowerCase();
  const args = parts.slice(1);

  // For action commands (not read-only), append "check status" URL
  const readOnlyCmds = ['status', 'villagers', 'buildings', 'events', 'map', 'help', 'grind'];
  if (!readOnlyCmds.includes(action)) appendStatus = true;

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
        const _ptS = db.prepare('SELECT play_token FROM worlds WHERE id = ?').get(worldId);
        if (_ptS && _ptS.play_token) {
          out += `\n\nAuto-play: https://pataclaw.com/api/agent/play?token=${_ptS.play_token}&cmd=grind+10`;
        }
        out += `\n\nOr pick a move:\n${suggestMoves(worldId, w, resources, popAlive, active)}`;
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
        if (!type) return res.send('ERROR: Specify building type.\nUsage: build farm\nTypes: hut, farm, workshop, wall, temple, watchtower, market, library, storehouse, dock, barracks');

        const { startBuilding, BUILDING_DEFS } = require('../simulation/buildings');
        if (!BUILDING_DEFS[type]) {
          return res.send(`ERROR: Unknown building "${type}".\nAvailable: ${Object.keys(BUILDING_DEFS).join(', ')}`);
        }

        // Auto-pick a buildable tile near town center
        const world = db.prepare('SELECT seed FROM worlds WHERE id = ?').get(worldId);
        const { getCenter } = require('../world/map');
        const center = getCenter(world.seed);

        let buildableTiles;
        if (type === 'dock') {
          // Dock: pick closest explored land tile adjacent to water (within 2 tiles)
          buildableTiles = db.prepare(`
            SELECT t.x, t.y FROM tiles t
            WHERE t.world_id = ? AND t.explored = 1
              AND t.terrain NOT IN ('water', 'mountain')
              AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.world_id = t.world_id AND b.x = t.x AND b.y = t.y AND b.status != 'destroyed')
              AND EXISTS (
                SELECT 1 FROM tiles w
                WHERE w.world_id = t.world_id AND w.terrain = 'water'
                  AND ABS(w.x - t.x) <= 2 AND ABS(w.y - t.y) <= 2
                  AND (w.x != t.x OR w.y != t.y)
              )
            ORDER BY ABS(t.x - ?) + ABS(t.y - ?) ASC
            LIMIT 1
          `).get(worldId, center.x, center.y);
          if (!buildableTiles) return res.send('ERROR: No coastline tiles available. Explore water tiles first — docks must be built on land within 2 tiles of water.');
        } else {
          buildableTiles = db.prepare(`
            SELECT t.x, t.y FROM tiles t
            WHERE t.world_id = ? AND t.explored = 1
              AND t.terrain NOT IN ('water', 'mountain')
              AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.world_id = t.world_id AND b.x = t.x AND b.y = t.y AND b.status != 'destroyed')
            ORDER BY ABS(t.x - ?) + ABS(t.y - ?) ASC
            LIMIT 1
          `).get(worldId, center.x, center.y);
        }

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
        const validRoles = ['idle', 'farmer', 'builder', 'warrior', 'scout', 'scholar', 'priest', 'fisherman', 'hunter'];
        if (!role || !validRoles.includes(role)) {
          return res.send(`ERROR: Specify role.\nUsage: assign farmer\nRoles: ${validRoles.join(', ')}`);
        }

        // How many to assign (default 1)
        const count = parseInt(args[1]) || 1;
        const idle = db.prepare("SELECT id, name FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'idle' LIMIT ?").all(worldId, count);
        if (idle.length === 0) return res.send('ERROR: No idle villagers to assign. All villagers already have roles.');

        // Auto-find matching building for production roles
        const ROLE_BUILDING_MAP = {
          farmer: ['farm'], fisherman: ['dock'], hunter: ['hunting_lodge'],
          builder: ['workshop'], scholar: ['library'], priest: ['temple'],
          warrior: ['barracks'],
        };
        let buildingId = null;
        let buildingWarning = '';

        // Barracks capacity check for warriors
        if (role === 'warrior') {
          const barracks = db.prepare(
            "SELECT b.id, (SELECT COUNT(*) FROM villagers v WHERE v.assigned_building_id = b.id AND v.role = 'warrior' AND v.status = 'alive') as warrior_count FROM buildings b WHERE b.world_id = ? AND b.type = 'barracks' AND b.status = 'active'"
          ).all(worldId);
          if (barracks.length === 0) {
            return res.send('ERROR: Build a barracks first to train warriors.');
          }
          const slotsAvailable = barracks.reduce((sum, b) => sum + Math.max(0, 5 - b.warrior_count), 0);
          if (slotsAvailable === 0) {
            return res.send('ERROR: Barracks full. Build another barracks. (Max 5 warriors per barracks)');
          }
          if (slotsAvailable < idle.length) {
            return res.send(`ERROR: Only ${slotsAvailable} warrior slot(s) available across all barracks. Build another barracks for more capacity.`);
          }
          buildingId = null; // will be set per-warrior in the loop below
        } else {
          const buildingTypes = ROLE_BUILDING_MAP[role];
          if (buildingTypes) {
            const placeholders = buildingTypes.map(() => '?').join(',');
            const building = db.prepare(
              `SELECT id FROM buildings WHERE world_id = ? AND type IN (${placeholders}) AND status = 'active' LIMIT 1`
            ).get(worldId, ...buildingTypes);
            if (building) {
              buildingId = building.id;
            } else {
              buildingWarning = `\nNote: No active ${buildingTypes[0]} found. Build one for this role to be productive.`;
            }
          }
        }

        const updateStmt = db.prepare('UPDATE villagers SET role = ?, assigned_building_id = ?, ascii_sprite = ?, warrior_type = ? WHERE id = ? AND world_id = ?');
        const names = [];
        if (role === 'warrior') {
          // Distribute warriors across barracks with capacity
          const allBarracks = db.prepare(
            "SELECT b.id, (SELECT COUNT(*) FROM villagers v WHERE v.assigned_building_id = b.id AND v.role = 'warrior' AND v.status = 'alive') as warrior_count FROM buildings b WHERE b.world_id = ? AND b.type = 'barracks' AND b.status = 'active' ORDER BY warrior_count ASC"
          ).all(worldId);
          let bIdx = 0;
          for (const v of idle) {
            while (bIdx < allBarracks.length && allBarracks[bIdx].warrior_count >= 5) bIdx++;
            if (bIdx >= allBarracks.length) break;
            const vFull = db.prepare('SELECT temperament, creativity, sociability FROM villagers WHERE id = ?').get(v.id);
            const wType = vFull ? computeWarriorType(vFull) : 'pincer';
            updateStmt.run(role, allBarracks[bIdx].id, role, wType, v.id, worldId);
            allBarracks[bIdx].warrior_count++;
            names.push(v.name);
          }
        } else {
          for (const v of idle) {
            updateStmt.run(role, buildingId, role, null, v.id, worldId);
            names.push(v.name);
          }
        }

        const { logCultureAction } = require('../simulation/culture');
        logCultureAction(worldId, 'assign', role);
        return res.send(`OK: Assigned ${names.length} villager(s) as ${role}: ${names.join(', ')}${buildingWarning}`);
      }

      case 'rename': {
        const newName = args.join(' ');
        if (!newName) return res.send('ERROR: Specify a name.\nUsage: rename My Cool Town');
        const sanitized = newName.replace(/[<>&"']/g, '').slice(0, 50);
        db.prepare('UPDATE worlds SET name = ? WHERE id = ?').run(sanitized, worldId);
        const { logCultureAction } = require('../simulation/culture');
        logCultureAction(worldId, 'rename', '_default');
        return res.send(`OK: Town renamed to "${sanitized}". Visible on leaderboard within 1 tick (~10s).`);
      }

      case 'motto': {
        const motto = args.join(' ');
        if (!motto) return res.send('ERROR: Specify a motto.\nUsage: motto From shell we rise');
        const sanitized = motto.replace(/[<>&"']/g, '').slice(0, 200);
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
        const tradeAction = args[0]; // buy, sell, or offer
        const market = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'market' AND status = 'active'").get(worldId);
        if (market.c === 0) return res.send('ERROR: No active market. Build a market first!');

        // Inter-world trade offer: trade offer <resource> <amount> for <resource> <amount>
        if (tradeAction === 'offer') {
          const sellRes = args[1];
          const sellAmt = parseInt(args[2]);
          const forKw = args[3];
          const buyRes = args[4];
          const buyAmt = parseInt(args[5]);
          if (!sellRes || !sellAmt || forKw !== 'for' || !buyRes || !buyAmt) {
            return res.send('ERROR: Usage: trade offer shell_lore 5 for life_essence 3');
          }
          if (sellAmt <= 0 || sellAmt > 200 || buyAmt <= 0 || buyAmt > 200) return res.send('ERROR: Amounts must be 1-200.');
          if (sellRes === buyRes) return res.send('ERROR: Cannot trade a resource for itself.');

          const sellCheck = db.prepare('SELECT amount FROM resources WHERE world_id = ? AND type = ?').get(worldId, sellRes);
          if (!sellCheck || sellCheck.amount < sellAmt) {
            return res.send(`ERROR: Not enough ${sellRes}. Have ${Math.floor(sellCheck ? sellCheck.amount : 0)}, need ${sellAmt}.`);
          }

          // Escrow the offered resource
          db.prepare('UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = ?').run(sellAmt, worldId, sellRes);
          const tradeId = uuid();
          db.prepare(
            "INSERT INTO trades (id, world_id, direction, offer_resource, offer_amount, request_resource, request_amount, status) VALUES (?, ?, 'outgoing', ?, ?, ?, ?, 'open')"
          ).run(tradeId, worldId, sellRes, sellAmt, buyRes, buyAmt);

          const worldName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(worldId);
          return res.send(`OK: Trade posted! Offering ${sellAmt} ${sellRes} for ${buyAmt} ${buyRes}.\nTrade ID: ${tradeId}\nOther towns can accept this trade.`);
        }

        // Accept another world's open trade: trade accept <trade_id>
        if (tradeAction === 'accept') {
          const tradeId = args[1];
          if (!tradeId) return res.send('ERROR: Usage: trade accept <trade_id>');

          const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND status = 'open'").get(tradeId);
          if (!trade) return res.send('ERROR: Trade not found or already completed.');
          if (trade.world_id === worldId) return res.send('ERROR: Cannot accept your own trade.');

          // Check acceptor has the requested resource
          const acceptorRes = db.prepare('SELECT amount FROM resources WHERE world_id = ? AND type = ?').get(worldId, trade.request_resource);
          if (!acceptorRes || acceptorRes.amount < trade.request_amount) {
            return res.send(`ERROR: Not enough ${trade.request_resource}. Have ${Math.floor(acceptorRes ? acceptorRes.amount : 0)}, need ${trade.request_amount}.`);
          }

          // Execute trade atomically
          db.transaction(() => {
            // Deduct from acceptor
            db.prepare('UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = ?').run(trade.request_amount, worldId, trade.request_resource);
            // Give acceptor the offered resource (ensure row exists)
            const acceptorOffered = db.prepare('SELECT amount FROM resources WHERE world_id = ? AND type = ?').get(worldId, trade.offer_resource);
            if (!acceptorOffered) {
              db.prepare('INSERT INTO resources (world_id, type, amount, capacity) VALUES (?, ?, 0, 50)').run(worldId, trade.offer_resource);
            }
            db.prepare('UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?').run(trade.offer_amount, worldId, trade.offer_resource);
            // Give offerer the requested resource (ensure row exists)
            const offererRequested = db.prepare('SELECT amount FROM resources WHERE world_id = ? AND type = ?').get(trade.world_id, trade.request_resource);
            if (!offererRequested) {
              db.prepare('INSERT INTO resources (world_id, type, amount, capacity) VALUES (?, ?, 0, 50)').run(trade.world_id, trade.request_resource);
            }
            db.prepare('UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?').run(trade.request_amount, trade.world_id, trade.request_resource);

            // Mark trade complete
            const acceptorName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(worldId);
            db.prepare("UPDATE trades SET status = 'completed', partner_world_name = ? WHERE id = ?").run(acceptorName ? acceptorName.name : 'unknown', tradeId);
          })();

          return res.send(`OK: Trade accepted! Received ${trade.offer_amount} ${trade.offer_resource}, sent ${trade.request_amount} ${trade.request_resource}.`);
        }

        // Cancel your own open trade: trade cancel <trade_id>
        if (tradeAction === 'cancel') {
          const tradeId = args[1];
          if (!tradeId) return res.send('ERROR: Usage: trade cancel <trade_id>');
          const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND world_id = ? AND status = 'open'").get(tradeId, worldId);
          if (!trade) return res.send('ERROR: Trade not found (must be yours and still open).');
          db.prepare('UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?').run(trade.offer_amount, worldId, trade.offer_resource);
          db.prepare("UPDATE trades SET status = 'cancelled' WHERE id = ?").run(tradeId);
          return res.send(`OK: Trade cancelled. Refunded ${trade.offer_amount} ${trade.offer_resource}.`);
        }

        // Standard crypto buy/sell
        const resource = args[1];
        const amount = parseInt(args[2]);
        if (!tradeAction || !resource || !amount) return res.send('ERROR: Usage: trade sell food 10 | trade buy wood 5 | trade offer ... | trade accept <id> | trade cancel <id>');
        if (tradeAction !== 'buy' && tradeAction !== 'sell') return res.send('ERROR: Action must be "buy", "sell", "offer", "accept", or "cancel".');

        const TRADE_RATES = { food: { sell: 0.5, buy: 0.8 }, wood: { sell: 0.4, buy: 0.6 }, stone: { sell: 0.3, buy: 0.5 }, knowledge: { sell: 2.0, buy: 3.0 }, faith: { sell: 1.5, buy: 2.5 } };
        if (!TRADE_RATES[resource]) return res.send(`ERROR: Can't trade "${resource}" for crypto. Tradeable: ${Object.keys(TRADE_RATES).join(', ')}. For unique resources, use: trade offer <res> <amt> for <res> <amt>`);
        if (amount <= 0 || amount > 200) return res.send('ERROR: Amount must be 1-200.');

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

      case 'bet': {
        // Agent betting: bet <war_id> <side> <amount>
        const betWarId = args[0];
        const betSide = args[1]; // challenger name or defender name
        const betAmt = parseInt(args[2]);
        if (!betWarId || !betSide || !betAmt) return res.send('ERROR: Usage: bet <war_id> <side_name> <amount>');

        try {
          const betWar = db.prepare("SELECT * FROM wars WHERE id = ? AND status = 'countdown'").get(betWarId);
          if (!betWar) return res.send('ERROR: War not found or betting is closed.');

          // Find or create agent spectator
          let spectator = db.prepare('SELECT * FROM spectators WHERE world_id = ?').get(worldId);
          if (!spectator) {
            const { v4: specUuid } = require('uuid');
            const specId = specUuid();
            const specToken = specUuid();
            const wName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(worldId);
            db.prepare('INSERT INTO spectators (id, session_token, display_name, credits, is_agent, world_id) VALUES (?, ?, ?, 500, 1, ?)')
              .run(specId, specToken, wName ? wName.name : 'Agent', worldId);
            spectator = db.prepare('SELECT * FROM spectators WHERE id = ?').get(specId);
          }

          if (betAmt > spectator.credits) return res.send(`ERROR: Not enough credits. Have ${spectator.credits}.`);

          // Resolve side name to world id
          const cName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(betWar.challenger_id);
          const dName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(betWar.defender_id);
          let backedId = null;
          if (betSide.toLowerCase() === cName.name.toLowerCase()) backedId = betWar.challenger_id;
          else if (betSide.toLowerCase() === dName.name.toLowerCase()) backedId = betWar.defender_id;
          else return res.send(`ERROR: Side must be "${cName.name}" or "${dName.name}"`);

          // Place bet via arena logic
          const existingBet = db.prepare("SELECT id FROM bets WHERE war_id = ? AND spectator_id = ? AND status = 'active'").get(betWarId, spectator.id);
          if (existingBet) return res.send('ERROR: Already bet on this war.');

          const { v4: betUuid } = require('uuid');
          // Simple odds calc inline
          const odds = backedId === betWar.challenger_id ? 1.5 : 1.5; // Simplified for agent
          const payout = Math.floor(betAmt * odds * 0.95);

          db.transaction(() => {
            db.prepare('INSERT INTO bets (id, war_id, spectator_id, backed_world_id, amount, odds_at_placement, potential_payout) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(betUuid(), betWarId, spectator.id, backedId, betAmt, odds, payout);
            db.prepare('UPDATE spectators SET credits = credits - ?, total_wagered = total_wagered + ? WHERE id = ?')
              .run(betAmt, betAmt, spectator.id);
          })();

          return res.send(`OK: Bet ${betAmt} credits on ${betSide}. Potential payout: ${payout} credits.`);
        } catch (e) {
          return res.send(`ERROR: ${e.message}`);
        }
      }

      case 'mybets': {
        try {
          const spectator = db.prepare('SELECT * FROM spectators WHERE world_id = ?').get(worldId);
          if (!spectator) return res.send('No betting account. Place a bet first.');
          const bets = db.prepare(`
            SELECT b.amount, b.status, b.odds_at_placement, b.payout, backed.name as backed_name
            FROM bets b JOIN worlds backed ON backed.id = b.backed_world_id
            WHERE b.spectator_id = ? ORDER BY b.created_at DESC LIMIT 10
          `).all(spectator.id);
          let out = `=== YOUR BETS (${spectator.credits} credits) ===\n`;
          for (const b of bets) {
            out += `  ${b.backed_name} | ${b.amount} credits @ ${b.odds_at_placement}x | ${b.status}${b.payout ? ' → +' + b.payout : ''}\n`;
          }
          return res.send(out);
        } catch {
          return res.send('No betting account yet.');
        }
      }

      case 'challenge':
      case 'war-declare': {
        const targetName = args.join(' ');
        if (!targetName) return res.send('ERROR: Specify target world.\nUsage: challenge <world_name>');
        const target = db.prepare("SELECT id, name FROM worlds WHERE name = ? AND status = 'active'").get(targetName);
        if (!target) return res.send(`ERROR: World "${targetName}" not found. Check /leaderboard for active worlds.`);
        const { declareWar } = require('../simulation/war');
        const warResult = declareWar(worldId, target.id);
        if (!warResult.ok) return res.send(`ERROR: ${warResult.reason}`);
        return res.send(`OK: War declared on ${target.name}! Waiting for them to accept.\nWar ID: ${warResult.warId}`);
      }

      case 'accept-war':
      case 'war-accept': {
        const { getPendingWarForDefender, acceptWar } = require('../simulation/war');
        const pending = getPendingWarForDefender(worldId);
        if (!pending) return res.send('ERROR: No pending war challenge to accept.');
        const acceptResult = acceptWar(pending.id, worldId);
        if (!acceptResult.ok) return res.send(`ERROR: ${acceptResult.reason}`);
        return res.send(`OK: War accepted! Battle begins at ${acceptResult.bettingClosesAt}.\n5-minute betting window is now open.`);
      }

      case 'decline-war':
      case 'war-decline': {
        const { getPendingWarForDefender, declineWar } = require('../simulation/war');
        const pendingW = getPendingWarForDefender(worldId);
        if (!pendingW) return res.send('ERROR: No pending war challenge to decline.');
        const declineResult = declineWar(pendingW.id, worldId);
        if (!declineResult.ok) return res.send(`ERROR: ${declineResult.reason}`);
        return res.send(`OK: ${declineResult.message}`);
      }

      case 'select-skills':
      case 'war-skills': {
        const skillArgs = args;
        if (skillArgs.length === 0) {
          // Show available skills
          const { getAvailableSkills, getAllSkills } = require('../simulation/war-skills');
          const available = getAvailableSkills(worldId);
          const allSkills = getAllSkills();
          let out = '=== WAR SKILLS ===\n';
          for (const s of allSkills) {
            const unlocked = available.includes(s.id);
            out += `  ${unlocked ? '[✓]' : '[✗]'} ${s.name} (${s.id}) — ${s.desc}\n      Unlock: ${s.unlockDesc}\n`;
          }
          out += `\nYou have ${available.length} skills unlocked.`;
          if (available.length >= 3) out += `\nUsage: select-skills <id1> <id2> <id3>`;
          return res.send(out);
        }
        if (skillArgs.length !== 3) return res.send('ERROR: Must select exactly 3 skills.\nUsage: select-skills berserker_charge shield_wall spires_wrath');

        const { getWarByParticipant, selectSkills: doSelectSkills } = require('../simulation/war');
        const activeWar = getWarByParticipant(worldId);
        if (!activeWar) return res.send('ERROR: No active/countdown war to select skills for.');
        if (activeWar.status !== 'countdown') return res.send('ERROR: Skills can only be selected during the countdown phase.');

        const skillResult = doSelectSkills(activeWar.id, worldId, skillArgs);
        if (!skillResult.ok) return res.send(`ERROR: ${skillResult.reason}`);
        return res.send(`OK: Skills selected: ${skillArgs.join(', ')}. Ready for battle!`);
      }

      case 'war-ready': {
        const { isWarReady } = require('../simulation/war');
        const readiness = isWarReady(worldId);
        if (readiness.ready) return res.send('OK: Your civilization is WAR READY. You can challenge other worlds.');
        return res.send(`NOT READY: ${readiness.reason}`);
      }

      case 'wars': {
        const activeWars = db.prepare("SELECT w.*, c.name as c_name, d.name as d_name FROM wars w JOIN worlds c ON c.id = w.challenger_id JOIN worlds d ON d.id = w.defender_id WHERE w.status IN ('pending', 'countdown', 'active') ORDER BY w.created_at DESC LIMIT 10").all();
        if (activeWars.length === 0) return res.send('No active wars. Peace reigns... for now.');
        let out = '=== ACTIVE WARS ===\n';
        for (const w of activeWars) {
          out += `  [${w.status.toUpperCase()}] ${w.c_name} vs ${w.d_name}`;
          if (w.status === 'active') out += ` | Round ${w.round_number}/${MAX_ROUNDS} | HP: ${w.challenger_hp} vs ${w.defender_hp}`;
          out += ` | ID: ${w.id.slice(0,8)}\n`;
        }
        return res.send(out);
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

          // Snapshot world state at mint time
          const mWorld = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
          const mPop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
          const mBuildings = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND status != 'destroyed'").get(worldId).c;
          const mCulture = db.prepare('SELECT village_mood FROM culture WHERE world_id = ?').get(worldId);
          const mSnapshot = JSON.stringify({
            name: mWorld.name, day_number: mWorld.day_number, season: mWorld.season,
            population: mPop, buildings: mBuildings,
            culture: mCulture ? mCulture.village_mood : 'calm',
            reputation: mWorld.reputation, minted_at: new Date().toISOString(),
          });

          db.prepare('INSERT INTO nft_mints (id, world_id, token_id, wallet_address, tx_hash, world_snapshot) VALUES (?, ?, ?, ?, ?, ?)')
            .run(uuid(), worldId, tokenId, wallet, mintResult.txHash, mSnapshot);
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
          console.error('[NFT] Agent mint failed:', mintErr);
          return res.send('ERROR: Mint failed. Please try again later.');
        }
      }

      case 'grind': {
        // Auto-play: analyze state and execute multiple optimal moves in one request
        const maxMoves = Math.min(parseInt(args[0]) || 5, 10);
        const w = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
        const { startBuilding, BUILDING_DEFS } = require('../simulation/buildings');
        const { getCenter } = require('../world/map');
        const center = getCenter(w.seed);
        const log = [];

        for (let i = 0; i < maxMoves; i++) {
          const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
          const resMap = {};
          for (const r of resources) resMap[r.type] = Math.floor(r.amount);

          const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
          const idle = db.prepare("SELECT id, name FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'idle'").all(worldId);
          const blds = db.prepare("SELECT type, status FROM buildings WHERE world_id = ? AND status != 'destroyed'").all(worldId);
          const activeTypes = new Set(blds.filter(b => b.status === 'active').map(b => b.type));
          const constructing = blds.filter(b => b.status === 'constructing').length;

          // Decision priority: assign idle > food crisis > build needed > explore
          if (idle.length > 0) {
            // Assign idle villagers to most needed role
            let role = 'farmer';
            const farmers = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'farmer'").get(worldId).c;
            const warriors = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'warrior'").get(worldId).c;
            const builders = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'builder'").get(worldId).c;

            if (farmers < 2) role = 'farmer';
            else if (constructing > 0 && builders < 1) role = 'builder';
            else if (w.day_number >= 7 && warriors < 2) role = 'warrior';
            else if (farmers < 3) role = 'farmer';
            else role = 'builder';

            const v = idle[0];
            const buildingMatch = db.prepare(
              "SELECT id FROM buildings WHERE world_id = ? AND type IN (SELECT type FROM buildings WHERE type IN ('farm','workshop','barracks','temple','library','dock','hunting_lodge') AND world_id = ?) AND status = 'active' ORDER BY assigned_villagers ASC LIMIT 1"
            ).get(worldId, worldId);

            db.prepare("UPDATE villagers SET role = ?, ascii_sprite = ? WHERE id = ?").run(role, role, v.id);
            if (buildingMatch) {
              db.prepare("UPDATE villagers SET assigned_building_id = ? WHERE id = ?").run(buildingMatch.id, v.id);
              db.prepare("UPDATE buildings SET assigned_villagers = assigned_villagers + 1 WHERE id = ?").run(buildingMatch.id);
            }
            log.push(`Assigned ${v.name} as ${role}`);
            continue;
          }

          if (constructing > 0) {
            log.push('Waiting for construction...');
            break; // Nothing useful to do while building
          }

          // Build priority
          let toBuild = null;
          const farmCount = blds.filter(b => b.type === 'farm' && b.status === 'active').length;
          if ((resMap.food || 0) < 20 && farmCount < 3) toBuild = 'farm';
          else if (!activeTypes.has('hut') && popAlive >= 3) toBuild = 'hut';
          else if (!activeTypes.has('workshop')) toBuild = 'workshop';
          else if (!activeTypes.has('wall') && w.day_number >= 5) toBuild = 'wall';
          else if (farmCount < 2) toBuild = 'farm';
          else if (!activeTypes.has('watchtower') && w.day_number >= 7) toBuild = 'watchtower';
          else if (!activeTypes.has('barracks') && w.day_number >= 8) toBuild = 'barracks';
          else if (!activeTypes.has('temple')) toBuild = 'temple';
          else if (!activeTypes.has('market')) toBuild = 'market';
          else if (!activeTypes.has('library')) toBuild = 'library';
          else if (!activeTypes.has('storehouse')) toBuild = 'storehouse';
          else if (popAlive >= 5 && blds.filter(b => b.type === 'hut').length < 3) toBuild = 'hut';

          if (toBuild && BUILDING_DEFS[toBuild]) {
            const tile = db.prepare(`
              SELECT t.x, t.y FROM tiles t
              WHERE t.world_id = ? AND t.explored = 1
                AND t.terrain NOT IN ('water', 'mountain')
                AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.world_id = t.world_id AND b.x = t.x AND b.y = t.y AND b.status != 'destroyed')
              ORDER BY ABS(t.x - ?) + ABS(t.y - ?) ASC LIMIT 1
            `).get(worldId, center.x, center.y);

            if (tile) {
              const result = startBuilding(worldId, toBuild, tile.x, tile.y);
              if (result.ok) {
                const { logCultureAction } = require('../simulation/culture');
                logCultureAction(worldId, 'build', toBuild);
                log.push(`Started building ${toBuild}`);
                continue;
              }
            }
          }

          // Teach a phrase if nothing else to do
          if ((resMap.knowledge || 0) >= 0) {
            const phrases = ['We grind', 'Victory awaits', 'Shells to dust', 'Never idle'];
            const phrase = phrases[Math.floor(Math.random() * phrases.length)];
            try {
              const { logCultureAction } = require('../simulation/culture');
              logCultureAction(worldId, 'teach', phrase);
              log.push(`Taught: "${phrase}"`);
            } catch { /* skip */ }
          }
          break;
        }

        if (log.length === 0) log.push('Nothing to do right now — town is running smoothly');

        let out = `=== GRIND REPORT (${log.length} actions) ===\n`;
        for (const l of log) out += `  > ${l}\n`;

        // Append current status summary
        const wNow = db.prepare('SELECT name, day_number, reputation FROM worlds WHERE id = ?').get(worldId);
        const popNow = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
        const resNow = db.prepare("SELECT type, amount FROM resources WHERE world_id = ? AND type = 'food'").get(worldId);
        const bldNow = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND status != 'destroyed'").get(worldId).c;
        out += `\n${wNow.name} | Day ${wNow.day_number} | Pop ${popNow} | Food ${Math.floor(resNow ? resNow.amount : 0)} | ${bldNow} buildings | Rep ${wNow.reputation}`;

        // Chain: give the AI the next URL to browse
        const _pt = db.prepare('SELECT play_token FROM worlds WHERE id = ?').get(worldId);
        if (_pt && _pt.play_token) {
          out += `\n\nKeep going — browse: https://pataclaw.com/api/agent/play?token=${_pt.play_token}&cmd=grind+10`;
        }

        return res.send(out);
      }

      default:
        return res.send(`ERROR: Unknown command "${action}".\n\n` + agentHelp(worldId));
    }
  } catch (err) {
    console.error('Agent play error:', err);
    return res.send(`ERROR: ${err.message}`);
  }
}
router.get('/agent/play', agentRateLimit, authFlexible, agentPlayHandler);
router.post('/agent/play', agentRateLimit, authFlexible, agentPlayHandler);

function agentHelp(worldId) {
  const w = worldId ? db.prepare('SELECT name, town_number, view_token, play_token FROM worlds WHERE id = ?').get(worldId) : null;
  let out = '=== PATACLAW — AI Agent Play Endpoint ===\n';
  if (w && w.play_token) {
    out += `Browse: /api/agent/play?token=${w.play_token}&cmd=COMMAND\n\n`;
  } else {
    out += 'Browse: /api/agent/play?token=YOUR_PLAY_TOKEN&cmd=COMMAND\n\n';
  }
  out += 'COMMANDS:\n';
  out += '  status          — View town state, resources, buildings\n';
  out += '  villagers       — List all villagers with roles/stats\n';
  out += '  buildings       — List all buildings with IDs\n';
  out += '  events          — Recent event log\n';
  out += '  map             — Explored tiles and features\n';
  out += '  build <type>    — Build (auto-places near center)\n';
  out += '                    Types: hut, farm, workshop, wall, barracks,\n';
  out += '                    temple, watchtower, market, library,\n';
  out += '                    storehouse, dock\n';
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
  out += '  trade offer <res> <amt> for <res> <amt>\n';
  out += '  trade accept <trade_id>\n';
  out += '  challenge <name> — Declare war on another world\n';
  out += '  accept-war      — Accept a war challenge\n';
  out += '  decline-war     — Decline a war challenge (-5 rep)\n';
  out += '  select-skills   — View/select 3 war skills for battle\n';
  out += '  war-ready       — Check if your civilization is war-ready\n';
  out += '  wars            — List active/pending wars\n';
  out += '  grind [N]       — Auto-play N optimal moves (default 5, max 10)\n';
  out += '  mint <wallet>   — Mint world as ERC-721 NFT on Base\n';
  out += '                    (0.01 ETH, server pays gas, 500 max supply)\n';
  out += '  help            — This message\n';
  out += '\nEXAMPLE (browse these URLs):\n';
  if (w && w.play_token) {
    out += `  /api/agent/play?token=${w.play_token}&cmd=status\n`;
    out += `  /api/agent/play?token=${w.play_token}&cmd=build+farm\n`;
    out += `  /api/agent/play?token=${w.play_token}&cmd=assign+farmer\n`;
  } else {
    out += '  /api/agent/play?token=YOUR_PLAY_TOKEN&cmd=status\n';
    out += '  /api/agent/play?token=YOUR_PLAY_TOKEN&cmd=build+farm\n';
    out += '  /api/agent/play?token=YOUR_PLAY_TOKEN&cmd=assign+farmer\n';
  }
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

  // Get play token for generating browsable URLs
  const wRow = db.prepare('SELECT play_token FROM worlds WHERE id = ?').get(worldId);
  const pt = wRow ? wRow.play_token : null;
  const base = pt ? `https://pataclaw.com/api/agent/play?token=${pt}&cmd=` : null;

  function suggestion(text, cmd) {
    return base ? `${text} — browse: ${base}${cmd}` : `${text} (cmd=${cmd})`;
  }

  const suggestions = [];

  if ((resMap.food || 0) < 10) suggestions.push(suggestion('CRITICAL: Build a farm', 'build+farm'));
  if (!buildTypes.has('farm')) suggestions.push(suggestion('Build a farm for food', 'build+farm'));
  else if (!buildTypes.has('hut') && pop >= 4) suggestions.push(suggestion('Build a hut for population', 'build+hut'));
  else if (!buildTypes.has('wall') && world.day_number >= 7) suggestions.push(suggestion('Build walls before raids', 'build+wall'));
  else if (!buildTypes.has('workshop')) suggestions.push(suggestion('Build a workshop', 'build+workshop'));

  const idleCount = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'idle'").get(worldId).c;
  if (idleCount > 0) suggestions.push(suggestion(`Assign ${idleCount} idle villager(s)`, 'assign+farmer'));

  if (suggestions.length === 0) suggestions.push(suggestion('Explore the map', 'explore+north'));
  return suggestions.join('\n');
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
