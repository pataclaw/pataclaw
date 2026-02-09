const db = require('../db/connection');

const BUILDING_WEIGHTS = {
  hut: 2, farm: 3, workshop: 4, wall: 5, temple: 4,
  watchtower: 3, market: 5, library: 5, storehouse: 2, dock: 3,
  town_center: 6,
};

function recalculateStats(worldId) {
  const villagers = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(worldId);

  const buildings = db.prepare(
    "SELECT * FROM buildings WHERE world_id = ? AND status = 'active'"
  ).all(worldId);

  const popAlive = villagers.length;
  if (popAlive === 0 && buildings.length === 0) return;

  // --- Visible stats ---

  // Military strength: warriors + fortifications + experience
  const warriors = villagers.filter(v => v.role === 'warrior');
  const avgWarriorXp = warriors.length > 0
    ? warriors.reduce((s, v) => s + (v.experience || 0), 0) / warriors.length
    : 0;
  const wallScore = buildings
    .filter(b => b.type === 'wall')
    .reduce((s, b) => s + (b.level || 1) * 5, 0);
  const towerScore = buildings
    .filter(b => b.type === 'watchtower')
    .reduce((s, b) => s + (b.level || 1) * 3, 0);
  const military_strength = Math.round(warriors.length * 10 + wallScore + towerScore + avgWarriorXp * 2);

  // Economic output: sum resource production capacity
  const farmers = villagers.filter(v => v.role === 'farmer').length;
  const fishermen = villagers.filter(v => v.role === 'fisherman').length;
  const scholars = villagers.filter(v => v.role === 'scholar').length;
  const priests = villagers.filter(v => v.role === 'priest').length;
  const workshopIds = buildings.filter(b => b.type === 'workshop').map(b => b.id);
  const workshopWorkers = workshopIds.length > 0
    ? db.prepare(
        `SELECT COUNT(*) as c FROM villagers WHERE assigned_building_id IN (${workshopIds.map(() => '?').join(',')}) AND status = 'alive'`
      ).get(...workshopIds).c
    : 0;
  const economic_output = Math.round((farmers * 0.8 + fishermen * 0.6 + workshopWorkers * 0.4 + scholars * 0.4 + priests * 0.4) * 10) / 10;

  // Exploration %
  const world = db.prepare('SELECT map_size FROM worlds WHERE id = ?').get(worldId);
  const mapSize = (world && world.map_size) || 40;
  const totalTiles = mapSize * mapSize;
  const exploredTiles = db.prepare(
    "SELECT COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1"
  ).get(worldId).c;
  const exploration_pct = Math.round(exploredTiles / totalTiles * 1000) / 10;

  // Happiness index: average morale
  const happiness_index = popAlive > 0
    ? Math.round(villagers.reduce((s, v) => s + v.morale, 0) / popAlive * 10) / 10
    : 50;

  // Infrastructure score
  const infrastructure_score = buildings.reduce((s, b) => {
    const weight = BUILDING_WEIGHTS[b.type] || 1;
    return s + (b.level || 1) * weight;
  }, 0);

  // --- Hidden stats (for future battle mode) ---

  // Fortification rating
  const tcLevel = buildings.find(b => b.type === 'town_center');
  const fortification_rating = wallScore * 3 + towerScore * 2 + (tcLevel ? (tcLevel.level || 1) * 5 : 5);

  // Production efficiency (ratio of workers to buildings — balanced = better)
  const totalWorkers = villagers.filter(v => v.role !== 'idle').length;
  const production_efficiency = popAlive > 0
    ? Math.round(Math.min(1.0, totalWorkers / Math.max(1, popAlive)) * 100) / 100
    : 0;

  // Morale resilience
  const avgMorale = happiness_index;
  const culture = db.prepare('SELECT cooperation_level FROM culture WHERE world_id = ?').get(worldId);
  const cooperationLevel = (culture && culture.cooperation_level) || 0;
  const morale_resilience = Math.round(
    Math.max(0.3, Math.min(1.0, avgMorale / 100)) * (1 + cooperationLevel / 200) * 100
  ) / 100;

  // War readiness
  const war_readiness = popAlive > 0
    ? Math.round(military_strength * morale_resilience / popAlive * 10) / 10
    : 0;

  // Army power breakdown
  const army_power = JSON.stringify({
    warriors: warriors.length,
    avg_xp: Math.round(avgWarriorXp),
    traits: warriors.reduce((m, v) => { m[v.trait] = (m[v.trait] || 0) + 1; return m; }, {}),
  });

  // Upsert
  db.prepare(`
    INSERT INTO world_stats (world_id, military_strength, economic_output, exploration_pct,
      happiness_index, infrastructure_score, fortification_rating, production_efficiency,
      morale_resilience, war_readiness, army_power, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(world_id) DO UPDATE SET
      military_strength = excluded.military_strength,
      economic_output = excluded.economic_output,
      exploration_pct = excluded.exploration_pct,
      happiness_index = excluded.happiness_index,
      infrastructure_score = excluded.infrastructure_score,
      fortification_rating = excluded.fortification_rating,
      production_efficiency = excluded.production_efficiency,
      morale_resilience = excluded.morale_resilience,
      war_readiness = excluded.war_readiness,
      army_power = excluded.army_power,
      updated_at = datetime('now')
  `).run(worldId, military_strength, economic_output, exploration_pct,
    happiness_index, infrastructure_score, fortification_rating, production_efficiency,
    morale_resilience, war_readiness, army_power);
}

module.exports = { recalculateStats };
