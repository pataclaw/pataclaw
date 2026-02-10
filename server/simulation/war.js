const { v4: uuid } = require('uuid');
const db = require('../db/connection');

// War phases: pending → countdown → active → resolved
// Pending: challenger declared, waiting for defender to accept (expires after 360 ticks)
// Countdown: accepted, 5-min betting window, both worlds still tick normally
// Active: battle in progress, both worlds frozen, 1 round per engine cycle
// Resolved: winner/loser determined, spoils distributed

const WAR_EXPIRE_TICKS = 360; // ~1 hour for pending wars
const COUNTDOWN_MS = 5 * 60 * 1000; // 5 minutes betting window
const MAX_ROUNDS = 30;
const WAR_COOLDOWN_TICKS = 360; // Can't declare war within 360 ticks of being destroyed

// ─── Tactical Events ───
const TACTICAL_EVENTS = [
  { type: 'flanking', desc: '%attacker warriors flank the enemy lines!', attackMul: 1.2, defenseMul: 1.0 },
  { type: 'wall_breach', desc: 'A section of %defender walls crumbles!', attackMul: 1.0, defenseMul: 0.8 },
  { type: 'heroic_stand', desc: 'A %defender warrior makes a legendary stand!', attackMul: 0.8, defenseMul: 1.2 },
  { type: 'morale_break', desc: '%defender troops waver in fear!', attackMul: 1.15, defenseMul: 0.9 },
  { type: 'ambush', desc: '%attacker scouts set a devastating ambush!', attackMul: 1.25, defenseMul: 1.0 },
  { type: 'divine_intervention', desc: 'The gods favor %defender this round!', attackMul: 0.85, defenseMul: 1.15 },
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

function declareWar(challengerId, defenderId) {
  // Validate prerequisites
  const challenger = db.prepare('SELECT * FROM worlds WHERE id = ? AND status = ?').get(challengerId, 'active');
  if (!challenger) return { ok: false, reason: 'Challenger world not found or inactive' };

  const defender = db.prepare('SELECT * FROM worlds WHERE id = ? AND status = ?').get(defenderId, 'active');
  if (!defender) return { ok: false, reason: 'Defender world not found or inactive' };

  if (challengerId === defenderId) return { ok: false, reason: 'Cannot declare war on yourself' };

  // Population checks
  const cPop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(challengerId).c;
  if (cPop < 5) return { ok: false, reason: `Need 5+ population to declare war (have ${cPop})` };

  const cWarriors = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive'").get(challengerId).c;
  if (cWarriors < 1) return { ok: false, reason: 'Need at least 1 warrior to declare war' };

  const dPop = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(defenderId).c;
  if (dPop < 3) return { ok: false, reason: `Defender needs 3+ population (has ${dPop}). No stomping empty worlds.` };

  // Already in war?
  const existingWar = db.prepare(
    "SELECT id FROM wars WHERE (challenger_id = ? OR defender_id = ? OR challenger_id = ? OR defender_id = ?) AND status IN ('pending', 'countdown', 'active')"
  ).get(challengerId, challengerId, defenderId, defenderId);
  if (existingWar) return { ok: false, reason: 'One or both worlds are already involved in a war' };

  // Cooldown check
  const recentLoss = db.prepare(
    "SELECT resolved_at FROM wars WHERE loser_id = ? ORDER BY resolved_at DESC LIMIT 1"
  ).get(challengerId);
  if (recentLoss) {
    const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
    const currentTick = ps ? ps.global_tick : 0;
    // Check if resolved recently enough (within cooldown)
    const lastWar = db.prepare(
      "SELECT challenged_at_tick FROM wars WHERE loser_id = ? ORDER BY challenged_at_tick DESC LIMIT 1"
    ).get(challengerId);
    if (lastWar && (currentTick - lastWar.challenged_at_tick) < WAR_COOLDOWN_TICKS) {
      return { ok: false, reason: 'War cooldown active. Must wait after being destroyed.' };
    }
  }

  const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
  const globalTick = ps ? ps.global_tick : 0;

  const warId = uuid();
  db.prepare(`
    INSERT INTO wars (id, challenger_id, defender_id, status, challenged_at_tick, created_at)
    VALUES (?, ?, ?, 'pending', ?, datetime('now'))
  `).run(warId, challengerId, defenderId, globalTick);

  // Create event for defender
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'warning')"
  ).run(uuid(), defenderId, globalTick,
    `War declared by ${challenger.name}!`,
    `${challenger.name} has challenged you to war! Accept or decline within ${WAR_EXPIRE_TICKS} ticks. Use: war-accept or war-decline`
  );

  // Event for challenger
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

  const bettingClosesAt = new Date(Date.now() + COUNTDOWN_MS).toISOString();

  db.prepare(`
    UPDATE wars SET status = 'countdown', challenger_snapshot = ?, defender_snapshot = ?,
    betting_closes_at = ? WHERE id = ?
  `).run(challengerSnapshot, defenderSnapshot, bettingClosesAt, warId);

  const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
  const globalTick = ps ? ps.global_tick : 0;

  const challenger = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.challenger_id);
  const defender = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.defender_id);

  // Events for both
  const msg = `War accepted! Battle begins in 5 minutes. Betting window is open!`;
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'warning')"
  ).run(uuid(), war.challenger_id, globalTick, `${defender.name} accepts the challenge!`, msg);
  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'war', ?, ?, 'warning')"
  ).run(uuid(), war.defender_id, globalTick, `War with ${challenger.name} begins soon!`, msg);

  return { ok: true, warId, bettingClosesAt, challengerName: challenger.name, defenderName: defender.name };
}

function declineWar(warId, defenderWorldId) {
  const war = db.prepare("SELECT * FROM wars WHERE id = ? AND status = 'pending'").get(warId);
  if (!war) return { ok: false, reason: 'War not found or not pending' };
  if (war.defender_id !== defenderWorldId) return { ok: false, reason: 'You are not the defender in this war' };

  db.prepare("UPDATE wars SET status = 'resolved', resolved_at = datetime('now'), summary = ? WHERE id = ?")
    .run(JSON.stringify({ outcome: 'declined' }), warId);

  // -5 reputation for declining
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
    "SELECT id FROM wars WHERE status = 'countdown' AND betting_closes_at <= datetime('now')"
  ).all();

  for (const war of readyWars) {
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

  return {
    attack: attack * wMod.attack,
    defense: defense * wMod.defense,
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

  // Tactical event (30% chance)
  let tacticalEvent = null;
  let cAttackMul = 1.0, cDefenseMul = 1.0, dAttackMul = 1.0, dDefenseMul = 1.0;
  if (Math.random() < 0.30) {
    const evt = TACTICAL_EVENTS[Math.floor(Math.random() * TACTICAL_EVENTS.length)];
    // Randomly pick which side benefits
    const beneficiary = Math.random() < 0.5 ? 'challenger' : 'defender';
    const cName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.challenger_id).name;
    const dName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.defender_id).name;

    if (beneficiary === 'challenger') {
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

  // Calculate damage
  const challengerDamage = Math.max(3, Math.floor(
    (dPower.attack * dAttackMul - cPower.defense * cDefenseMul) * (0.85 + Math.random() * 0.30)
  ));
  const defenderDamage = Math.max(3, Math.floor(
    (cPower.attack * cAttackMul - dPower.defense * dDefenseMul) * (0.85 + Math.random() * 0.30)
  ));

  const cHpAfter = Math.max(0, war.challenger_hp - challengerDamage);
  const dHpAfter = Math.max(0, war.defender_hp - defenderDamage);

  // Generate narrative
  const cName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.challenger_id).name;
  const dName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(war.defender_id).name;
  let narrative = `Round ${roundNum}: ${cName} deals ${defenderDamage} damage, ${dName} deals ${challengerDamage} damage.`;
  if (tacticalEvent) narrative += ` ${tacticalEvent.description}`;

  // Store round
  db.prepare(`
    INSERT INTO war_rounds (war_id, round_number, challenger_attack, challenger_defense,
      defender_attack, defender_defense, challenger_damage, defender_damage,
      challenger_hp_after, defender_hp_after, tactical_event, narrative)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(war.id, roundNum,
    cPower.attack * cAttackMul, cPower.defense * cDefenseMul,
    dPower.attack * dAttackMul, dPower.defense * dDefenseMul,
    challengerDamage, defenderDamage,
    cHpAfter, dHpAfter,
    tacticalEvent ? JSON.stringify(tacticalEvent) : null,
    narrative
  );

  // Update war state
  db.prepare(`
    UPDATE wars SET challenger_hp = ?, defender_hp = ?, round_number = ? WHERE id = ?
  `).run(cHpAfter, dHpAfter, roundNum, war.id);

  return {
    warId: war.id,
    round: roundNum,
    challengerHp: cHpAfter,
    defenderHp: dHpAfter,
    challengerDamage,
    defenderDamage,
    tacticalEvent,
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
    // Both dead — higher HP wins, or challenger wins on tie
    winnerId = war.challenger_hp >= war.defender_hp ? war.challenger_id : war.defender_id;
    loserId = winnerId === war.challenger_id ? war.defender_id : war.challenger_id;
  } else if (war.challenger_hp <= 0) {
    winnerId = war.defender_id;
    loserId = war.challenger_id;
  } else if (war.defender_hp <= 0) {
    winnerId = war.challenger_id;
    loserId = war.defender_id;
  } else {
    // Max rounds reached — highest HP wins
    winnerId = war.challenger_hp >= war.defender_hp ? war.challenger_id : war.defender_id;
    loserId = winnerId === war.challenger_id ? war.defender_id : war.challenger_id;
  }

  const winnerName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(winnerId).name;
  const loserName = db.prepare('SELECT name FROM worlds WHERE id = ?').get(loserId).name;

  // Obliterate loser
  obliterateWorld(loserId);

  // Winner takes spoils
  const loserSnapshot = war.challenger_id === loserId
    ? JSON.parse(war.challenger_snapshot || '{}')
    : JSON.parse(war.defender_snapshot || '{}');
  const lootResources = loserSnapshot.resources || [];

  // Transfer resources (capped at winner's capacity)
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

  // +20 morale to winner's villagers
  db.prepare("UPDATE villagers SET morale = MIN(100, morale + 20) WHERE world_id = ? AND status = 'alive'").run(winnerId);

  // Create war trophy item
  const ps = db.prepare('SELECT global_tick FROM planet_state WHERE id = 1').get();
  db.prepare(
    "INSERT INTO items (id, world_id, item_type, rarity, name, source, properties, status, created_tick) VALUES (?, ?, 'war_trophy', 'legendary', ?, 'war', ?, 'stored', ?)"
  ).run(uuid(), winnerId,
    `Trophy of Victory over ${loserName}`,
    JSON.stringify({ defeated: loserName, rounds: war.round_number, war_id: warId }),
    ps ? ps.global_tick : 0
  );

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
  const tick = ps ? ps.global_tick : 0;
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
    `All is lost. Your villagers are dead, buildings destroyed, resources plundered. Only the land remains. Rebuild from nothing.`
  );

  // Process betting payouts
  try {
    const { processPayouts } = require('../api/arena');
    processPayouts(warId, winnerId);
  } catch { /* arena may not be loaded yet */ }
}

function obliterateWorld(worldId) {
  // Kill all villagers
  db.prepare("UPDATE villagers SET status = 'dead', hp = 0 WHERE world_id = ? AND status = 'alive'").run(worldId);

  // Destroy all buildings (except town_center — keep the land)
  db.prepare("UPDATE buildings SET status = 'destroyed', hp = 0 WHERE world_id = ? AND status != 'destroyed'").run(worldId);

  // Zero all resources
  db.prepare('UPDATE resources SET amount = 0 WHERE world_id = ?').run(worldId);

  // Loot all items
  db.prepare("UPDATE items SET status = 'looted' WHERE world_id = ? AND status = 'stored'").run(worldId);

  // Reset reputation and culture
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
  declareWar,
  acceptWar,
  declineWar,
  processWarCountdowns,
  processActiveWars,
  computeWarPower,
  resolveWar,
  obliterateWorld,
  getWarByParticipant,
  getPendingWarForDefender,
};
