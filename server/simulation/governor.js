const db = require('../db/connection');
const { canBuild, startBuilding, getGrowthStage, BUILDING_DEFS } = require('./buildings');
const { getCenter } = require('../world/map');

// ─── AUTONOMOUS GOVERNOR ───
// Every few ticks, each world makes ONE autonomous decision.
// Priority: survive → grow → build → culture → endgame.
// This makes every world a living, self-sustaining civilization.

const GOVERNOR_INTERVAL = 3; // runs every 3 ticks

// Roles that produce from buildings
const ROLE_BUILDING = {
  farmer:    ['farm'],
  fisherman: ['dock'],
  hunter:    ['hunting_lodge'],
  builder:   ['workshop'],
  scholar:   ['library'],
  priest:    ['temple'],
  warrior:   ['wall', 'watchtower'],
};

// Personality affinities for smart role assignment
// Positive = high stat is good for this role, negative = low stat is good
const ROLE_PERSONALITY = {
  farmer:    { temperament: 0.4,  creativity: -0.2, sociability: 0.1  }, // calm, practical
  fisherman: { temperament: 0.3,  creativity: 0,    sociability: 0.3  }, // patient, social
  hunter:    { temperament: -0.4, creativity: 0,    sociability: -0.3 }, // aggressive, loner
  builder:   { temperament: 0.1,  creativity: 0.4,  sociability: 0.1  }, // creative
  scholar:   { temperament: 0.2,  creativity: 0.5,  sociability: -0.1 }, // calm, creative, bookish
  priest:    { temperament: 0.3,  creativity: 0.1,  sociability: 0.4  }, // calm, social
  warrior:   { temperament: -0.5, creativity: -0.1, sociability: 0    }, // aggressive
  scout:     { temperament: -0.1, creativity: 0.1,  sociability: -0.4 }, // independent, loner
};

function scoreForRole(v, role) {
  const aff = ROLE_PERSONALITY[role];
  if (!aff) return 0;
  return (v.temperament || 50) * (aff.temperament || 0) +
         (v.creativity || 50) * (aff.creativity || 0) +
         (v.sociability || 50) * (aff.sociability || 0);
}

function processGovernor(worldId, tick) {
  if (tick % GOVERNOR_INTERVAL !== 0) return [];
  const events = [];

  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  if (!world) return events;

  // Check if an agent/player is actively controlling this world
  // If so, governor only handles survival — agent makes strategic calls
  const AGENT_TIMEOUT = 6 * 60 * 1000; // 6 minutes
  const agentActive = world.last_agent_heartbeat &&
    (Date.now() - new Date(world.last_agent_heartbeat + 'Z').getTime()) < AGENT_TIMEOUT;

  const center = getCenter(world.seed);
  const pop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
  if (pop === 0) return events;

  const idle = db.prepare("SELECT id, name, temperament, creativity, sociability FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'idle'").all(worldId);
  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = r.amount;

  const activeBuildings = db.prepare("SELECT type, id FROM buildings WHERE world_id = ? AND status = 'active'").all(worldId);
  const constructing = db.prepare("SELECT type FROM buildings WHERE world_id = ? AND status = 'constructing'").all(worldId);
  const buildingSet = new Set(activeBuildings.map(b => b.type));
  const constructingSet = new Set(constructing.map(b => b.type));
  const buildingCounts = {};
  for (const b of activeBuildings) buildingCounts[b.type] = (buildingCounts[b.type] || 0) + 1;

  // Population cap
  const capRow = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 WHEN type = 'spawning_pools' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId);
  const popCap = capRow.cap;

  // Worker counts by role
  const roleCounts = {};
  const roleRows = db.prepare("SELECT role, COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive' GROUP BY role").all(worldId);
  for (const r of roleRows) roleCounts[r.role] = r.c;

  const food = resMap.food || 0;
  const wood = resMap.wood || 0;
  const stone = resMap.stone || 0;

  // Helper: assign the best-matched idle villager to a role
  function assignRole(role) {
    if (idle.length === 0) return false;
    // Pick the villager whose personality best fits this role
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < idle.length; i++) {
      const s = scoreForRole(idle[i], role);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    }
    const v = idle.splice(bestIdx, 1)[0];
    const types = ROLE_BUILDING[role];
    let buildingId = null;
    if (types) {
      const placeholders = types.map(() => '?').join(',');
      const b = db.prepare(
        `SELECT id FROM buildings WHERE world_id = ? AND type IN (${placeholders}) AND status = 'active' LIMIT 1`
      ).get(worldId, ...types);
      if (b) buildingId = b.id;
    }
    db.prepare('UPDATE villagers SET role = ?, assigned_building_id = ?, ascii_sprite = ? WHERE id = ? AND world_id = ?')
      .run(role, buildingId, role, v.id, worldId);
    events.push({
      type: 'governor',
      title: `${v.name} becomes ${role}`,
      description: `The village decided ${v.name} should work as a ${role}.`,
      severity: 'info',
    });
    return true;
  }

  // Helper: try to build something
  function tryBuild(type) {
    if (constructingSet.has(type)) return false; // already building one
    const check = canBuild(worldId, type);
    if (!check.ok) return false;
    const tile = db.prepare(`
      SELECT t.x, t.y FROM tiles t
      WHERE t.world_id = ? AND t.explored = 1
        AND t.terrain NOT IN ('water', 'mountain')
        AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.world_id = t.world_id AND b.x = t.x AND b.y = t.y AND b.status != 'destroyed')
      ORDER BY ABS(t.x - ?) + ABS(t.y - ?) ASC
      LIMIT 1
    `).get(worldId, center.x, center.y);
    if (!tile) return false;
    const result = startBuilding(worldId, type, tile.x, tile.y);
    if (!result.ok) return false;
    events.push({
      type: 'governor',
      title: `Village builds ${type}`,
      description: `The village has decided to construct a ${type.replace(/_/g, ' ')}.`,
      severity: 'info',
    });
    return true;
  }

  // ─── DECISION PRIORITY ───

  // 1. FOOD CRISIS: assign idle to food production
  if (food < pop * 3) {
    if (idle.length > 0 && buildingSet.has('farm') && (roleCounts.farmer || 0) < (buildingCounts.farm || 0) * 2) {
      if (assignRole('farmer')) return events;
    }
    if (idle.length > 0 && buildingSet.has('dock') && (roleCounts.fisherman || 0) < (buildingCounts.dock || 0) * 2) {
      if (assignRole('fisherman')) return events;
    }
    if (idle.length > 0 && buildingSet.has('hunting_lodge') && (roleCounts.hunter || 0) < (buildingCounts.hunting_lodge || 0) * 2) {
      if (assignRole('hunter')) return events;
    }
    // Build a farm if we don't have enough
    if ((buildingCounts.farm || 0) < 2 && !constructingSet.has('farm')) {
      if (tryBuild('farm')) return events;
    }
  }

  // 2. POPULATION CAP: build hut if crowded
  if (pop >= popCap - 1 && pop >= 3) {
    if (tryBuild('hut')) return events;
  }

  // 3. BASIC INFRASTRUCTURE: build first key buildings
  // Need at least 1 farmer on the farm
  if (idle.length > 0 && buildingSet.has('farm') && (roleCounts.farmer || 0) === 0) {
    if (assignRole('farmer')) return events;
  }

  // ─── AGENT OVERRIDE ───
  // If an agent/player is active, stop here. They handle strategy.
  // Governor only ensures survival: food, housing, first farmer.
  if (agentActive) return events;

  // Workshop (wood + stone production)
  if (!buildingSet.has('workshop') && pop >= 4) {
    if (tryBuild('workshop')) return events;
  }
  if (idle.length > 0 && buildingSet.has('workshop') && (roleCounts.builder || 0) === 0 && pop >= 4) {
    if (assignRole('builder')) return events;
  }

  // Storehouse (more capacity)
  if (!buildingSet.has('storehouse') && pop >= 5 && (resMap.food || 0) > 30) {
    if (tryBuild('storehouse')) return events;
  }

  // 3b. EXPLORATION: assign one scout to explore the map
  if (idle.length > 0 && (roleCounts.scout || 0) === 0 && pop >= 4) {
    if (assignRole('scout')) return events;
  }

  // 3c. MODEL SHRINE: dedicate a shrine to the world's AI model
  if (!buildingSet.has('model_shrine') && !constructingSet.has('model_shrine') && pop >= 6) {
    if (tryBuild('model_shrine')) return events;
  }

  // 4. DEFENSE: watchtower + wall + warrior
  if (!buildingSet.has('watchtower') && pop >= 5) {
    if (tryBuild('watchtower')) return events;
  }
  if (!buildingSet.has('wall') && pop >= 6) {
    if (tryBuild('wall')) return events;
  }
  if (idle.length > 0 && (roleCounts.warrior || 0) === 0 && pop >= 5 && (buildingSet.has('watchtower') || buildingSet.has('wall'))) {
    if (assignRole('warrior')) return events;
  }

  // 5. FOOD DIVERSITY: dock + hunting lodge
  if (!buildingSet.has('dock') && pop >= 5 && food > 15) {
    if (tryBuild('dock')) return events;
  }
  if (!buildingSet.has('hunting_lodge') && pop >= 6 && food > 15) {
    if (tryBuild('hunting_lodge')) return events;
  }

  // 6. CULTURE: temple + library
  if (!buildingSet.has('temple') && pop >= 7 && (resMap.faith || 0) < 5) {
    if (tryBuild('temple')) return events;
  }
  if (idle.length > 0 && buildingSet.has('temple') && (roleCounts.priest || 0) === 0 && pop >= 7) {
    if (assignRole('priest')) return events;
  }
  if (!buildingSet.has('library') && pop >= 8) {
    if (tryBuild('library')) return events;
  }
  if (idle.length > 0 && buildingSet.has('library') && (roleCounts.scholar || 0) === 0 && pop >= 8) {
    if (assignRole('scholar')) return events;
  }

  // 7. ECONOMY: market
  if (!buildingSet.has('market') && pop >= 9 && food > 20) {
    if (tryBuild('market')) return events;
  }

  // 8. SCALE: second farm, more huts
  if ((buildingCounts.farm || 0) < 3 && pop >= 8 && food < pop * 5) {
    if (tryBuild('farm')) return events;
  }
  if (pop >= popCap - 1) {
    if (tryBuild('hut')) return events;
  }

  // 9. ENDGAME: megastructures at stage 4
  const stageInfo = getGrowthStage(worldId);
  if (stageInfo.stage >= 4) {
    const MEGAS = ['shell_archive', 'abyssal_beacon', 'molt_cathedral', 'spawning_pools'];
    // Pick the first megastructure we don't have
    for (const mega of MEGAS) {
      if (!buildingSet.has(mega) && !constructingSet.has(mega)) {
        if (tryBuild(mega)) return events;
        break; // only try one
      }
    }
  }

  // 10. ASSIGN REMAINING IDLE: spread across needs
  if (idle.length > 0) {
    // Prioritize food roles if food is moderate
    if (food < pop * 8 && buildingSet.has('farm') && (roleCounts.farmer || 0) < 3) {
      if (assignRole('farmer')) return events;
    }
    if (buildingSet.has('dock') && (roleCounts.fisherman || 0) === 0) {
      if (assignRole('fisherman')) return events;
    }
    if (buildingSet.has('hunting_lodge') && (roleCounts.hunter || 0) === 0) {
      if (assignRole('hunter')) return events;
    }
    // Additional builder if lots of building to do
    if (buildingSet.has('workshop') && (roleCounts.builder || 0) < 2 && constructing.length > 0) {
      if (assignRole('builder')) return events;
    }
  }

  return events;
}

module.exports = { processGovernor };
