const db = require('../db/connection');
const { MEGA_RESOURCE_RATE, MEGA_RESOURCE_CAPACITY } = require('./constants');

// Each megastructure produces a unique resource
const MEGA_RESOURCE_MAP = {
  shell_archive:  'shell_lore',       // ancient knowledge encoded in shells
  abyssal_beacon: 'abyssal_essence',  // deep energy from the abyss
  molt_cathedral: 'divine_carapace',  // sacred molted armor
  spawning_pools: 'life_essence',     // concentrated vitality
};

// Check if a world has an active megastructure of the given type
function hasMegastructure(worldId, type) {
  return db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = ? AND status = 'active'"
  ).get(worldId, type).c > 0;
}

// Produce unique resources from active megastructures
function processMegastructureResources(worldId) {
  const events = [];
  for (const [megaType, resourceType] of Object.entries(MEGA_RESOURCE_MAP)) {
    if (!hasMegastructure(worldId, megaType)) continue;

    // Ensure resource row exists (INSERT OR IGNORE for safety)
    db.prepare(
      'INSERT OR IGNORE INTO resources (world_id, type, amount, capacity) VALUES (?, ?, 0, ?)'
    ).run(worldId, resourceType, MEGA_RESOURCE_CAPACITY);

    // Produce
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?'
    ).run(MEGA_RESOURCE_RATE, worldId, resourceType);
  }
  return events;
}

module.exports = { hasMegastructure, processMegastructureResources, MEGA_RESOURCE_MAP };
