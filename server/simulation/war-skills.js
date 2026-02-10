const db = require('../db/connection');

// ─── War Skills System ───
// 12 skills in 4 categories. Each side picks 3 before battle.
// Skills auto-trigger once at optimal HP thresholds during combat.

const SKILLS = {
  // OFFENSIVE (Red) — earned through violence/military
  berserker_charge: {
    id: 'berserker_charge', name: 'Berserker Charge', category: 'offensive', color: 'red',
    desc: '+50% attack for 2 rounds',
    unlock: (w) => w.violence >= 60,
    unlockDesc: 'violence >= 60',
    trigger: (ctx) => ctx.ownHpPct < 0.70,
    effect: { attackMul: 1.5, defenseMul: 1.0, rounds: 2 },
    visual: 'berserker_charge',
    priority: 3,
  },
  rain_of_fire: {
    id: 'rain_of_fire', name: 'Rain of Fire', category: 'offensive', color: 'red',
    desc: '25 direct damage + ignite 1 enemy building',
    unlock: (w) => w.raidsSurvived >= 5,
    unlockDesc: '5+ raids survived',
    trigger: (ctx) => ctx.enemyHpPct < 0.60,
    effect: { directDamage: 25, ignitesBuilding: true },
    visual: 'rain_of_fire',
    priority: 5,
  },
  warcry: {
    id: 'warcry', name: 'Warcry', category: 'offensive', color: 'red',
    desc: 'Enemy -40% defense for 1 round',
    unlock: (w) => w.warriors >= 15,
    unlockDesc: '15+ warriors alive',
    trigger: (ctx) => ctx.round >= 3 && ctx.round <= 5,
    effect: { enemyDefenseMul: 0.6, rounds: 1 },
    visual: 'warcry',
    priority: 2,
  },

  // DEFENSIVE (Blue) — earned through cooperation/fortification
  shield_wall: {
    id: 'shield_wall', name: 'Shield Wall', category: 'defensive', color: 'blue',
    desc: '-50% damage taken for 2 rounds',
    unlock: (w) => w.cooperation >= 60,
    unlockDesc: 'cooperation >= 60',
    trigger: (ctx) => ctx.ownHpPct < 0.50,
    effect: { defenseMul: 2.0, rounds: 2 },
    visual: 'shield_wall',
    priority: 4,
  },
  rally_cry: {
    id: 'rally_cry', name: 'Rally Cry', category: 'defensive', color: 'blue',
    desc: 'Restore 25 HP',
    unlock: (w) => w.projectsCompleted >= 1,
    unlockDesc: 'any community project completed',
    trigger: (ctx) => ctx.ownHpPct < 0.40,
    effect: { heal: 25 },
    visual: 'rally_cry',
    priority: 6,
  },
  iron_fortify: {
    id: 'iron_fortify', name: 'Iron Fortify', category: 'defensive', color: 'blue',
    desc: 'Double wall defense for 2 rounds',
    unlock: (w) => w.wallCount >= 2 && w.wallLevelSum >= 4,
    unlockDesc: '2+ walls, wall level sum >= 4',
    trigger: (ctx) => ctx.enemyUsedOffensiveSkill,
    effect: { wallDefenseMul: 2.0, rounds: 2 },
    visual: 'iron_fortify',
    priority: 7,
  },

  // TACTICAL (Green) — earned through creativity/knowledge
  ambush: {
    id: 'ambush', name: 'Ambush', category: 'tactical', color: 'green',
    desc: 'Bypass defense, full damage for 1 round',
    unlock: (w) => w.explorationPct >= 40,
    unlockDesc: 'exploration >= 40%',
    trigger: (ctx) => ctx.round >= 8 && ctx.round <= 12,
    effect: { bypassDefense: true, rounds: 1 },
    visual: 'ambush',
    priority: 8,
  },
  sabotage: {
    id: 'sabotage', name: 'Sabotage', category: 'tactical', color: 'green',
    desc: 'Destroy 1 random enemy unused skill',
    unlock: (w) => w.hasLibrary,
    unlockDesc: 'library built + active',
    trigger: (ctx) => ctx.enemySkillsRemaining >= 2,
    effect: { destroyEnemySkill: true },
    visual: 'sabotage',
    priority: 1,
  },
  flanking_strike: {
    id: 'flanking_strike', name: 'Flanking', category: 'tactical', color: 'green',
    desc: '+40% attack, ignore walls for 1 round',
    unlock: (w) => w.creativity >= 60,
    unlockDesc: 'creativity >= 60',
    trigger: (ctx) => ctx.enemyHpPct < 0.50,
    effect: { attackMul: 1.4, ignoreWalls: true, rounds: 1 },
    visual: 'flanking_strike',
    priority: 9,
  },

  // MYSTICAL (Gold) — earned through faith/megastructures
  divine_shield: {
    id: 'divine_shield', name: 'Divine Shield', category: 'mystical', color: 'gold',
    desc: 'Block ALL damage for 1 round',
    unlock: (w) => w.hasTemple && w.faith >= 50,
    unlockDesc: 'temple + faith >= 50',
    trigger: (ctx) => ctx.ownHpPct < 0.30,
    effect: { invulnerable: true, rounds: 1 },
    visual: 'divine_shield',
    priority: 10,
  },
  molt_fury: {
    id: 'molt_fury', name: 'Molt Fury', category: 'mystical', color: 'gold',
    desc: '+30% attack for 3 rounds (warrior molt power)',
    unlock: (w) => w.hasMoltCathedral,
    unlockDesc: 'molt_cathedral active',
    trigger: (ctx) => ctx.round >= 5 && ctx.round <= 10,
    effect: { attackMul: 1.3, rounds: 3 },
    visual: 'molt_fury',
    priority: 11,
  },
  spires_wrath: {
    id: 'spires_wrath', name: "Spire's Wrath", category: 'mystical', color: 'gold',
    desc: '30 direct damage channeled from the spire',
    unlock: (w) => w.hasCompletedSpire,
    unlockDesc: 'completed spire (everyone has this)',
    trigger: (ctx) => ctx.ownHpPct < 0.25,
    effect: { directDamage: 30 },
    visual: 'spires_wrath',
    priority: 12,
  },
};

function getWorldSkillContext(worldId) {
  const culture = db.prepare('SELECT violence_level, creativity_level, cooperation_level FROM culture WHERE world_id = ?').get(worldId) || {};
  const warriors = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive'").get(worldId).c;
  const raidsSurvived = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'raid' AND severity = 'celebration'").get(worldId).c;
  const projectsCompleted = db.prepare("SELECT COUNT(*) as c FROM projects WHERE world_id = ? AND status = 'complete'").get(worldId).c;
  const walls = db.prepare("SELECT level FROM buildings WHERE world_id = ? AND type = 'wall' AND status = 'active'").all(worldId);
  const wallCount = walls.length;
  const wallLevelSum = walls.reduce((s, w) => s + (w.level || 1), 0);
  const hasLibrary = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'library' AND status = 'active'").get(worldId).c > 0;
  const hasTemple = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'temple' AND status = 'active'").get(worldId).c > 0;
  const hasMoltCathedral = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'molt_cathedral' AND status = 'active'").get(worldId).c > 0;
  const faith = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'faith'").get(worldId);
  const spireSegments = db.prepare("SELECT COUNT(*) as c FROM monolith_segments WHERE world_id = ?").get(worldId).c;
  const hasCompletedSpire = spireSegments >= 16;

  const totalTiles = db.prepare("SELECT COUNT(*) as c FROM tiles WHERE world_id = ?").get(worldId).c;
  const exploredTiles = db.prepare("SELECT COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1").get(worldId).c;
  const explorationPct = totalTiles > 0 ? Math.round((exploredTiles / totalTiles) * 100) : 0;

  return {
    violence: culture.violence_level || 0,
    creativity: culture.creativity_level || 0,
    cooperation: culture.cooperation_level || 0,
    warriors,
    raidsSurvived,
    projectsCompleted,
    wallCount,
    wallLevelSum,
    hasLibrary,
    hasTemple,
    hasMoltCathedral,
    faith: faith ? faith.amount : 0,
    hasCompletedSpire,
    explorationPct,
  };
}

function getAvailableSkills(worldId) {
  const ctx = getWorldSkillContext(worldId);
  const available = [];
  for (const skill of Object.values(SKILLS)) {
    if (skill.unlock(ctx)) {
      available.push(skill.id);
    }
  }
  return available;
}

function autoSelectSkills(worldId) {
  const available = getAvailableSkills(worldId);
  // Sort by priority (higher = more desperate = save for later) — pick lowest priority first for variety
  const sorted = available
    .map(id => SKILLS[id])
    .sort((a, b) => a.priority - b.priority);
  return sorted.slice(0, 3).map(s => s.id);
}

function validateSkillSelection(worldId, skillIds) {
  if (!Array.isArray(skillIds) || skillIds.length !== 3) return false;
  const available = new Set(getAvailableSkills(worldId));
  const unique = new Set(skillIds);
  if (unique.size !== 3) return false;
  for (const id of skillIds) {
    if (!available.has(id)) return false;
  }
  return true;
}

function buildTriggerContext(war, side, round, usedSkills) {
  const isChallenger = side === 'challenger';
  const ownHp = isChallenger ? war.challenger_hp : war.defender_hp;
  const enemyHp = isChallenger ? war.defender_hp : war.challenger_hp;

  // Check if enemy used an offensive skill this war
  const enemySide = isChallenger ? 'defender' : 'challenger';
  const enemyUsedOffensive = usedSkills
    .filter(u => u.side === enemySide)
    .some(u => {
      const s = SKILLS[u.skillId];
      return s && s.category === 'offensive';
    });

  // Count enemy unused skills
  const enemySkillsCol = isChallenger ? 'defender_skills' : 'challenger_skills';
  let enemySkillsRemaining = 0;
  try {
    const enemySkills = JSON.parse(war[enemySkillsCol] || '[]');
    const enemyUsedIds = new Set(usedSkills.filter(u => u.side === enemySide).map(u => u.skillId));
    enemySkillsRemaining = enemySkills.filter(id => !enemyUsedIds.has(id)).length;
  } catch { /* ignore */ }

  return {
    round,
    ownHp,
    ownHpPct: ownHp / 200,
    enemyHp,
    enemyHpPct: enemyHp / 200,
    enemyUsedOffensiveSkill: enemyUsedOffensive,
    enemySkillsRemaining,
  };
}

function checkSkillTrigger(war, side, round, usedSkills) {
  const isChallenger = side === 'challenger';
  const skillsCol = isChallenger ? 'challenger_skills' : 'defender_skills';
  let selectedSkills;
  try {
    selectedSkills = JSON.parse(war[skillsCol] || '[]');
  } catch {
    return null;
  }

  const usedIds = new Set(usedSkills.filter(u => u.side === side).map(u => u.skillId));
  const remaining = selectedSkills.filter(id => !usedIds.has(id));

  if (remaining.length === 0) return null;

  const ctx = buildTriggerContext(war, side, round, usedSkills);

  // Check each remaining skill's trigger
  for (const skillId of remaining) {
    const skill = SKILLS[skillId];
    if (!skill) continue;
    if (skill.trigger(ctx)) {
      return {
        side,
        skillId: skill.id,
        skillName: skill.name,
        description: skill.desc,
        visual: skill.visual,
        effect: skill.effect,
        category: skill.category,
        color: skill.color,
      };
    }
  }

  return null;
}

function applySkillEffect(effect, ownPower, enemyPower, ownHp, enemyHp) {
  const mods = { ownAttackMul: 1, ownDefenseMul: 1, enemyDefenseMul: 1, heal: 0, directDamage: 0, bypassDefense: false, ignoreWalls: false, invulnerable: false, destroyEnemySkill: false };

  if (effect.attackMul) mods.ownAttackMul = effect.attackMul;
  if (effect.defenseMul) mods.ownDefenseMul = effect.defenseMul;
  if (effect.enemyDefenseMul) mods.enemyDefenseMul = effect.enemyDefenseMul;
  if (effect.heal) mods.heal = effect.heal;
  if (effect.directDamage) mods.directDamage = effect.directDamage;
  if (effect.bypassDefense) mods.bypassDefense = true;
  if (effect.ignoreWalls) mods.ignoreWalls = true;
  if (effect.invulnerable) mods.invulnerable = true;
  if (effect.destroyEnemySkill) mods.destroyEnemySkill = true;

  return mods;
}

function getSkillInfo(skillId) {
  return SKILLS[skillId] || null;
}

function getAllSkills() {
  return Object.values(SKILLS).map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    color: s.color,
    desc: s.desc,
    unlockDesc: s.unlockDesc,
  }));
}

module.exports = {
  SKILLS,
  getAvailableSkills,
  autoSelectSkills,
  validateSkillSelection,
  checkSkillTrigger,
  applySkillEffect,
  getSkillInfo,
  getAllSkills,
  getWorldSkillContext,
};
