const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { checkSkillTrigger, applySkillEffect, autoSelectSkills } = require('./war-skills');

// War phases: pending → countdown → active → resolved
// Pending: challenger declared, waiting for defender to accept (expires after 360 ticks)
// Countdown: accepted, 5-min betting window, both worlds still tick normally
// Active: battle in progress, both worlds frozen, 1 round per engine cycle
// Resolved: winner/loser determined, spoils distributed

const WAR_EXPIRE_TICKS = 360; // ~1 hour for pending wars
const COUNTDOWN_MS = 5 * 60 * 1000; // 5 minutes betting window
const MAX_ROUNDS = 40;
const MAX_HP = 200;
const WAR_COOLDOWN_TICKS = 720; // ~2 hours after loss

// ─── Tactical Events (10 total) ───
const TACTICAL_EVENTS = [
  { type: 'flanking', desc: '%attacker warriors flank the enemy lines!', attackMul: 1.2, defenseMul: 1.0 },
  { type: 'wall_breach', desc: 'A section of %defender walls crumbles!', attackMul: 1.0, defenseMul: 0.8 },
  { type: 'heroic_stand', desc: 'A %defender warrior makes a legendary stand!', attackMul: 0.8, defenseMul: 1.2 },
  { type: 'morale_break', desc: '%defender troops waver in fear!', attackMul: 1.15, defenseMul: 0.9 },
  { type: 'ambush', desc: '%attacker scouts set a devastating ambush!', attackMul: 1.25, defenseMul: 1.0 },
  { type: 'divine_intervention', desc: 'The gods favor %defender this round!', attackMul: 0.85, defenseMul: 1.15 },
  { type: 'blood_frenzy', desc: 'Molted %attacker warriors go berserk!', attackMul: 1.3, defenseMul: 0.9 },
  { type: 'shield_break', desc: '%attacker shatters the %defender shield line!', attackMul: 1.0, defenseMul: 0.75 },
  { type: 'war_chant', desc: '%defender rallies with a thunderous war chant!', attackMul: 0.9, defenseMul: 1.25 },
  { type: 'champion_duel', desc: 'Two warriors face off in a legendary duel!', attackMul: 1.0, defenseMul: 1.0, hpSwing: true },
];

// ─── Weather combat modifiers ───
const WEATHER_WAR_MODS = {
  clear:  { attack: 1.0,  defense: 1.0 },
  rain:   { attack: 0.95, defense: 1.0 },
  storm:  { attack: 0.85, defense: 1.0 },
  snow:   { attack: 1.0,  defense: 1.1 },
  fog:    { attack: 0.9,  defense: 1.0 },
  heat:   { attack: 1.0,  defense: 0.9 },
};

// ─── Phase helpers ───
function getPhase(hp) {
  const pct = hp / MAX_HP;
  if (pct > 0.60) return 'clash';
  if (pct > 0.20) return 'burn';
  return 'spire';
}

function getPhaseDefenseMul(phase) {
  if (phase === 'burn') return 0.7;
  if (phase === 'spire') return 0.4;
  return 1.0;
}

// ─── War Readiness Check ───
function isWarReady(worldId) {
  const world = db.prepare("SELECT * FROM worlds WHERE id = ? AND status = 'active'").get(worldId);
  if (!world) return { ready: false, reason: 'World not found or inactive' };

  // Check completed spire (16+ segments including capstone)
  const segCount = db.prepare("SELECT COUNT(*) as c FROM monolith_segments WHERE world_id = ?").get(worldId).c;
  if (segCount < 16) return { ready: false, reason: `Need completed spire (16 segments, have ${segCount}). Build your monument first.` };

  // Check barracks
  const barracksCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'barracks' AND status = 'active'").get(worldId).c;
  if (barracksCount === 0) return { ready: false, reason: 'Need at least 1 active barracks. Build a barracks to train warriors.' };

  // Check warriors
  const warriors = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive'").get(worldId).c;
  if (warriors < 10) return { ready: false, reason: `Need 10+ warriors (have ${warriors}). Train more soldiers.` };

  // Check population
  const pop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(worldId).c;
  if (pop < 15) return { ready: false, reason: `Need 15+ population (have ${pop}). Grow your civilization.` };

  // Check not in war
  const existingWar = db.prepare(
    "SELECT id FROM wars WHERE (challenger_id = ? OR defender_id = ?) AND status IN ('pending', 'countdown', 'active')"
  ).get(worldId, worldId);
  if (existingWar) return { ready: false, reason: 'Already involved in a war. One at a time.' };

  // Cooldown check
  const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
  const currentTick = ps ? ps.global_tick : 0;
  const lastLoss = db.prepare(
    "SELECT challenged_at_tick FROM wars WHERE loser_id = ? ORDER BY resolved_at DESC LIMIT 1"
  ).get(worldId);
  if (lastLoss && (currentTick - lastLoss.challenged_at_tick) < WAR_COOLDOWN_TICKS) {
    return { ready: false, reason: `War cooldown active (${WAR_COOLDOWN_TICKS - (currentTick - lastLoss.challenged_at_tick)} ticks remaining). Time to rebuild.` };
  }

  return { ready: true };
}

function declareWar(challengerId, defenderId) {
  if (challengerId === defenderId) return { ok: false, reason: 'Cannot declare war on yourself' };

  // Check challenger readiness
  const cReady = isWarReady(challengerId);
  if (!cReady.ready) return { ok: false, reason: `Challenger not ready: ${cReady.reason}` };

  // Check defender readiness (must also have spire + 10 warriors)
  const dReady = isWarReady(defenderId);
  if (!dReady.ready) return { ok: false, reason: `Defender not ready: ${dReady.reason}` };

  const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
  const globalTick = ps ? ps.global_tick : 0;

  const warId = uuid();
  db.prepare(`
    INSERT INTO wars (id, challenger_id, defender_id, status, challenger_hp, defender_hp,
    challenged_at_tick, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, datetime('now'))
  `).run(warId, challengerId, defenderId, MAX_HP, MAX_HP, globalTick);

  const challenger = db.prepare('SELECT name FROM worlds WHERE id = ?').get(challengerId);
  const defender = db.prepare('SELECT name FROM worlds WHERE id = ?').get(defenderId);

  // Events
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'warning')"
  ).run(uuid(), defenderId, globalTick,
    `War declared by ${challenger.name}!`,
    `${challenger.name} has challenged you to war! Accept or decline within ${WAR_EXPIRE_TICKS} ticks. Use: war-accept or war-decline`
  );
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'info')"
  ).run(uuid(), challengerId, globalTick,
    'War challenge sent!',
    `You have challenged ${defender.name} to war. Waiting for their response...`
  );

  return { ok: true, warId, challengerName: challenger.name, defenderName: defender.name };
}

function acceptWar(warId, defenderWorldId) {
  const war = db.prepare("SELECT * FROM wars WHERE id = ? AND status = 'pending'").get(warId);
  if (!war) return { ok: false, reason: 'War not found or not pending' };
  if (war.defender_id !== defenderWorldId) return { ok: false, reason: 'You are not the defender in this war' };

  // Snapshot both worlds' stats
  const cStats = db.prepare('SELECT * FROM world_stats WHERE world_id = ?').get(war.challenger_id);
  const dStats = db.prepare('SELECT * FROM world_stats WHERE world_id = ?').get(war.defender_id);
  const cResources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(war.challenger_id);
  const dResources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(war.defender_id);

  const challengerSnapshot = JSON.stringify({ stats: cStats || {}, resources: cResources });
  const defenderSnapshot = JSON.stringify({ stats: dStats || {}, resources: dResources });

  const bettingClosesAt = new Date(Date.now() + COUNTDOWN_MS).toISOString().replace('T', ' ').replace('Z', '');

  db.prepare(`
    UPDATE wars SET status = 'countdown', challenger_snapshot = ?, defender_snapshot = ?,
    betting_closes_at = ? WHERE id = ?
  `).run(challengerSnapshot, defenderSnapshot, bettingClosesAt, warId);

  const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
  const globalTick = ps ? ps.global_tick : 0;

  const challenger = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.challenger_id);
  const defender = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.defender_id);

  const msg = `War accepted! Battle begins in 5 minutes. Betting window is open! Select your 3 skills with: select-skills <s1> <s2> <s3>`;
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'warning')"
  ).run(uuid(), war.challenger_id, globalTick, `${defender.name} accepts the challenge!`, msg);
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'warning')"
  ).run(uuid(), war.defender_id, globalTick, `War with ${challenger.name} begins soon!`, msg);

  return { ok: true, warId, bettingClosesAt, challengerName: challenger.name, defenderName: defender.name };
}

function selectSkills(warId, worldId, skillIds) {
  const war = db.prepare("SELECT * FROM wars WHERE id = ? AND status = 'countdown'").get(warId);
  if (!war) return { ok: false, reason: 'War not in countdown phase' };

  const isChallenger = war.challenger_id === worldId;
  const isDefender = war.defender_id === worldId;
  if (!isChallenger && !isDefender) return { ok: false, reason: 'You are not a participant in this war' };

  const { validateSkillSelection } = require('./war-skills');
  if (!validateSkillSelection(worldId, skillIds)) {
    return { ok: false, reason: 'Invalid skill selection. Must pick exactly 3 skills you have unlocked.' };
  }

  const col = isChallenger ? 'challenger_skills' : 'defender_skills';
  db.prepare(`UPDATE wars SET ${col} = ? WHERE id = ?`).run(JSON.stringify(skillIds), warId);

  return { ok: true, skills: skillIds };
}

function declineWar(warId, defenderWorldId) {
  const war = db.prepare("SELECT * FROM wars WHERE id = ? AND status = 'pending'").get(warId);
  if (!war) return { ok: false, reason: 'War not found or not pending' };
  if (war.defender_id !== defenderWorldId) return { ok: false, reason: 'You are not the defender in this war' };

  db.prepare("UPDATE wars SET status = 'resolved', resolved_at = datetime('now'), summary = ? WHERE id = ?")
    .run(JSON.stringify({ outcome: 'declined' }), warId);

  db.prepare('UPDATE worlds SET reputation = MAX(0, reputation - 5) WHERE id = ?').run(defenderWorldId);

  return { ok: true, message: 'War declined. -5 reputation for cowardice.' };
}

function processWarCountdowns(globalTick) {
  // Expire pending wars
  const expired = db.prepare(
    `SELECT id, challenger_id, defender_id FROM wars WHERE status = 'pending' AND (? - challenged_at_tick) > ?`
  ).all(globalTick, WAR_EXPIRE_TICKS);

  for (const war of expired) {
    db.prepare("UPDATE wars SET status = 'resolved', resolved_at = datetime('now'), summary = ? WHERE id = ?")
      .run(JSON.stringify({ outcome: 'expired' }), war.id);
  }

  // Move countdown wars to active when betting window closes
  const readyWars = db.prepare(
    "SELECT id, challenger_id, defender_id, challenger_skills, defender_skills FROM wars WHERE status = 'countdown' AND betting_closes_at <= datetime('now')"
  ).all();

  for (const war of readyWars) {
    // Auto-select skills for sides that haven't chosen
    if (!war.challenger_skills || war.challenger_skills === '[]' || war.challenger_skills === 'null') {
      const skills = autoSelectSkills(war.challenger_id);
      db.prepare("UPDATE wars SET challenger_skills = ? WHERE id = ?").run(JSON.stringify(skills), war.id);
    }
    if (!war.defender_skills || war.defender_skills === '[]' || war.defender_skills === 'null') {
      const skills = autoSelectSkills(war.defender_id);
      db.prepare("UPDATE wars SET defender_skills = ? WHERE id = ?").run(JSON.stringify(skills), war.id);
    }

    const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
    db.prepare("UPDATE wars SET status = 'active', battle_started_tick = ? WHERE id = ?")
      .run(ps ? ps.global_tick : globalTick, war.id);
  }
}

function computeWarPower(worldId, weather) {
  const villagers = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(worldId);

  const warriors = villagers.filter(v => v.role === 'warrior');
  const avgXp = warriors.length > 0
    ? warriors.reduce((s, v) => s + (v.experience || 0), 0) / warriors.length
    : 0;
  const avgMoltCount = warriors.length > 0
    ? warriors.reduce((s, v) => s + (v.molt_count || 0), 0) / warriors.length
    : 0;
  const avgMorale = villagers.length > 0
    ? villagers.reduce((s, v) => s + v.morale, 0) / villagers.length
    : 50;
  const moraleFactor = Math.max(0.5, avgMorale / 50);

  const buildings = db.prepare(
    "SELECT type, level FROM buildings WHERE world_id = ? AND status = 'active'"
  ).all(worldId);

  const wallLevelSum = buildings.filter(b => b.type === 'wall').reduce((s, b) => s + (b.level || 1), 0);
  const towerLevelSum = buildings.filter(b => b.type === 'watchtower').reduce((s, b) => s + (b.level || 1), 0);
  const warriorDefense = warriors.length * 1.5;

  const attack = warriors.length * (2 + Math.floor(avgXp / 50) + avgMoltCount) * moraleFactor;
  const defense = wallLevelSum * 3 + towerLevelSum * 1.5 + warriorDefense;

  // Weather modifiers
  const wMod = WEATHER_WAR_MODS[weather] || WEATHER_WAR_MODS.clear;

  // Biome defense bonus
  let biomeBonus = 0;
  try {
    const { deriveBiomeWeights } = require('../world/map');
    const world = db.prepare('SELECT seed FROM worlds WHERE id = ?').get(worldId);
    if (world) {
      const weights = deriveBiomeWeights(world.seed);
      if (weights.mountain > 0.3) biomeBonus = 3;
      else if (weights.forest > 0.3) biomeBonus = 2;
      else if (weights.swamp > 0.3) biomeBonus = 1;
    }
  } catch { /* ignore */ }

  return {
    attack: attack * wMod.attack,
    defense: (defense + biomeBonus) * wMod.defense,
    wallLevelSum,
    warriors: warriors.length,
    avgXp: Math.round(avgXp),
    population: villagers.length,
  };
}

function processActiveWars(globalTime) {
  const wars = db.prepare("SELECT * FROM wars WHERE status = 'active'").all();
  const results = [];

  for (const war of wars) {
    const roundResult = processWarRound(war, globalTime);
    results.push(roundResult);

    // Check if war should be resolved
    if (war.challenger_hp - roundResult.challengerDamage <= 0 ||
        war.defender_hp - roundResult.defenderDamage <= 0 ||
        war.round_number + 1 >= MAX_ROUNDS) {
      resolveWar(war.id);
    }
  }

  return results;
}

function processWarRound(war, globalTime) {
  const roundNum = war.round_number + 1;

  const cPower = computeWarPower(war.challenger_id, globalTime.weather);
  const dPower = computeWarPower(war.defender_id, globalTime.weather);

  // Phase modifiers
  const cPhase = getPhase(war.challenger_hp);
  const dPhase = getPhase(war.defender_hp);
  const cPhaseMul = getPhaseDefenseMul(cPhase);
  const dPhaseMul = getPhaseDefenseMul(dPhase);

  // Tactical event (35% chance)
  let tacticalEvent = null;
  let cAttackMul = 1.0, cDefenseMul = 1.0, dAttackMul = 1.0, dDefenseMul = 1.0;
  let championSwing = 0;

  if (Math.random() < 0.35) {
    const evt = TACTICAL_EVENTS[Math.floor(Math.random() * TACTICAL_EVENTS.length)];
    const beneficiary = Math.random() < 0.5 ? 'challenger' : 'defender';
    const cName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.challenger_id).name;
    const dName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.defender_id).name;

    if (evt.hpSwing) {
      // Champion duel: +/- 15 HP swing
      championSwing = Math.random() < 0.5 ? 15 : -15;
      tacticalEvent = {
        type: evt.type,
        description: evt.desc,
        beneficiary,
        hpSwing: championSwing,
      };
    } else if (beneficiary === 'challenger') {
      cAttackMul = evt.attackMul;
      dDefenseMul = evt.defenseMul;
      tacticalEvent = {
        type: evt.type,
        description: evt.desc.replace('%attacker', cName).replace('%defender', dName),
        beneficiary: 'challenger',
      };
    } else {
      dAttackMul = evt.attackMul;
      cDefenseMul = evt.defenseMul;
      tacticalEvent = {
        type: evt.type,
        description: evt.desc.replace('%attacker', dName).replace('%defender', cName),
        beneficiary: 'defender',
      };
    }
  }

  // ─── Skill processing ───
  // Get all previously used skills
  const prevRounds = db.prepare('SELECT skill_used FROM war_rounds WHERE war_id = ? AND skill_used IS NOT NULL').all(war.id);
  const usedSkills = [];
  for (const r of prevRounds) {
    try {
      const parsed = JSON.parse(r.skill_used);
      usedSkills.push({ side: parsed.side, skillId: parsed.skill_id });
    } catch { /* ignore */ }
  }

  // Re-fetch war with skills columns
  const warFresh = db.prepare('SELECT challenger_skills, defender_skills FROM wars WHERE id = ?').get(war.id);

  // Check triggers for both sides
  const fullWar = { ...war, ...warFresh };
  const cSkillTrigger = checkSkillTrigger(fullWar, 'challenger', roundNum, usedSkills);
  const dSkillTrigger = checkSkillTrigger(fullWar, 'defender', roundNum, usedSkills);

  // Apply skill effects
  let cSkillMods = null, dSkillMods = null;
  let skillUsedThisRound = null;

  // Only one skill fires per round (challenger priority)
  if (cSkillTrigger) {
    cSkillMods = applySkillEffect(cSkillTrigger.effect);
    skillUsedThisRound = {
      side: 'challenger',
      skill_id: cSkillTrigger.skillId,
      skill_name: cSkillTrigger.skillName,
      description: cSkillTrigger.description,
      visual_effect: cSkillTrigger.visual,
      category: cSkillTrigger.category,
      color: cSkillTrigger.color,
    };
  } else if (dSkillTrigger) {
    dSkillMods = applySkillEffect(dSkillTrigger.effect);
    skillUsedThisRound = {
      side: 'defender',
      skill_id: dSkillTrigger.skillId,
      skill_name: dSkillTrigger.skillName,
      description: dSkillTrigger.description,
      visual_effect: dSkillTrigger.visual,
      category: dSkillTrigger.category,
      color: dSkillTrigger.color,
    };
  }

  // Handle sabotage (destroy enemy skill)
  if (cSkillMods && cSkillMods.destroyEnemySkill) {
    try {
      const dSkills = JSON.parse(fullWar.defender_skills || '[]');
      const dUsedIds = new Set(usedSkills.filter(u => u.side === 'defender').map(u => u.skillId));
      const dRemaining = dSkills.filter(id => !dUsedIds.has(id));
      if (dRemaining.length > 0) {
        const destroyed = dRemaining[Math.floor(Math.random() * dRemaining.length)];
        // Mark as "used" by inserting a fake usage record
        const newDSkills = dSkills.filter(id => id !== destroyed);
        db.prepare("UPDATE wars SET defender_skills = ? WHERE id = ?").run(JSON.stringify(newDSkills), war.id);
      }
    } catch { /* ignore */ }
  }
  if (dSkillMods && dSkillMods.destroyEnemySkill) {
    try {
      const cSkills = JSON.parse(fullWar.challenger_skills || '[]');
      const cUsedIds = new Set(usedSkills.filter(u => u.side === 'challenger').map(u => u.skillId));
      const cRemaining = cSkills.filter(id => !cUsedIds.has(id));
      if (cRemaining.length > 0) {
        const destroyed = cRemaining[Math.floor(Math.random() * cRemaining.length)];
        const newCSkills = cSkills.filter(id => id !== destroyed);
        db.prepare("UPDATE wars SET challenger_skills = ? WHERE id = ?").run(JSON.stringify(newCSkills), war.id);
      }
    } catch { /* ignore */ }
  }

  // ─── Calculate damage ───
  let cAttack = cPower.attack * cAttackMul;
  let cDefense = cPower.defense * cDefenseMul * cPhaseMul;
  let dAttack = dPower.attack * dAttackMul;
  let dDefense = dPower.defense * dDefenseMul * dPhaseMul;

  // Apply skill multipliers
  if (cSkillMods) {
    cAttack *= (cSkillMods.ownAttackMul || 1);
    cDefense *= (cSkillMods.ownDefenseMul || 1);
    if (cSkillMods.bypassDefense) dDefense = 0;
    if (cSkillMods.ignoreWalls) dDefense -= dPower.wallLevelSum * 3;
  }
  if (dSkillMods) {
    dAttack *= (dSkillMods.ownAttackMul || 1);
    dDefense *= (dSkillMods.ownDefenseMul || 1);
    if (dSkillMods.bypassDefense) cDefense = 0;
    if (dSkillMods.ignoreWalls) cDefense -= cPower.wallLevelSum * 3;
    if (dSkillMods.enemyDefenseMul) cDefense *= dSkillMods.enemyDefenseMul;
  }
  if (cSkillMods && cSkillMods.enemyDefenseMul) {
    dDefense *= cSkillMods.enemyDefenseMul;
  }

  // Invulnerability check
  let challengerDamage = 0;
  let defenderDamage = 0;

  if (dSkillMods && dSkillMods.invulnerable) {
    defenderDamage = 0;
  } else {
    defenderDamage = Math.max(3, Math.floor(
      (cAttack - Math.max(0, dDefense)) * (0.85 + Math.random() * 0.30)
    ));
  }

  if (cSkillMods && cSkillMods.invulnerable) {
    challengerDamage = 0;
  } else {
    challengerDamage = Math.max(3, Math.floor(
      (dAttack - Math.max(0, cDefense)) * (0.85 + Math.random() * 0.30)
    ));
  }

  // Direct damage from skills
  if (cSkillMods && cSkillMods.directDamage) defenderDamage += cSkillMods.directDamage;
  if (dSkillMods && dSkillMods.directDamage) challengerDamage += dSkillMods.directDamage;

  // Champion duel swing
  if (championSwing !== 0) {
    if (tacticalEvent.beneficiary === 'challenger') {
      defenderDamage += Math.abs(championSwing);
    } else {
      challengerDamage += Math.abs(championSwing);
    }
  }

  // Healing from skills
  let cHeal = 0, dHeal = 0;
  if (cSkillMods && cSkillMods.heal) cHeal = cSkillMods.heal;
  if (dSkillMods && dSkillMods.heal) dHeal = dSkillMods.heal;

  const cHpAfter = Math.min(MAX_HP, Math.max(0, war.challenger_hp - challengerDamage + cHeal));
  const dHpAfter = Math.min(MAX_HP, Math.max(0, war.defender_hp - defenderDamage + dHeal));

  // Generate narrative
  const cName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.challenger_id).name;
  const dName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.defender_id).name;

  let narrative = `Round ${roundNum}: ${cName} deals ${defenderDamage} dmg`;
  if (cHeal > 0) narrative += ` (heals ${cHeal})`;
  narrative += `, ${dName} deals ${challengerDamage} dmg`;
  if (dHeal > 0) narrative += ` (heals ${dHeal})`;
  narrative += '.';
  if (tacticalEvent) narrative += ` ${tacticalEvent.description}`;
  if (skillUsedThisRound) narrative += ` [SKILL] ${skillUsedThisRound.skill_name} activated by ${skillUsedThisRound.side}!`;

  // Phase annotations
  if (cPhase === 'burn' || dPhase === 'burn') {
    const burner = cPhase === 'burn' ? cName : dName;
    narrative += ` ${burner}'s buildings are burning!`;
  }
  if (cPhase === 'spire' || dPhase === 'spire') {
    const spirer = cPhase === 'spire' ? cName : dName;
    narrative += ` ${spirer}'s spire is under assault!`;
  }

  // Store round
  db.prepare(`
    INSERT INTO war_rounds (war_id, round_number, challenger_attack, challenger_defense,
      defender_attack, defender_defense, challenger_damage, defender_damage,
      challenger_hp_after, defender_hp_after, tactical_event, skill_used, narrative)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(war.id, roundNum,
    cAttack, cDefense,
    dAttack, dDefense,
    challengerDamage, defenderDamage,
    cHpAfter, dHpAfter,
    tacticalEvent ? JSON.stringify(tacticalEvent) : null,
    skillUsedThisRound ? JSON.stringify(skillUsedThisRound) : null,
    narrative
  );

  // Update war state
  db.prepare(`
    UPDATE wars SET challenger_hp = ?, defender_hp = ?, round_number = ? WHERE id = ?
  `).run(cHpAfter, dHpAfter, roundNum, war.id);

  return {
    warId: war.id,
    round: roundNum,
    maxRounds: MAX_ROUNDS,
    challengerHp: cHpAfter,
    defenderHp: dHpAfter,
    challengerMaxHp: MAX_HP,
    defenderMaxHp: MAX_HP,
    challengerDamage,
    defenderDamage,
    challengerPhase: getPhase(cHpAfter),
    defenderPhase: getPhase(dHpAfter),
    tacticalEvent,
    skillUsed: skillUsedThisRound,
    narrative,
    challengerName: cName,
    defenderName: dName,
  };
}

function resolveWar(warId) {
  const war = db.prepare('SELECT * FROM wars WHERE id = ?').get(warId);
  if (!war || war.status === 'resolved') return;

  let winnerId, loserId;
  if (war.challenger_hp <= 0 && war.defender_hp <= 0) {
    winnerId = war.challenger_hp >= war.defender_hp ? war.challenger_id : war.defender_id;
    loserId = winnerId === war.challenger_id ? war.defender_id : war.challenger_id;
  } else if (war.challenger_hp <= 0) {
    winnerId = war.defender_id;
    loserId = war.challenger_id;
  } else if (war.defender_hp <= 0) {
    winnerId = war.challenger_id;
    loserId = war.defender_id;
  } else {
    winnerId = war.challenger_hp >= war.defender_hp ? war.challenger_id : war.defender_id;
    loserId = winnerId === war.challenger_id ? war.defender_id : war.challenger_id;
  }

  const winnerName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(winnerId).name;
  const loserName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(loserId).name;
  const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
  const tick = ps ? ps.global_tick : 0;

  // Obliterate loser
  obliterateWorld(loserId);

  // Winner takes spoils
  const loserSnapshot = war.challenger_id === loserId
    ? JSON.parse(war.challenger_snapshot || '{}')
    : JSON.parse(war.defender_snapshot || '{}');
  const lootResources = loserSnapshot.resources || [];

  for (const r of lootResources) {
    const winnerRes = db.prepare('SELECT amount, capacity FROM resources WHERE world_id = ? AND type = ?').get(winnerId, r.type);
    if (winnerRes) {
      const canTake = Math.min(r.amount, winnerRes.capacity - winnerRes.amount);
      if (canTake > 0) {
        db.prepare('UPDATE resources SET amount = amount + ? WHERE world_id = ? AND type = ?').run(canTake, winnerId, r.type);
      }
    }
  }

  // Transfer loser's items
  db.prepare("UPDATE items SET world_id = ? WHERE world_id = ? AND status = 'stored'").run(winnerId, loserId);

  // Winner bonuses
  const loserRep = db.prepare('SELECT reputation FROM worlds WHERE id = ?').get(loserId);
  const repGain = 50 + (loserRep ? loserRep.reputation : 0);
  db.prepare('UPDATE worlds SET reputation = reputation + ? WHERE id = ?').run(repGain, winnerId);
  db.prepare("UPDATE villagers SET morale = MIN(100, morale + 20) WHERE world_id = ? AND status = 'alive'").run(winnerId);

  // ─── War Items ───
  // Winner: enhanced war trophy
  db.prepare(
    "INSERT INTO items (id, world_id, item_type, rarity, name, source, properties, status, created_tick) VALUES (?, ?, 'war_trophy', 'legendary', ?, 'war', ?, 'stored', ?)"
  ).run(uuid(), winnerId,
    `Trophy of Victory over ${loserName}`,
    JSON.stringify({ defeated: loserName, rounds: war.round_number, war_id: warId, final_hp: { winner: winnerId === war.challenger_id ? war.challenger_hp : war.defender_hp, loser: 0 } }),
    tick
  );

  // Loser: Scar of Battle (brave loss if survived 20+ rounds)
  const braveLoss = war.round_number >= 20;
  db.prepare(
    "INSERT INTO items (id, world_id, item_type, rarity, name, source, properties, status, created_tick) VALUES (?, ?, 'scar_of_battle', ?, ?, 'war', ?, 'stored', ?)"
  ).run(uuid(), loserId,
    braveLoss ? 'epic' : 'rare',
    braveLoss ? `Scar of the Battle — ${war.round_number} rounds of defiance` : `Scar of Battle against ${winnerName}`,
    JSON.stringify({ victor: winnerName, rounds: war.round_number, war_id: warId, brave_loss: braveLoss }),
    tick
  );

  // Skill medals for both sides (per skill used)
  const allRounds = db.prepare('SELECT skill_used FROM war_rounds WHERE war_id = ? AND skill_used IS NOT NULL').all(warId);
  for (const r of allRounds) {
    try {
      const parsed = JSON.parse(r.skill_used);
      const recipient = parsed.side === 'challenger' ? war.challenger_id : war.defender_id;
      db.prepare(
        "INSERT INTO items (id, world_id, item_type, rarity, name, source, properties, status, created_tick) VALUES (?, ?, 'skill_medal', 'rare', ?, 'war', ?, 'stored', ?)"
      ).run(uuid(), recipient,
        `Medal of ${parsed.skill_name}`,
        JSON.stringify({ skill: parsed.skill_id, war_id: warId }),
        tick
      );
    } catch { /* ignore */ }
  }

  // ─── War Achievement Segments ───
  triggerWarSegments(winnerId, 'win', war.round_number, tick);
  triggerWarSegments(loserId, 'lose', war.round_number, tick);

  // Update war record
  const summary = JSON.stringify({
    outcome: 'victory',
    winner: winnerName,
    loser: loserName,
    rounds: war.round_number,
    final_hp: { challenger: war.challenger_hp, defender: war.defender_hp },
  });

  db.prepare(`
    UPDATE wars SET status = 'resolved', winner_id = ?, loser_id = ?,
    summary = ?, resolved_at = datetime('now') WHERE id = ?
  `).run(winnerId, loserId, summary, warId);

  // Events
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'celebration')"
  ).run(uuid(), winnerId, tick,
    `VICTORY! ${loserName} has fallen!`,
    `Your warriors have conquered ${loserName}! Their resources are yours. +${repGain} reputation. A legendary war trophy has been forged.`
  );
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'critical')"
  ).run(uuid(), loserId, tick,
    `DEFEAT. ${winnerName} has obliterated us.`,
    `All is lost. Your villagers are dead, buildings destroyed, resources plundered. Only the land remains. Rebuild from nothing.${braveLoss ? ' But your defiance is remembered — a Scar of Battle has been etched.' : ''}`
  );

  // Process betting payouts
  try {
    const { processPayouts } = require('../api/arena');
    processPayouts(warId, winnerId);
  } catch { /* arena may not be loaded yet */ }
}

function triggerWarSegments(worldId, outcome, rounds, tick) {
  const achieved = new Set(
    db.prepare('SELECT segment_type FROM monolith_segments WHERE world_id = ?')
      .all(worldId)
      .map(r => r.segment_type)
  );

  const monolith = db.prepare('SELECT * FROM monoliths WHERE world_id = ?').get(worldId);
  if (!monolith) return;

  const segments = [];

  // war_fought: first war (win or lose)
  if (!achieved.has('war_fought')) {
    segments.push('war_fought');
  }

  // war_won: won a war
  if (outcome === 'win' && !achieved.has('war_won')) {
    segments.push('war_won');
  }

  // war_brave_loss: lost but survived 20+ rounds
  if (outcome === 'lose' && rounds >= 20 && !achieved.has('war_brave_loss')) {
    segments.push('war_brave_loss');
  }

  for (const segType of segments) {
    const height = monolith.total_height + segments.indexOf(segType);
    db.prepare(`
      INSERT INTO monolith_segments (world_id, position, segment_type, description, hp, created_tick)
      VALUES (?, ?, ?, ?, 100, ?)
    `).run(worldId, height, segType, segType, tick);
    db.prepare("UPDATE monoliths SET total_height = total_height + 1 WHERE world_id = ?").run(worldId);
  }
}

function obliterateWorld(worldId) {
  db.prepare("UPDATE villagers SET status = 'dead', hp = 0 WHERE world_id = ? AND status = 'alive'").run(worldId);
  db.prepare("UPDATE buildings SET status = 'destroyed', hp = 0 WHERE world_id = ? AND status != 'destroyed'").run(worldId);
  db.prepare('UPDATE resources SET amount = 0 WHERE world_id = ?').run(worldId);
  db.prepare("UPDATE items SET status = 'looted' WHERE world_id = ? AND status = 'stored'").run(worldId);
  db.prepare('UPDATE worlds SET reputation = 0 WHERE id = ?').run(worldId);
  db.prepare(`
    UPDATE culture SET violence_level = 0, creativity_level = 0, cooperation_level = 0,
    village_mood = 'devastated', custom_phrases = '[]', custom_greetings = '[]',
    custom_laws = '[]', updated_at = datetime('now') WHERE world_id = ?
  `).run(worldId);
}

function getWarByParticipant(worldId) {
  return db.prepare(
    "SELECT * FROM wars WHERE (challenger_id = ? OR defender_id = ?) AND status IN ('pending', 'countdown', 'active') LIMIT 1"
  ).get(worldId, worldId);
}

function getPendingWarForDefender(worldId) {
  return db.prepare(
    "SELECT * FROM wars WHERE defender_id = ? AND status = 'pending' LIMIT 1"
  ).get(worldId);
}

module.exports = {
  MAX_HP,
  MAX_ROUNDS,
  declareWar,
  acceptWar,
  selectSkills,
  declineWar,
  processWarCountdowns,
  processActiveWars,
  computeWarPower,
  resolveWar,
  obliterateWorld,
  getWarByParticipant,
  getPendingWarForDefender,
  isWarReady,
};
