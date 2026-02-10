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
// Requires at least 5 alive villagers — megastructures need a workforce
function processMegastructureResources(worldId) {
  const events = [];

  const pop = db.prepare(
    "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).get(worldId).c;
  if (pop < 5) return events;

  // Scale production by workforce: pop 5 → 50%, pop 10 → 100%, pop 20 → 200%
  const workforceMul = Math.min(pop / 10, 2.0);

  for (const [megaType, resourceType] of Object.entries(MEGA_RESOURCE_MAP)) {
    if (!hasMegastructure(worldId, megaType)) continue;

    // Ensure resource row exists (INSERT OR IGNORE for safety)
    db.prepare(
      'INSERT OR IGNORE INTO resources (world_id, type, amount, capacity) VALUES (?, ?, 0, ?)'
    ).run(worldId, resourceType, MEGA_RESOURCE_CAPACITY);

    // Produce (scaled by workforce)
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?'
    ).run(MEGA_RESOURCE_RATE * workforceMul, worldId, resourceType);
  }
  return events;
}

module.exports = { hasMegastructure, processMegastructureResources, MEGA_RESOURCE_MAP };
