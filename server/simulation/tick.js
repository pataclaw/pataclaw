const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { advanceTime } = require('./time');
const { rollWeather } = require('./weather');
const { processResources } = require('./resources');
const { processBuildings } = require('./buildings');
const { processVillagers } = require('./villagers');
const { processExploration } = require('./exploration');
const { rollRandomEvents } = require('./events');
const { processRaids } = require('./combat');
const { processCrops } = require('./crops');
const { recalculateCulture } = require('./culture');
const { processVillagerLife } = require('./village-life');
const { expandMap, mulberry32 } = require('../world/map');
const { FEATURES_TO_PLACE } = require('../world/templates');

function processTick(worldId) {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  if (!world || world.status !== 'active') return null;

  // 1. Advance time
  const time = advanceTime(world);

  // 2. Weather
  const weather = rollWeather(world.weather, time.season);

  // 3. Resources
  const resResult = processResources(worldId, weather, time.season);

  // 3.5. Crops
  const cropEvents = processCrops(worldId, time.season, time.tick);

  // 4. Buildings
  const buildingEvents = processBuildings(worldId);

  // 5. Villagers
  const villagerEvents = processVillagers(worldId, resResult.isStarving, weather);

  // 6. Exploration
  const exploreEvents = processExploration(worldId);

  // 7. Random events
  const randomEvents = rollRandomEvents(worldId, time.tick);

  // 8. Combat (process any raid events)
  const raidTriggers = randomEvents.filter((e) => e.type === 'raid');
  const combatEvents = processRaids(worldId, raidTriggers);

  // 9. Village life (relationships, activities, interactions, projects, violence)
  const lifeEvents = processVillagerLife(worldId);

  // 10. Map expansion check — double map when population reaches 5
  let expansionEvents = [];
  const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
  if (popAlive >= 5 && (world.map_size || 40) < 80) {
    expansionEvents = expandWorld(worldId, world);
  }

  // 11. Recalculate culture every 36 ticks (once per in-game day)
  if (time.tick % 36 === 0) {
    recalculateCulture(worldId);
  }

  // 10b. Season change events
  let seasonEvents = [];
  if (time.season !== world.season) {
    seasonEvents = generateSeasonEvent(worldId, time.season, world.season);
  }

  // Update world state
  db.prepare(`
    UPDATE worlds
    SET current_tick = ?, time_of_day = ?, day_number = ?, season = ?,
        weather = ?, last_tick_at = datetime('now')
    WHERE id = ?
  `).run(time.tick, time.time_of_day, time.day_number, time.season, weather, worldId);

  // Store all events
  const allEvents = [...cropEvents, ...buildingEvents, ...villagerEvents, ...exploreEvents, ...randomEvents, ...combatEvents, ...lifeEvents, ...expansionEvents, ...seasonEvents];
  const insertEvent = db.prepare(`
    INSERT INTO events (id, world_id, tick, type, title, description, severity, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const evt of allEvents) {
    insertEvent.run(uuid(), worldId, time.tick, evt.type, evt.title, evt.description, evt.severity, evt.data || null);
  }

  return {
    tick: time.tick,
    time_of_day: time.time_of_day,
    day_number: time.day_number,
    season: time.season,
    weather,
    events: allEvents,
  };
}

// Batch catch-up: simplified processing for missed ticks
function processCatchup(worldId, missedTicks) {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  if (!world) return;

  const summary = { food: 0, wood: 0, stone: 0, births: 0, deaths: 0, eventsCount: 0 };

  for (let i = 0; i < missedTicks; i++) {
    const result = processTick(worldId);
    if (result) {
      summary.eventsCount += result.events.length;
      for (const e of result.events) {
        if (e.type === 'birth') summary.births++;
        if (e.type === 'death') summary.deaths++;
      }
    }
  }

  return summary;
}

// Expand the world map (double size) and place features on new tiles
function expandWorld(worldId, world) {
  const oldSize = world.map_size || 40;
  const newSize = oldSize * 2;

  const newTiles = expandMap(worldId, world.seed, oldSize, newSize);
  if (newTiles.length === 0) return [];

  const insertTile = db.prepare(`
    INSERT OR IGNORE INTO tiles (world_id, x, y, terrain, elevation, explored, feature, feature_depleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBatch = db.transaction((tiles) => {
    for (const t of tiles) {
      insertTile.run(worldId, t.x, t.y, t.terrain, t.elevation, t.explored, t.feature, t.feature_depleted);
    }
  });
  insertBatch(newTiles);

  // Place features on the new tiles
  const rng = mulberry32(world.seed * 13 + 77);
  const updateTile = db.prepare('UPDATE tiles SET feature = ? WHERE world_id = ? AND x = ? AND y = ?');
  const newCenter = Math.floor(newSize / 2);
  for (const spec of FEATURES_TO_PLACE) {
    const candidates = newTiles.filter((t) => {
      const dist = Math.sqrt((t.x - newCenter) ** 2 + (t.y - newCenter) ** 2);
      if (spec.nearCenter && dist > (spec.maxDist || 10) * 2) return false;
      if (spec.minDist && dist < spec.minDist) return false;
      if (spec.terrains && !spec.terrains.includes(t.terrain)) return false;
      if (t.terrain === 'water') return false;
      return true;
    });
    // Shuffle
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = Math.ceil(spec.count * 1.5); // more features for bigger map
    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      updateTile.run(spec.type, worldId, candidates[i].x, candidates[i].y);
    }
  }

  // Update world map_size
  db.prepare('UPDATE worlds SET map_size = ? WHERE id = ?').run(newSize, worldId);

  return [{
    type: 'expansion',
    title: 'The world grows!',
    description: `Your thriving population has revealed a vast new territory. The map has doubled to ${newSize}x${newSize}!`,
    severity: 'celebration',
  }];
}

// Season change effects + events
function generateSeasonEvent(worldId, newSeason, oldSeason) {
  const events = [];

  if (newSeason === 'spring') {
    // Spring bloom: +10 food, morale boost
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 10) WHERE world_id = ? AND type = 'food'").run(worldId);
    db.prepare("UPDATE villagers SET morale = MIN(100, morale + 5) WHERE world_id = ? AND status = 'alive'").run(worldId);
    events.push({
      type: 'season',
      title: 'Spring has arrived!',
      description: 'The snow melts and flowers bloom. Crops grow faster, spirits rise. +10 food, +5 morale to all.',
      severity: 'celebration',
    });
  } else if (newSeason === 'summer') {
    // Summer: morale boost, heat warning
    db.prepare("UPDATE villagers SET morale = MIN(100, morale + 3) WHERE world_id = ? AND status = 'alive'").run(worldId);
    events.push({
      type: 'season',
      title: 'Summer begins!',
      description: 'Long warm days ahead. Farms will peak but beware the scorching heat. +3 morale.',
      severity: 'info',
    });
  } else if (newSeason === 'autumn') {
    // Harvest festival: big food bonus if farms exist
    const farmCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'farm' AND status = 'active'").get(worldId).c;
    const harvestBonus = farmCount * 8;
    if (harvestBonus > 0) {
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'food'").run(harvestBonus, worldId);
    }
    db.prepare("UPDATE villagers SET morale = MIN(100, morale + 8) WHERE world_id = ? AND status = 'alive'").run(worldId);
    events.push({
      type: 'season',
      title: 'Harvest Festival!',
      description: `Autumn brings the harvest. The village celebrates!${harvestBonus > 0 ? ` ${farmCount} farm(s) yielded +${harvestBonus} bonus food.` : ''} +8 morale to all. Fishermen thrive this season.`,
      severity: 'celebration',
    });
  } else if (newSeason === 'winter') {
    // Winter: morale hit, frost damage to farms
    db.prepare("UPDATE villagers SET morale = MAX(0, morale - 5) WHERE world_id = ? AND status = 'alive'").run(worldId);
    const farms = db.prepare("SELECT id, hp FROM buildings WHERE world_id = ? AND type = 'farm' AND status = 'active'").all(worldId);
    for (const f of farms) {
      db.prepare('UPDATE buildings SET hp = MAX(1, hp - 10) WHERE id = ?').run(f.id);
    }
    events.push({
      type: 'season',
      title: 'Winter descends!',
      description: `Cold winds sweep the land. Food production drops sharply. ${farms.length > 0 ? `${farms.length} farm(s) took frost damage (-10 HP each).` : ''} -5 morale. Stock up on food and build docks for fishing!`,
      severity: 'warning',
    });
  }

  return events;
}

module.exports = { processTick, processCatchup };
