const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { advanceTime, TICKS_PER_DAY } = require('./time');
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
    // Use global planet state for season/time, but day_number is per-world age
    const newTick = world.current_tick + 1;
    time = {
      tick: newTick,
      time_of_day: globalTime.time_of_day,
      day_number: Math.floor(newTick / TICKS_PER_DAY) + 1,
      season: globalTime.season,
    };
  } else {
    time = advanceTime(world);
  }

  // 1.5. Determine dominant biome (used for weather, planetary effects, season events)
  const domRow = db.prepare("SELECT terrain, COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1 GROUP BY terrain ORDER BY c DESC LIMIT 1").get(worldId);
  const domBiome = domRow ? domRow.terrain : 'plains';

  // 1.6. Planetary events (global effects)
  const planetaryEvent = getActivePlanetaryEvent();
  let pEffects = {};
  if (planetaryEvent) {
    const rawEffects = planetaryEvent.effects;
    if (rawEffects.biomes) {
      pEffects = rawEffects.biomes.includes(domBiome) ? rawEffects : {};
    } else {
      pEffects = rawEffects;
    }
  }

  // 2. Weather — per-world, biome-modulated (each world gets weather matching its biome)
  const weather = rollWeather(world.weather, time.season, domBiome);

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
      const target = db.prepare("SELECT id, type, hp FROM buildings WHERE world_id = ? AND status = 'active' AND type NOT IN ('town_center', 'farm') ORDER BY RANDOM() LIMIT 1").get(worldId);
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

  // 10b. Season change events (biome-flavored)
  let seasonEvents = [];
  if (time.season !== world.season) {
    seasonEvents = generateSeasonEvent(worldId, time.season, world.season, domBiome);
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

// ─── BIOME-FLAVORED SEASON EVENTS ───
// Each biome experiences seasons differently. Ice worlds barely thaw in summer.
// Desert worlds barely freeze in winter. The planet is one, but the land remembers.

const SEASON_FLAVOR = {
  spring: {
    ice:      { food: 5,  morale: 3,  title: 'The Thaw Begins',        desc: 'Meltwater pools form between the ice sheets. Lichen creeps across exposed rock. A brief reprieve.' },
    tundra:   { food: 5,  morale: 3,  title: 'Permafrost Softens',     desc: 'The frozen ground yields slightly. Hardy moss pushes through cracks. The wind carries a hint of warmth.' },
    mountain: { food: 8,  morale: 4,  title: 'Mountain Streams Swell',  desc: 'Snowmelt cascades down the peaks. Alpine flowers push through rocky soil. The passes begin to clear.' },
    desert:   { food: 6,  morale: 5,  title: 'Desert Bloom!',           desc: 'Brief rains coax dormant seeds to life. The dunes are spotted with color for a fleeting moment.' },
    swamp:    { food: 12, morale: 3,  title: 'The Bog Awakens',         desc: 'The marsh thaws and teems with life. Insects swarm, fish spawn in the murk. Everything is alive and hungry.' },
    water:    { food: 10, morale: 5,  title: 'Currents Warm',           desc: 'The sea warms and teems with life. Schools of fish return to the shallows. Fishing season begins.' },
    default:  { food: 10, morale: 5,  title: 'Spring has arrived!',     desc: 'The snow melts and flowers bloom. Crops grow faster, spirits rise.' },
  },
  summer: {
    ice:      { food: 3,  morale: 5,  title: 'The Brief Polar Summer',  desc: 'Ice pools glimmer in perpetual twilight. Lichen grows on exposed rock. The villagers savor the rare warmth.' },
    tundra:   { food: 5,  morale: 4,  title: 'Midnight Sun',            desc: 'The sun barely sets. Hardy grasses green the tundra. Mosquitoes cloud the air but spirits are high.' },
    mountain: { food: 5,  morale: 5,  title: 'Alpine Meadows Bloom',    desc: 'Clear days reveal distant peaks. Wildflowers carpet the slopes above the treeline.' },
    desert:   { food: -5, morale: -2, title: 'The Scorching',           desc: 'The sun is merciless. Sand burns through shells. Only the hardiest venture out during the day.' },
    swamp:    { food: 0,  morale: -2, title: 'The Festering',           desc: 'The bog festers in the heat. Thick mists and biting flies plague the village. Everything rots faster.' },
    water:    { food: 5,  morale: 5,  title: 'Calm Seas',               desc: 'Calm waters and long days. Perfect weather for fishing and coastal exploration.' },
    default:  { food: 0,  morale: 3,  title: 'Summer begins!',          desc: 'Long warm days ahead. Farms will peak but beware the scorching heat.' },
  },
  autumn: {
    ice:      { food: 3,  morale: 2,  harvestMul: 0.5, title: 'First Frost Returns', desc: 'The brief warmth fades. Ice reclaims the pools. The villagers rush to store what little they gathered.' },
    tundra:   { food: 4,  morale: 3,  harvestMul: 0.6, title: 'The Darkening',       desc: 'Days shorten rapidly. First snows dust the tundra. Stock up now — the long dark approaches.' },
    mountain: { food: 6,  morale: 5,  harvestMul: 0.8, title: 'Mountain Fog Rolls In', desc: 'Mist clings to the valleys. The last herbs are gathered before snowfall seals the passes.' },
    desert:   { food: 5,  morale: 8,  harvestMul: 0.7, title: 'Cooler Nights Return', desc: 'The desert breathes easier. Cool winds sweep the dunes at dusk. A time of relief and gratitude.' },
    swamp:    { food: 8,  morale: 6,  harvestMul: 1.0, title: 'Mushroom Season',      desc: 'Fog clings to the wetlands. Mushrooms and tubers are abundant in the damp earth.' },
    water:    { food: 8,  morale: 6,  harvestMul: 1.2, title: 'Storm Fishing',        desc: 'Autumn storms churn rich waters. The fishing is dangerous but bountiful.' },
    default:  { food: 0,  morale: 8,  harvestMul: 1.0, title: 'Harvest Festival!',    desc: 'Autumn brings the harvest. The village celebrates!' },
  },
  winter: {
    ice:      { morale: -8, farmDmg: 15, title: 'The Long Dark',        desc: 'Blizzards rage for days without end. The sun vanishes below the horizon. Survival is everything.' },
    tundra:   { morale: -7, farmDmg: 12, title: 'Polar Night',          desc: 'Darkness descends. The wind howls across frozen wastes. Only the walls keep the cold at bay.' },
    mountain: { morale: -6, farmDmg: 12, title: 'Snowed In',            desc: 'Heavy snow blankets the peaks. Passes close. The village is isolated until the thaw.' },
    desert:   { morale: -2, farmDmg: 3,  title: 'Cold Desert Nights',   desc: 'Days remain clear but nights bite with cold. Frost dusts the dunes at dawn, gone by noon.' },
    swamp:    { morale: -4, farmDmg: 8,  title: 'The Frozen Bog',       desc: 'The marsh freezes over. An eerie silence settles. Strange shapes are locked beneath the ice.' },
    water:    { morale: -5, farmDmg: 10, title: 'Storm Season',         desc: 'Huge waves batter the coast. Fishing becomes treacherous. The sea takes more than it gives.' },
    default:  { morale: -5, farmDmg: 10, title: 'Winter descends!',     desc: 'Cold winds sweep the land. Food production drops sharply.' },
  },
};

function generateSeasonEvent(worldId, newSeason, oldSeason, biome) {
  const events = [];
  const flavorTable = SEASON_FLAVOR[newSeason];
  if (!flavorTable) return events;
  const f = flavorTable[biome] || flavorTable.default;

  if (newSeason === 'spring') {
    if (f.food > 0) db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'food'").run(f.food, worldId);
    if (f.morale > 0) db.prepare("UPDATE villagers SET morale = MIN(100, morale + ?) WHERE world_id = ? AND status = 'alive'").run(f.morale, worldId);
    events.push({
      type: 'season', title: f.title,
      description: `${f.desc} +${f.food} food, +${f.morale} morale.`,
      severity: 'celebration',
    });
  } else if (newSeason === 'summer') {
    if (f.food > 0) {
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'food'").run(f.food, worldId);
    } else if (f.food < 0) {
      db.prepare("UPDATE resources SET amount = MAX(0, amount + ?) WHERE world_id = ? AND type = 'food'").run(f.food, worldId);
    }
    if (f.morale > 0) {
      db.prepare("UPDATE villagers SET morale = MIN(100, morale + ?) WHERE world_id = ? AND status = 'alive'").run(f.morale, worldId);
    } else if (f.morale < 0) {
      db.prepare("UPDATE villagers SET morale = MAX(0, morale + ?) WHERE world_id = ? AND status = 'alive'").run(f.morale, worldId);
    }
    const parts = [f.desc];
    if (f.food !== 0) parts.push(`${f.food > 0 ? '+' : ''}${f.food} food.`);
    if (f.morale !== 0) parts.push(`${f.morale > 0 ? '+' : ''}${f.morale} morale.`);
    events.push({
      type: 'season', title: f.title,
      description: parts.join(' '),
      severity: f.morale < 0 ? 'warning' : 'info',
    });
  } else if (newSeason === 'autumn') {
    const farmCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'farm' AND status = 'active'").get(worldId).c;
    const harvestMul = f.harvestMul || 1.0;
    const harvestBonus = Math.floor(farmCount * 8 * harvestMul) + (f.food || 0);
    if (harvestBonus > 0) {
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'food'").run(harvestBonus, worldId);
    }
    db.prepare("UPDATE villagers SET morale = MIN(100, morale + ?) WHERE world_id = ? AND status = 'alive'").run(f.morale, worldId);
    const parts = [f.desc];
    if (harvestBonus > 0) parts.push(`+${harvestBonus} food from the harvest.`);
    parts.push(`+${f.morale} morale.`);
    events.push({
      type: 'season', title: f.title,
      description: parts.join(' '),
      severity: 'celebration',
    });
  } else if (newSeason === 'winter') {
    db.prepare("UPDATE villagers SET morale = MAX(0, morale + ?) WHERE world_id = ? AND status = 'alive'").run(f.morale, worldId);
    const farms = db.prepare("SELECT id, hp FROM buildings WHERE world_id = ? AND type = 'farm' AND status = 'active'").all(worldId);
    const frostDmg = f.farmDmg || 10;
    for (const farm of farms) {
      db.prepare('UPDATE buildings SET hp = MAX(1, hp - ?) WHERE id = ?').run(frostDmg, farm.id);
    }
    const parts = [f.desc];
    if (farms.length > 0) parts.push(`${farms.length} farm(s) took frost damage (-${frostDmg} HP).`);
    parts.push(`${f.morale} morale.`);
    events.push({
      type: 'season', title: f.title,
      description: parts.join(' '),
      severity: 'warning',
    });
  }

  return events;
}

module.exports = { processTick, processCatchup };
