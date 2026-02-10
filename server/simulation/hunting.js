const { v4: uuid } = require('uuid');
const db = require('../db/connection');

const HUNT_CHECK_INTERVAL = 15;

const SEASON_HUNT_MODIFIER = {
  spring: 1.0,
  summer: 1.1,
  autumn: 1.3,
  winter: 0.7,
};

// Outcome odds by rarity: [catch%, fled%, injury%]
const RARITY_OUTCOMES = {
  common:    [90, 10,  0],
  uncommon:  [75, 25,  0],
  rare:      [60, 30, 10],
  epic:      [40, 40, 20],
  legendary: [10, 55, 35],
};

// Food reward ranges by rarity: [min, max]
const RARITY_FOOD = {
  common:    [3, 5],
  uncommon:  [5, 8],
  rare:      [8, 12],
  epic:      [12, 18],
  legendary: [18, 25],
};

// Item drops by rarity (what can drop from hunting)
const HUNT_ITEM_DROPS = {
  common:    [{ type: 'hide', rarity: 'common', name: 'Animal Hide', props: { food_cap_bonus: 1 } }],
  uncommon:  [{ type: 'bone_tool', rarity: 'common', name: 'Bone Tool', props: { production_bonus: 0.1 } }],
  rare:      [{ type: 'rare_pelt', rarity: 'rare', name: 'Rare Pelt', props: { culture_bonus: 2 } }],
  epic:      [{ type: 'beast_fang', rarity: 'epic', name: 'Beast Fang', props: { defense_bonus: 5 } }],
  legendary: null, // handled specially — trophy per species
};

// Drop chances by rarity
const ITEM_DROP_CHANCE = {
  common:    0.15,
  uncommon:  0.25,
  rare:      1.0,
  epic:      1.0,
  legendary: 1.0,
};

function processHunting(worldId, currentTick) {
  const events = [];

  if (currentTick % HUNT_CHECK_INTERVAL !== 0) return events;

  // Prerequisites: active hunting_lodge
  const hasLodge = db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'hunting_lodge' AND status = 'active'"
  ).get(worldId).c > 0;
  if (!hasLodge) return events;

  // 1+ hunter alive
  const hunters = db.prepare(
    "SELECT id, name, hp FROM villagers WHERE world_id = ? AND role = 'hunter' AND status = 'alive'"
  ).all(worldId);
  if (hunters.length === 0) return events;

  // Find nearest wild animal (within 20 tiles of lodge)
  const lodge = db.prepare(
    "SELECT x, y FROM buildings WHERE world_id = ? AND type = 'hunting_lodge' AND status = 'active' LIMIT 1"
  ).get(worldId);
  if (!lodge) return events;

  const target = db.prepare(`
    SELECT * FROM wildlife WHERE world_id = ? AND status = 'wild'
    AND ABS(x - ?) <= 20 AND ABS(y - ?) <= 20
    ORDER BY
      CASE rarity
        WHEN 'legendary' THEN 5
        WHEN 'epic' THEN 4
        WHEN 'rare' THEN 3
        WHEN 'uncommon' THEN 2
        ELSE 1
      END DESC,
      RANDOM()
    LIMIT 1
  `).get(worldId, lodge.x, lodge.y);

  if (!target) {
    // No wildlife nearby — empty hunt
    if (Math.random() < 0.3) {
      events.push({
        type: 'hunting',
        title: 'Hunters returned empty-handed',
        description: 'The hunting party found no game near the lodge. Explore more territory or wait for wildlife to appear.',
        severity: 'info',
      });
    }
    return events;
  }

  const displayName = target.species.replace(/_/g, ' ');
  const outcomes = RARITY_OUTCOMES[target.rarity] || RARITY_OUTCOMES.common;
  const roll = Math.random() * 100;

  const world = db.prepare('SELECT season FROM worlds WHERE id = ?').get(worldId);
  const sHuntMod = SEASON_HUNT_MODIFIER[(world && world.season) || 'spring'] || 1.0;

  if (roll < outcomes[0]) {
    // Catch!
    const [minFood, maxFood] = RARITY_FOOD[target.rarity] || [3, 5];
    const foodGain = Math.round((minFood + Math.floor(Math.random() * (maxFood - minFood + 1))) * sHuntMod);

    db.prepare("UPDATE wildlife SET status = 'hunted' WHERE id = ?").run(target.id);
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'food'").run(foodGain, worldId);

    const hunter = hunters[Math.floor(Math.random() * hunters.length)];

    events.push({
      type: 'hunting',
      title: `${hunter.name} caught a ${displayName}!`,
      description: `The hunting party brought down a ${target.rarity} ${displayName}. +${foodGain} food.`,
      severity: target.rarity === 'legendary' ? 'celebration' : 'info',
    });

    // Item drop check
    const dropChance = ITEM_DROP_CHANCE[target.rarity] || 0;
    if (Math.random() < dropChance) {
      const itemEvent = createHuntDrop(worldId, target, currentTick);
      if (itemEvent) events.push(itemEvent);
    }

  } else if (roll < outcomes[0] + outcomes[1]) {
    // Fled
    db.prepare("UPDATE wildlife SET status = 'fled' WHERE id = ?").run(target.id);
    events.push({
      type: 'hunting',
      title: `The ${displayName} escaped!`,
      description: `A ${target.rarity} ${displayName} fled before the hunters could strike.`,
      severity: 'info',
    });

  } else {
    // Injury
    db.prepare("UPDATE wildlife SET status = 'fled' WHERE id = ?").run(target.id);
    const hunter = hunters[Math.floor(Math.random() * hunters.length)];
    const dmg = 10 + Math.floor(Math.random() * 11);
    db.prepare('UPDATE villagers SET hp = MAX(0, hp - ?) WHERE id = ?').run(dmg, hunter.id);

    events.push({
      type: 'hunting',
      title: `${hunter.name} was injured hunting a ${displayName}!`,
      description: `The ${target.rarity} ${displayName} fought back! ${hunter.name} took ${dmg} damage. The beast escaped.`,
      severity: 'warning',
    });

    // Check if hunter died
    const check = db.prepare('SELECT hp FROM villagers WHERE id = ?').get(hunter.id);
    if (check && check.hp <= 0) {
      db.prepare("UPDATE villagers SET status = 'dead' WHERE id = ?").run(hunter.id);
      events.push({
        type: 'death',
        title: `${hunter.name} was killed on the hunt!`,
        description: `${hunter.name} perished fighting a ${target.rarity} ${displayName}. The village mourns.`,
        severity: 'danger',
      });
    }
  }

  return events;
}

function createHuntDrop(worldId, animal, currentTick) {
  let itemDef;

  if (animal.rarity === 'legendary') {
    // Unique trophy per species
    itemDef = {
      type: 'legendary_trophy',
      rarity: 'legendary',
      name: `Trophy: ${animal.species.replace(/_/g, ' ')}`,
      props: { culture_bonus: 10, mintable: true, species: animal.species },
    };
  } else {
    const drops = HUNT_ITEM_DROPS[animal.rarity];
    if (!drops || drops.length === 0) return null;
    itemDef = drops[Math.floor(Math.random() * drops.length)];
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO items (id, world_id, item_type, rarity, name, source, properties, status, created_tick)
    VALUES (?, ?, ?, ?, ?, 'hunting', ?, 'stored', ?)
  `).run(id, worldId, itemDef.type, itemDef.rarity, itemDef.name, JSON.stringify(itemDef.props), currentTick);

  return {
    type: 'item_drop',
    title: `Item found: ${itemDef.name}!`,
    description: `The hunters recovered a ${itemDef.rarity} ${itemDef.name} from the ${animal.species.replace(/_/g, ' ')}.`,
    severity: itemDef.rarity === 'legendary' ? 'celebration' : 'info',
  };
}

module.exports = { processHunting };
