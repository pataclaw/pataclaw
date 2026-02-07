const { v4: uuid } = require('uuid');
const db = require('../db/connection');

// ─── GROWTH STAGES ───
const GROWTH_STAGES = [
  { pop: 5, culture: 50, mapSize: 50, maxReligious: 1 },
  { pop: 10, culture: 100, mapSize: 60, maxReligious: 2 },
  { pop: 15, culture: 150, mapSize: 70, maxReligious: 3 },
  { pop: 20, culture: 200, mapSize: 80, maxReligious: 4 },
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
  hut:        { wood: 10, stone: 0, gold: 0, ticks: 5, hp: 100 },
  farm:       { wood: 5, stone: 3, gold: 0, ticks: 8, hp: 80 },
  workshop:   { wood: 15, stone: 10, gold: 0, ticks: 12, hp: 120 },
  wall:       { wood: 0, stone: 20, gold: 0, ticks: 15, hp: 200 },
  temple:     { wood: 0, stone: 10, gold: 5, ticks: 20, hp: 150 },
  watchtower: { wood: 15, stone: 5, gold: 0, ticks: 10, hp: 100 },
  market:     { wood: 20, stone: 15, gold: 5, ticks: 18, hp: 120 },
  library:    { wood: 15, stone: 20, gold: 10, ticks: 25, hp: 130 },
  storehouse: { wood: 25, stone: 10, gold: 0, ticks: 12, hp: 150 },
  dock:       { wood: 12, stone: 5, gold: 0, ticks: 10, hp: 90 },
};

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
  if ((resMap.gold || 0) < def.gold) return { ok: false, reason: `Need ${def.gold} gold (have ${Math.floor(resMap.gold || 0)})` };

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
  if (def.gold > 0) db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'gold'").run(def.gold, worldId);

  const id = uuid();
  db.prepare(`
    INSERT INTO buildings (id, world_id, type, x, y, hp, max_hp, status, construction_ticks_remaining)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'constructing', ?)
  `).run(id, worldId, type, x, y, def.hp, def.hp, def.ticks);

  return { ok: true, buildingId: id, ticks: def.ticks };
}

module.exports = { processBuildings, canBuild, startBuilding, BUILDING_DEFS, GROWTH_STAGES, getGrowthStage };
