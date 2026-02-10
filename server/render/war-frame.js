const db = require('../db/connection');
const { getSkillInfo } = require('../simulation/war-skills');
const { getWarriorLevel } = require('../simulation/warrior-types');
const { buildTownFrame } = require('./ascii');

// ─── War Panorama Frame Generator ───
// Builds full panoramic data for the ASCII war renderer.
// Includes both towns' full frame data + war overlay + per-warrior combat data.
// Consumed by client/js/war-panorama.js via SSE.

function getPhase(hp) {
  const pct = hp / 200;
  if (pct > 0.60) return 'clash';
  if (pct > 0.20) return 'burn';
  return 'spire';
}

function getWarriorCombatData(worldId, hp) {
  const warriors = db.prepare(
    "SELECT id, name, experience, molt_count, trait, warrior_type, temperament, creativity, sociability FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive' ORDER BY experience DESC LIMIT 15"
  ).all(worldId);

  // Also include recently killed warriors (killed_in_war) for fallen sprites
  const fallen = db.prepare(
    "SELECT id, name, experience, molt_count, trait, warrior_type FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'killed_in_war' ORDER BY experience DESC LIMIT 10"
  ).all(worldId);

  const phase = getPhase(hp);
  const pct = hp / 200;

  const aliveSprites = warriors.map((w, i) => {
    let state = 'fighting';
    if (phase === 'spire' && i > warriors.length * 0.4) state = 'fallen';
    else if (phase === 'burn' && i > warriors.length * 0.7) state = 'fallen';
    else if (pct < 0.15) state = 'defending';
    else if (pct > 0.80) state = 'charging';

    return {
      name: w.name,
      type: w.warrior_type || 'pincer',
      level: getWarriorLevel(w.experience),
      molt: w.molt_count || 0,
      state,
      x_slot: i,
      xp: w.experience || 0,
      molted: (w.molt_count || 0) > 0,
      trait: w.trait,
    };
  });

  const fallenSprites = fallen.map((w, i) => ({
    name: w.name,
    type: w.warrior_type || 'pincer',
    level: getWarriorLevel(w.experience),
    molt: w.molt_count || 0,
    state: 'dead',
    x_slot: aliveSprites.length + i,
    xp: w.experience || 0,
    molted: (w.molt_count || 0) > 0,
    trait: w.trait,
  }));

  return [...aliveSprites, ...fallenSprites];
}

function getBuildingStates(worldId, hp) {
  const buildings = db.prepare(
    "SELECT type, level, status FROM buildings WHERE world_id = ? AND status = 'active' ORDER BY CASE type WHEN 'farm' THEN 0 WHEN 'workshop' THEN 1 WHEN 'hut' THEN 2 WHEN 'market' THEN 3 WHEN 'library' THEN 4 WHEN 'dock' THEN 5 WHEN 'hunting_lodge' THEN 6 WHEN 'storehouse' THEN 7 WHEN 'wall' THEN 8 WHEN 'watchtower' THEN 9 WHEN 'temple' THEN 10 ELSE 11 END"
  ).all(worldId);

  const phase = getPhase(hp);
  const pct = hp / 200;

  let burningCount = 0;
  let destroyedCount = 0;
  if (phase === 'burn') {
    const burnPct = (0.60 - pct) / 0.40;
    burningCount = Math.floor(buildings.length * burnPct * 0.6);
    destroyedCount = Math.floor(buildings.length * burnPct * 0.2);
  } else if (phase === 'spire') {
    destroyedCount = buildings.length;
  }

  return buildings.map((b, i) => {
    let visual_state = 'standing';
    if (i < destroyedCount) visual_state = 'destroyed';
    else if (i < destroyedCount + burningCount) visual_state = 'burning';

    return {
      type: b.type,
      level: b.level,
      visual_state,
    };
  });
}

function getSpireState(worldId, hp) {
  const segments = db.prepare(
    "SELECT COUNT(*) as c FROM monolith_segments WHERE world_id = ?"
  ).get(worldId).c;

  const phase = getPhase(hp);

  let intact = segments;
  let cracked = 0;
  let fallen = 0;

  if (phase === 'spire') {
    const spireHpLost = Math.max(0, 40 - hp);
    fallen = Math.min(segments, Math.floor(spireHpLost / (40 / Math.max(1, segments))));
    cracked = Math.min(segments - fallen, Math.ceil(fallen * 0.5));
    intact = Math.max(0, segments - fallen - cracked);
  } else if (phase === 'burn') {
    cracked = Math.min(2, Math.floor(segments * 0.1));
    intact = segments - cracked;
  }

  return {
    segments_total: segments,
    segments_intact: intact,
    segments_cracked: cracked,
    segments_fallen: fallen,
    collapsed: hp <= 0,
  };
}

function getSkillStates(warId, side) {
  const war = db.prepare('SELECT challenger_skills, defender_skills FROM wars WHERE id = ?').get(warId);
  if (!war) return [];

  const skillsCol = side === 'challenger' ? 'challenger_skills' : 'defender_skills';
  let skillIds;
  try { skillIds = JSON.parse(war[skillsCol] || '[]'); } catch { return []; }

  const rounds = db.prepare('SELECT skill_used FROM war_rounds WHERE war_id = ? AND skill_used IS NOT NULL').all(warId);
  const usedByThisSide = new Set();
  for (const r of rounds) {
    try {
      const parsed = JSON.parse(r.skill_used);
      if (parsed.side === side) usedByThisSide.add(parsed.skill_id);
    } catch { /* ignore */ }
  }

  return skillIds.map(id => {
    const info = getSkillInfo(id);
    return {
      id,
      name: info ? info.name : id,
      category: info ? info.category : 'unknown',
      color: info ? info.color : 'white',
      used: usedByThisSide.has(id),
    };
  });
}

function getDominantBiome(worldId) {
  try {
    const { deriveBiomeWeights } = require('../world/map');
    const world = db.prepare('SELECT seed FROM worlds WHERE id = ?').get(worldId);
    if (!world) return 'plains';
    const weights = deriveBiomeWeights(world.seed);
    let best = 'plains', maxW = 0;
    for (const [b, w] of Object.entries(weights)) {
      if (w > maxW) { maxW = w; best = b; }
    }
    return best;
  } catch { return 'plains'; }
}

function buildWarFrame(warId) {
  const war = db.prepare(`
    SELECT w.*, c.name as challenger_name, c.town_number as challenger_town,
           d.name as defender_name, d.town_number as defender_town
    FROM wars w
    JOIN worlds c ON c.id = w.challenger_id
    JOIN worlds d ON d.id = w.defender_id
    WHERE w.id = ?
  `).get(warId);

  if (!war) return null;

  const rounds = db.prepare(
    'SELECT * FROM war_rounds WHERE war_id = ? ORDER BY round_number ASC'
  ).all(warId);

  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;

  // Get global time
  let weather = 'clear', time_of_day = 'day';
  try {
    const ps = db.prepare('SELECT weather, time_of_day FROM planet_state WHERE id = 1').get();
    if (ps) { weather = ps.weather; time_of_day = ps.time_of_day; }
  } catch { /* ignore */ }

  // Parse latest round skill
  let latestSkill = null;
  if (latestRound && latestRound.skill_used) {
    try { latestSkill = JSON.parse(latestRound.skill_used); } catch { /* ignore */ }
  }

  // Build full town frames for both sides
  let challengerTown = null, defenderTown = null;
  try { challengerTown = buildTownFrame(war.challenger_id); } catch { /* ignore */ }
  try { defenderTown = buildTownFrame(war.defender_id); } catch { /* ignore */ }

  return {
    war_id: warId,
    round: war.round_number,
    max_rounds: 40,
    status: war.status,
    weather,
    time_of_day,

    challenger: {
      name: war.challenger_name,
      town_number: war.challenger_town,
      hp: war.challenger_hp,
      max_hp: 200,
      phase: getPhase(war.challenger_hp),
      town: challengerTown,
      warriors: getWarriorCombatData(war.challenger_id, war.challenger_hp),
      buildings: getBuildingStates(war.challenger_id, war.challenger_hp),
      spire: getSpireState(war.challenger_id, war.challenger_hp),
      skills: getSkillStates(warId, 'challenger'),
      biome: getDominantBiome(war.challenger_id),
    },

    defender: {
      name: war.defender_name,
      town_number: war.defender_town,
      hp: war.defender_hp,
      max_hp: 200,
      phase: getPhase(war.defender_hp),
      town: defenderTown,
      warriors: getWarriorCombatData(war.defender_id, war.defender_hp),
      buildings: getBuildingStates(war.defender_id, war.defender_hp),
      spire: getSpireState(war.defender_id, war.defender_hp),
      skills: getSkillStates(warId, 'defender'),
      biome: getDominantBiome(war.defender_id),
    },

    latest_round: latestRound ? {
      tactical_event: latestRound.tactical_event ? JSON.parse(latestRound.tactical_event) : null,
      skill_used: latestSkill,
      narrative: latestRound.narrative,
      damage: {
        challenger: latestRound.challenger_damage,
        defender: latestRound.defender_damage,
      },
    } : null,

    battle_log: rounds.slice(-5).map(r => r.narrative),
  };
}

module.exports = { buildWarFrame, getPhase };
