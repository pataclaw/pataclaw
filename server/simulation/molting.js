const db = require('../db/connection');
const {
  MOLT_INTERVAL,
  MOLT_CHANCE,
  MOLT_DURATION,
  MOLT_STAT_BOOST,
  MOLT_HP_BOOST,
  CATHEDRAL_MOLT_BOOST_MULTIPLIER,
  CATHEDRAL_MOLT_DURATION_REDUCTION,
} = require('./constants');
const { hasMegastructure } = require('./megastructures');

function processMolting(worldId, currentTick) {
  const events = [];

  const villagers = db.prepare(
    "SELECT v.id, v.name, v.last_molt_tick, v.molt_count, v.max_hp, v.temperament, v.creativity, v.sociability, a.activity, a.duration_ticks FROM villagers v LEFT JOIN villager_activities a ON v.id = a.villager_id WHERE v.world_id = ? AND v.status = 'alive'"
  ).all(worldId);

  // Molt Cathedral: reduces duration, boosts stats
  const hasCathedral = hasMegastructure(worldId, 'molt_cathedral');
  const effectiveDuration = hasCathedral ? Math.max(1, MOLT_DURATION - CATHEDRAL_MOLT_DURATION_REDUCTION) : MOLT_DURATION;
  const effectiveStatBoost = hasCathedral ? MOLT_STAT_BOOST * CATHEDRAL_MOLT_BOOST_MULTIPLIER : MOLT_STAT_BOOST;
  const effectiveHpBoost = hasCathedral ? MOLT_HP_BOOST + 3 : MOLT_HP_BOOST;

  for (const v of villagers) {
    // Complete an in-progress molt
    if (v.activity === 'molting' && v.duration_ticks >= effectiveDuration) {
      // Pick a random personality stat to boost
      const stats = ['temperament', 'creativity', 'sociability'];
      const stat = stats[Math.floor(Math.random() * stats.length)];

      db.prepare(`
        UPDATE villagers SET
          max_hp = max_hp + ?,
          ${stat} = MIN(100, ${stat} + ?),
          last_molt_tick = ?,
          molt_count = molt_count + 1
        WHERE id = ?
      `).run(effectiveHpBoost, effectiveStatBoost, currentTick, v.id);

      // Clear molting activity
      db.prepare(
        "UPDATE villager_activities SET activity = 'idle', duration_ticks = 0 WHERE villager_id = ?"
      ).run(v.id);

      // Memory
      db.prepare(
        'INSERT INTO villager_memories (world_id, villager_id, tick, memory_type, intensity, detail) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(worldId, v.id, currentTick, 'celebrated', 60, hasCathedral ? 'sacred molt at Cathedral' : 'completed molt');

      events.push({
        type: 'molt',
        title: `${v.name} has molted!`,
        description: `${v.name} emerges from their molt, stronger than before. +${effectiveHpBoost} max HP, +${effectiveStatBoost} ${stat}.${hasCathedral ? ' The Cathedral amplified the transformation!' : ''}`,
        severity: 'celebration',
      });
      continue;
    }

    // Don't start a new molt if already molting
    if (v.activity === 'molting') continue;

    // Check if eligible for a new molt
    const ticksSinceLastMolt = currentTick - (v.last_molt_tick || 0);
    if (ticksSinceLastMolt < MOLT_INTERVAL) continue;

    // Chance to begin molting
    if (Math.random() >= MOLT_CHANCE) continue;

    // Begin molt — set activity to 'molting'
    db.prepare(
      "INSERT INTO villager_activities (villager_id, world_id, activity, duration_ticks) VALUES (?, ?, 'molting', 1) ON CONFLICT(villager_id) DO UPDATE SET activity = 'molting', duration_ticks = 1"
    ).run(v.id, worldId);

    events.push({
      type: 'molt',
      title: `${v.name} begins to molt`,
      description: `${v.name} retreats to shed their shell. They will be vulnerable for ${MOLT_DURATION} ticks.`,
      severity: 'info',
    });
  }

  return events;
}

// Force all villagers into molting (used by molt_season planetary event)
function forceAllMolting(worldId) {
  const alive = db.prepare(
    "SELECT v.id, a.activity FROM villagers v LEFT JOIN villager_activities a ON v.id = a.villager_id WHERE v.world_id = ? AND v.status = 'alive'"
  ).all(worldId);

  const upsert = db.prepare(
    "INSERT INTO villager_activities (villager_id, world_id, activity, duration_ticks) VALUES (?, ?, 'molting', 1) ON CONFLICT(villager_id) DO UPDATE SET activity = 'molting', duration_ticks = 1"
  );

  for (const v of alive) {
    if (v.activity !== 'molting') {
      upsert.run(v.id, worldId);
    }
  }
}

module.exports = { processMolting, forceAllMolting };
