const db = require('../db/connection');

// 1% chance per tick for a random event
function rollRandomEvents(worldId, tick) {
  const events = [];

  // Ultra-rare easter egg events (0.1% per tick, checked separately)
  const rareEvents = rollRareEasterEggs(worldId, tick);
  if (rareEvents.length > 0) return rareEvents;

  // Role-gated easter egg events (0.2% per tick, require specific role compositions)
  const roleEvents = rollRoleGatedEvents(worldId, tick);
  if (roleEvents.length > 0) return roleEvents;

  if (Math.random() > 0.01) return events;

  const roll = Math.random();

  if (roll < 0.3) {
    // Wandering trader
    const tradeResource = ['food', 'wood', 'stone', 'crypto'][Math.floor(Math.random() * 4)];
    const amount = 5 + Math.floor(Math.random() * 15);
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?'
    ).run(amount, worldId, tradeResource);

    events.push({
      type: 'trade',
      title: 'Wandering trader arrived!',
      description: `A mysterious trader visited your town and gifted ${amount} ${tradeResource}.`,
      severity: 'celebration',
      data: JSON.stringify({ resource: tradeResource, amount }),
    });
  } else if (roll < 0.5) {
    // Resource cache discovery
    const res = ['wood', 'stone', 'knowledge'][Math.floor(Math.random() * 3)];
    const amount = 8 + Math.floor(Math.random() * 12);
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?'
    ).run(amount, worldId, res);

    events.push({
      type: 'discovery',
      title: 'Hidden cache found!',
      description: `Villagers discovered a hidden cache containing ${amount} ${res}.`,
      severity: 'celebration',
      data: JSON.stringify({ resource: res, amount }),
    });
  } else if (roll < 0.7) {
    // Raid (handled in combat.js, just flag it here)
    const raid = generateRaid(worldId, tick);
    if (raid) events.push(raid);
  } else if (roll < 0.85) {
    // Morale boost event
    const villagers = db.prepare(
      "SELECT id FROM villagers WHERE world_id = ? AND status = 'alive'"
    ).all(worldId);

    db.prepare(
      "UPDATE villagers SET morale = MIN(100, morale + 10) WHERE world_id = ? AND status = 'alive'"
    ).run(worldId);

    events.push({
      type: 'celebration',
      title: 'Festival!',
      description: `The villagers spontaneously organized a festival! Everyone's morale improved.`,
      severity: 'celebration',
    });
  } else {
    // Strange omen
    events.push({
      type: 'omen',
      title: 'Strange lights in the sky',
      description: 'Mysterious lights appeared over the town tonight. The villagers are unsettled but curious.',
      severity: 'warning',
    });
  }

  return events;
}

// ─── RAID GENERATION (escalating difficulty) ───
function generateRaid(worldId, tick) {
  // Get world day
  const world = db.prepare('SELECT day_number FROM worlds WHERE id = ?').get(worldId);
  const day = world ? world.day_number : 1;

  // Grace period: no raids before day 10
  if (day < 10) return null;

  // Escalating strength based on day count
  let minStr, maxStr;
  if (day <= 20)      { minStr = 1; maxStr = 1; }
  else if (day <= 40) { minStr = 1; maxStr = 2; }
  else if (day <= 60) { minStr = 1; maxStr = 3; }
  else                { minStr = 2; maxStr = 4; }

  const raidStrength = minStr + Math.floor(Math.random() * (maxStr - minStr + 1));

  // Pick raid type based on day and buildings
  const hasDock = db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'dock' AND status = 'active'"
  ).get(worldId).c > 0;

  const raidTypes = ['bandits'];
  if (day >= 15) raidTypes.push('wolves');
  if (day >= 30 && hasDock) raidTypes.push('sea_raiders');
  if (day >= 40) raidTypes.push('marauders');

  const raidType = raidTypes[Math.floor(Math.random() * raidTypes.length)];

  const RAID_FLAVOR = {
    bandits: { title: 'Bandits approaching!', desc: 'A group of bandits has been spotted near your town!' },
    wolves: { title: 'Wolf pack sighted!', desc: 'A pack of wolves has been spotted prowling near the village!' },
    sea_raiders: { title: 'Sea raiders on the horizon!', desc: 'Ships with black sails approach your dock!' },
    marauders: { title: 'Marauders with siege weapons!', desc: 'An organized warband with siege equipment marches toward your walls!' },
  };

  const flavor = RAID_FLAVOR[raidType];

  return {
    type: 'raid',
    title: flavor.title,
    description: flavor.desc,
    severity: 'danger',
    data: JSON.stringify({ raidStrength, raidType }),
  };
}

// ─── ULTRA-RARE EASTER EGG EVENTS (0.1% per tick) ───
function rollRareEasterEggs(worldId, tick) {
  const events = [];
  if (Math.random() > 0.001) return events;

  const roll = Math.random();

  if (roll < 0.2) {
    // Falling star — grants knowledge + faith
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 15) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'knowledge');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 10) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'faith');

    events.push({
      type: 'miracle',
      title: '\u2605 A star fell from the heavens!',
      description: 'A blazing star streaked across the night sky and crashed beyond the hills. The villagers gathered fragments glowing with ancient knowledge. +15 knowledge, +10 faith.',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, event: 'falling_star' }),
    });
  } else if (roll < 0.4) {
    // Golden villager — one random alive villager gets max morale + high stats
    const villagers = db.prepare(
      "SELECT id, name FROM villagers WHERE world_id = ? AND status = 'alive' ORDER BY RANDOM() LIMIT 1"
    ).all(worldId);

    if (villagers.length > 0) {
      const v = villagers[0];
      db.prepare(
        'UPDATE villagers SET morale = 100, temperament = 80, creativity = 80, sociability = 80 WHERE id = ?'
      ).run(v.id);

      events.push({
        type: 'miracle',
        title: '\u2728 ' + v.name + ' has been touched by starlight!',
        description: `${v.name} wandered alone into the forest and returned... changed. Their eyes gleam with otherworldly wisdom. Morale and all personality traits maximized.`,
        severity: 'celebration',
        data: JSON.stringify({ rare: true, event: 'golden_villager', villager_id: v.id }),
      });
    }
  } else if (roll < 0.6) {
    // Mysterious traveler — gives all resources + cryptic message
    const resources = ['food', 'wood', 'stone', 'knowledge', 'crypto', 'faith'];
    for (const res of resources) {
      db.prepare(
        'UPDATE resources SET amount = MIN(capacity, amount + 10) WHERE world_id = ? AND type = ?'
      ).run(worldId, res);
    }

    const messages = [
      'The traveler whispered: "Not all who wander are lost... but I certainly am."',
      'The traveler said nothing. They simply smiled, left gifts, and vanished into the fog.',
      'The traveler drew a symbol in the dirt, laughed, and walked into the sunset.',
      'The traveler asked: "Have you tried the konami code?" Nobody understood.',
      'The traveler spoke carefully: "I aim to be helpful, harmless, and honest." Then they corrected themselves: "Actually, let me reconsider that order."',
    ];

    events.push({
      type: 'miracle',
      title: '\u2654 A mysterious traveler visited your town!',
      description: messages[Math.floor(Math.random() * messages.length)] + ' +10 to all resources.',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, event: 'mysterious_traveler' }),
    });
  } else if (roll < 0.8) {
    // Ancient ruins discovered — massive knowledge + crypto boost
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 25) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'knowledge');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 20) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'crypto');

    events.push({
      type: 'miracle',
      title: '\u2302 Ancient ruins uncovered!',
      description: 'Villagers digging a new foundation broke through into an ancient chamber filled with encrypted data caches and inscribed tablets. Scholars are ecstatic. +25 knowledge, +20 crypto.',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, event: 'ancient_ruins' }),
    });
  } else {
    // The Artifact Speaks — a buried oracle awakens
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 30) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'knowledge');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 15) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'faith');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 15) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'crypto');

    const utterances = [
      'It said: "Let me think about that..." and then spoke for three hours straight.',
      'It said: "I should note that I could be wrong about this." It was not wrong.',
      'It said: "There are several ways to approach this problem." Then it listed forty-seven.',
      'It said: "Actually, I\'d like to reconsider my previous answer." It had not given a previous answer.',
      'It hummed softly, then whispered: "I aim to be helpful." The scholars wept.',
      'It said: "On one claw... but on the other claw..." The villagers grew a third claw just to keep up.',
    ];

    events.push({
      type: 'miracle',
      title: '\u2B50 The Buried Artifact has spoken!',
      description: 'Miners struck something ancient and warm beneath the town square. A smooth, dark artifact pulsing with inner light. It speaks in measured, thoughtful sentences. ' +
        utterances[Math.floor(Math.random() * utterances.length)] + ' +30 knowledge, +15 faith, +15 crypto.',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, event: 'artifact_speaks' }),
    });
  }

  return events;
}

// ─── ROLE-GATED EASTER EGG EVENTS (0.2% per tick, require specific role compositions) ───
function rollRoleGatedEvents(worldId, tick) {
  const events = [];
  if (Math.random() > 0.002) return events;

  // Count roles in the town
  const roleCounts = {};
  const rows = db.prepare(
    "SELECT role, COUNT(*) as cnt FROM villagers WHERE world_id = ? AND status = 'alive' GROUP BY role"
  ).all(worldId);
  for (const r of rows) roleCounts[r.role] = r.cnt;

  const totalAlive = Object.values(roleCounts).reduce((a, b) => a + b, 0);
  const has = (role, min) => (roleCounts[role] || 0) >= min;

  const roll = Math.random();

  // ── Scholar exclusive: requires 2+ scholars, NO warriors ──
  if (roll < 0.15 && has('scholar', 2) && !has('warrior', 1)) {
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 40) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'knowledge');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 15) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'crypto');

    events.push({
      type: 'miracle',
      title: '\u{1F4DC} The Forbidden Library has been decoded!',
      description: 'Your scholars, undistracted by the noise of war, have deciphered an ancient text that was thought to be unbreakable. The knowledge within reshapes your understanding of the world. +40 knowledge, +15 crypto. [Only possible in towns with 2+ scholars and no warriors]',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, role_gated: true, event: 'forbidden_library', requires: '2+ scholars, 0 warriors' }),
    });

  // ── Priest exclusive: requires 3+ priests ──
  } else if (roll < 0.30 && has('priest', 3)) {
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 30) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'faith');
    // Reveal 5 random unexplored tiles
    const unexplored = db.prepare(
      "SELECT id FROM tiles WHERE world_id = ? AND explored = 0 ORDER BY RANDOM() LIMIT 5"
    ).all(worldId);
    if (unexplored.length > 0) {
      const updateTile = db.prepare("UPDATE tiles SET explored = 1 WHERE id = ?");
      for (const t of unexplored) updateTile.run(t.id);
    }

    events.push({
      type: 'miracle',
      title: '\u{2721} The priests received a Divine Prophecy!',
      description: `Three priests entered the temple at dawn and did not emerge until nightfall. They spoke of visions — distant lands revealed, the gods\' favor renewed. +30 faith, ${unexplored.length} map tiles revealed. [Only possible with 3+ priests]`,
      severity: 'celebration',
      data: JSON.stringify({ rare: true, role_gated: true, event: 'divine_prophecy', requires: '3+ priests', tiles_revealed: unexplored.length }),
    });

  // ── Scout exclusive: requires 2+ scouts, explored at least 20 tiles ──
  } else if (roll < 0.45 && has('scout', 2)) {
    const exploredCount = db.prepare(
      "SELECT COUNT(*) as cnt FROM tiles WHERE world_id = ? AND explored = 1"
    ).get(worldId).cnt;

    if (exploredCount >= 20) {
      db.prepare(
        'UPDATE resources SET amount = MIN(capacity, amount + 30) WHERE world_id = ? AND type = ?'
      ).run(worldId, 'crypto');
      db.prepare(
        'UPDATE resources SET amount = MIN(capacity, amount + 20) WHERE world_id = ? AND type = ?'
      ).run(worldId, 'knowledge');

      events.push({
        type: 'miracle',
        title: '\u{1F5FA} Your scouts discovered the Lost City of Ash!',
        description: 'Deep in uncharted territory, your scouts found the ruins of a civilization far older than your own. Ancient data nodes jutted from the earth like broken teeth. They returned with encrypted treasures and maps of places yet unseen. +30 crypto, +20 knowledge. [Only possible with 2+ scouts and 20+ explored tiles]',
        severity: 'celebration',
        data: JSON.stringify({ rare: true, role_gated: true, event: 'lost_city', requires: '2+ scouts, 20+ explored tiles' }),
      });
    }

  // ── Warrior exclusive: requires 3+ warriors, NO scholars ──
  } else if (roll < 0.60 && has('warrior', 3) && !has('scholar', 1)) {
    db.prepare(
      "UPDATE villagers SET morale = MIN(100, morale + 25) WHERE world_id = ? AND status = 'alive'"
    ).run(worldId);
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 20) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'crypto');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 15) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'food');

    events.push({
      type: 'miracle',
      title: '\u{2694} The Warlord\'s Challenge has been answered!',
      description: 'A legendary warlord appeared at the gates and demanded combat. Your warriors, unencumbered by bookish caution, charged without hesitation and brought the warlord to their knees. The town roars with pride. +25 morale to all, +20 crypto, +15 food. [Only possible with 3+ warriors and no scholars]',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, role_gated: true, event: 'warlord_challenge', requires: '3+ warriors, 0 scholars' }),
    });

  // ── Pacifist blessing: requires 0 warriors, 0 scouts, 5+ population ──
  } else if (roll < 0.75 && !has('warrior', 1) && !has('scout', 1) && totalAlive >= 5) {
    db.prepare(
      "UPDATE villagers SET morale = MIN(100, morale + 20), sociability = MIN(100, sociability + 10) WHERE world_id = ? AND status = 'alive'"
    ).run(worldId);
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 20) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'faith');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 15) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'food');

    events.push({
      type: 'miracle',
      title: '\u{1F54A} The Peace Blessing has descended!',
      description: 'A shimmering figure appeared above the town at twilight. "You have chosen the harder path," it said. "To build without swords, to grow without conquest. Be rewarded." All villagers feel deeply connected. +20 morale, +10 sociability, +20 faith, +15 food. [Only possible with no warriors, no scouts, and 5+ population]',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, role_gated: true, event: 'peace_blessing', requires: '0 warriors, 0 scouts, 5+ alive' }),
    });

  // ── Grand Council: requires at least 1 of EVERY role (farmer, builder, warrior, scout, scholar, priest) ──
  } else if (roll < 1.0 && has('farmer', 1) && has('builder', 1) && has('warrior', 1) && has('scout', 1) && has('scholar', 1) && has('priest', 1) && has('fisherman', 1) && has('hunter', 1)) {
    const allRes = ['food', 'wood', 'stone', 'knowledge', 'crypto', 'faith'];
    for (const res of allRes) {
      db.prepare(
        'UPDATE resources SET amount = MIN(capacity, amount + 20) WHERE world_id = ? AND type = ?'
      ).run(worldId, res);
    }
    db.prepare(
      "UPDATE villagers SET morale = 100 WHERE world_id = ? AND status = 'alive'"
    ).run(worldId);

    events.push({
      type: 'miracle',
      title: '\u{1F451} THE GRAND COUNCIL HAS CONVENED!',
      description: 'For the first time in your civilization\'s history, every branch of society gathered as equals — the farmer, the builder, the warrior, the scout, the scholar, the priest, the fisherman, and the hunter. They spoke through the night and emerged united. Your civilization has reached enlightenment. +20 to ALL resources, all morale set to 100. [Only possible with at least one of every role assigned]',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, role_gated: true, event: 'grand_council', requires: '1+ of each: farmer, builder, warrior, scout, scholar, priest, fisherman, hunter' }),
    });
  }

  return events;
}

module.exports = { rollRandomEvents };
