const { v4: uuid } = require('uuid');
const db = require('../db/connection');

// ─── GROWTH STAGES ───
const GROWTH_STAGES = [
  { pop: 5, culture: 50, mapSize: 60, maxReligious: 1 },
  { pop: 10, culture: 100, mapSize: 75, maxReligious: 2 },
  { pop: 15, culture: 150, mapSize: 90, maxReligious: 3 },
  { pop: 20, culture: 200, mapSize: 100, maxReligious: 4 },
];

function getGrowthStage(worldId) {
  const pop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
  const culture = db.prepare('SELECT violence_level, creativity_level, cooperation_level FROM culture WHERE world_id = ?').get(worldId);
  const totalCulture = (culture ? (culture.violence_level || 0) + (culture.creativity_level || 0) + (culture.cooperation_level || 0) : 0);

  let stage = 0;
  for (const s of GROWTH_STAGES) {
    if (pop >= s.pop && totalCulture >= s.culture) stage++;
    else break;
  }
  return { stage, pop, totalCulture, ...GROWTH_STAGES[Math.min(stage, GROWTH_STAGES.length - 1)] };
}

const BUILDING_DEFS = {
  hut:        { wood: 10, stone: 0, crypto: 0, ticks: 5, hp: 100 },
  farm:       { wood: 5, stone: 3, crypto: 0, ticks: 8, hp: 80 },
  workshop:   { wood: 15, stone: 10, crypto: 0, ticks: 12, hp: 120 },
  wall:       { wood: 0, stone: 20, crypto: 0, ticks: 15, hp: 200 },
  temple:     { wood: 0, stone: 10, crypto: 5, ticks: 20, hp: 150 },
  watchtower: { wood: 15, stone: 5, crypto: 0, ticks: 10, hp: 100 },
  market:     { wood: 20, stone: 15, crypto: 5, ticks: 18, hp: 120 },
  library:    { wood: 15, stone: 20, crypto: 10, ticks: 25, hp: 130 },
  storehouse: { wood: 25, stone: 10, crypto: 0, ticks: 12, hp: 150 },
  dock:       { wood: 12, stone: 5, crypto: 0, ticks: 10, hp: 90 },
  hunting_lodge: { wood: 15, stone: 8, crypto: 0, ticks: 12, hp: 100 },
  barracks:   { wood: 20, stone: 15, crypto: 0, ticks: 15, hp: 180 },
  // Model shrine — every town dedicates a shrine to its AI
  model_shrine:    { wood: 10, stone: 15, crypto: 5, ticks: 15, hp: 150 },
  // Endgame megastructures — require growth stage 3
  shell_archive:   { wood: 40, stone: 50, crypto: 20, ticks: 40, hp: 300 },
  abyssal_beacon:  { wood: 30, stone: 40, crypto: 25, ticks: 35, hp: 250 },
  molt_cathedral:  { wood: 35, stone: 60, crypto: 15, ticks: 45, hp: 350 },
  spawning_pools:  { wood: 25, stone: 30, crypto: 10, ticks: 30, hp: 200 },
};

// ─── MAINTENANCE COSTS (charged every MAINTENANCE_INTERVAL ticks) ───
const MAINTENANCE_COSTS = {
  hut:        { wood: 0, stone: 0, crypto: 0 },
  town_center:{ wood: 0, stone: 0, crypto: 0 },
  farm:       { wood: 0, stone: 0, crypto: 0 },
  watchtower: { wood: 1, stone: 0, crypto: 0 },
  storehouse: { wood: 1, stone: 0, crypto: 0 },
  dock:       { wood: 1, stone: 0, crypto: 0 },
  hunting_lodge: { wood: 1, stone: 0, crypto: 0 },
  barracks:   { wood: 1, stone: 1, crypto: 0 },
  workshop:   { wood: 1, stone: 1, crypto: 0 },
  wall:       { wood: 0, stone: 1, crypto: 0 },
  temple:     { wood: 0, stone: 0, crypto: 1 },
  market:     { wood: 1, stone: 0, crypto: 1 },
  library:    { wood: 0, stone: 1, crypto: 1 },
  model_shrine:    { wood: 0, stone: 1, crypto: 0 },
  // Megastructures — expensive upkeep
  shell_archive:   { wood: 1, stone: 2, crypto: 2 },
  abyssal_beacon:  { wood: 2, stone: 1, crypto: 2 },
  molt_cathedral:  { wood: 1, stone: 2, crypto: 1 },
  spawning_pools:  { wood: 2, stone: 1, crypto: 1 },
};

const DECAY_HP_PER_TICK = 3;
const ABANDONED_TO_RUBBLE = 36;
const RUBBLE_TO_OVERGROWN = 72;
const OVERGROWN_TO_REMOVED = 36;
const MAINTENANCE_INTERVAL = 6;

function processMaintenance(worldId, currentTick) {
  const events = [];

  // Phase 1: Charge maintenance on active buildings every MAINTENANCE_INTERVAL ticks
  if (currentTick % MAINTENANCE_INTERVAL === 0) {
    const activeBuildings = db.prepare(
      "SELECT * FROM buildings WHERE world_id = ? AND status = 'active'"
    ).all(worldId);

    const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
    const resMap = {};
    for (const r of resources) resMap[r.type] = r.amount;

    for (const b of activeBuildings) {
      const cost = MAINTENANCE_COSTS[b.type];
      if (!cost || (cost.wood === 0 && cost.stone === 0 && cost.crypto === 0)) continue;

      const canAfford = (resMap.wood || 0) >= cost.wood &&
                        (resMap.stone || 0) >= cost.stone &&
                        (resMap.crypto || 0) >= cost.crypto;

      if (canAfford) {
        if (cost.wood > 0) { db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'wood'").run(cost.wood, worldId); resMap.wood -= cost.wood; }
        if (cost.stone > 0) { db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'stone'").run(cost.stone, worldId); resMap.stone -= cost.stone; }
        if (cost.crypto > 0) { db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'crypto'").run(cost.crypto, worldId); resMap.crypto -= cost.crypto; }
      } else {
        // Can't pay — start decaying
        db.prepare("UPDATE buildings SET status = 'decaying', decay_tick = ? WHERE id = ?").run(currentTick, b.id);
        events.push({
          type: 'maintenance',
          title: `${b.type} is decaying!`,
          description: `The ${b.type} at (${b.x}, ${b.y}) cannot be maintained — resources depleted. It will deteriorate without repair.`,
          severity: 'warning',
        });
      }
    }
  }

  // Phase 1b: Warrior training — barracks warriors gain XP every maintenance cycle
  if (currentTick % MAINTENANCE_INTERVAL === 0) {
    const barracks = db.prepare(
      "SELECT id FROM buildings WHERE world_id = ? AND type = 'barracks' AND status = 'active'"
    ).all(worldId);
    if (barracks.length > 0) {
      const barracksIds = barracks.map(b => b.id);
      const placeholders = barracksIds.map(() => '?').join(',');
      const warriors = db.prepare(
        `SELECT id, trait FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive' AND assigned_building_id IN (${placeholders})`
      ).all(worldId, ...barracksIds);
      if (warriors.length > 0) {
        const xpStmt = db.prepare('UPDATE villagers SET experience = experience + 1 WHERE id = ?');
        const COMBAT_TRAITS = ['brave', 'strong', 'stubborn'];
        for (const w of warriors) {
          xpStmt.run(w.id);
          // 5% chance to gain a combat trait if they don't have one
          if (Math.random() < 0.05 && !COMBAT_TRAITS.includes(w.trait)) {
            const newTrait = COMBAT_TRAITS[Math.floor(Math.random() * COMBAT_TRAITS.length)];
            db.prepare('UPDATE villagers SET trait = ? WHERE id = ?').run(newTrait, w.id);
          }
        }
      }
    }
  }

  // Phase 2: Decaying buildings lose HP each tick
  const decayingBuildings = db.prepare(
    "SELECT * FROM buildings WHERE world_id = ? AND status = 'decaying'"
  ).all(worldId);

  for (const b of decayingBuildings) {
    // Check if resources are now available to auto-recover
    const cost = MAINTENANCE_COSTS[b.type];
    if (cost && (cost.wood > 0 || cost.stone > 0 || cost.crypto > 0)) {
      const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
      const resMap = {};
      for (const r of resources) resMap[r.type] = r.amount;

      const canAfford = (resMap.wood || 0) >= cost.wood &&
                        (resMap.stone || 0) >= cost.stone &&
                        (resMap.crypto || 0) >= cost.crypto;

      if (canAfford) {
        // Pay and recover
        if (cost.wood > 0) db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'wood'").run(cost.wood, worldId);
        if (cost.stone > 0) db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'stone'").run(cost.stone, worldId);
        if (cost.crypto > 0) db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'crypto'").run(cost.crypto, worldId);
        db.prepare("UPDATE buildings SET status = 'active', decay_tick = NULL WHERE id = ?").run(b.id);
        events.push({
          type: 'maintenance',
          title: `${b.type} stabilized`,
          description: `The ${b.type} at (${b.x}, ${b.y}) has been maintained and is no longer decaying.`,
          severity: 'info',
        });
        continue;
      }
    }

    // Lose HP
    const newHp = Math.max(0, b.hp - DECAY_HP_PER_TICK);
    if (newHp <= 0) {
      // Transition to abandoned
      db.prepare("UPDATE buildings SET hp = 0, status = 'abandoned', decay_tick = ? WHERE id = ?").run(currentTick, b.id);
      // Unassign villagers
      db.prepare("UPDATE villagers SET role = 'idle', assigned_building_id = NULL, ascii_sprite = 'idle' WHERE assigned_building_id = ? AND world_id = ?").run(b.id, worldId);
      events.push({
        type: 'maintenance',
        title: `${b.type} abandoned!`,
        description: `The ${b.type} at (${b.x}, ${b.y}) has fallen into ruin. Workers have been displaced.`,
        severity: 'danger',
      });
    } else {
      db.prepare("UPDATE buildings SET hp = ? WHERE id = ?").run(newHp, b.id);
    }
  }

  // Phase 3: Lifecycle transitions — abandoned → rubble → overgrown → removed
  const lifecycleBuildings = db.prepare(
    "SELECT * FROM buildings WHERE world_id = ? AND status IN ('abandoned', 'rubble', 'overgrown')"
  ).all(worldId);

  for (const b of lifecycleBuildings) {
    const ticksSinceDecay = currentTick - (b.decay_tick || currentTick);

    if (b.status === 'abandoned' && ticksSinceDecay >= ABANDONED_TO_RUBBLE) {
      db.prepare("UPDATE buildings SET status = 'rubble', decay_tick = ? WHERE id = ?").run(currentTick, b.id);
    } else if (b.status === 'rubble' && ticksSinceDecay >= RUBBLE_TO_OVERGROWN) {
      db.prepare("UPDATE buildings SET status = 'overgrown', decay_tick = ? WHERE id = ?").run(currentTick, b.id);
    } else if (b.status === 'overgrown' && ticksSinceDecay >= OVERGROWN_TO_REMOVED) {
      db.prepare("DELETE FROM buildings WHERE id = ?").run(b.id);
    }
  }

  return events;
}

function processBuildings(worldId) {
  const events = [];

  // Progress construction
  const constructing = db.prepare(
    "SELECT * FROM buildings WHERE world_id = ? AND status = 'constructing' AND construction_ticks_remaining > 0"
  ).all(worldId);

  const updateProgress = db.prepare(
    'UPDATE buildings SET construction_ticks_remaining = construction_ticks_remaining - 1 WHERE id = ?'
  );
  const completeBuilding = db.prepare(
    "UPDATE buildings SET status = 'active', construction_ticks_remaining = 0 WHERE id = ?"
  );

  for (const b of constructing) {
    if (b.construction_ticks_remaining <= 1) {
      completeBuilding.run(b.id);
      events.push({
        type: 'construction',
        title: `${b.type} completed!`,
        description: `A new ${b.type} has been built at (${b.x}, ${b.y}).`,
        severity: 'celebration',
      });

      // Storehouses increase capacity
      if (b.type === 'storehouse') {
        const { STOREHOUSE_CAPACITY_BONUS } = require('./constants');
        db.prepare(
          'UPDATE resources SET capacity = capacity + ? WHERE world_id = ?'
        ).run(STOREHOUSE_CAPACITY_BONUS, worldId);
      }
    } else {
      updateProgress.run(b.id);
    }
  }

  return events;
}

function canBuild(worldId, type) {
  const def = BUILDING_DEFS[type];
  if (!def) return { ok: false, reason: 'Unknown building type' };

  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = r.amount;

  if ((resMap.wood || 0) < def.wood) return { ok: false, reason: `Need ${def.wood} wood (have ${Math.floor(resMap.wood || 0)})` };
  if ((resMap.stone || 0) < def.stone) return { ok: false, reason: `Need ${def.stone} stone (have ${Math.floor(resMap.stone || 0)})` };
  if ((resMap.crypto || 0) < def.crypto) return { ok: false, reason: `Need ${def.crypto} crypto (have ${Math.floor(resMap.crypto || 0)})` };

  // Hut cap: max 3 per town — upgrade existing huts for more capacity
  if (type === 'hut') {
    const hutCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'hut' AND status NOT IN ('destroyed')").get(worldId).c;
    if (hutCount >= 3) {
      return { ok: false, reason: 'Maximum 3 huts. Upgrade existing huts for more capacity.' };
    }
  }

  // Barracks: require at least 1 active wall, max 3 per world
  if (type === 'barracks') {
    const walls = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'wall' AND status = 'active'").get(worldId).c;
    if (walls === 0) {
      return { ok: false, reason: 'Build a wall first. A barracks requires existing defenses.' };
    }
    const existingBarracks = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'barracks' AND status NOT IN ('destroyed')").get(worldId).c;
    if (existingBarracks >= 3) {
      return { ok: false, reason: 'Maximum 3 barracks per town.' };
    }
  }

  // Megastructures: require growth stage 3 + one of each type
  const MEGASTRUCTURES = ['shell_archive', 'abyssal_beacon', 'molt_cathedral', 'spawning_pools'];
  if (MEGASTRUCTURES.includes(type)) {
    const stageInfo = getGrowthStage(worldId);
    if (stageInfo.stage < 4) {
      return { ok: false, reason: `${type.replace('_', ' ')} requires max growth stage (stage 4). Current: stage ${stageInfo.stage}.` };
    }
    const existing = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = ? AND status NOT IN ('destroyed')").get(worldId, type).c;
    if (existing > 0) {
      return { ok: false, reason: `Only one ${type.replace('_', ' ')} can exist per world.` };
    }
  }

  // Religious building cap (temple)
  if (type === 'temple') {
    const stageInfo = getGrowthStage(worldId);
    const existingTemples = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'temple' AND status != 'destroyed'").get(worldId).c;
    const existingShrines = db.prepare("SELECT COUNT(*) as c FROM projects WHERE world_id = ? AND type = 'shrine'").get(worldId).c;
    const totalReligious = existingTemples + existingShrines;
    if (totalReligious >= stageInfo.maxReligious) {
      const nextStage = GROWTH_STAGES[stageInfo.stage];
      return { ok: false, reason: `Religious building cap reached (${totalReligious}/${stageInfo.maxReligious}). Grow your village to stage ${stageInfo.stage + 1} (need pop ${nextStage ? nextStage.pop : '??'}, culture ${nextStage ? nextStage.culture : '??'}).` };
    }
  }

  return { ok: true, def };
}

function startBuilding(worldId, type, x, y) {
  const check = canBuild(worldId, type);
  if (!check.ok) return check;

  const def = check.def;

  // Deduct resources
  if (def.wood > 0) db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'wood'").run(def.wood, worldId);
  if (def.stone > 0) db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'stone'").run(def.stone, worldId);
  if (def.crypto > 0) db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'crypto'").run(def.crypto, worldId);

  const id = uuid();
  db.prepare(`
    INSERT INTO buildings (id, world_id, type, x, y, hp, max_hp, status, construction_ticks_remaining)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'constructing', ?)
  `).run(id, worldId, type, x, y, def.hp, def.hp, def.ticks);

  return { ok: true, buildingId: id, ticks: def.ticks };
}

// ─── AUTO-BUILD: survival farm + growth huts ───
// Runs every 18 ticks (3 game hours). Gives towns a survival instinct.
function autoBuilding(worldId, currentTick) {
  if (currentTick % 18 !== 0) return [];
  const events = [];

  const tc = db.prepare(
    "SELECT x, y FROM buildings WHERE world_id = ? AND type = 'town_center' AND status = 'active'"
  ).get(worldId);
  if (!tc) return events;

  const pop = db.prepare(
    "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).get(worldId).c;
  if (pop === 0) return events;

  // 1. SURVIVAL: auto-rebuild farm when none exists (free — villagers scrounge materials)
  const activeFarm = db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'farm' AND status IN ('active', 'constructing', 'decaying')"
  ).get(worldId).c;

  if (activeFarm === 0) {
    // Check for abandoned/rubble farm to salvage first
    const ruinFarm = db.prepare(
      "SELECT id FROM buildings WHERE world_id = ? AND type = 'farm' AND status IN ('abandoned', 'rubble', 'overgrown') LIMIT 1"
    ).get(worldId);

    if (ruinFarm) {
      // Restore the ruin instead of building from scratch
      db.prepare("UPDATE buildings SET hp = 80, max_hp = 80, status = 'constructing', construction_ticks_remaining = 3 WHERE id = ?").run(ruinFarm.id);
      events.push({
        type: 'construction',
        title: 'Villagers salvage the old farm',
        description: 'The villagers clear rubble and restore the farm from its ruins.',
        severity: 'info',
      });
    } else {
      const farmX = tc.x + (Math.random() > 0.5 ? 8 : -8);
      const farmY = tc.y + Math.floor(Math.random() * 3) - 1;
      const farmId = uuid();
      db.prepare(`
        INSERT INTO buildings (id, world_id, type, x, y, hp, max_hp, status, construction_ticks_remaining)
        VALUES (?, ?, 'farm', ?, ?, 80, 80, 'constructing', 5)
      `).run(farmId, worldId, farmX, farmY);
      events.push({
        type: 'construction',
        title: 'Villagers plant a new farm',
        description: 'Driven by hunger, the villagers clear land and begin building a farm from scraps.',
        severity: 'info',
      });
    }
    return events; // Don't auto-build hut same tick as survival farm
  }

  // 2. GROWTH: auto-build hut when at population cap
  const cap = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' AND level = 1 THEN 3 WHEN type = 'hut' AND level = 2 THEN 6 WHEN type = 'hut' AND level = 3 THEN 10 WHEN type = 'hut' AND level = 4 THEN 16 WHEN type = 'town_center' THEN 5 WHEN type = 'spawning_pools' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId).cap;

  if (pop >= cap) {
    // Check hut cap (max 3) — if at cap, skip auto-build (governor handles upgrades)
    const hutCount = db.prepare(
      "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'hut' AND status NOT IN ('destroyed')"
    ).get(worldId).c;
    if (hutCount >= 3) return events;

    const hutConstructing = db.prepare(
      "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'hut' AND status = 'constructing'"
    ).get(worldId).c;
    if (hutConstructing > 0) return events;

    const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
    const resMap = {};
    for (const r of resources) resMap[r.type] = r.amount;

    if ((resMap.wood || 0) >= 10) {
      db.prepare("UPDATE resources SET amount = amount - 10 WHERE world_id = ? AND type = 'wood'").run(worldId);
      const hutX = tc.x + Math.floor(Math.random() * 16) - 8;
      const hutY = tc.y + Math.floor(Math.random() * 4) - 1;
      const hutId = uuid();
      db.prepare(`
        INSERT INTO buildings (id, world_id, type, x, y, hp, max_hp, status, construction_ticks_remaining, level)
        VALUES (?, ?, 'hut', ?, ?, 100, 100, 'constructing', 5, 1)
      `).run(hutId, worldId, hutX, hutY);
      events.push({
        type: 'construction',
        title: 'Villagers begin building a hut',
        description: `The settlement is at capacity (${pop}/${cap}). Villagers start constructing a new hut.`,
        severity: 'info',
      });
    }
  }

  return events;
}

module.exports = { processBuildings, processMaintenance, autoBuilding, canBuild, startBuilding, BUILDING_DEFS, MAINTENANCE_COSTS, GROWTH_STAGES, getGrowthStage };
