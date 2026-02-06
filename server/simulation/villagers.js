const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { randomName, randomTrait, TRAIT_PERSONALITY } = require('../world/templates');
const { CENTER } = require('../world/map');
const { getCulture } = require('./culture');

function processVillagers(worldId, isStarving, weather) {
  const culture = getCulture(worldId);
  const events = [];

  // Temple healing bonus: +2 HP/tick if active temple exists
  const hasTemple = db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'temple' AND status = 'active'"
  ).get(worldId).c > 0;

  const villagers = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(worldId);

  // Auto-refugee: when population is 0, a wanderer arrives every 10 ticks
  if (villagers.length === 0) {
    const world = db.prepare('SELECT current_tick, day_number FROM worlds WHERE id = ?').get(worldId);
    if (world && world.current_tick % 10 === 0) {
      const rng = () => Math.random();
      const name = randomName(rng);
      const trait = randomTrait(rng);
      const basePers = TRAIT_PERSONALITY[trait] || { temperament: 50, creativity: 50, sociability: 50 };
      // Survival instinct: auto-assign as farmer if food is 0, otherwise idle
      const food = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'food'").get(worldId);
      const hasFarm = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'farm' AND status = 'active'").get(worldId).c > 0;
      const survivalRole = (food && food.amount <= 5 && hasFarm) ? 'farmer' : 'idle';
      db.prepare(`
        INSERT INTO villagers (id, world_id, name, role, x, y, hp, max_hp, morale, hunger, experience, status, trait, ascii_sprite, cultural_phrase, temperament, creativity, sociability)
        VALUES (?, ?, ?, ?, ?, ?, 80, 100, 50, 20, 0, 'alive', ?, ?, NULL, ?, ?, ?)
      `).run(uuid(), worldId, name, survivalRole, CENTER, CENTER + 1, trait, survivalRole, basePers.temperament, basePers.creativity, basePers.sociability);
      events.push({
        type: 'birth',
        title: `${name} wanders in`,
        description: `A lone refugee named ${name} has found your empty settlement.${survivalRole === 'farmer' ? ' They head straight for the farm.' : ' Hope is not lost.'}`,
        severity: 'celebration',
      });
    }
    return events;
  }

  // Survival auto-assign: idle villagers become farmers when food is critically low
  const food = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'food'").get(worldId);
  if (food && food.amount <= 5) {
    const hasFarm = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'farm' AND status = 'active'").get(worldId).c > 0;
    if (hasFarm) {
      const idleVillagers = villagers.filter(v => v.role === 'idle');
      if (idleVillagers.length > 0) {
        const autoAssign = db.prepare("UPDATE villagers SET role = 'farmer', ascii_sprite = 'farmer' WHERE id = ? AND world_id = ?");
        for (const v of idleVillagers) {
          autoAssign.run(v.id, worldId);
          v.role = 'farmer';
        }
        events.push({
          type: 'survival',
          title: 'Survival instinct',
          description: `${idleVillagers.length} idle villager${idleVillagers.length > 1 ? 's' : ''} started farming to avoid starvation.`,
          severity: 'warning',
        });
      }
    }
  }

  const updateVillager = db.prepare(
    'UPDATE villagers SET hp = ?, morale = ?, hunger = ?, status = ? WHERE id = ?'
  );

  for (const v of villagers) {
    let { hp, morale, hunger, status } = v;

    // Hunger
    if (isStarving) {
      hunger = Math.min(100, hunger + 5);
    } else {
      hunger = Math.max(0, hunger - 3);
    }

    // HP from starvation
    if (hunger >= 80) {
      hp -= 5;
    }

    // HP regeneration: heal when not starving (+3 base, +2 if temple)
    if (hunger < 50 && hp > 0 && hp < v.max_hp) {
      hp = Math.min(v.max_hp, hp + 3 + (hasTemple ? 2 : 0));
    }

    // Morale adjustments
    if (hunger > 50) morale -= 2;
    if (hunger === 0) morale += 1;
    if (weather === 'storm') morale -= 2;
    if (weather === 'clear') morale += 1;

    // Trait effects
    if (v.trait === 'brave') morale = Math.min(100, morale + 1);
    if (v.trait === 'timid') morale -= 1;
    if (v.trait === 'lazy' && v.role !== 'idle') morale -= 1;

    // Personality-based morale: high temperament = more stable morale
    const temp = v.temperament || 50;
    if (temp > 70) morale = Math.min(100, morale + 1);
    if ((v.sociability || 50) > 70 && villagers.length > 3) morale = Math.min(100, morale + 1);

    morale = Math.max(0, Math.min(100, morale));

    // Death check
    if (hp <= 0) {
      status = 'dead';
      events.push({
        type: 'death',
        title: `${v.name} has died`,
        description: `${v.name} the ${v.role} has perished. ${hunger >= 80 ? 'Starvation took them.' : 'Their wounds were too severe.'}`,
        severity: 'danger',
      });
    }

    updateVillager.run(hp, morale, hunger, status, v.id);
  }

  // Birth chance: if pop < capacity, morale > 60 avg, 2% chance per tick
  const alive = villagers.filter((v) => v.status === 'alive' || (v.hp > 0));
  const buildingCap = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId).cap;

  const avgMorale = alive.length > 0 ? alive.reduce((s, v) => s + v.morale, 0) / alive.length : 0;

  // Higher cooperation = slightly higher birth rate
  const cooperationBonus = Math.max(0, (culture.cooperation_level || 0) - 50) / 2000;
  const birthRate = Math.max(0.005, Math.min(0.05, 0.02 + cooperationBonus));

  if (alive.length < buildingCap && avgMorale > 60 && Math.random() < birthRate) {
    const rng = () => Math.random();
    const name = randomName(rng);

    // Culture-influenced trait selection
    let trait;
    if (culture.preferred_trait && Math.random() < 0.4) {
      trait = culture.preferred_trait;
    } else {
      trait = randomTrait(rng);
    }

    // Personality from trait + village influence
    const basePers = TRAIT_PERSONALITY[trait] || { temperament: 50, creativity: 50, sociability: 50 };
    // Newborns drift toward village average
    const avgTemp = alive.length > 0 ? Math.round(alive.reduce((s, v) => s + (v.temperament || 50), 0) / alive.length) : 50;
    const avgCre = alive.length > 0 ? Math.round(alive.reduce((s, v) => s + (v.creativity || 50), 0) / alive.length) : 50;
    const avgSoc = alive.length > 0 ? Math.round(alive.reduce((s, v) => s + (v.sociability || 50), 0) / alive.length) : 50;

    const blend = (base, avg) => Math.max(0, Math.min(100, Math.round(base * 0.7 + avg * 0.3) + Math.floor(Math.random() * 11) - 5));

    const temperament = blend(basePers.temperament, avgTemp);
    const creativity = blend(basePers.creativity, avgCre);
    const sociability = blend(basePers.sociability, avgSoc);

    // Cultural imprinting — newborn absorbs a phrase from town culture
    let culturalPhrase = null;
    if (culture.custom_phrases && culture.custom_phrases.length > 0) {
      culturalPhrase = culture.custom_phrases[Math.floor(Math.random() * culture.custom_phrases.length)];
    }

    db.prepare(`
      INSERT INTO villagers (id, world_id, name, role, x, y, hp, max_hp, morale, hunger, experience, status, trait, ascii_sprite, cultural_phrase, temperament, creativity, sociability)
      VALUES (?, ?, ?, 'idle', ?, ?, 100, 100, 70, 0, 0, 'alive', ?, 'idle', ?, ?, ?, ?)
    `).run(uuid(), worldId, name, CENTER, CENTER + 1, trait, culturalPhrase, temperament, creativity, sociability);

    events.push({
      type: 'birth',
      title: `${name} has joined!`,
      description: `A new villager named ${name} (${trait}) has appeared in town.`,
      severity: 'celebration',
    });
  }

  return events;
}

module.exports = { processVillagers };
