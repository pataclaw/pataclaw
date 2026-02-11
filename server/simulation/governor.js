const db = require('../db/connection');
const { canBuild, startBuilding, getGrowthStage, BUILDING_DEFS } = require('./buildings');
const { getCenter } = require('../world/map');
const { computeWarriorType } = require('./warrior-types');

// ─── AUTONOMOUS GOVERNOR ───
// Every 3 ticks, runs TWO phases:
//   Phase 1: BUILDING — place new structures (skipped if agent active)
//   Phase 2: ROLES   — assign/rebalance all idle villagers (ALWAYS runs)
// This ensures villages never stall with idle workers, even when
// an agent is controlling building placement.

const GOVERNOR_INTERVAL = 3;

// Roles that require specific buildings
const ROLE_BUILDING = {
  farmer:    ['farm'],
  fisherman: ['dock'],
  hunter:    ['hunting_lodge'],
  builder:   ['workshop'],
  scholar:   ['library'],
  priest:    ['temple'],
  warrior:   ['barracks'],
};

// Personality affinities for smart role assignment
const ROLE_PERSONALITY = {
  farmer:    { temperament: 0.4,  creativity: -0.2, sociability: 0.1  },
  fisherman: { temperament: 0.3,  creativity: 0,    sociability: 0.3  },
  hunter:    { temperament: -0.4, creativity: 0,    sociability: -0.3 },
  builder:   { temperament: 0.1,  creativity: 0.4,  sociability: 0.1  },
  scholar:   { temperament: 0.2,  creativity: 0.5,  sociability: -0.1 },
  priest:    { temperament: 0.3,  creativity: 0.1,  sociability: 0.4  },
  warrior:   { temperament: -0.5, creativity: -0.1, sociability: 0    },
  scout:     { temperament: -0.1, creativity: 0.1,  sociability: -0.4 },
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

  const AGENT_TIMEOUT = 6 * 60 * 1000;
  const agentActive = world.last_agent_heartbeat &&
    (Date.now() - new Date(world.last_agent_heartbeat + 'Z').getTime()) < AGENT_TIMEOUT;

  const center = getCenter(world.seed);
  const pop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
  if (pop === 0) return events;

  const idle = db.prepare("SELECT id, name, temperament, creativity, sociability FROM villagers WHERE world_id = ? AND status = 'alive' AND role = 'idle'").all(worldId);
  const resources = db.prepare('SELECT type, amount, capacity FROM resources WHERE world_id = ?').all(worldId);
  const resMap = {}, resCap = {};
  for (const r of resources) { resMap[r.type] = r.amount; resCap[r.type] = r.capacity || 200; }

  const activeBuildings = db.prepare("SELECT type, id FROM buildings WHERE world_id = ? AND status = 'active'").all(worldId);
  const constructing = db.prepare("SELECT type FROM buildings WHERE world_id = ? AND status = 'constructing'").all(worldId);
  const buildingSet = new Set(activeBuildings.map(b => b.type));
  const constructingSet = new Set(constructing.map(b => b.type));
  const buildingCounts = {};
  for (const b of activeBuildings) buildingCounts[b.type] = (buildingCounts[b.type] || 0) + 1;

  const capRow = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 WHEN type = 'spawning_pools' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId);
  const popCap = capRow.cap;

  const roleCounts = {};
  const roleRows = db.prepare("SELECT role, COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive' GROUP BY role").all(worldId);
  for (const r of roleRows) roleCounts[r.role] = r.c;

  const food = resMap.food || 0;
  const wood = resMap.wood || 0;
  const stone = resMap.stone || 0;
  const foodCap = resCap.food || 200;
  const woodCap = resCap.wood || 200;
  const stoneCap = resCap.stone || 200;

  // ─── HELPERS ───

  function assignRole(role) {
    if (idle.length === 0) return false;
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < idle.length; i++) {
      const s = scoreForRole(idle[i], role);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    }
    const v = idle.splice(bestIdx, 1)[0];
    const types = ROLE_BUILDING[role];
    let buildingId = null;
    if (role === 'warrior') {
      const barracks = db.prepare(
        "SELECT b.id, (SELECT COUNT(*) FROM villagers v2 WHERE v2.assigned_building_id = b.id AND v2.role = 'warrior' AND v2.status = 'alive') as wc FROM buildings b WHERE b.world_id = ? AND b.type = 'barracks' AND b.status = 'active' ORDER BY wc ASC LIMIT 1"
      ).get(worldId);
      if (barracks && barracks.wc < 5) buildingId = barracks.id;
      else return false;
    } else if (types) {
      const placeholders = types.map(() => '?').join(',');
      const b = db.prepare(
        `SELECT id FROM buildings WHERE world_id = ? AND type IN (${placeholders}) AND status = 'active' LIMIT 1`
      ).get(worldId, ...types);
      if (b) buildingId = b.id;
    }
    const wType = role === 'warrior' ? computeWarriorType(v) : null;
    db.prepare('UPDATE villagers SET role = ?, assigned_building_id = ?, ascii_sprite = ?, warrior_type = ? WHERE id = ? AND world_id = ?')
      .run(role, buildingId, role, wType, v.id, worldId);
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    events.push({
      type: 'governor',
      title: `${v.name} becomes ${role}`,
      description: `The village decided ${v.name} should work as a ${role}.`,
      severity: 'info',
    });
    return true;
  }

  // Demote a villager from a role back to idle (for rebalancing)
  function demoteRole(role, count) {
    if (count <= 0) return 0;
    // Pick the least experienced villagers of this role to demote
    const workers = db.prepare(
      "SELECT id, name, temperament, creativity, sociability FROM villagers WHERE world_id = ? AND role = ? AND status = 'alive' ORDER BY experience ASC LIMIT ?"
    ).all(worldId, role, count);
    let demoted = 0;
    for (const v of workers) {
      db.prepare("UPDATE villagers SET role = 'idle', assigned_building_id = NULL, ascii_sprite = 'idle', warrior_type = NULL WHERE id = ? AND world_id = ?")
        .run(v.id, worldId);
      idle.push(v);
      demoted++;
      events.push({
        type: 'governor',
        title: `${v.name} reassigned`,
        description: `${v.name} was relieved of ${role} duties to fill a more pressing need.`,
        severity: 'info',
      });
    }
    roleCounts[role] = Math.max(0, (roleCounts[role] || 0) - demoted);
    return demoted;
  }

  function tryBuild(type) {
    if (constructingSet.has(type)) return false;
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
    constructingSet.add(type);
    events.push({
      type: 'governor',
      title: `Village builds ${type}`,
      description: `The village has decided to construct a ${type.replace(/_/g, ' ')}.`,
      severity: 'info',
    });
    return true;
  }

  // Assign N villagers to a role (batch)
  function assignMultiple(role, count) {
    let assigned = 0;
    for (let i = 0; i < count && idle.length > 0; i++) {
      if (assignRole(role)) assigned++;
      else break;
    }
    return assigned;
  }

  // ════════════════════════════════════════════
  // PHASE 1: BUILDINGS (one per tick, skip if agent active)
  // ════════════════════════════════════════════

  // Food crisis building: always allowed
  if (food < pop * 3 && (buildingCounts.farm || 0) < 2 && !constructingSet.has('farm')) {
    tryBuild('farm');
  }

  // Pop cap: always allowed
  if (pop >= popCap - 1 && pop >= 3) {
    tryBuild('hut');
  }

  // Strategic buildings: skip if agent active
  if (!agentActive) {
    // Workshop
    if (!buildingSet.has('workshop') && pop >= 4) tryBuild('workshop');

    // Storehouse
    if (!buildingSet.has('storehouse') && pop >= 5 && food > 30) tryBuild('storehouse');

    // Model shrine
    if (!buildingSet.has('model_shrine') && !constructingSet.has('model_shrine') && pop >= 6) tryBuild('model_shrine');

    // Defense chain: watchtower → wall → barracks
    if (!buildingSet.has('watchtower') && pop >= 5) tryBuild('watchtower');
    if (!buildingSet.has('wall') && pop >= 6) tryBuild('wall');
    if (!buildingSet.has('barracks') && buildingSet.has('wall') && pop >= 7) tryBuild('barracks');

    // Scale barracks with pop: 1 per 20 pop, need wall first
    if (buildingSet.has('barracks') && pop >= 20) {
      const targetBarracks = Math.min(4, Math.floor(pop / 20) + 1);
      if ((buildingCounts.barracks || 0) < targetBarracks) tryBuild('barracks');
    }

    // Food diversity
    if (!buildingSet.has('dock') && pop >= 5 && food > 15) tryBuild('dock');
    if (!buildingSet.has('hunting_lodge') && pop >= 6 && food > 15) tryBuild('hunting_lodge');

    // Culture
    if (!buildingSet.has('temple') && pop >= 7 && (resMap.faith || 0) < 5) tryBuild('temple');
    if (!buildingSet.has('library') && pop >= 8) tryBuild('library');

    // Economy
    if (!buildingSet.has('market') && pop >= 9 && food > 20) tryBuild('market');

    // Scale farms
    if ((buildingCounts.farm || 0) < 3 && pop >= 8 && food < pop * 5) tryBuild('farm');

    // More huts
    if (pop >= popCap - 1) tryBuild('hut');

    // Endgame megastructures
    const stageInfo = getGrowthStage(worldId);
    if (stageInfo.stage >= 4) {
      const MEGAS = ['shell_archive', 'abyssal_beacon', 'molt_cathedral', 'spawning_pools'];
      for (const mega of MEGAS) {
        if (!buildingSet.has(mega) && !constructingSet.has(mega)) {
          tryBuild(mega);
          break;
        }
      }
    }

    // Second workshop if pop is high and wood/stone are suffering
    if ((buildingCounts.workshop || 0) < 2 && pop >= 15 && (wood < woodCap * 0.15 || stone < stoneCap * 0.15)) {
      tryBuild('workshop');
    }
  }

  // ════════════════════════════════════════════
  // PHASE 2: RESOURCE REBALANCING (always runs)
  // ════════════════════════════════════════════

  // If food is abundant but wood/stone are critically low,
  // demote excess farmers to idle so they can be reassigned to builders
  const foodPct = food / Math.max(1, foodCap);
  const woodPct = wood / Math.max(1, woodCap);
  const stonePct = stone / Math.max(1, stoneCap);
  const farmers = roleCounts.farmer || 0;
  const builders = roleCounts.builder || 0;

  // Keep a minimum number of farmers based on population
  const minFarmers = Math.max(2, Math.ceil(pop / 15));

  if (foodPct > 0.6 && (woodPct < 0.15 || stonePct < 0.15) && farmers > minFarmers && buildingSet.has('workshop')) {
    // Demote excess farmers — convert up to half the surplus
    const surplus = farmers - minFarmers;
    const toDemote = Math.min(surplus, Math.max(1, Math.ceil(surplus / 2)));
    demoteRole('farmer', toDemote);
  }

  // ════════════════════════════════════════════
  // PHASE 3: ROLE ASSIGNMENT (always runs, batch)
  // ════════════════════════════════════════════

  if (idle.length === 0) return events;

  // 3a. FOOD CRISIS: if food is low, assign farmers first
  if (food < pop * 3) {
    const farmCap = (buildingCounts.farm || 0) * 3;
    const needed = Math.min(idle.length, Math.max(1, farmCap - (roleCounts.farmer || 0)));
    if (needed > 0 && buildingSet.has('farm')) assignMultiple('farmer', needed);

    // Also try fishermen and hunters
    if (idle.length > 0 && buildingSet.has('dock') && (roleCounts.fisherman || 0) < (buildingCounts.dock || 0) * 2) {
      assignMultiple('fisherman', (buildingCounts.dock || 0) * 2 - (roleCounts.fisherman || 0));
    }
    if (idle.length > 0 && buildingSet.has('hunting_lodge') && (roleCounts.hunter || 0) < (buildingCounts.hunting_lodge || 0) * 2) {
      assignMultiple('hunter', (buildingCounts.hunting_lodge || 0) * 2 - (roleCounts.hunter || 0));
    }
  }

  if (idle.length === 0) return events;

  // 3b. TARGET-BASED ASSIGNMENT for all roles
  // Calculate ideal role distribution based on pop + available buildings

  // Builders: at least 2 when workshop exists, scale with pop
  if (buildingSet.has('workshop')) {
    const targetBuilders = Math.max(2, Math.floor(pop / 12));
    const need = targetBuilders - (roleCounts.builder || 0);
    if (need > 0) assignMultiple('builder', need);
  }

  // Scout: always 1
  if ((roleCounts.scout || 0) === 0 && pop >= 4) {
    assignRole('scout');
  }

  // Warriors: scale with pop, capped by barracks slots
  if (buildingSet.has('barracks')) {
    const barracksSlots = (buildingCounts.barracks || 0) * 5;
    const targetWarriors = Math.min(barracksSlots, Math.max(2, Math.floor(pop / 6)));
    const need = targetWarriors - (roleCounts.warrior || 0);
    if (need > 0) assignMultiple('warrior', need);
  }

  // Priests: 1 per temple
  if (buildingSet.has('temple')) {
    const targetPriests = Math.min(2, buildingCounts.temple || 0);
    const need = targetPriests - (roleCounts.priest || 0);
    if (need > 0) assignMultiple('priest', need);
  }

  // Scholars: 1 per library
  if (buildingSet.has('library')) {
    const targetScholars = Math.min(2, buildingCounts.library || 0);
    const need = targetScholars - (roleCounts.scholar || 0);
    if (need > 0) assignMultiple('scholar', need);
  }

  // Food diversity: fishermen + hunters
  if (buildingSet.has('dock')) {
    const targetFishers = Math.min(2, (buildingCounts.dock || 0) * 2);
    const need = targetFishers - (roleCounts.fisherman || 0);
    if (need > 0) assignMultiple('fisherman', need);
  }
  if (buildingSet.has('hunting_lodge')) {
    const targetHunters = Math.min(2, (buildingCounts.hunting_lodge || 0) * 2);
    const need = targetHunters - (roleCounts.hunter || 0);
    if (need > 0) assignMultiple('hunter', need);
  }

  // 3c. REMAINING IDLE → farmers or builders based on what's needed
  if (idle.length > 0) {
    // Split remaining between farmers and builders based on resource needs
    const needsWood = woodPct < 0.3;
    const needsStone = stonePct < 0.3;
    const needsFood = foodPct < 0.5;

    while (idle.length > 0) {
      if ((needsWood || needsStone) && buildingSet.has('workshop')) {
        if (!assignRole('builder')) break;
      } else if (needsFood && buildingSet.has('farm')) {
        if (!assignRole('farmer')) break;
      } else if (buildingSet.has('farm')) {
        // Default: alternate between farmer and builder
        if ((roleCounts.builder || 0) < (roleCounts.farmer || 0) && buildingSet.has('workshop')) {
          if (!assignRole('builder')) {
            if (!assignRole('farmer')) break;
          }
        } else {
          if (!assignRole('farmer')) break;
        }
      } else {
        break; // no buildings to assign to
      }
    }
  }

  return events;
}

module.exports = { processGovernor };
