const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { advanceTime } = require('./time');
const { rollWeather } = require('./weather');
const { processResources } = require('./resources');
const { processBuildings, processMaintenance, autoBuilding, getGrowthStage } = require('./buildings');
const { processVillagers } = require('./villagers');
const { processExploration } = require('./exploration');
const { rollRandomEvents } = require('./events');
const { processRaids } = require('./combat');
const { processCrops } = require('./crops');
const { recalculateCulture } = require('./culture');
const { processVillagerLife } = require('./village-life');
const { expandMap, mulberry32 } = require('../world/map');
const { FEATURES_TO_PLACE } = require('../world/templates');
const { getActivePlanetaryEvent } = require('./planetary');
const { recalculateStats } = require('./stats');
const { processChronicler } = require('./chronicler');
const { processMonolith } = require('./monolith');
const { processMolting, forceAllMolting } = require('./molting');
const { processProphets, processProphecies } = require('./prophets');
const { processDeepSea } = require('./deep-sea');
const { processWildlife } = require('./wildlife');
const { processHunting } = require('./hunting');
const { hasMegastructure, processMegastructureResources } = require('./megastructures');
const { processResourceNodes } = require('./resource-nodes');
const { processGovernor } = require('./governor');
const {
  MOLT_FESTIVAL_INTERVAL,
  MOLT_FESTIVAL_CULTURE_THRESHOLD,
  MOLT_FESTIVAL_MORALE_BOOST,
  MOLT_FESTIVAL_SCAFFOLD_BONUS,
} = require('./constants');

function processTick(worldId, globalTime) {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  if (!world || world.status !== 'active') return null;

  // 1. Advance time — use global time if provided, else compute per-world (for catchup)
  let time;
  if (globalTime) {
    // Use global planet state but still increment world's own tick counter
    time = {
      tick: world.current_tick + 1,
      time_of_day: globalTime.time_of_day,
      day_number: globalTime.day_number,
      season: globalTime.season,
    };
  } else {
    time = advanceTime(world);
  }

  // 1.5. Planetary events (global effects)
  const planetaryEvent = getActivePlanetaryEvent();
  // If event has biome restriction, check world's dominant biome
  let pEffects = {};
  if (planetaryEvent) {
    const rawEffects = planetaryEvent.effects;
    if (rawEffects.biomes) {
      const domRow = db.prepare("SELECT terrain, COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1 GROUP BY terrain ORDER BY c DESC LIMIT 1").get(worldId);
      const domBiome = domRow ? domRow.terrain : 'plains';
      pEffects = rawEffects.biomes.includes(domBiome) ? rawEffects : {};
    } else {
      pEffects = rawEffects;
    }
  }

  // 2. Weather — use global weather if provided, else roll per-world (for catchup)
  const weather = globalTime ? globalTime.weather : rollWeather(world.weather, time.season);

  // 3. Resources (pass planetary modifiers)
  const resResult = processResources(worldId, weather, time.season, pEffects);

  // 3.1. Megastructure unique resource production
  const megaResEvents = processMegastructureResources(worldId);

  // 3.2. Resource node depletion + respawn (trees, rocks, fish spots)
  const nodeEvents = processResourceNodes(worldId, time.tick);

  // 3.25. Planetary effects: stone bonus, building damage, morale
  let planetaryEvents = [];
  if (planetaryEvent) {
    if (pEffects.stoneBonus) {
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'stone'").run(pEffects.stoneBonus, worldId);
    }
    if (pEffects.moraleDelta) {
      // Molt Cathedral shields from negative morale during molt_season
      let applyMorale = true;
      if (pEffects.moraleDelta < 0 && pEffects.moltAll && hasMegastructure(worldId, 'molt_cathedral')) {
        applyMorale = false;
        planetaryEvents.push({
          type: 'planetary',
          title: 'Cathedral shields the village!',
          description: 'The Molt Cathedral protects the village from molt season despair.',
          severity: 'info',
        });
      }
      if (applyMorale) {
        if (pEffects.moraleDelta > 0) {
          db.prepare("UPDATE villagers SET morale = MIN(100, morale + ?) WHERE world_id = ? AND status = 'alive'").run(pEffects.moraleDelta, worldId);
        } else {
          db.prepare("UPDATE villagers SET morale = MAX(0, morale + ?) WHERE world_id = ? AND status = 'alive'").run(pEffects.moraleDelta, worldId);
        }
      }
    }
    if (pEffects.buildingDamageChance && Math.random() < pEffects.buildingDamageChance) {
      const target = db.prepare("SELECT id, type, hp FROM buildings WHERE world_id = ? AND status = 'active' AND type != 'town_center' ORDER BY RANDOM() LIMIT 1").get(worldId);
      if (target) {
        db.prepare('UPDATE buildings SET hp = MAX(0, hp - ?) WHERE id = ?').run(pEffects.buildingDamage || 10, target.id);
        planetaryEvents.push({
          type: 'planetary',
          title: `Meteor strikes ${target.type}!`,
          description: `A meteorite fragment hit the ${target.type}, dealing ${pEffects.buildingDamage || 10} damage.`,
          severity: 'warning',
        });
      }
    }
    if (pEffects.warriorXpMul) {
      db.prepare("UPDATE villagers SET experience = experience + ? WHERE world_id = ? AND role = 'warrior' AND status = 'alive'").run(Math.floor(2 * pEffects.warriorXpMul), worldId);
    }
    if (pEffects.moltAll) {
      forceAllMolting(worldId);
    }
  }

  // 3.5. Crops
  const cropEvents = processCrops(worldId, time.season, time.tick);

  // 4. Buildings
  const buildingEvents = processBuildings(worldId);

  // 4.5. Building maintenance & decay
  const maintenanceEvents = processMaintenance(worldId, time.tick);

  // 4.6. Auto-build survival infrastructure (farm rebuild, hut growth)
  const autoBuildEvents = autoBuilding(worldId, time.tick);

  // 5. Villagers
  const villagerEvents = processVillagers(worldId, resResult.isStarving, weather);

  // 5.5. Molting
  const moltEvents = processMolting(worldId, time.tick);

  // 6. Exploration
  const exploreEvents = processExploration(worldId);

  // 6.5. Deep-sea exploration
  const deepSeaEvents = processDeepSea(worldId, time.tick);

  // 6.6. Wildlife spawning
  const wildlifeEvents = processWildlife(worldId, time.tick);

  // 6.7. Hunting
  const huntingEvents = processHunting(worldId, time.tick);

  // 7. Random events
  const randomEvents = rollRandomEvents(worldId, time.tick);

  // 8. Combat (process any raid events)
  const raidTriggers = randomEvents.filter((e) => e.type === 'raid');
  const combatEvents = processRaids(worldId, raidTriggers);

  // 8.5. Autonomous governor — world makes its own decisions
  const governorEvents = processGovernor(worldId, time.tick);

  // 9. Village life (relationships, activities, interactions, projects, violence)
  const lifeEvents = processVillagerLife(worldId);

  // 9.5. Chronicler — write book entries based on events
  const allEventsForChronicler = [...cropEvents, ...buildingEvents, ...maintenanceEvents, ...autoBuildEvents, ...villagerEvents, ...moltEvents, ...exploreEvents, ...deepSeaEvents, ...wildlifeEvents, ...huntingEvents, ...randomEvents, ...combatEvents, ...governorEvents, ...lifeEvents];
  const chroniclerEvents = processChronicler(worldId, time.tick, allEventsForChronicler);

  // 9.6. Monolith — Spire of Shells
  const monolithEvents = processMonolith(worldId, time.tick);

  // 9.7. Prophets — discover teachings of the 64
  const prophetEvents = processProphets(worldId, time.tick);

  // 9.8. Prophecies — priests receive visions
  const prophecyEvents = processProphecies(worldId, time.tick);

  // 10. Map expansion check — stage-based incremental expansion
  let expansionEvents = [];
  const stageInfo = getGrowthStage(worldId);
  const currentMapSize = world.map_size || 40;
  if (stageInfo.mapSize > currentMapSize) {
    expansionEvents = expandWorld(worldId, world, stageInfo.mapSize);
  }

  // 11. Recalculate culture + stats every 36 ticks (once per in-game day)
  if (time.tick % 36 === 0) {
    recalculateCulture(worldId);
    recalculateStats(worldId);
  }

  // 11.5. Molt Festival — every 360 ticks when culture is strong
  let festivalEvents = [];
  if (time.tick % MOLT_FESTIVAL_INTERVAL === 0 && time.tick > 0) {
    const culture = db.prepare('SELECT * FROM culture WHERE world_id = ?').get(worldId);
    if (culture) {
      const cultureSum = (culture.violence_level || 0) + (culture.creativity_level || 0) + (culture.cooperation_level || 0);
      if (cultureSum >= MOLT_FESTIVAL_CULTURE_THRESHOLD) {
        // Morale boost to all villagers
        db.prepare(
          "UPDATE villagers SET morale = MIN(100, morale + ?) WHERE world_id = ? AND status = 'alive'"
        ).run(MOLT_FESTIVAL_MORALE_BOOST, worldId);
        // Free monolith scaffolding progress
        db.prepare(
          "UPDATE monoliths SET scaffolding_progress = MIN(?, scaffolding_progress + ?) WHERE world_id = ? AND status = 'building_scaffold'"
        ).run(100, MOLT_FESTIVAL_SCAFFOLD_BONUS, worldId);
        // Set all alive villagers to celebrating
        db.prepare(
          "UPDATE villager_activities SET activity = 'celebrating', duration_ticks = 3 WHERE world_id = ?"
        ).run(worldId);
        // Add celebration memories
        const alive = db.prepare("SELECT id FROM villagers WHERE world_id = ? AND status = 'alive'").all(worldId);
        const insertMem = db.prepare(
          'INSERT INTO villager_memories (world_id, villager_id, memory_type, tick, detail) VALUES (?, ?, ?, ?, ?)'
        );
        for (const v of alive) {
          insertMem.run(worldId, v.id, 'celebrated', time.tick, 'Molt Festival');
        }
        festivalEvents.push({
          type: 'festival',
          title: 'The Molt Festival!',
          description: `The village celebrates the sacred shedding! All villagers gather to honor growth and change. +${MOLT_FESTIVAL_MORALE_BOOST} morale. "We shed, we grow, we remember!"`,
          severity: 'celebration',
        });
      }
    }
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
  const allEvents = [...planetaryEvents, ...megaResEvents, ...nodeEvents, ...cropEvents, ...buildingEvents, ...maintenanceEvents, ...autoBuildEvents, ...villagerEvents, ...moltEvents, ...exploreEvents, ...deepSeaEvents, ...wildlifeEvents, ...huntingEvents, ...randomEvents, ...combatEvents, ...governorEvents, ...lifeEvents, ...chroniclerEvents, ...monolithEvents, ...prophetEvents, ...prophecyEvents, ...expansionEvents, ...seasonEvents, ...festivalEvents];
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

// Expand the world map to a target size and place features on new tiles
function expandWorld(worldId, world, targetSize) {
  const oldSize = world.map_size || 40;
  const newSize = targetSize || oldSize * 2;

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
    description: `Your thriving population has revealed new territory. The map has expanded to ${newSize}x${newSize}!`,
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
