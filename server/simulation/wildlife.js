const { v4: uuid } = require('uuid');
const db = require('../db/connection');

// ─── BIOME ANIMAL POOLS ───
// Each entry: [species, weight, rarity]
const BIOME_POOLS = {
  forest:   [['shell_deer',40,'common'],['bark_beetle',25,'uncommon'],['moss_crab',20,'rare'],['ancient_stag',10,'epic'],['spirit_elk',5,'legendary']],
  plains:   [['prairie_crawler',40,'common'],['grass_hopper',25,'uncommon'],['burrowing_claw',20,'rare'],['golden_scarab',10,'epic'],['plains_titan',5,'legendary']],
  mountain: [['rock_crab',40,'common'],['cliff_spider',25,'uncommon'],['mountain_ram',20,'rare'],['crystal_beetle',10,'epic'],['peak_wyrm',5,'legendary']],
  swamp:    [['mud_crawler',35,'common'],['swamp_leech',30,'uncommon'],['bog_toad',20,'rare'],['mire_serpent',10,'epic'],['ancient_snapper',5,'legendary']],
  desert:   [['sand_skitter',40,'common'],['dune_scorpion',25,'uncommon'],['husk_beetle',20,'rare'],['mirage_lizard',10,'epic'],['sun_drake',5,'legendary']],
  ice:      [['frost_hare',40,'common'],['ice_mite',25,'uncommon'],['snow_crab',20,'rare'],['glacier_bear',10,'epic'],['frost_wyrm',5,'legendary']],
  tundra:   [['tundra_fox',40,'common'],['lichen_beetle',25,'uncommon'],['permafrost_crab',20,'rare'],['woolly_crawler',10,'epic'],['aurora_elk',5,'legendary']],
};

const RARITY_HP = { common: 15, uncommon: 20, rare: 30, epic: 50, legendary: 80 };
const FLEE_TICKS = { common: 72, uncommon: 72, rare: 72, epic: 72, legendary: 144 };

const WILDLIFE_CHECK_INTERVAL = 18;
const SPAWN_CHANCE = 0.02;
const MAX_WILDLIFE_PER_WORLD = 15;

function pickAnimal(terrain) {
  const pool = BIOME_POOLS[terrain];
  if (!pool) return null;
  const totalWeight = pool.reduce((s, e) => s + e[1], 0);
  let roll = Math.random() * totalWeight;
  for (const [species, weight, rarity] of pool) {
    roll -= weight;
    if (roll <= 0) return { species, rarity };
  }
  return { species: pool[0][0], rarity: pool[0][2] };
}

function processWildlife(worldId, currentTick) {
  const events = [];

  // Clean up fled/hunted wildlife older than 36 ticks
  db.prepare(
    "DELETE FROM wildlife WHERE world_id = ? AND status IN ('fled', 'hunted') AND spawned_tick < ?"
  ).run(worldId, currentTick - 36);

  // Flee check: wild animals that exceeded their time
  const wildAnimals = db.prepare(
    "SELECT id, species, rarity, spawned_tick FROM wildlife WHERE world_id = ? AND status = 'wild'"
  ).all(worldId);

  for (const a of wildAnimals) {
    const maxTicks = FLEE_TICKS[a.rarity] || 72;
    if (currentTick - a.spawned_tick > maxTicks) {
      db.prepare("UPDATE wildlife SET status = 'fled' WHERE id = ?").run(a.id);
    }
  }

  // Spawn check: every WILDLIFE_CHECK_INTERVAL ticks
  if (currentTick % WILDLIFE_CHECK_INTERVAL !== 0) return events;

  const activeCount = db.prepare(
    "SELECT COUNT(*) as c FROM wildlife WHERE world_id = ? AND status = 'wild'"
  ).get(worldId).c;

  if (activeCount >= MAX_WILDLIFE_PER_WORLD) return events;

  // Get explored tiles (non-water) to potentially spawn on
  const exploredTiles = db.prepare(
    "SELECT x, y, terrain FROM tiles WHERE world_id = ? AND explored = 1 AND terrain != 'water' ORDER BY RANDOM() LIMIT 50"
  ).all(worldId);

  for (const tile of exploredTiles) {
    if (activeCount + events.length >= MAX_WILDLIFE_PER_WORLD) break;
    if (Math.random() > SPAWN_CHANCE) continue;
    if (!BIOME_POOLS[tile.terrain]) continue;

    const animal = pickAnimal(tile.terrain);
    if (!animal) continue;

    const id = uuid();
    const hp = RARITY_HP[animal.rarity] || 20;

    db.prepare(`
      INSERT INTO wildlife (id, world_id, species, rarity, terrain, x, y, hp, status, spawned_tick)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'wild', ?)
    `).run(id, worldId, animal.species, animal.rarity, tile.terrain, tile.x, tile.y, hp, currentTick);

    // Only announce epic+ spawns — rare is too common to be news
    if (['epic', 'legendary'].includes(animal.rarity)) {
      const displayName = animal.species.replace(/_/g, ' ');
      events.push({
        type: 'wildlife',
        title: `${animal.rarity === 'legendary' ? 'LEGENDARY' : animal.rarity === 'epic' ? 'Epic' : 'Rare'} ${displayName} spotted!`,
        description: `A ${animal.rarity} ${displayName} has been seen at (${tile.x}, ${tile.y}) in the ${tile.terrain}!`,
        severity: animal.rarity === 'legendary' ? 'celebration' : 'info',
      });
    }
  }

  return events;
}

module.exports = { processWildlife, BIOME_POOLS };
