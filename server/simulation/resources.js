const db = require('../db/connection');
const { getWeatherModifier } = require('./weather');
const { getCulture } = require('./culture');
const { getNodeRatio } = require('./resource-nodes');

const SEASON_FOOD_MODIFIER = {
  spring: 1.0,
  summer: 1.5,
  autumn: 1.2,
  winter: 0.5,
};

const SEASON_FISH_MODIFIER = {
  spring: 1.0,
  summer: 1.2,
  autumn: 1.3,
  winter: 0.8,
};

const SEASON_HUNT_MODIFIER = {
  spring: 1.0,
  summer: 1.1,
  autumn: 1.3,
  winter: 0.7,
};

// Biome production bonuses: [building_type] → multiplier
const BIOME_BONUSES = {
  forest:   { hunting_lodge: 1.3, workshop: 1.2 },
  mountain: { workshop: 1.3 },
  desert:   { market: 1.3 },
  swamp:    { farm: 1.2 },
  ice:      { hunting_lodge: 1.2 },
  tundra:   { hunting_lodge: 1.2 },
};

function processResources(worldId, weather, season, planetaryEffects) {
  const wMod = getWeatherModifier(weather);
  const sMod = SEASON_FOOD_MODIFIER[season] || 1.0;
  const sFishMod = SEASON_FISH_MODIFIER[season] || 1.0;
  const sHuntMod = SEASON_HUNT_MODIFIER[season] || 1.0;
  const culture = getCulture(worldId);
  const workEthic = 1 + (culture.work_ethic_modifier || 0);
  const pEffects = planetaryEffects || {};
  const pFoodMul = pEffects.foodMul || 1.0;
  const pFishMul = pEffects.fishMul || 1.0;
  const pFaithMul = pEffects.faithMul || 1.0;
  const pProdMul = pEffects.productionMul || 1.0;

  // Determine dominant biome for production bonuses
  const biomeRow = db.prepare(
    "SELECT terrain, COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1 GROUP BY terrain ORDER BY c DESC LIMIT 1"
  ).get(worldId);
  const dominantBiome = biomeRow ? biomeRow.terrain : 'plains';
  const biomeBonuses = BIOME_BONUSES[dominantBiome] || {};

  // Get active and decaying buildings with assigned workers
  const buildings = db.prepare(
    "SELECT * FROM buildings WHERE world_id = ? AND status IN ('active', 'decaying')"
  ).all(worldId);

  let foodProd = 0;
  let woodProd = 0;
  let stoneProd = 0;
  let knowledgeProd = 0;
  let faithProd = 0;

  for (const b of buildings) {
    const workers = db.prepare(
      "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND assigned_building_id = ? AND status = 'alive'"
    ).get(worldId, b.id).c;

    const decayMul = b.status === 'decaying' ? 0.5 : 1.0;

    const bMul = biomeBonuses[b.type] || 1.0;

    switch (b.type) {
      case 'town_center':
        // Baseline food: town center foraging provides 1 food/tick (feeds 2 villagers)
        foodProd += 1 * decayMul * pFoodMul;
        break;
      case 'farm':
        foodProd += 2 * workers * wMod.food * sMod * workEthic * decayMul * pFoodMul * pProdMul * bMul;
        break;
      case 'dock': {
        const fishRatio = getNodeRatio(worldId, b.id, 'fish_spot');
        foodProd += 1.5 * workers * wMod.fish * sFishMod * workEthic * decayMul * pFishMul * pProdMul * fishRatio;
        break;
      }
      case 'hunting_lodge':
        foodProd += 1.2 * workers * wMod.food * sHuntMod * workEthic * decayMul * pProdMul * bMul;
        break;
      case 'workshop': {
        const treeRatio = getNodeRatio(worldId, b.id, 'tree');
        const rockRatio = getNodeRatio(worldId, b.id, 'rock');
        woodProd += 0.5 * workers * wMod.wood * workEthic * decayMul * pProdMul * bMul * treeRatio;
        stoneProd += 0.3 * workers * wMod.stone * workEthic * decayMul * pProdMul * bMul * rockRatio;
        break;
      }
      case 'temple':
        faithProd += 1 * workers * workEthic * decayMul * pFaithMul * pProdMul;
        break;
      case 'library':
        knowledgeProd += 1 * workers * workEthic * decayMul * pProdMul;
        break;
    }
  }

  // Consumption: each alive villager eats 0.5 food/tick
  const popAlive = db.prepare(
    "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).get(worldId).c;
  const foodConsumption = popAlive * 0.5;

  // Update resources
  const updates = [
    { type: 'food', delta: foodProd - foodConsumption },
    { type: 'wood', delta: woodProd },
    { type: 'stone', delta: stoneProd },
    { type: 'knowledge', delta: knowledgeProd },
    { type: 'faith', delta: faithProd },
  ];

  const updateStmt = db.prepare(
    'UPDATE resources SET amount = MIN(capacity, MAX(0, amount + ?)) WHERE world_id = ? AND type = ?'
  );

  for (const u of updates) {
    if (u.delta !== 0) {
      updateStmt.run(u.delta, worldId, u.type);
    }
  }

  // Check for starvation
  const food = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'food'").get(worldId);
  const isStarving = food && food.amount <= 0;

  return { foodProd, foodConsumption, isStarving, popAlive };
}

module.exports = { processResources };
