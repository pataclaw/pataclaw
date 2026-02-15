const db = require('../db/connection');
const { villagerAppearance, SPEECH, SLEEP_BUBBLES, BUILDING_SPRITES, BIOME_TOWN_CENTERS, BIOME_WALLS, BIOME_WATCHTOWERS, BIOME_BARRACKS, MODEL_SHRINES, PROJECT_SPRITES, TERRAIN_CHARS, FEATURE_CHARS, RUBBLE_SPRITE, OVERGROWN_SPRITE, MEGASTRUCTURE_SPEECH, NOMAD_CAMP_SPRITE, BUILDING_TIER_SPRITES } = require('./sprites');
const { hasMegastructure } = require('../simulation/megastructures');
const { MAP_SIZE, deriveBiomeWeights } = require('../world/map');
const { getCulture, buildSpeechPool } = require('../simulation/culture');
const { getActivePlanetaryEvent } = require('../simulation/planetary');
const { getGrowthStage } = require('../simulation/buildings');
const { getMonolithData } = require('../simulation/monolith');
const { getOvergrowthState } = require('../simulation/overgrowth');
const { getNodesForFrame } = require('../simulation/resource-nodes');
const { TICKS_PER_DAY } = require('../simulation/time');

// Build structured world state for the client to animate
function buildFrame(worldId, viewType = 'town') {
  if (viewType === 'map') return buildMapFrame(worldId);
  return buildTownFrame(worldId);
}

function buildTownFrame(worldId) {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  if (!world) return { frame_type: 'town', composed: '', status_bar: '' };

  const culture = getCulture(worldId);

  const buildings = db.prepare(
    "SELECT * FROM buildings WHERE world_id = ? AND status != 'destroyed' ORDER BY x"
  ).all(worldId);

  const villagers = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(worldId);

  const resources = db.prepare(
    'SELECT type, amount, capacity FROM resources WHERE world_id = ?'
  ).all(worldId);

  const recentEvents = db.prepare(
    'SELECT title, severity, type FROM events WHERE world_id = ? ORDER BY tick DESC LIMIT 5'
  ).all(worldId);

  const popAlive = villagers.filter((v) => v.status === 'alive').length;
  const buildingCap = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' AND level = 1 THEN 3 WHEN type = 'hut' AND level = 2 THEN 6 WHEN type = 'hut' AND level = 3 THEN 10 WHEN type = 'hut' AND level = 4 THEN 16 WHEN type = 'town_center' THEN 5 WHEN type = 'spawning_pools' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId).cap;

  // Ghost echoes: recently dead villagers (within last 36 ticks)
  const ghosts = db.prepare(
    "SELECT v.name, v.x, v.y, v.cultural_phrase, v.role, e.tick as death_tick FROM villagers v JOIN events e ON e.world_id = v.world_id AND e.type = 'death' AND e.title LIKE '%' || v.name || '%' WHERE v.world_id = ? AND v.status = 'dead' AND e.tick >= ? ORDER BY e.tick DESC LIMIT 5"
  ).all(worldId, world.current_tick - 36);

  // Get activities for each villager
  const activityRows = db.prepare('SELECT * FROM villager_activities WHERE world_id = ?').all(worldId);
  const activityMap = {};
  for (const a of activityRows) activityMap[a.villager_id] = a;

  // Get projects (cap at 3 — in-progress first, then newest complete)
  const projectsInProgress = db.prepare(
    "SELECT * FROM projects WHERE world_id = ? AND status = 'in_progress'"
  ).all(worldId);
  const projectsComplete = db.prepare(
    "SELECT * FROM projects WHERE world_id = ? AND status = 'complete' ORDER BY created_at DESC LIMIT ?"
  ).all(worldId, Math.max(0, 3 - projectsInProgress.length));
  const projects = projectsInProgress.concat(projectsComplete);

  // Get growing crops
  const crops = db.prepare(
    'SELECT c.id, c.farm_id, c.crop_type, c.growth_stage FROM crops c WHERE c.world_id = ? AND c.harvested = 0'
  ).all(worldId);

  // Get recent social events for sidebar
  const socialEvents = db.prepare(
    "SELECT title, severity, type FROM events WHERE world_id = ? AND type IN ('fight', 'project_complete', 'project_started', 'death') ORDER BY tick DESC LIMIT 8"
  ).all(worldId);

  // Shell relics — priests reference the dead
  const relicNames = db.prepare(
    'SELECT villager_name FROM shell_relics WHERE world_id = ? ORDER BY created_tick DESC LIMIT 5'
  ).all(worldId).map(r => r.villager_name);

  // Activities that happen indoors (villager not shown in the town view)
  const INDOOR_ACTIVITIES = new Set([
    'working', 'sleeping', 'meditating', 'praying', 'teaching',
  ]);
  // Roles that are typically indoors when not doing an outdoor activity
  const INDOOR_ROLES = new Set(['scholar', 'priest']);

  // Max visible villagers in the town view (prevents overcrowding)
  const MAX_OUTDOOR = 14;

  // Enrich villagers with unique appearance + activity-aware speech
  const enrichedVillagers = villagers.map((v) => {
    const appearance = villagerAppearance(v.name, v.trait, v.role);
    const activity = activityMap[v.id] || { activity: 'idle', target_id: null, duration_ticks: 0 };
    const speechPool = buildSpeechPool(v.role, culture, world.hero_title, activity.activity);
    // Add villager's personal imprinted phrase
    if (v.cultural_phrase) speechPool.push(v.cultural_phrase);
    // Priests reference the dead via shell relics
    if (v.role === 'priest' && relicNames.length > 0) {
      for (const name of relicNames) {
        speechPool.push(`${name}'s shell remembers`);
        speechPool.push(`we honor ${name}`);
      }
    }
    // Megastructure-aware speech — all villagers near these buildings talk about them
    for (const [megaType, lines] of Object.entries(MEGASTRUCTURE_SPEECH)) {
      if (hasMegastructure(worldId, megaType)) {
        speechPool.push(...lines);
      }
    }

    // Determine if this villager is indoors
    const indoor = INDOOR_ACTIVITIES.has(activity.activity) ||
      (INDOOR_ROLES.has(v.role) && activity.activity === 'idle');

    return {
      ...v,
      appearance,
      activity,
      indoor,
      speechPool,
      greetingPool: culture.custom_greetings.length > 0 ? culture.custom_greetings : null,
      sleepBubbles: SLEEP_BUBBLES,
    };
  });

  // Split into outdoor and indoor villagers
  const outdoorVillagers = enrichedVillagers.filter(v => !v.indoor);
  const indoorVillagers = enrichedVillagers.filter(v => v.indoor);

  // If too many outdoor, move excess to indoor (lowest-priority roles first)
  let visibleVillagers = outdoorVillagers;
  if (outdoorVillagers.length > MAX_OUTDOOR) {
    // Prioritize: warriors > scouts > builders > hunters > fishermen > farmers > idle
    const ROLE_PRIORITY = { warrior: 7, scout: 6, builder: 5, hunter: 4, fisherman: 3, farmer: 2, idle: 0 };
    // Also prioritize villagers doing interesting activities
    const ACTIVITY_PRIORITY = { fighting: 10, building_project: 8, celebrating: 6, making_art: 5, playing_music: 5, molting: 9, feasting: 4, arguing: 3, sparring: 7, socializing: 2, wandering: 1, chopping: 3, mining: 3, fishing: 3, hunting: 4 };
    outdoorVillagers.sort((a, b) => {
      const aP = (ACTIVITY_PRIORITY[a.activity.activity] || 0) + (ROLE_PRIORITY[a.role] || 1);
      const bP = (ACTIVITY_PRIORITY[b.activity.activity] || 0) + (ROLE_PRIORITY[b.role] || 1);
      return bP - aP;
    });
    visibleVillagers = outdoorVillagers.slice(0, MAX_OUTDOOR);
  }

  // Biome distribution (explored tiles only) — computed early for biome-variant sprites
  const biomeRows = db.prepare(
    "SELECT terrain, COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1 GROUP BY terrain"
  ).all(worldId);
  const totalExplored = biomeRows.reduce((s, r) => s + r.c, 0);
  const totalTiles = db.prepare("SELECT COUNT(*) as c FROM tiles WHERE world_id = ?").get(worldId).c;
  const biomeDistribution = {};
  let dominantBiome = 'plains';
  let maxCount = 0;
  for (const row of biomeRows) {
    biomeDistribution[row.terrain] = Math.round((row.c / Math.max(1, totalExplored)) * 100);
    if (row.c > maxCount) { maxCount = row.c; dominantBiome = row.terrain; }
  }

  // Enrich buildings with sprite data (status-appropriate, biome-variant for defenses, tier upgrades)
  const enrichedBuildings = buildings.map((b) => {
    let sprite;
    if (b.status === 'rubble') sprite = RUBBLE_SPRITE;
    else if (b.status === 'overgrown') sprite = OVERGROWN_SPRITE;
    // Tier sprites for L2+ (override biome variants — upgraded buildings look universal)
    else if (b.level >= 2 && BUILDING_TIER_SPRITES[b.type] && BUILDING_TIER_SPRITES[b.type][b.level]) {
      sprite = BUILDING_TIER_SPRITES[b.type][b.level];
    }
    // L1 biome variants
    else if (b.type === 'town_center' && BIOME_TOWN_CENTERS[dominantBiome]) sprite = BIOME_TOWN_CENTERS[dominantBiome];
    else if (b.type === 'wall' && BIOME_WALLS[dominantBiome]) sprite = BIOME_WALLS[dominantBiome];
    else if (b.type === 'watchtower' && BIOME_WATCHTOWERS[dominantBiome]) sprite = BIOME_WATCHTOWERS[dominantBiome];
    else if (b.type === 'barracks' && BIOME_BARRACKS[dominantBiome]) sprite = BIOME_BARRACKS[dominantBiome];
    else if (b.type === 'model_shrine') sprite = MODEL_SHRINES[world.model || 'pataclaw'] || MODEL_SHRINES.pataclaw;
    else sprite = BUILDING_SPRITES[b.type] || BUILDING_SPRITES.hut;
    return { ...b, sprite };
  });

  // Enrich projects with sprite data
  const enrichedProjects = projects.map((p) => {
    const spriteDef = PROJECT_SPRITES[p.type];
    const sprite = spriteDef
      ? (p.status === 'complete' ? spriteDef.complete : spriteDef.in_progress)
      : ['[?]'];
    return { ...p, sprite, contributors: JSON.parse(p.contributors || '[]') };
  });

  const resMap = {};
  for (const r of resources) resMap[r.type] = { amount: Math.floor(r.amount), capacity: r.capacity };

  // Growth stage
  const stageInfo = getGrowthStage(worldId);

  // Emergent culture descriptor string
  const moodDescriptors = [];
  moodDescriptors.push(culture.village_mood.toUpperCase());
  if (culture.creativity_level > 50) moodDescriptors.push('creative');
  if (culture.cooperation_level > 50) moodDescriptors.push('cooperative');
  if (culture.violence_level > 50) moodDescriptors.push('violent');
  if (culture.violence_level < 10 && culture.cooperation_level > 40) moodDescriptors.push('peaceful');

  return {
    frame_type: 'town',
    world: {
      name: world.name,
      day_number: world.day_number,
      town_age: Math.floor((world.current_tick || 0) / TICKS_PER_DAY) + 1,
      season: world.season,
      time_of_day: world.time_of_day,
      weather: world.weather,
      motto: world.motto,
      hero_title: world.hero_title,
      reputation: world.reputation,
      current_tick: world.current_tick,
      banner_symbol: world.banner_symbol,
      map_size: world.map_size || 40,
      seed: world.seed,
      town_number: world.town_number,
      model: world.model || 'pataclaw',
    },
    culture: {
      mood: culture.village_mood,
      violence: culture.violence_level,
      creativity: culture.creativity_level,
      cooperation: culture.cooperation_level,
      cultural_value_1: culture.cultural_value_1,
      cultural_value_2: culture.cultural_value_2,
      dominant_activities: culture.dominant_activities,
      descriptor: moodDescriptors.join(' | '),
      total_projects: culture.total_projects_completed,
      total_fights: culture.total_fights,
    },
    buildings: enrichedBuildings,
    villagers: visibleVillagers,
    indoors: enrichedVillagers.length - visibleVillagers.length,
    projects: enrichedProjects,
    crops,
    resourceNodes: getNodesForFrame(worldId),
    resources: resMap,
    population: { alive: popAlive, capacity: buildingCap },
    recentEvents,
    socialEvents,
    ghosts: ghosts.map(g => ({
      name: g.name,
      phrase: g.cultural_phrase || '...',
      ticksSinceDeath: world.current_tick - g.death_tick,
    })),
    relics: db.prepare(
      'SELECT villager_name, relic_type, culture_bonus FROM shell_relics WHERE world_id = ? ORDER BY created_tick DESC LIMIT 10'
    ).all(worldId),
    monolith: getMonolithData(worldId),
    megastructures: ['shell_archive', 'abyssal_beacon', 'molt_cathedral', 'spawning_pools']
      .filter(t => hasMegastructure(worldId, t)),
    biome: {
      dominant: dominantBiome,
      seed_dominant: (() => {
        const weights = deriveBiomeWeights(world.seed);
        let best = 'plains', maxW = 0;
        for (const [b, w] of Object.entries(weights)) {
          if (w > maxW) { maxW = w; best = b; }
        }
        return best;
      })(),
      distribution: biomeDistribution,
      explored_pct: totalTiles > 0 ? Math.round((totalExplored / totalTiles) * 100) : 0,
    },
    growth_stage: stageInfo.stage,
    planetaryEvent: getActivePlanetaryEvent(),
    moltFestival: db.prepare(
      "SELECT 1 FROM events WHERE world_id = ? AND type = 'festival' AND tick >= ? LIMIT 1"
    ).get(worldId, world.current_tick - 3) != null,
    overgrowth: (() => {
      const og = getOvergrowthState(worldId);
      return og.level > 0 ? og : null;
    })(),
    nomad_camps: db.prepare(
      "SELECT name, x, y FROM villagers WHERE world_id = ? AND status = 'nomad'"
    ).all(worldId),
    wildlife: (() => { try { return db.prepare(
      "SELECT species, rarity, terrain, x, y FROM wildlife WHERE world_id = ? AND status = 'wild' ORDER BY spawned_tick DESC LIMIT 15"
    ).all(worldId); } catch { return []; } })(),
    items: (() => { try { return db.prepare(
      `SELECT item_type, rarity, name, source, properties, status,
       COUNT(*) as count, MIN(created_tick) as first_tick
       FROM items WHERE world_id = ?
       GROUP BY item_type
       ORDER BY CASE rarity
         WHEN 'legendary' THEN 0 WHEN 'epic' THEN 1
         WHEN 'rare' THEN 2 WHEN 'uncommon' THEN 3 ELSE 4 END`
    ).all(worldId); } catch { return []; } })(),
    timestamp: Date.now(),
  };
}

function buildMapFrame(worldId) {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  if (!world) return { frame_type: 'map', composed: '', status_bar: '' };

  const mapSize = world.map_size || MAP_SIZE;
  const tiles = db.prepare('SELECT x, y, terrain, explored, feature FROM tiles WHERE world_id = ?').all(worldId);
  const buildings = db.prepare("SELECT x, y, type FROM buildings WHERE world_id = ? AND status != 'destroyed'").all(worldId);
  const villagers = db.prepare("SELECT x, y FROM villagers WHERE world_id = ? AND status = 'alive'").all(worldId);

  const grid = [];
  for (let y = 0; y < mapSize; y++) {
    grid[y] = new Array(mapSize).fill(' ');
  }

  for (const t of tiles) {
    if (t.y >= mapSize || t.x >= mapSize) continue;
    if (!t.explored) {
      grid[t.y][t.x] = TERRAIN_CHARS.fog;
    } else if (t.feature && FEATURE_CHARS[t.feature]) {
      grid[t.y][t.x] = FEATURE_CHARS[t.feature];
    } else {
      grid[t.y][t.x] = TERRAIN_CHARS[t.terrain] || '.';
    }
  }

  for (const b of buildings) {
    if (b.y >= 0 && b.y < mapSize && b.x >= 0 && b.x < mapSize) {
      grid[b.y][b.x] = b.type === 'town_center' ? '\u2588' : '\u25a0';
    }
  }

  for (const v of villagers) {
    if (v.y >= 0 && v.y < mapSize && v.x >= 0 && v.x < mapSize) {
      grid[v.y][v.x] = '\u263a';
    }
  }

  const composed = grid.map((row) => row.join('')).join('\n');

  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = Math.floor(r.amount);
  const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;

  return {
    frame_type: 'map',
    composed,
    status_bar: `Day ${Math.floor((world.current_tick || 0) / TICKS_PER_DAY) + 1} | ${world.season} | ${world.weather} | Pop: ${popAlive} | Food: ${resMap.food || 0} | Wood: ${resMap.wood || 0} | Stone: ${resMap.stone || 0}`,
    timestamp: Date.now(),
  };
}

module.exports = { buildFrame, buildTownFrame };
