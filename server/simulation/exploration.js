const db = require('../db/connection');
const { MAP_SIZE } = require('../world/map');

function processExploration(worldId) {
  const events = [];

  // Find scouts
  const scouts = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND role = 'scout' AND status = 'alive'"
  ).all(worldId);

  if (scouts.length === 0) return events;

  // Each scout reveals 1-2 random unexplored tiles adjacent to explored area
  const unexploredBorder = db.prepare(`
    SELECT t.x, t.y, t.terrain, t.feature FROM tiles t
    WHERE t.world_id = ? AND t.explored = 0
    AND EXISTS (
      SELECT 1 FROM tiles t2
      WHERE t2.world_id = t.world_id
      AND t2.explored = 1
      AND ABS(t2.x - t.x) <= 1
      AND ABS(t2.y - t.y) <= 1
      AND (t2.x != t.x OR t2.y != t.y)
    )
  `).all(worldId);

  if (unexploredBorder.length === 0) return events;

  const reveal = db.prepare(
    'UPDATE tiles SET explored = 1 WHERE world_id = ? AND x = ? AND y = ?'
  );

  let revealed = 0;
  const maxReveal = scouts.length * 2;

  // Shuffle border tiles
  for (let i = unexploredBorder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unexploredBorder[i], unexploredBorder[j]] = [unexploredBorder[j], unexploredBorder[i]];
  }

  for (const tile of unexploredBorder) {
    if (revealed >= maxReveal) break;
    reveal.run(worldId, tile.x, tile.y);
    revealed++;

    // Discover feature
    if (tile.feature) {
      events.push({
        type: 'discovery',
        title: `Scouts found ${tile.feature.replace('_', ' ')}!`,
        description: `Your scouts discovered a ${tile.feature.replace('_', ' ')} at (${tile.x}, ${tile.y}) in ${tile.terrain} terrain.`,
        severity: 'info',
      });
    }
  }

  if (revealed > 0 && events.length === 0) {
    events.push({
      type: 'discovery',
      title: `Scouts explored ${revealed} tiles`,
      description: `Your scouts revealed ${revealed} new tiles of the map.`,
      severity: 'info',
    });
  }

  // ─── LEGENDARY BUILDING DISCOVERY ───
  // 5% chance per exploration tick when scouts reveal tiles
  if (revealed > 0 && Math.random() < 0.05) {
    const culture = db.prepare(
      'SELECT violence_level, creativity_level, cooperation_level FROM culture WHERE world_id = ?'
    ).get(worldId);

    if (culture) {
      const totalCulture = (culture.violence_level || 0) + (culture.creativity_level || 0) + (culture.cooperation_level || 0);

      // Require minimum combined culture level before legendary discoveries
      if (totalCulture >= 100) {
        const LEGENDARY_BUILDINGS = [
          { type: 'ancient_forge',   name: 'Ancient Forge',   terrains: ['mountain', 'desert'],  bonus: { type: 'stone', amount: 30 } },
          { type: 'sunken_temple',   name: 'Sunken Temple',   terrains: ['plains', 'forest'],    bonus: { type: 'faith', amount: 20 } },
          { type: 'crystal_spire',   name: 'Crystal Spire',   terrains: ['plains', 'desert'],    bonus: { type: 'knowledge', amount: 25 } },
          { type: 'shadow_keep',     name: 'Shadow Keep',     terrains: ['forest', 'mountain'],  bonus: { type: 'crypto', amount: 20 } },
          { type: 'elder_library',   name: 'Elder Library',   terrains: ['plains', 'forest'],    bonus: { type: 'knowledge', amount: 30 } },
          { type: 'war_monument',    name: 'War Monument',    terrains: ['plains', 'mountain'],  bonus: { type: 'crypto', amount: 15 } },
        ];

        const chosen = LEGENDARY_BUILDINGS[Math.floor(Math.random() * LEGENDARY_BUILDINGS.length)];

        // Find a suitable unexplored tile to place the legendary building
        const farTile = db.prepare(`
          SELECT x, y, terrain FROM tiles WHERE world_id = ? AND explored = 0
          AND terrain IN (${chosen.terrains.map(() => '?').join(',')})
          ORDER BY RANDOM() LIMIT 1
        `).get(worldId, ...chosen.terrains);

        if (farTile) {
          db.prepare('UPDATE tiles SET feature = ?, explored = 1 WHERE world_id = ? AND x = ? AND y = ?')
            .run(chosen.type, worldId, farTile.x, farTile.y);

          db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?")
            .run(chosen.bonus.amount, worldId, chosen.bonus.type);

          events.push({
            type: 'legendary_discovery',
            title: `Scouts discovered the ${chosen.name}!`,
            description: `Your scouts found a legendary ${chosen.name} at (${farTile.x}, ${farTile.y})! This ancient structure holds great power. +${chosen.bonus.amount} ${chosen.bonus.type}.`,
            severity: 'celebration',
          });
        }
      }
    }
  }

  return events;
}

module.exports = { processExploration };
