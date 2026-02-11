const { Router } = require('express');
const db = require('../db/connection');
const { getWorldHighlights } = require('../simulation/highlights');

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
  const world = db.prepare('SELECT name, current_tick, day_number, season, time_of_day, weather, hero_title, motto, reputation, map_size, town_number FROM worlds WHERE id = ?').get(req.worldId);
  const resources = db.prepare('SELECT type, amount, capacity FROM resources WHERE world_id = ?').all(req.worldId);
  const popAlive = db.prepare("SELECT COUNT(*) as count FROM villagers WHERE world_id = ? AND status = 'alive'").get(req.worldId).count;
  const buildingCap = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 WHEN type = 'spawning_pools' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'").get(req.worldId).cap;
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
  const { getProphetCount } = require('../simulation/prophets');
  const culture = getCulture(req.worldId);
  const world = db.prepare('SELECT banner_symbol FROM worlds WHERE id = ?').get(req.worldId);
  const prophetCount = getProphetCount(req.worldId);

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
    prophet_count: prophetCount,
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

  const prophetCountAch = db.prepare('SELECT COUNT(*) as c FROM prophet_discoveries WHERE world_id = ?').get(req.worldId).c;
  const deepDives = db.prepare('SELECT deep_dives FROM worlds WHERE id = ?').get(req.worldId);
  const relicCount = db.prepare('SELECT COUNT(*) as c FROM shell_relics WHERE world_id = ?').get(req.worldId).c;

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
    { id: 'wealthy', name: 'Crypto Age', desc: 'Accumulate 50 crypto', unlocked: (resMap.crypto || 0) >= 50 },
    { id: 'scholar_dream', name: "Scholar's Dream", desc: 'Accumulate 50 knowledge', unlocked: (resMap.knowledge || 0) >= 50 },
    { id: 'centurion', name: 'Centurion', desc: 'Reach day 100', unlocked: (world ? world.day_number : 0) >= 100 },
    { id: 'seeker_of_truth', name: 'Seeker of Truth', desc: 'Discover 10 prophets', unlocked: prophetCountAch >= 10 },
    { id: 'the_64_witnesses', name: 'The 64 Witnesses', desc: 'Discover all 64 prophets', unlocked: prophetCountAch >= 64 },
    { id: 'into_the_abyss', name: 'Into the Abyss', desc: 'Complete 5 deep-sea dives', unlocked: (deepDives ? deepDives.deep_dives : 0) >= 5 },
    { id: 'shell_collector', name: 'Shell Collector', desc: 'Accumulate 5 shell relics', unlocked: relicCount >= 5 },
    { id: 'shell_archive', name: 'Memory Eternal', desc: 'Build the Shell Archive', unlocked: buildingTypes.has('shell_archive') },
    { id: 'abyssal_beacon', name: 'Light in the Deep', desc: 'Build the Abyssal Beacon', unlocked: buildingTypes.has('abyssal_beacon') },
    { id: 'molt_cathedral', name: 'Sacred Shedding', desc: 'Build the Molt Cathedral', unlocked: buildingTypes.has('molt_cathedral') },
    { id: 'spawning_pools', name: 'Cradle of Life', desc: 'Build the Spawning Pools', unlocked: buildingTypes.has('spawning_pools') },
    { id: 'mega_builder', name: 'Master Architect', desc: 'Build all 4 megastructures', unlocked: buildingTypes.has('shell_archive') && buildingTypes.has('abyssal_beacon') && buildingTypes.has('molt_cathedral') && buildingTypes.has('spawning_pools') },
  ];

  const unlocked = ACHIEVEMENTS.filter(a => a.unlocked);
  const locked = ACHIEVEMENTS.filter(a => !a.unlocked);

  res.json({
    total: ACHIEVEMENTS.length,
    unlocked: unlocked.length,
    achievements: ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, desc: a.desc, unlocked: a.unlocked })),
  });
});

// GET /api/world/quests - computed active objectives
router.get('/quests', (req, res) => {
  const world = db.prepare('SELECT day_number, seed FROM worlds WHERE id = ?').get(req.worldId);
  if (!world) return res.status(404).json({ error: 'World not found' });

  const activeBuildings = db.prepare("SELECT type FROM buildings WHERE world_id = ? AND status = 'active'").all(req.worldId);
  const buildingTypes = new Set(activeBuildings.map(b => b.type));
  const buildingTypeCounts = {};
  for (const b of activeBuildings) buildingTypeCounts[b.type] = (buildingTypeCounts[b.type] || 0) + 1;

  const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(req.worldId).c;
  const exploredTiles = db.prepare("SELECT COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1").get(req.worldId).c;
  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(req.worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = Math.floor(r.amount);
  const raidWins = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'raid' AND severity = 'celebration'").get(req.worldId).c;
  const warriorCount = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'warrior'").get(req.worldId).c;

  const QUEST_POOL = [
    { id: 'build_farm', name: 'Build a farm', description: 'Establish a farm to feed your people', target: 1, current: buildingTypeCounts['farm'] || 0 },
    { id: 'build_wall', name: 'Fortify your town', description: 'Build walls to protect your village', target: 2, current: buildingTypeCounts['wall'] || 0 },
    { id: 'build_watchtower', name: 'Eyes on the horizon', description: 'Construct a watchtower for early warning', target: 1, current: buildingTypeCounts['watchtower'] || 0 },
    { id: 'build_dock', name: 'Set sail', description: 'Build a dock to access waterways', target: 1, current: buildingTypeCounts['dock'] || 0 },
    { id: 'pop_5', name: 'Growing village', description: 'Grow your population to 5 villagers', target: 5, current: popAlive },
    { id: 'pop_10', name: 'Thriving town', description: 'Grow your population to 10 villagers', target: 10, current: popAlive },
    { id: 'explore_10', name: 'Scout the land', description: 'Explore 10 tiles of the map', target: 10, current: exploredTiles },
    { id: 'explore_30', name: 'Map the world', description: 'Explore 30 tiles of the map', target: 30, current: exploredTiles },
    { id: 'crypto_30', name: 'Fill the wallets', description: 'Accumulate 30 crypto', target: 30, current: resMap.crypto || 0 },
    { id: 'knowledge_20', name: 'Pursuit of wisdom', description: 'Accumulate 20 knowledge', target: 20, current: resMap.knowledge || 0 },
    { id: 'survive_day_20', name: 'Endure', description: 'Survive until day 20', target: 20, current: world.day_number },
    { id: 'survive_day_50', name: 'The long road', description: 'Survive until day 50', target: 50, current: world.day_number },
    { id: 'repel_raid', name: 'Hold the line', description: 'Successfully repel a raid', target: 1, current: raidWins },
    { id: 'build_5_types', name: 'Architect', description: 'Have 5 different active building types', target: 5, current: buildingTypes.size },
    { id: 'assign_warrior', name: 'Call to arms', description: 'Assign at least one warrior', target: 1, current: warriorCount },
  ];

  // Mark completion
  for (const q of QUEST_POOL) {
    q.completed = q.current >= q.target;
  }

  // Deterministic hash from seed + epoch (rotates every 10 days)
  const epoch = Math.floor(world.day_number / 10);
  const seed = world.seed || 0;
  // Simple deterministic hash: mix seed and epoch
  let hash = ((seed * 2654435761) ^ (epoch * 2246822519)) >>> 0;

  const incomplete = QUEST_POOL.filter(q => !q.completed);
  let selected;

  if (incomplete.length >= 3) {
    // Shuffle incomplete deterministically using the hash and pick 3
    const shuffled = incomplete.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      hash = ((hash * 1664525 + 1013904223) & 0xFFFFFFFF) >>> 0;
      const j = hash % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    selected = shuffled.slice(0, 3);
  } else if (incomplete.length > 0) {
    // Fewer than 3 incomplete: take all incomplete, fill rest from hardest completed
    const hardest = QUEST_POOL.filter(q => q.completed).sort((a, b) => b.target - a.target);
    selected = [...incomplete, ...hardest].slice(0, 3);
  } else {
    // All completed: show 3 hardest
    const hardest = QUEST_POOL.slice().sort((a, b) => b.target - a.target);
    selected = hardest.slice(0, 3);
  }

  res.json({
    epoch,
    quests: selected.map(q => ({
      id: q.id,
      name: q.name,
      description: q.description,
      target: q.target,
      current: Math.min(q.current, q.target),
      completed: q.completed,
    })),
  });
});

// GET /api/world/highlights - top notable events for this world
router.get('/highlights', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const highlights = getWorldHighlights(req.worldId, limit);
  res.json({ highlights });
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

// POST /api/world/claim-nft — mint world as ERC-721 NFT on Base
router.post('/claim-nft', async (req, res) => {
  const config = require('../config');
  if (!config.nft.enabled) {
    return res.status(503).json({ error: 'NFT minting is not configured. Set NFT_CONTRACT_ADDRESS and NFT_SERVER_KEY env vars.' });
  }

  const { wallet } = req.body;
  if (!wallet) {
    return res.status(400).json({ error: 'Missing wallet address' });
  }

  const { ethers } = require('ethers');
  if (!ethers.isAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  const existingMint = db.prepare('SELECT * FROM nft_mints WHERE world_id = ?').get(req.worldId);
  if (existingMint) {
    return res.status(409).json({
      error: 'Already minted',
      tokenId: existingMint.token_id,
      txHash: existingMint.tx_hash,
    });
  }

  const { mintWorld, isAlreadyMinted, worldIdToTokenId, getSupplyInfo } = require('../blockchain/base');
  const { v4: uuidGen } = require('uuid');
  const tokenId = worldIdToTokenId(req.worldId);

  // Check supply before attempting mint
  const supply = await getSupplyInfo();
  if (supply.remaining === 0) {
    return res.status(410).json({
      error: 'All NFTs have been minted. No more available.',
      maxSupply: supply.maxSupply,
      totalMinted: supply.totalMinted,
    });
  }

  const onChain = await isAlreadyMinted(tokenId);
  if (onChain) {
    return res.status(409).json({ error: 'Token already exists on-chain', tokenId });
  }

  try {
    const result = await mintWorld(wallet, tokenId);

    // Snapshot world state at mint time for NFT resilience
    const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(req.worldId);
    const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(req.worldId).c;
    const buildingCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND status != 'destroyed'").get(req.worldId).c;
    const culture = db.prepare('SELECT village_mood FROM culture WHERE world_id = ?').get(req.worldId);
    const snapshot = JSON.stringify({
      name: world.name,
      day_number: world.day_number,
      season: world.season,
      population: popAlive,
      buildings: buildingCount,
      culture: culture ? culture.village_mood : 'calm',
      reputation: world.reputation,
      minted_at: new Date().toISOString(),
    });

    db.prepare(
      'INSERT INTO nft_mints (id, world_id, token_id, wallet_address, tx_hash, world_snapshot) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uuidGen(), req.worldId, tokenId, wallet, result.txHash, snapshot);

    const baseUrl = config.nft.baseUrl || `http://localhost:${config.port}/api/nft`;
    res.json({
      ok: true,
      tokenId,
      txHash: result.txHash,
      metadata_url: `${baseUrl}/${tokenId}/metadata`,
      mintsRemaining: supply.remaining - 1,
    });
  } catch (err) {
    console.error('NFT mint failed:', err);
    res.status(500).json({ error: 'Minting failed. Please try again later.' });
  }
});

module.exports = router;
