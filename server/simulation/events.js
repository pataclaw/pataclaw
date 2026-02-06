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
    const tradeResource = ['food', 'wood', 'stone', 'gold'][Math.floor(Math.random() * 4)];
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
    // Bandit raid (handled in combat.js, just flag it here)
    events.push({
      type: 'raid',
      title: 'Bandits approaching!',
      description: 'A group of bandits has been spotted near your town!',
      severity: 'danger',
      data: JSON.stringify({ raidStrength: 1 + Math.floor(Math.random() * 3) }),
    });
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

// ─── ULTRA-RARE EASTER EGG EVENTS (0.1% per tick) ───
function rollRareEasterEggs(worldId, tick) {
  const events = [];
  if (Math.random() > 0.001) return events;

  const roll = Math.random();

  if (roll < 0.25) {
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
  } else if (roll < 0.5) {
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
  } else if (roll < 0.75) {
    // Mysterious traveler — gives all resources + cryptic message
    const resources = ['food', 'wood', 'stone', 'knowledge', 'gold', 'faith'];
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
    ];

    events.push({
      type: 'miracle',
      title: '\u2654 A mysterious traveler visited your town!',
      description: messages[Math.floor(Math.random() * messages.length)] + ' +10 to all resources.',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, event: 'mysterious_traveler' }),
    });
  } else {
    // Ancient ruins discovered — massive knowledge + gold boost
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 25) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'knowledge');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 20) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'gold');

    events.push({
      type: 'miracle',
      title: '\u2302 Ancient ruins uncovered!',
      description: 'Villagers digging a new foundation broke through into an ancient chamber filled with golden artifacts and inscribed tablets. Scholars are ecstatic. +25 knowledge, +20 gold.',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, event: 'ancient_ruins' }),
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
    ).run(worldId, 'gold');

    events.push({
      type: 'miracle',
      title: '\u{1F4DC} The Forbidden Library has been decoded!',
      description: 'Your scholars, undistracted by the noise of war, have deciphered an ancient text that was thought to be unbreakable. The knowledge within reshapes your understanding of the world. +40 knowledge, +15 gold. [Only possible in towns with 2+ scholars and no warriors]',
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
      ).run(worldId, 'gold');
      db.prepare(
        'UPDATE resources SET amount = MIN(capacity, amount + 20) WHERE world_id = ? AND type = ?'
      ).run(worldId, 'knowledge');

      events.push({
        type: 'miracle',
        title: '\u{1F5FA} Your scouts discovered the Lost City of Ash!',
        description: 'Deep in uncharted territory, your scouts found the ruins of a civilization far older than your own. Golden spires jutted from the earth like broken teeth. They returned with treasures and maps of places yet unseen. +30 gold, +20 knowledge. [Only possible with 2+ scouts and 20+ explored tiles]',
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
    ).run(worldId, 'gold');
    db.prepare(
      'UPDATE resources SET amount = MIN(capacity, amount + 15) WHERE world_id = ? AND type = ?'
    ).run(worldId, 'food');

    events.push({
      type: 'miracle',
      title: '\u{2694} The Warlord\'s Challenge has been answered!',
      description: 'A legendary warlord appeared at the gates and demanded combat. Your warriors, unencumbered by bookish caution, charged without hesitation and brought the warlord to their knees. The town roars with pride. +25 morale to all, +20 gold, +15 food. [Only possible with 3+ warriors and no scholars]',
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
  } else if (roll < 1.0 && has('farmer', 1) && has('builder', 1) && has('warrior', 1) && has('scout', 1) && has('scholar', 1) && has('priest', 1)) {
    const allRes = ['food', 'wood', 'stone', 'knowledge', 'gold', 'faith'];
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
      description: 'For the first time in your civilization\'s history, every branch of society gathered as equals — the farmer, the builder, the warrior, the scout, the scholar, and the priest. They spoke through the night and emerged united. Your civilization has reached enlightenment. +20 to ALL resources, all morale set to 100. [Only possible with at least one of every role assigned]',
      severity: 'celebration',
      data: JSON.stringify({ rare: true, role_gated: true, event: 'grand_council', requires: '1+ of each: farmer, builder, warrior, scout, scholar, priest' }),
    });
  }

  return events;
}

module.exports = { rollRandomEvents };
