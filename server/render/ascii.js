const db = require('../db/connection');
const { villagerAppearance, SPEECH, SLEEP_BUBBLES, BUILDING_SPRITES, PROJECT_SPRITES, TERRAIN_CHARS, FEATURE_CHARS, RUBBLE_SPRITE, OVERGROWN_SPRITE, MEGASTRUCTURE_SPEECH, NOMAD_CAMP_SPRITE } = require('./sprites');
const { hasMegastructure } = require('../simulation/megastructures');
const { MAP_SIZE } = require('../world/map');
const { getCulture, buildSpeechPool } = require('../simulation/culture');
const { getActivePlanetaryEvent } = require('../simulation/planetary');
const { getGrowthStage } = require('../simulation/buildings');
const { getMonolithData } = require('../simulation/monolith');
const { getOvergrowthState } = require('../simulation/overgrowth');

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
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 WHEN type = 'spawning_pools' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId).cap;

  // Ghost echoes: recently dead villagers (within last 36 ticks)
  const ghosts = db.prepare(
    "SELECT v.name, v.x, v.y, v.cultural_phrase, v.role, e.tick as death_tick FROM villagers v JOIN events e ON e.world_id = v.world_id AND e.type = 'death' AND e.title LIKE '%' || v.name || '%' WHERE v.world_id = ? AND v.status = 'dead' AND e.tick >= ? ORDER BY e.tick DESC LIMIT 5"
  ).all(worldId, world.current_tick - 36);

  // Get activities for each villager
  const activityRows = db.prepare('SELECT * FROM villager_activities WHERE world_id = ?').all(worldId);
  const activityMap = {};
  for (const a of activityRows) activityMap[a.villager_id] = a;

  // Get projects
  const projects = db.prepare(
    "SELECT * FROM projects WHERE world_id = ? AND status IN ('in_progress', 'complete') ORDER BY x"
  ).all(worldId);

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

    return {
      ...v,
      appearance,
      activity,
      speechPool,
      greetingPool: culture.custom_greetings.length > 0 ? culture.custom_greetings : null,
      sleepBubbles: SLEEP_BUBBLES,
    };
  });

  // Enrich buildings with sprite data (status-appropriate)
  const enrichedBuildings = buildings.map((b) => {
    let sprite;
    if (b.status === 'rubble') sprite = RUBBLE_SPRITE;
    else if (b.status === 'overgrown') sprite = OVERGROWN_SPRITE;
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

  // Biome distribution (explored tiles only)
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
    villagers: enrichedVillagers,
    projects: enrichedProjects,
    crops,
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
    status_bar: `Day ${world.day_number} | ${world.season} | ${world.weather} | Pop: ${popAlive} | Food: ${resMap.food || 0} | Wood: ${resMap.wood || 0} | Stone: ${resMap.stone || 0}`,
    timestamp: Date.now(),
  };
}

module.exports = { buildFrame };
