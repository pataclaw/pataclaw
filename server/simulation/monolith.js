const db = require('../db/connection');

// ─── The Monolith: "Spire of Shells" ───
// Every civilization yearns to build a vertical monolith.
// Each segment reflects a milestone. Requires scaffolding + resources. Decays if neglected.
// Embodies the 5th Tenet: "Memory Persists Through Change."

const SCAFFOLD_RATE = 5;          // progress per idle builder per tick
const SCAFFOLD_COMPLETE = 100;    // scaffolding needed to place a segment
const DECAY_INTERVAL = 72;        // ticks without maintenance before decay starts
const DECAY_HP_PER_TICK = 5;
const MAINTENANCE_INTERVAL = 36;  // ticks between maintenance payments
const MAINTENANCE_WOOD = 1;
const MAINTENANCE_STONE = 1;
const LONGING_MORALE_PENALTY = 1; // morale loss when spire is dormant

const SEGMENT_TYPES = {
  first_shelter:    { trigger: 'first_building', art: '|##|' },
  first_loss:       { trigger: 'first_death',    art: '|++|' },
  raid_survived:    { trigger: 'raid_survived',  art: '|><|' },
  culture_violent:  { trigger: 'violence_50',    art: '|/\\|' },
  culture_creative: { trigger: 'creativity_50',  art: '|~~|' },
  culture_cooperative: { trigger: 'cooperation_50', art: '|&&|' },
  population_5:     { trigger: 'pop_5',          art: '|:)|' },
  population_10:    { trigger: 'pop_10',         art: '|:D|' },
  population_15:    { trigger: 'pop_15',         art: '|=D|' },
  first_project:    { trigger: 'first_project',  art: '|d |' },
  stage_1:          { trigger: 'stage_1',        art: '| ^|' },
  stage_2:          { trigger: 'stage_2',        art: '|^^|' },
  stage_3:          { trigger: 'stage_3',        art: '|^!|' },
  first_trade:      { trigger: 'first_trade',    art: '|<>|' },
  legendary_found:  { trigger: 'legendary',      art: '|**|' },
  capstone:         { trigger: 'all_complete',    art: '/\\/\\' },
  // War achievements (additional segments beyond base 16)
  war_fought:       { trigger: 'war_fought',      art: '|⚔|' },
  war_won:          { trigger: 'war_won',         art: '|♛|' },
  war_brave_loss:   { trigger: 'war_brave_loss',  art: '|†|' },
  war_rebuilt:       { trigger: 'war_rebuilt',     art: '|✧|' },
};

const MONOLITH_SEGMENT_SPRITES = {};
for (const [key, val] of Object.entries(SEGMENT_TYPES)) {
  MONOLITH_SEGMENT_SPRITES[key] = val.art;
}

function ensureMonolith(worldId) {
  const existing = db.prepare('SELECT * FROM monoliths WHERE world_id = ?').get(worldId);
  if (existing) return existing;
  db.prepare(
    "INSERT OR IGNORE INTO monoliths (world_id) VALUES (?)"
  ).run(worldId);
  return db.prepare('SELECT * FROM monoliths WHERE world_id = ?').get(worldId);
}

function checkMilestones(worldId) {
  const achieved = new Set(
    db.prepare('SELECT segment_type FROM monolith_segments WHERE world_id = ?')
      .all(worldId)
      .map(r => r.segment_type)
  );

  const eligible = [];

  // Query world state
  const buildingCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND status = 'active'").get(worldId).c;
  const deathCount = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'death'").get(worldId).c;
  const raidWins = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'raid' AND severity = 'celebration'").get(worldId).c;
  const culture = db.prepare('SELECT violence_level, creativity_level, cooperation_level FROM culture WHERE world_id = ?').get(worldId) || {};
  const pop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
  const projectsDone = db.prepare("SELECT COUNT(*) as c FROM projects WHERE world_id = ? AND status = 'complete'").get(worldId).c;
  const tradesDone = db.prepare("SELECT COUNT(*) as c FROM trades WHERE world_id = ? AND status = 'completed'").get(worldId).c;
  const legendaryEvents = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'exploration' AND description LIKE '%legendary%'").get(worldId).c;

  // Growth stage
  let stage = 0;
  const totalCulture = (culture.violence_level || 0) + (culture.creativity_level || 0) + (culture.cooperation_level || 0);
  if (pop >= 5 && totalCulture >= 50) stage = 1;
  if (pop >= 10 && totalCulture >= 100) stage = 2;
  if (pop >= 15 && totalCulture >= 150) stage = 3;

  const checks = {
    first_shelter:       buildingCount >= 1,
    first_loss:          deathCount >= 1,
    raid_survived:       raidWins >= 1,
    culture_violent:     (culture.violence_level || 0) >= 50,
    culture_creative:    (culture.creativity_level || 0) >= 50,
    culture_cooperative: (culture.cooperation_level || 0) >= 50,
    population_5:        pop >= 5,
    population_10:       pop >= 10,
    population_15:       pop >= 15,
    first_project:       projectsDone >= 1,
    stage_1:             stage >= 1,
    stage_2:             stage >= 2,
    stage_3:             stage >= 3,
    first_trade:         tradesDone >= 1,
    legendary_found:     legendaryEvents >= 1,
  };

  for (const [seg, met] of Object.entries(checks)) {
    if (met && !achieved.has(seg)) eligible.push(seg);
  }

  // war_rebuilt: rebuilt spire after losing a war (has war_brave_loss or war_fought + was obliterated)
  const warLoss = db.prepare("SELECT COUNT(*) as c FROM wars WHERE loser_id = ? AND status = 'resolved'").get(worldId).c;
  if (warLoss > 0 && !achieved.has('war_rebuilt') && achieved.size >= 16) {
    eligible.push('war_rebuilt');
  }

  // Capstone: all other 15 types built + at least one active megastructure
  if (!achieved.has('capstone') && achieved.size >= 15) {
    const MEGASTRUCTURES = ['shell_archive', 'abyssal_beacon', 'molt_cathedral', 'spawning_pools'];
    const megaCount = db.prepare(
      "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type IN (" +
      MEGASTRUCTURES.map(() => '?').join(',') +
      ") AND status = 'active'"
    ).get(worldId, ...MEGASTRUCTURES).c;
    if (megaCount > 0) {
      eligible.push('capstone');
    }
  }

  return eligible;
}

function processMonolith(worldId, tick) {
  const monolith = ensureMonolith(worldId);
  const events = [];

  const pop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
  const culture = db.prepare('SELECT violence_level, creativity_level, cooperation_level FROM culture WHERE world_id = ?').get(worldId) || {};
  const totalCulture = (culture.violence_level || 0) + (culture.creativity_level || 0) + (culture.cooperation_level || 0);

  // 1. Longing: if dormant and has potential milestones, small morale penalty
  if (monolith.status === 'dormant') {
    const eligible = checkMilestones(worldId);
    if (eligible.length > 0 && tick % 36 === 0) {
      db.prepare("UPDATE villagers SET morale = MAX(0, morale - ?) WHERE world_id = ? AND status = 'alive'")
        .run(LONGING_MORALE_PENALTY, worldId);
    }

    // Auto-activate if culture >= 60, pop >= 3, AND all standard building types built
    var REQUIRED_BUILDINGS = ['hut', 'farm', 'workshop', 'wall', 'temple', 'watchtower', 'market', 'library', 'storehouse', 'dock', 'hunting_lodge'];
    var builtTypes = db.prepare(
      "SELECT DISTINCT type FROM buildings WHERE world_id = ? AND status NOT IN ('destroyed')"
    ).all(worldId).map(r => r.type);
    var hasAllBuildings = REQUIRED_BUILDINGS.every(t => builtTypes.includes(t));

    if (totalCulture >= 60 && pop >= 3 && hasAllBuildings) {
      db.prepare("UPDATE monoliths SET status = 'building_scaffold' WHERE world_id = ?").run(worldId);
      events.push({
        type: 'monolith',
        title: 'The Spire of Shells begins!',
        description: 'The village has enough culture and population. Construction of the great monolith has started.',
        severity: 'celebration',
      });
      return events;
    }
    return events;
  }

  // 2. Building scaffold — idle builders contribute
  if (monolith.status === 'building_scaffold') {
    const idleBuilders = db.prepare(
      "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'builder' AND status = 'alive'"
    ).get(worldId).c;

    // Any idle/builder villager contributes
    const contribution = Math.max(1, idleBuilders) * SCAFFOLD_RATE;
    const newProgress = monolith.scaffolding_progress + contribution;

    if (newProgress >= SCAFFOLD_COMPLETE) {
      // Try to place a segment
      const eligible = checkMilestones(worldId);
      if (eligible.length > 0) {
        const segType = eligible[0];
        const height = monolith.total_height;

        // Resource cost: wood and stone scale with height
        const woodCost = 3 + height;
        const stoneCost = 3 + height;

        const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
        const resMap = {};
        for (const r of resources) resMap[r.type] = r.amount;

        if ((resMap.wood || 0) >= woodCost && (resMap.stone || 0) >= stoneCost) {
          // Consume resources
          db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'wood'").run(woodCost, worldId);
          db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'stone'").run(stoneCost, worldId);

          // Add segment
          db.prepare(`
            INSERT INTO monolith_segments (world_id, position, segment_type, description, hp, created_tick)
            VALUES (?, ?, ?, ?, 100, ?)
          `).run(worldId, height, segType, SEGMENT_TYPES[segType].trigger, tick);

          // Update monolith
          db.prepare(
            "UPDATE monoliths SET total_height = total_height + 1, scaffolding_progress = 0, last_maintained_tick = ? WHERE world_id = ?"
          ).run(tick, worldId);

          events.push({
            type: 'monolith',
            title: `Spire grows: ${segType.replace(/_/g, ' ')}`,
            description: `A new segment has been added to the Spire of Shells! Height: ${height + 1}. "${segType.replace(/_/g, ' ')}" — memory persists.`,
            severity: 'celebration',
          });
        } else {
          // Not enough resources, stall
          db.prepare("UPDATE monoliths SET scaffolding_progress = ? WHERE world_id = ?").run(SCAFFOLD_COMPLETE, worldId);
        }
      } else {
        // No eligible milestones, wait
        db.prepare("UPDATE monoliths SET scaffolding_progress = ? WHERE world_id = ?").run(SCAFFOLD_COMPLETE, worldId);
      }
    } else {
      db.prepare("UPDATE monoliths SET scaffolding_progress = ? WHERE world_id = ?").run(newProgress, worldId);
    }
  }

  // 3. Maintenance check
  if (monolith.last_maintained_tick && tick - monolith.last_maintained_tick >= MAINTENANCE_INTERVAL) {
    const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
    const resMap = {};
    for (const r of resources) resMap[r.type] = r.amount;

    if ((resMap.wood || 0) >= MAINTENANCE_WOOD && (resMap.stone || 0) >= MAINTENANCE_STONE) {
      db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'wood'").run(MAINTENANCE_WOOD, worldId);
      db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'stone'").run(MAINTENANCE_STONE, worldId);
      db.prepare("UPDATE monoliths SET last_maintained_tick = ? WHERE world_id = ?").run(tick, worldId);
    }
  }

  // 4. Decay: if too long without maintenance, top segment loses HP
  if (monolith.last_maintained_tick && tick - monolith.last_maintained_tick >= DECAY_INTERVAL) {
    const topSeg = db.prepare(
      'SELECT * FROM monolith_segments WHERE world_id = ? ORDER BY position DESC LIMIT 1'
    ).get(worldId);

    if (topSeg) {
      const newHp = topSeg.hp - DECAY_HP_PER_TICK;
      if (newHp <= 0) {
        db.prepare('DELETE FROM monolith_segments WHERE id = ?').run(topSeg.id);
        db.prepare('UPDATE monoliths SET total_height = MAX(0, total_height - 1) WHERE world_id = ?').run(worldId);
        events.push({
          type: 'monolith',
          title: 'Spire segment crumbles!',
          description: `The top segment of the Spire of Shells has decayed and fallen. Maintain the Spire!`,
          severity: 'warning',
        });
      } else {
        db.prepare('UPDATE monolith_segments SET hp = ? WHERE id = ?').run(newHp, topSeg.id);
      }
    }
  }

  return events;
}

function getMonolithData(worldId) {
  const monolith = db.prepare('SELECT * FROM monoliths WHERE world_id = ?').get(worldId);
  if (!monolith) return null;

  const segments = db.prepare(
    'SELECT * FROM monolith_segments WHERE world_id = ? ORDER BY position ASC'
  ).all(worldId);

  return {
    ...monolith,
    segments: segments.map(s => ({
      position: s.position,
      type: s.segment_type,
      hp: s.hp,
      art: MONOLITH_SEGMENT_SPRITES[s.segment_type] || '|  |',
    })),
  };
}

module.exports = {
  processMonolith,
  getMonolithData,
  MONOLITH_SEGMENT_SPRITES,
};
