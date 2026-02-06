const db = require('../db/connection');
const { getWeatherModifier } = require('./weather');
const { getCulture } = require('./culture');

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

function processResources(worldId, weather, season) {
  const wMod = getWeatherModifier(weather);
  const sMod = SEASON_FOOD_MODIFIER[season] || 1.0;
  const sFishMod = SEASON_FISH_MODIFIER[season] || 1.0;
  const culture = getCulture(worldId);
  const workEthic = 1 + (culture.work_ethic_modifier || 0);

  // Get active buildings with assigned workers
  const buildings = db.prepare(
    "SELECT * FROM buildings WHERE world_id = ? AND status = 'active'"
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

    switch (b.type) {
      case 'farm':
        foodProd += 2 * workers * wMod.food * sMod * workEthic;
        break;
      case 'dock':
        foodProd += 1.5 * workers * wMod.fish * sFishMod * workEthic;
        break;
      case 'workshop':
        woodProd += 0.5 * workers * wMod.wood * workEthic;
        stoneProd += 0.3 * workers * wMod.stone * workEthic;
        break;
      case 'temple':
        faithProd += 1 * workers * workEthic;
        break;
      case 'library':
        knowledgeProd += 1 * workers * workEthic;
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
