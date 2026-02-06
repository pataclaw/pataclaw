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

  return events;
}

module.exports = { processExploration };
