const db = require('../db/connection');

// ─── RESOURCE NODE SYSTEM ───
// Trees, rocks, and fish spots are physical objects near buildings.
// They deplete as villagers gather and respawn after a cooldown.

const NODE_DEFS = {
  tree:      { perBuilding: 3, maxHealth: 8,  respawnTicks: 12, building: 'workshop' },
  rock:      { perBuilding: 2, maxHealth: 10, respawnTicks: 15, building: 'workshop' },
  fish_spot: { perBuilding: 3, maxHealth: 6,  respawnTicks: 10, building: 'dock' },
};

// Activity → node type mapping
const ACTIVITY_NODE = {
  chopping: 'tree',
  mining: 'rock',
  fishing: 'fish_spot',
};

// Ensure the right number of nodes exist for each building
function ensureNodes(worldId) {
  for (const [nodeType, def] of Object.entries(NODE_DEFS)) {
    const buildings = db.prepare(
      "SELECT id FROM buildings WHERE world_id = ? AND type = ? AND status = 'active'"
    ).all(worldId, def.building);

    for (const b of buildings) {
      const existing = db.prepare(
        'SELECT COUNT(*) as c FROM resource_nodes WHERE world_id = ? AND building_id = ?  AND type = ?'
      ).get(worldId, b.id, nodeType).c;

      if (existing < def.perBuilding) {
        const toCreate = def.perBuilding - existing;
        const insertStmt = db.prepare(
          'INSERT INTO resource_nodes (world_id, type, building_id, x, health, max_health) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (let i = 0; i < toCreate; i++) {
          // x offset: spread nodes out (existing + i gives unique offset per node)
          const offset = existing + i;
          insertStmt.run(worldId, nodeType, b.id, offset, def.maxHealth, def.maxHealth);
        }
      }
    }

    // Clean up nodes for destroyed/missing buildings
    db.prepare(`
      DELETE FROM resource_nodes WHERE world_id = ? AND type = ?
        AND building_id NOT IN (
          SELECT id FROM buildings WHERE world_id = ? AND type = ? AND status = 'active'
        )
    `).run(worldId, nodeType, worldId, def.building);
  }
}

// Process node depletion (called from tick) and respawn
function processResourceNodes(worldId, tick) {
  const events = [];

  // 1. Ensure nodes exist for all active buildings
  ensureNodes(worldId);

  // 2. Deplete nodes based on villager activities
  const activities = db.prepare(
    "SELECT va.activity, v.assigned_building_id FROM villager_activities va JOIN villagers v ON va.villager_id = v.id WHERE va.world_id = ? AND v.status = 'alive'"
  ).all(worldId);

  // Count gatherers per building per activity
  const gatherCounts = {}; // { buildingId: { tree: N, rock: N, fish_spot: N } }
  for (const a of activities) {
    const nodeType = ACTIVITY_NODE[a.activity];
    if (!nodeType || !a.assigned_building_id) continue;
    if (!gatherCounts[a.assigned_building_id]) gatherCounts[a.assigned_building_id] = {};
    gatherCounts[a.assigned_building_id][nodeType] = (gatherCounts[a.assigned_building_id][nodeType] || 0) + 1;
  }

  // Apply depletion: each gatherer reduces 1 HP from the first active node of that type
  for (const [buildingId, types] of Object.entries(gatherCounts)) {
    for (const [nodeType, count] of Object.entries(types)) {
      // Get active nodes for this building, ordered by health (target lowest first)
      const nodes = db.prepare(
        'SELECT id, health FROM resource_nodes WHERE world_id = ? AND building_id = ? AND type = ? AND depleted_tick IS NULL ORDER BY health ASC'
      ).all(worldId, buildingId, nodeType);

      let remaining = count;
      for (const node of nodes) {
        if (remaining <= 0) break;
        const damage = Math.min(remaining, node.health);
        const newHealth = node.health - damage;
        if (newHealth <= 0) {
          db.prepare('UPDATE resource_nodes SET health = 0, depleted_tick = ? WHERE id = ?').run(tick, node.id);
        } else {
          db.prepare('UPDATE resource_nodes SET health = ? WHERE id = ?').run(newHealth, node.id);
        }
        remaining -= damage;
      }
    }
  }

  // 3. Respawn depleted nodes
  for (const [nodeType, def] of Object.entries(NODE_DEFS)) {
    db.prepare(
      'UPDATE resource_nodes SET health = max_health, depleted_tick = NULL WHERE world_id = ? AND type = ? AND depleted_tick IS NOT NULL AND ? - depleted_tick >= ?'
    ).run(worldId, nodeType, tick, def.respawnTicks);
  }

  return events;
}

// Get availability counts for activity weight gating
function getNodeAvailability(worldId) {
  const result = { trees: { active: 0, total: 0 }, rocks: { active: 0, total: 0 }, fish: { active: 0, total: 0 } };

  const rows = db.prepare(
    'SELECT type, COUNT(*) as total, SUM(CASE WHEN depleted_tick IS NULL THEN 1 ELSE 0 END) as active FROM resource_nodes WHERE world_id = ? GROUP BY type'
  ).all(worldId);

  for (const r of rows) {
    if (r.type === 'tree') { result.trees.active = r.active; result.trees.total = r.total; }
    else if (r.type === 'rock') { result.rocks.active = r.active; result.rocks.total = r.total; }
    else if (r.type === 'fish_spot') { result.fish.active = r.active; result.fish.total = r.total; }
  }

  return result;
}

// Get node ratio for a specific building (for production gating in resources.js)
function getNodeRatio(worldId, buildingId, nodeType) {
  const row = db.prepare(
    'SELECT COUNT(*) as total, SUM(CASE WHEN depleted_tick IS NULL THEN 1 ELSE 0 END) as active FROM resource_nodes WHERE world_id = ? AND building_id = ? AND type = ?'
  ).get(worldId, buildingId, nodeType);
  if (!row || row.total === 0) return 1.0; // no nodes yet = full production (backward compat)
  return row.active / row.total;
}

// Get all nodes for client frame rendering
function getNodesForFrame(worldId) {
  return db.prepare(
    'SELECT rn.type, rn.building_id, rn.x as offset_idx, rn.health, rn.max_health, rn.depleted_tick, b.x as bx, b.type as building_type FROM resource_nodes rn JOIN buildings b ON rn.building_id = b.id WHERE rn.world_id = ?'
  ).all(worldId);
}

module.exports = { processResourceNodes, getNodeAvailability, getNodeRatio, getNodesForFrame };
