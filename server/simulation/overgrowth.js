const db = require('../db/connection');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Resource bonus base amounts at max overgrowth (stage 3)
const BASE_BONUS = { food: 40, wood: 30, stone: 15, crypto: 5 };
const CAP_BONUS = { food: 120, wood: 90, stone: 50, crypto: 20 };
const BUILDING_SCALE = 0.15;

function getOvergrowthState(worldId) {
  const world = db.prepare('SELECT dormant_since FROM worlds WHERE id = ?').get(worldId);
  if (!world || !world.dormant_since) {
    return { level: 0, stage: -1, stageName: null, dormant_days: 0, resource_bonus: null };
  }

  const dormantMs = Date.now() - new Date(world.dormant_since).getTime();
  if (dormantMs <= 0) {
    return { level: 0, stage: -1, stageName: null, dormant_days: 0, resource_bonus: null };
  }

  const level = Math.min(1.0, dormantMs / SEVEN_DAYS_MS);
  const dormant_days = dormantMs / (24 * 60 * 60 * 1000);

  let stage, stageName;
  if (dormant_days < 2) { stage = 0; stageName = 'sprouting'; }
  else if (dormant_days < 4) { stage = 1; stageName = 'growing'; }
  else if (dormant_days < 6) { stage = 2; stageName = 'lush'; }
  else { stage = 3; stageName = 'max'; }

  // Calculate resource bonus (preview)
  const activeBuildings = db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId).c;

  const scale = 1 + activeBuildings * BUILDING_SCALE;
  const resource_bonus = {};
  for (const [type, base] of Object.entries(BASE_BONUS)) {
    resource_bonus[type] = Math.min(CAP_BONUS[type], Math.floor(base * scale * level));
  }

  return { level, stage, stageName, dormant_days: Math.floor(dormant_days), resource_bonus };
}

function harvestOvergrowth(worldId) {
  const state = getOvergrowthState(worldId);
  if (state.level < 0.25) return null;

  // Anti-abuse: if harvested less than 7 days ago, halve bonus
  const world = db.prepare('SELECT last_overgrowth_harvest FROM worlds WHERE id = ?').get(worldId);
  let multiplier = 1;
  if (world && world.last_overgrowth_harvest) {
    const sinceLastHarvest = Date.now() - new Date(world.last_overgrowth_harvest).getTime();
    if (sinceLastHarvest < SEVEN_DAYS_MS) {
      multiplier = 0.5;
    }
  }

  const bonus = {};
  const updateRes = db.prepare(
    "UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?"
  );

  for (const [type, amount] of Object.entries(state.resource_bonus)) {
    const adjusted = Math.floor(amount * multiplier);
    if (adjusted > 0) {
      updateRes.run(adjusted, worldId, type);
      bonus[type] = adjusted;
    }
  }

  // Clear dormant_since and record harvest time
  db.prepare(
    "UPDATE worlds SET dormant_since = NULL, last_overgrowth_harvest = datetime('now') WHERE id = ?"
  ).run(worldId);

  return bonus;
}

module.exports = { getOvergrowthState, harvestOvergrowth };
