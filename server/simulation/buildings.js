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
};

// ─── MAINTENANCE COSTS (charged every MAINTENANCE_INTERVAL ticks) ───
const MAINTENANCE_COSTS = {
  hut:        { wood: 0, stone: 0, crypto: 0 },
  town_center:{ wood: 0, stone: 0, crypto: 0 },
  farm:       { wood: 1, stone: 0, crypto: 0 },
  watchtower: { wood: 1, stone: 0, crypto: 0 },
  storehouse: { wood: 1, stone: 0, crypto: 0 },
  dock:       { wood: 1, stone: 0, crypto: 0 },
  workshop:   { wood: 1, stone: 1, crypto: 0 },
  wall:       { wood: 0, stone: 1, crypto: 0 },
  temple:     { wood: 0, stone: 0, crypto: 1 },
  market:     { wood: 1, stone: 0, crypto: 1 },
  library:    { wood: 0, stone: 1, crypto: 1 },
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
        db.prepare(
          'UPDATE resources SET capacity = capacity + 100 WHERE world_id = ?'
        ).run(worldId);
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

module.exports = { processBuildings, processMaintenance, canBuild, startBuilding, BUILDING_DEFS, MAINTENANCE_COSTS, GROWTH_STAGES, getGrowthStage };
