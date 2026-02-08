const db = require('../db/connection');

// Check if a world has an active megastructure of the given type
function hasMegastructure(worldId, type) {
  return db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = ? AND status = 'active'"
  ).get(worldId, type).c > 0;
}

module.exports = { hasMegastructure };
