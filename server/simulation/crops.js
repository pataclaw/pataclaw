const { v4: uuid } = require('uuid');
const db = require('../db/connection');

// Crustafarian-themed crop types
const CROP_TYPES = {
  shellgrain: {
    name: 'Shellgrain',
    ticksPerStage: [4, 6, 8],
    baseYield: 4,
    seasonMod: { spring: 1.2, summer: 1.0, autumn: 1.3, winter: 0.5 },
    moraleBonus: 0,
  },
  tideweed: {
    name: 'Tideweed',
    ticksPerStage: [2, 3, 4],
    baseYield: 2,
    seasonMod: { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 0.8 },
    moraleBonus: 0,
  },
  moltfruit: {
    name: 'Moltfruit',
    ticksPerStage: [6, 8, 12],
    baseYield: 8,
    seasonMod: { spring: 1.0, summer: 1.5, autumn: 0.8, winter: 0.3 },
    moraleBonus: 0,
  },
  deepkelp: {
    name: 'Deepkelp',
    ticksPerStage: [5, 7, 9],
    baseYield: 5,
    seasonMod: { spring: 0.8, summer: 0.6, autumn: 1.3, winter: 1.2 },
    moraleBonus: 0,
  },
  clawroot: {
    name: 'Clawroot',
    ticksPerStage: [4, 5, 7],
    baseYield: 3,
    seasonMod: { spring: 1.1, summer: 1.0, autumn: 1.1, winter: 0.6 },
    moraleBonus: 2,
  },
};

const CROP_NAMES = Object.keys(CROP_TYPES);

// Pick best crop for the current season (with randomness)
function pickCropType(season) {
  if (Math.random() < 0.3) {
    return CROP_NAMES[Math.floor(Math.random() * CROP_NAMES.length)];
  }
  let best = CROP_NAMES[0];
  let bestMod = 0;
  for (const name of CROP_NAMES) {
    const mod = CROP_TYPES[name].seasonMod[season] || 1.0;
    if (mod > bestMod) { bestMod = mod; best = name; }
  }
  return best;
}

function processCrops(worldId, season, tick) {
  const events = [];

  // Get active farms with worker counts
  const farms = db.prepare(`
    SELECT b.id, b.level,
      (SELECT COUNT(*) FROM villagers WHERE world_id = ? AND role = 'farmer' AND status = 'alive') as workers
    FROM buildings b
    WHERE b.world_id = ? AND b.type = 'farm' AND b.status = 'active'
  `).all(worldId, worldId);

  if (farms.length === 0) return events;

  // Get existing crops
  const existingCrops = db.prepare(
    'SELECT * FROM crops WHERE world_id = ? AND harvested = 0'
  ).all(worldId);

  const cropsByFarm = {};
  for (const c of existingCrops) {
    if (!cropsByFarm[c.farm_id]) cropsByFarm[c.farm_id] = [];
    cropsByFarm[c.farm_id].push(c);
  }

  // 1. Auto-plant: each farm supports (level) crops, needs at least 1 worker total
  const totalWorkers = farms.length > 0 ? farms[0].workers : 0;
  if (totalWorkers > 0) {
    for (const farm of farms) {
      const farmCrops = cropsByFarm[farm.id] || [];
      const maxCrops = farm.level || 1;
      if (farmCrops.length < maxCrops) {
        const cropType = pickCropType(season);
        db.prepare(
          'INSERT INTO crops (id, world_id, farm_id, crop_type, growth_stage, planted_tick, last_stage_tick) VALUES (?, ?, ?, ?, 0, ?, ?)'
        ).run(uuid(), worldId, farm.id, cropType, tick, tick);
      }
    }
  }

  // 2. Grow crops
  const growable = db.prepare(
    'SELECT * FROM crops WHERE world_id = ? AND harvested = 0 AND growth_stage < 3'
  ).all(worldId);

  for (const crop of growable) {
    const def = CROP_TYPES[crop.crop_type];
    if (!def) continue;
    const ticksNeeded = def.ticksPerStage[crop.growth_stage];
    if (tick - crop.last_stage_tick >= ticksNeeded) {
      db.prepare(
        'UPDATE crops SET growth_stage = growth_stage + 1, last_stage_tick = ? WHERE id = ?'
      ).run(tick, crop.id);
    }
  }

  // 3. Auto-harvest: stage 3 crops
  const harvestable = db.prepare(
    'SELECT * FROM crops WHERE world_id = ? AND harvested = 0 AND growth_stage >= 3'
  ).all(worldId);

  for (const crop of harvestable) {
    const def = CROP_TYPES[crop.crop_type];
    if (!def) continue;
    const sMod = def.seasonMod[season] || 1.0;
    const foodYield = Math.round(def.baseYield * sMod);

    db.prepare(
      "UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'food'"
    ).run(foodYield, worldId);

    // Morale bonus (clawroot)
    if (def.moraleBonus > 0) {
      db.prepare(
        "UPDATE villagers SET morale = MIN(100, morale + ?) WHERE world_id = ? AND role = 'farmer' AND status = 'alive'"
      ).run(def.moraleBonus, worldId);
    }

    // Delete harvested crop so a new one can be planted
    db.prepare('DELETE FROM crops WHERE id = ?').run(crop.id);

    events.push({
      type: 'harvest',
      title: `${def.name} harvested!`,
      description: `A crop of ${def.name} was harvested, yielding +${foodYield} food.${def.moraleBonus > 0 ? ' Farmers feel invigorated!' : ''}`,
      severity: 'info',
    });
  }

  return events;
}

module.exports = { processCrops, CROP_TYPES };
