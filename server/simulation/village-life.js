const { v4: uuid } = require('uuid');
const db = require('../db/connection');

// ─── ACTIVITY TYPES ───
const ACTIVITIES = [
  'idle', 'working', 'fighting', 'building_project', 'making_art',
  'playing_music', 'arguing', 'celebrating', 'mourning', 'sparring',
  'meditating', 'feasting', 'praying', 'teaching', 'brooding',
  'socializing', 'wandering', 'sleeping',
];

// ─── MEMORY TYPES ───
const MEMORY_TYPES = [
  'fought', 'was_hurt', 'built_together', 'made_art', 'heard_music',
  'saw_death', 'celebrated', 'argued', 'shared_meal', 'was_taught',
  'sparred', 'mourned', 'prayed_together', 'project_completed',
];

// ─── PROJECT TYPES ───
const PROJECT_TYPES = {
  obelisk:      { name: 'Obelisk',      threshold: 100, bonus: 'morale' },
  mural:        { name: 'Mural',        threshold: 80,  bonus: 'creativity' },
  garden:       { name: 'Garden',       threshold: 60,  bonus: 'food' },
  music_circle: { name: 'Music Circle', threshold: 70,  bonus: 'morale' },
  monument:     { name: 'Monument',     threshold: 120, bonus: 'morale' },
  bonfire:      { name: 'Bonfire',      threshold: 40,  bonus: 'social' },
  totem:        { name: 'Totem',        threshold: 90,  bonus: 'spiritual' },
  sculpture:    { name: 'Sculpture',    threshold: 85,  bonus: 'creativity' },
  stage:        { name: 'Stage',        threshold: 75,  bonus: 'social' },
  shrine:       { name: 'Shrine',       threshold: 65,  bonus: 'spiritual' },
};

const PROJECT_TYPE_KEYS = Object.keys(PROJECT_TYPES);

// ─── MAIN ENTRY: called every tick ───
function processVillagerLife(worldId) {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  if (!world) return [];

  const villagers = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(worldId);

  if (villagers.length < 2) return [];

  const events = [];
  const tick = world.current_tick;

  // 1. Ensure relationships exist for all pairs
  ensureRelationships(worldId, villagers);

  // 2. Update tension from environment
  updateEnvironmentalTension(worldId, world);

  // 3. Resolve activities
  resolveActivities(worldId, villagers, world);

  // 4. Process interactions
  const interactionEvents = processInteractions(worldId, villagers, tick);
  events.push(...interactionEvents);

  // 5. Process projects
  const projectEvents = processProjects(worldId, villagers, tick);
  events.push(...projectEvents);

  // 6. Prune old memories (>360 ticks)
  db.prepare('DELETE FROM villager_memories WHERE world_id = ? AND tick < ?')
    .run(worldId, Math.max(0, tick - 360));

  // 7. Personality drift (once per day = every 36 ticks)
  if (tick % 36 === 0) {
    driftPersonalities(worldId, tick);
  }

  return events;
}

// ─── RELATIONSHIPS ───
function ensureRelationships(worldId, villagers) {
  const existing = db.prepare(
    'SELECT villager_a, villager_b FROM villager_relationships WHERE world_id = ?'
  ).all(worldId);

  const pairSet = new Set(existing.map(r => r.villager_a + ':' + r.villager_b));

  const insert = db.prepare(`
    INSERT OR IGNORE INTO villager_relationships (world_id, villager_a, villager_b, affinity, tension, familiarity)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < villagers.length; i++) {
    for (let j = i + 1; j < villagers.length; j++) {
      const a = villagers[i].id, b = villagers[j].id;
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (!pairSet.has(key)) {
        // Initial affinity from trait compatibility
        const affinity = traitAffinity(villagers[i].trait, villagers[j].trait);
        const [va, vb] = a < b ? [a, b] : [b, a];
        insert.run(worldId, va, vb, affinity, 0, 5);
        pairSet.add(key);
      }
    }
  }
}

function traitAffinity(t1, t2) {
  if (t1 === t2) return 15;
  const compatible = {
    brave: ['strong', 'curious'], kind: ['timid', 'clever'], clever: ['curious', 'kind'],
    strong: ['brave', 'stubborn'], timid: ['kind', 'clever'], curious: ['clever', 'brave'],
    stubborn: ['strong', 'brave'], lazy: ['kind', 'timid'],
  };
  if (compatible[t1] && compatible[t1].includes(t2)) return 10;
  const clash = { brave: ['timid', 'lazy'], stubborn: ['kind', 'lazy'], strong: ['timid', 'lazy'] };
  if (clash[t1] && clash[t1].includes(t2)) return -10;
  return 0;
}

function getRelationship(worldId, idA, idB) {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  return db.prepare(
    'SELECT * FROM villager_relationships WHERE world_id = ? AND villager_a = ? AND villager_b = ?'
  ).get(worldId, a, b);
}

function updateRelationship(worldId, idA, idB, changes) {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'affinity') {
      sets.push('affinity = MAX(-100, MIN(100, affinity + ?))');
    } else if (k === 'tension') {
      sets.push('tension = MAX(0, MIN(100, tension + ?))');
    } else if (k === 'familiarity') {
      sets.push('familiarity = MIN(100, familiarity + ?)');
    } else if (k === 'shared_projects') {
      sets.push('shared_projects = shared_projects + ?');
    } else if (k === 'fights') {
      sets.push('fights = fights + ?');
    }
    params.push(v);
  }
  if (sets.length === 0) return;
  params.push(worldId, a, b);
  db.prepare(`UPDATE villager_relationships SET ${sets.join(', ')} WHERE world_id = ? AND villager_a = ? AND villager_b = ?`)
    .run(...params);
}

// ─── ENVIRONMENTAL TENSION ───
function updateEnvironmentalTension(worldId, world) {
  let tensionDelta = 0;
  if (world.weather === 'storm') tensionDelta += 3;
  if (world.weather === 'heat') tensionDelta += 1;

  // Check starvation
  const food = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'food'").get(worldId);
  if (food && food.amount < 5) tensionDelta += 5;
  else if (food && food.amount < 15) tensionDelta += 2;

  // Prosperity reduces tension
  if (food && food.amount > 50) tensionDelta -= 2;
  if (world.weather === 'clear') tensionDelta -= 1;

  if (tensionDelta !== 0) {
    db.prepare(`
      UPDATE villager_relationships SET tension = MAX(0, MIN(100, tension + ?)) WHERE world_id = ?
    `).run(tensionDelta, worldId);
  }

  // Natural tension decay
  db.prepare(`
    UPDATE villager_relationships SET tension = MAX(0, tension - 1) WHERE world_id = ? AND tension > 0
  `).run(worldId);
}

// ─── ACTIVITY RESOLUTION ───
function resolveActivities(worldId, villagers, world) {
  const isNight = world.time_of_day === 'night' || world.time_of_day === 'dusk';

  // Get active projects
  const activeProjects = db.prepare(
    "SELECT COUNT(*) as c FROM projects WHERE world_id = ? AND status = 'in_progress'"
  ).get(worldId).c;

  // Get avg morale
  const avgMorale = villagers.reduce((s, v) => s + v.morale, 0) / villagers.length;

  const upsert = db.prepare(`
    INSERT INTO villager_activities (villager_id, world_id, activity, target_id, duration_ticks)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(villager_id) DO UPDATE SET
      activity = excluded.activity,
      target_id = excluded.target_id,
      duration_ticks = duration_ticks + 1
  `);

  // Check current activities for continuation
  const currentActivities = {};
  const rows = db.prepare('SELECT * FROM villager_activities WHERE world_id = ?').all(worldId);
  for (const r of rows) currentActivities[r.villager_id] = r;

  for (const v of villagers) {
    const cur = currentActivities[v.villager_id];

    // Fighting/building_project persist until resolved — don't re-roll
    if (cur && (cur.activity === 'fighting' || cur.activity === 'building_project') && cur.duration_ticks < 5) {
      upsert.run(v.id, worldId, cur.activity, cur.target_id);
      continue;
    }

    // Weighted selection
    const weights = {};
    const temp = v.temperament || 50;
    const cre = v.creativity || 50;
    const soc = v.sociability || 50;

    if (isNight) {
      weights.sleeping = 50;
      weights.meditating = temp / 8;
      weights.brooding = (100 - temp) / 10;
      weights.idle = 5;
    } else {
      weights.working = Math.max(5, 15 - cre / 10);
      weights.making_art = cre / 8;
      weights.playing_music = cre / 10;
      weights.socializing = soc / 5;
      weights.sparring = (100 - temp) / 8;
      weights.building_project = activeProjects > 0 ? 15 : 2;
      weights.celebrating = avgMorale > 70 ? 8 : 1;
      weights.meditating = temp / 12;
      weights.wandering = 8;
      weights.praying = 3;
      weights.idle = 5;
    }

    // Recent memories boost certain activities
    const recentMemories = db.prepare(
      'SELECT memory_type, COUNT(*) as c FROM villager_memories WHERE villager_id = ? AND tick > ? GROUP BY memory_type'
    ).all(v.id, (world.current_tick || 0) - 72);

    for (const m of recentMemories) {
      if (m.memory_type === 'made_art' || m.memory_type === 'heard_music') {
        weights.making_art = (weights.making_art || 0) + m.c * 2;
        weights.playing_music = (weights.playing_music || 0) + m.c;
      }
      if (m.memory_type === 'celebrated' || m.memory_type === 'shared_meal') {
        weights.celebrating = (weights.celebrating || 0) + m.c * 2;
        weights.socializing = (weights.socializing || 0) + m.c;
      }
      if (m.memory_type === 'saw_death' || m.memory_type === 'mourned') {
        weights.mourning = (weights.mourning || 0) + m.c * 3;
        weights.brooding = (weights.brooding || 0) + m.c * 2;
      }
      if (m.memory_type === 'fought' || m.memory_type === 'was_hurt') {
        weights.sparring = (weights.sparring || 0) + m.c;
        weights.brooding = (weights.brooding || 0) + m.c;
      }
    }

    // Check if fighting should trigger (high tension + low temperament)
    if (!isNight) {
      const tensePairs = db.prepare(`
        SELECT villager_a, villager_b, tension, affinity FROM villager_relationships
        WHERE world_id = ? AND (villager_a = ? OR villager_b = ?) AND tension > 70
      `).all(worldId, v.id, v.id);

      for (const rel of tensePairs) {
        if (rel.tension > 70 || (rel.affinity < -30 && temp < 30)) {
          weights.fighting = (weights.fighting || 0) + 15;
          break;
        }
      }
    }

    const activity = weightedRandom(weights);
    upsert.run(v.id, worldId, activity, null);
  }
}

function weightedRandom(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total === 0) return 'idle';
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

// ─── INTERACTIONS ───
function processInteractions(worldId, villagers, tick) {
  const events = [];
  const activities = {};
  const rows = db.prepare('SELECT * FROM villager_activities WHERE world_id = ?').all(worldId);
  for (const r of rows) activities[r.villager_id] = r;

  // Process fighters
  const fighters = villagers.filter(v => activities[v.id] && activities[v.id].activity === 'fighting');
  for (const fighter of fighters) {
    // Find highest-tension opponent
    const opponent = findOpponent(worldId, fighter, villagers);
    if (!opponent) continue;

    const fightEvents = processFight(worldId, fighter, opponent, villagers, tick);
    events.push(...fightEvents);
  }

  // Process sparring
  const sparrers = villagers.filter(v => activities[v.id] && activities[v.id].activity === 'sparring');
  for (let i = 0; i < sparrers.length - 1; i += 2) {
    processSpar(worldId, sparrers[i], sparrers[i + 1], tick);
  }

  // Process socializing pairs — build affinity
  const socializers = villagers.filter(v => activities[v.id] && activities[v.id].activity === 'socializing');
  for (let i = 0; i < socializers.length - 1; i += 2) {
    updateRelationship(worldId, socializers[i].id, socializers[i + 1].id, { affinity: 2, tension: -3, familiarity: 1 });
    addMemory(worldId, socializers[i].id, tick, 'celebrated', socializers[i + 1].id, 30);
    addMemory(worldId, socializers[i + 1].id, tick, 'celebrated', socializers[i].id, 30);
  }

  // Process art/music — inspire nearby
  const artists = villagers.filter(v => activities[v.id] &&
    (activities[v.id].activity === 'making_art' || activities[v.id].activity === 'playing_music'));
  for (const artist of artists) {
    for (const other of villagers) {
      if (other.id === artist.id) continue;
      if (Math.random() < 0.3) {
        addMemory(worldId, other.id, tick, 'heard_music', artist.id, 25);
        updateRelationship(worldId, other.id, artist.id, { affinity: 1 });
      }
    }
    addMemory(worldId, artist.id, tick, 'made_art', null, 40);
  }

  // Process arguing (high tension, low affinity pairs that aren't fighting)
  const arguers = villagers.filter(v => activities[v.id] && activities[v.id].activity === 'arguing');
  for (const arguer of arguers) {
    const target = findTensePartner(worldId, arguer, villagers);
    if (target) {
      updateRelationship(worldId, arguer.id, target.id, { affinity: -2, tension: -5, familiarity: 1 });
      addMemory(worldId, arguer.id, tick, 'argued', target.id, 40);
      addMemory(worldId, target.id, tick, 'argued', arguer.id, 40);
    }
  }

  // Celebrating villagers boost each other's morale
  const celebrators = villagers.filter(v => activities[v.id] && activities[v.id].activity === 'celebrating');
  if (celebrators.length > 1) {
    const boostMorale = db.prepare('UPDATE villagers SET morale = MIN(100, morale + 2) WHERE id = ?');
    for (const c of celebrators) {
      boostMorale.run(c.id);
      addMemory(worldId, c.id, tick, 'celebrated', null, 30);
    }
  }

  return events;
}

function findOpponent(worldId, fighter, villagers) {
  const rels = db.prepare(`
    SELECT villager_a, villager_b, tension, affinity FROM villager_relationships
    WHERE world_id = ? AND (villager_a = ? OR villager_b = ?)
    ORDER BY tension DESC, affinity ASC LIMIT 1
  `).get(worldId, fighter.id, fighter.id);

  if (!rels) return null;
  const otherId = rels.villager_a === fighter.id ? rels.villager_b : rels.villager_a;
  return villagers.find(v => v.id === otherId && v.status === 'alive');
}

function findTensePartner(worldId, villager, villagers) {
  const rel = db.prepare(`
    SELECT villager_a, villager_b FROM villager_relationships
    WHERE world_id = ? AND (villager_a = ? OR villager_b = ?) AND tension > 30
    ORDER BY tension DESC LIMIT 1
  `).get(worldId, villager.id, villager.id);

  if (!rel) return null;
  const otherId = rel.villager_a === villager.id ? rel.villager_b : rel.villager_a;
  return villagers.find(v => v.id === otherId && v.status === 'alive');
}

// ─── VIOLENCE ───
function processFight(worldId, attacker, defender, allVillagers, tick) {
  const events = [];

  // Damage based on strength trait
  let dmg = 8 + Math.floor(Math.random() * 8);
  if (attacker.trait === 'strong') dmg += 5;
  if (attacker.trait === 'brave') dmg += 3;

  // Both take damage (defender retaliates)
  let defDmg = 5 + Math.floor(Math.random() * 6);
  if (defender.trait === 'strong') defDmg += 5;

  db.prepare('UPDATE villagers SET hp = MAX(0, hp - ?), morale = MAX(0, morale - 5) WHERE id = ?').run(dmg, defender.id);
  db.prepare('UPDATE villagers SET hp = MAX(0, hp - ?), morale = MAX(0, morale - 3) WHERE id = ?').run(defDmg, attacker.id);

  // Memories
  addMemory(worldId, attacker.id, tick, 'fought', defender.id, 70);
  addMemory(worldId, defender.id, tick, 'was_hurt', attacker.id, 80);

  // Relationship damage
  updateRelationship(worldId, attacker.id, defender.id, { affinity: -10, tension: -20, fights: 1 });

  // Violence lowers attacker's temperament (violence begets violence)
  db.prepare('UPDATE villagers SET temperament = MAX(0, temperament - 1) WHERE id = ?').run(attacker.id);

  // Update culture stats
  db.prepare('UPDATE culture SET total_fights = total_fights + 1 WHERE world_id = ?').run(worldId);

  // Witnesses lose morale and form opinions
  for (const w of allVillagers) {
    if (w.id === attacker.id || w.id === defender.id) continue;
    db.prepare('UPDATE villagers SET morale = MAX(0, morale - 2) WHERE id = ?').run(w.id);
    addMemory(worldId, w.id, tick, 'saw_death', attacker.id, 40); // saw_violence really
    // Witnesses side with the defender
    updateRelationship(worldId, w.id, attacker.id, { affinity: -3 });
    updateRelationship(worldId, w.id, defender.id, { affinity: 1 });
  }

  events.push({
    type: 'fight',
    title: `${attacker.name} attacked ${defender.name}!`,
    description: `A fight broke out. ${attacker.name} dealt ${dmg} damage, took ${defDmg} in return.`,
    severity: 'danger',
  });

  // Check for death
  const defCheck = db.prepare('SELECT hp, name FROM villagers WHERE id = ?').get(defender.id);
  if (defCheck && defCheck.hp <= 0) {
    db.prepare("UPDATE villagers SET status = 'dead' WHERE id = ?").run(defender.id);
    db.prepare('UPDATE culture SET total_deaths_by_violence = total_deaths_by_violence + 1 WHERE world_id = ?').run(worldId);

    // Village-wide mourning
    for (const w of allVillagers) {
      if (w.id === defender.id) continue;
      db.prepare('UPDATE villagers SET morale = MAX(0, morale - 8) WHERE id = ?').run(w.id);
      addMemory(worldId, w.id, tick, 'saw_death', defender.id, 90);
    }

    events.push({
      type: 'death',
      title: `${defCheck.name} has been killed!`,
      description: `${defCheck.name} was killed by ${attacker.name} in a violent fight.`,
      severity: 'danger',
    });
  }

  return events;
}

function processSpar(worldId, a, b, tick) {
  // Non-lethal — minor morale boost, skill building
  addMemory(worldId, a.id, tick, 'sparred', b.id, 30);
  addMemory(worldId, b.id, tick, 'sparred', a.id, 30);
  updateRelationship(worldId, a.id, b.id, { affinity: 1, tension: -5, familiarity: 2 });
  db.prepare('UPDATE villagers SET morale = MIN(100, morale + 1) WHERE id IN (?, ?)').run(a.id, b.id);
}

// ─── PROJECTS ───
function processProjects(worldId, villagers, tick) {
  const events = [];

  // Progress active projects
  const activeProjects = db.prepare(
    "SELECT * FROM projects WHERE world_id = ? AND status = 'in_progress'"
  ).all(worldId);

  const activities = {};
  const rows = db.prepare('SELECT * FROM villager_activities WHERE world_id = ?').all(worldId);
  for (const r of rows) activities[r.villager_id] = r;

  const builders = villagers.filter(v => activities[v.id] && activities[v.id].activity === 'building_project');

  for (const project of activeProjects) {
    const contributors = JSON.parse(project.contributors || '[]');

    // Add new builders
    for (const b of builders) {
      if (!contributors.includes(b.id)) {
        const rel = getRelationship(worldId, b.id, project.initiated_by);
        if (!rel || rel.affinity > -20) {
          contributors.push(b.id);
        }
      }
    }

    // Progress = sum of contributor morale/creativity
    let progressGain = 0;
    for (const cid of contributors) {
      const c = villagers.find(v => v.id === cid);
      if (c && activities[c.id] && activities[c.id].activity === 'building_project') {
        progressGain += Math.max(1, Math.floor(((c.morale || 50) + (c.creativity || 50)) / 40));
        addMemory(worldId, c.id, tick, 'built_together', project.initiated_by, 30);
      }
    }

    const newProgress = Math.min(100, project.progress + progressGain);
    const quality = Math.min(100, project.quality + (contributors.length > 2 ? 1 : 0));

    // Check completion
    const def = PROJECT_TYPES[project.type];
    if (newProgress >= 100) {
      db.prepare("UPDATE projects SET progress = 100, quality = ?, contributors = ?, status = 'complete' WHERE id = ?")
        .run(quality, JSON.stringify(contributors), project.id);
      db.prepare('UPDATE culture SET total_projects_completed = total_projects_completed + 1 WHERE world_id = ?').run(worldId);

      // Shared accomplishment
      for (const cid of contributors) {
        addMemory(worldId, cid, tick, 'project_completed', null, 80);
        db.prepare('UPDATE villagers SET morale = MIN(100, morale + 10) WHERE id = ?').run(cid);
        // Build affinity between all contributors
        for (const oid of contributors) {
          if (oid !== cid) {
            updateRelationship(worldId, cid, oid, { affinity: 5, shared_projects: 1 });
          }
        }
      }

      events.push({
        type: 'project_complete',
        title: `${project.name} completed!`,
        description: `The village ${def.name.toLowerCase()} "${project.name}" has been finished by ${contributors.length} villagers.`,
        severity: 'celebration',
      });
    } else {
      db.prepare('UPDATE projects SET progress = ?, quality = ?, contributors = ? WHERE id = ?')
        .run(newProgress, quality, JSON.stringify(contributors), project.id);
    }

    // Abandonment: no progress for 20 ticks with 0 active builders
    if (progressGain === 0 && project.progress === newProgress) {
      // Check if stale
      const stale = db.prepare(
        "SELECT COUNT(*) as c FROM villager_activities WHERE world_id = ? AND activity = 'building_project'"
      ).get(worldId).c;
      if (stale === 0) {
        // Only abandon after many ticks of no activity (tracked via duration)
        // For now just let it sit — projects don't auto-abandon quickly
      }
    }
  }

  // Initiate new projects
  if (activeProjects.length < 2) {
    for (const v of villagers) {
      if ((v.creativity || 50) > 60 && v.morale > 50) {
        const act = activities[v.id];
        if (act && act.activity === 'idle' && act.duration_ticks >= 3) {
          // Start a project
          const typeKey = PROJECT_TYPE_KEYS[Math.floor(Math.random() * PROJECT_TYPE_KEYS.length)];
          const def = PROJECT_TYPES[typeKey];
          const projectName = generateProjectName(typeKey, v.name);

          db.prepare(`
            INSERT INTO projects (id, world_id, type, name, x, progress, quality, contributors, status, initiated_by)
            VALUES (?, ?, ?, ?, ?, 0, 50, ?, 'in_progress', ?)
          `).run(uuid(), worldId, typeKey, projectName, v.x, JSON.stringify([v.id]), v.id);

          addMemory(worldId, v.id, tick, 'made_art', null, 60);

          events.push({
            type: 'project_started',
            title: `${v.name} started building: ${projectName}`,
            description: `${v.name} has begun work on a ${def.name.toLowerCase()}.`,
            severity: 'info',
          });
          break; // Only one new project per tick
        }
      }
    }
  }

  return events;
}

function generateProjectName(type, initiatorName) {
  const adjectives = ['Grand', 'Sacred', 'Ancient', 'Proud', 'Wild', 'Humble', 'Bright', 'Dark', 'Stone', 'Wood'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const def = PROJECT_TYPES[type];
  return `${adj} ${def.name} of ${initiatorName}`;
}

// ─── PERSONALITY DRIFT ───
function driftPersonalities(worldId, tick) {
  const villagers = db.prepare(
    "SELECT id FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(worldId);

  const windowStart = Math.max(0, tick - 36);

  for (const v of villagers) {
    const memories = db.prepare(
      'SELECT memory_type, SUM(intensity) as total FROM villager_memories WHERE villager_id = ? AND tick >= ? GROUP BY memory_type'
    ).all(v.id, windowStart);

    let tempDelta = 0, creDelta = 0, socDelta = 0;

    for (const m of memories) {
      const count = m.total / 50; // normalize
      switch (m.memory_type) {
        case 'fought':
        case 'was_hurt':
          tempDelta -= count; // more violent
          break;
        case 'made_art':
        case 'heard_music':
          creDelta += count;
          break;
        case 'celebrated':
        case 'shared_meal':
          socDelta += count;
          tempDelta += count * 0.5;
          break;
        case 'saw_death':
          tempDelta += count; // trauma makes more cautious
          socDelta -= count;
          break;
        case 'built_together':
          socDelta += count;
          creDelta += count * 0.5;
          break;
        case 'argued':
          tempDelta -= count * 0.5;
          break;
        case 'sparred':
          tempDelta -= count * 0.3;
          socDelta += count * 0.3;
          break;
      }
    }

    // Clamp deltas to ±3 per day
    tempDelta = Math.max(-3, Math.min(3, Math.round(tempDelta)));
    creDelta = Math.max(-3, Math.min(3, Math.round(creDelta)));
    socDelta = Math.max(-3, Math.min(3, Math.round(socDelta)));

    if (tempDelta !== 0 || creDelta !== 0 || socDelta !== 0) {
      db.prepare(`
        UPDATE villagers SET
          temperament = MAX(0, MIN(100, temperament + ?)),
          creativity = MAX(0, MIN(100, creativity + ?)),
          sociability = MAX(0, MIN(100, sociability + ?))
        WHERE id = ?
      `).run(tempDelta, creDelta, socDelta, v.id);
    }
  }
}

// ─── MEMORY HELPER ───
function addMemory(worldId, villagerId, tick, memoryType, targetId, intensity) {
  db.prepare(`
    INSERT INTO villager_memories (world_id, villager_id, tick, memory_type, target_id, intensity)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(worldId, villagerId, tick, memoryType, targetId || null, intensity || 50);
}

module.exports = { processVillagerLife, PROJECT_TYPES, ACTIVITIES };
