const db = require('../db/connection');
const { villagerAppearance, SPEECH, SLEEP_BUBBLES, BUILDING_SPRITES, PROJECT_SPRITES, TERRAIN_CHARS, FEATURE_CHARS } = require('./sprites');
const { MAP_SIZE } = require('../world/map');
const { getCulture, buildSpeechPool } = require('../simulation/culture');

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
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId).cap;

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

  // Enrich villagers with unique appearance + activity-aware speech
  const enrichedVillagers = villagers.map((v) => {
    const appearance = villagerAppearance(v.name, v.trait, v.role);
    const activity = activityMap[v.id] || { activity: 'idle', target_id: null, duration_ticks: 0 };
    const speechPool = buildSpeechPool(v.role, culture, world.hero_title, activity.activity);
    // Add villager's personal imprinted phrase
    if (v.cultural_phrase) speechPool.push(v.cultural_phrase);

    return {
      ...v,
      appearance,
      activity,
      speechPool,
      greetingPool: culture.custom_greetings.length > 0 ? culture.custom_greetings : null,
      sleepBubbles: SLEEP_BUBBLES,
    };
  });

  // Enrich buildings with sprite data
  const enrichedBuildings = buildings.map((b) => ({
    ...b,
    sprite: BUILDING_SPRITES[b.type] || BUILDING_SPRITES.hut,
  }));

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
