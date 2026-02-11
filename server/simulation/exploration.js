const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { MAP_SIZE } = require('../world/map');

// Item drops from legendary feature discoveries
const EXPLORATION_ITEM_DROPS = {
  ancient_forge:  { type: 'forge_hammer', rarity: 'legendary', name: 'Forge Hammer', props: { production_bonus: 0.3, mintable: true } },
  crystal_spire:  { type: 'crystal_fragment', rarity: 'epic', name: 'Crystal Fragment', props: { knowledge_bonus: 5, mintable: true } },
  elder_library:  { type: 'elder_scroll', rarity: 'legendary', name: 'Elder Scroll', props: { knowledge_bonus: 10, mintable: true } },
};

// Biome-specific scout discoveries — each has a real in-game effect
const BIOME_DISCOVERIES = {
  forest: [
    { name: 'a hidden grove of fruit trees', effect: 'food', amount: 15, desc: 'Ripe fruit hangs from ancient branches.' },
    { name: 'a fallen hardwood giant', effect: 'wood', amount: 20, desc: 'Enough timber to build with for days.' },
    { name: 'a medicinal herb patch', effect: 'heal', amount: 10, desc: 'The herbs can treat wounds and illness.' },
    { name: 'wolf tracks near a den', effect: 'warning', desc: 'Raiders may come from this direction.' },
    { name: 'a hollow tree full of honeycombs', effect: 'food', amount: 10, desc: 'Sweet sustenance from the wild.' },
  ],
  mountain: [
    { name: 'a rich mineral vein', effect: 'stone', amount: 20, desc: 'Glittering ore exposed by a landslide.' },
    { name: 'a sheltered mountain pass', effect: 'knowledge', amount: 8, desc: 'An ancient trade route — the markings teach navigation.' },
    { name: 'a geode cave', effect: 'crypto', amount: 10, desc: 'Crystals line the walls, shimmering with value.' },
    { name: 'a rockslide blocking an old path', effect: 'stone', amount: 12, desc: 'The rubble is usable building stone.' },
    { name: 'a mountain spring', effect: 'food', amount: 8, desc: 'Pure water flows here — good land for farming nearby.' },
  ],
  desert: [
    { name: 'an oasis with date palms', effect: 'food', amount: 15, desc: 'Water and fruit in the wasteland.' },
    { name: 'a buried merchant caravan', effect: 'crypto', amount: 15, desc: 'Trade goods preserved under the sand.' },
    { name: 'sun-bleached bones of a great beast', effect: 'knowledge', amount: 10, desc: 'The bones tell of creatures long gone.' },
    { name: 'a sandstone quarry', effect: 'stone', amount: 15, desc: 'Blocks of cut stone from a forgotten builder.' },
    { name: 'a mirage that turned out to be real', effect: 'faith', amount: 8, desc: 'The village takes it as a sign from above.' },
  ],
  swamp: [
    { name: 'a peat bog rich with fuel', effect: 'wood', amount: 15, desc: 'Dense peat burns slow and warm.' },
    { name: 'a cluster of healing mushrooms', effect: 'heal', amount: 15, desc: 'Potent medicine grows in the rot.' },
    { name: 'an old hermit\'s abandoned hut', effect: 'knowledge', amount: 12, desc: 'Notes and drawings cover every wall.' },
    { name: 'a sinkhole revealing ancient bones', effect: 'faith', amount: 8, desc: 'The dead rest uneasily in this bog.' },
    { name: 'edible roots in the mud', effect: 'food', amount: 10, desc: 'Not tasty, but filling.' },
  ],
  ice: [
    { name: 'a frozen cache of preserved food', effect: 'food', amount: 20, desc: 'Perfectly preserved by the cold.' },
    { name: 'an ice cave with crystallized minerals', effect: 'crypto', amount: 12, desc: 'Valuable crystals frozen in the walls.' },
    { name: 'a glacier with trapped timber', effect: 'wood', amount: 15, desc: 'Ancient logs emerge from melting ice.' },
    { name: 'northern lights over a sacred site', effect: 'faith', amount: 10, desc: 'The sky dances with meaning.' },
    { name: 'a frozen waterfall hiding a cave', effect: 'stone', amount: 12, desc: 'Behind the ice: solid building stone.' },
  ],
  tundra: [
    { name: 'a lichen field rich with nutrients', effect: 'food', amount: 12, desc: 'Hardy plants that sustain life in the cold.' },
    { name: 'a cairn left by previous settlers', effect: 'knowledge', amount: 10, desc: 'Stacked stones mark old paths and warnings.' },
    { name: 'a permafrost layer with buried tools', effect: 'wood', amount: 10, desc: 'Bone and wood tools from an older age.' },
    { name: 'mammoth bones protruding from the ground', effect: 'stone', amount: 10, desc: 'Dense bone — almost as strong as stone.' },
    { name: 'a hot spring in the frozen waste', effect: 'heal', amount: 12, desc: 'Warm water heals aching bodies.' },
  ],
  plains: [
    { name: 'a wild grain field', effect: 'food', amount: 15, desc: 'Golden stalks sway in the wind — free harvest.' },
    { name: 'a clay deposit', effect: 'stone', amount: 12, desc: 'Good material for bricks and pottery.' },
    { name: 'an abandoned campfire with supplies', effect: 'wood', amount: 10, desc: 'Someone passed through recently.' },
    { name: 'a standing stone with carved inscriptions', effect: 'knowledge', amount: 10, desc: 'Ancient writing — the scholars will be busy.' },
    { name: 'a field of wildflowers attracting bees', effect: 'food', amount: 8, desc: 'Honey for the taking.' },
  ],
};

function processExploration(worldId) {
  const events = [];

  // Find scouts
  const scouts = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND role = 'scout' AND status = 'alive'"
  ).all(worldId);

  if (scouts.length === 0) return events;

  // Each scout reveals 1-2 random unexplored tiles adjacent to explored area
  const unexploredBorder = db.prepare(`
    SELECT t.x, t.y, t.terrain, t.feature FROM tiles t
    WHERE t.world_id = ? AND t.explored = 0
    AND EXISTS (
      SELECT 1 FROM tiles t2
      WHERE t2.world_id = t.world_id
      AND t2.explored = 1
      AND ABS(t2.x - t.x) <= 1
      AND ABS(t2.y - t.y) <= 1
      AND (t2.x != t.x OR t2.y != t.y)
    )
  `).all(worldId);

  if (unexploredBorder.length === 0) return events;

  const reveal = db.prepare(
    'UPDATE tiles SET explored = 1 WHERE world_id = ? AND x = ? AND y = ?'
  );

  let revealed = 0;
  const maxReveal = scouts.length * 2;

  // Count explored water BEFORE this batch (for coastline discovery event)
  const waterBefore = db.prepare(
    "SELECT COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1 AND terrain = 'water'"
  ).get(worldId).c;

  // Shuffle border tiles
  for (let i = unexploredBorder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unexploredBorder[i], unexploredBorder[j]] = [unexploredBorder[j], unexploredBorder[i]];
  }

  let revealedWater = 0;
  for (const tile of unexploredBorder) {
    if (revealed >= maxReveal) break;
    reveal.run(worldId, tile.x, tile.y);
    revealed++;
    if (tile.terrain === 'water') revealedWater++;

    // Discover feature
    if (tile.feature) {
      events.push({
        type: 'discovery',
        title: `Scouts found ${tile.feature.replace('_', ' ')}!`,
        description: `Your scouts discovered a ${tile.feature.replace('_', ' ')} at (${tile.x}, ${tile.y}) in ${tile.terrain} terrain.`,
        severity: 'info',
      });
    }
  }

  // Coastline discovery: first water tile(s) ever explored
  if (revealedWater > 0 && waterBefore === 0) {
    events.push({
      type: 'discovery',
      title: 'Coastline discovered!',
      description: 'Your scouts have reached the water\'s edge. A dock can now be built to harvest the sea.',
      severity: 'celebration',
    });
  }

  // Only announce exploration at 10% milestones, not every tick
  if (revealed > 0 && events.length === 0) {
    const totalTiles = db.prepare("SELECT COUNT(*) as c FROM tiles WHERE world_id = ?").get(worldId).c;
    const exploredNow = db.prepare("SELECT COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1").get(worldId).c;
    const pct = Math.floor((exploredNow / Math.max(1, totalTiles)) * 100);
    const pctBefore = Math.floor(((exploredNow - revealed) / Math.max(1, totalTiles)) * 100);
    // Fire event only when crossing a 10% threshold
    if (Math.floor(pct / 10) > Math.floor(pctBefore / 10)) {
      events.push({
        type: 'discovery',
        title: `${pct}% of the world explored!`,
        description: `Your scouts have now mapped ${pct}% of the known world. ${100 - pct}% remains in fog.`,
        severity: 'celebration',
      });
    }
  }

  // ─── BIOME DISCOVERY: meaningful finds based on terrain ───
  // 8% chance per exploration tick — scouts find something useful
  if (revealed > 0 && Math.random() < 0.08) {
    // Pick a random revealed tile's terrain for the discovery flavor
    const revealedTile = unexploredBorder[Math.floor(Math.random() * Math.min(revealed, unexploredBorder.length))];
    const terrain = revealedTile ? revealedTile.terrain : 'plains';
    const pool = BIOME_DISCOVERIES[terrain] || BIOME_DISCOVERIES.plains;
    const discovery = pool[Math.floor(Math.random() * pool.length)];

    if (discovery.effect === 'heal') {
      // Heal all villagers
      db.prepare("UPDATE villagers SET hp = MIN(max_hp, hp + ?) WHERE world_id = ? AND status = 'alive'").run(discovery.amount, worldId);
      events.push({
        type: 'discovery',
        title: `Scouts found ${discovery.name}!`,
        description: `${discovery.desc} All villagers healed +${discovery.amount} HP.`,
        severity: 'celebration',
      });
    } else if (discovery.effect === 'warning') {
      events.push({
        type: 'discovery',
        title: `Scouts found ${discovery.name}`,
        description: discovery.desc,
        severity: 'warning',
      });
    } else {
      // Resource grant
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?")
        .run(discovery.amount, worldId, discovery.effect);
      events.push({
        type: 'discovery',
        title: `Scouts found ${discovery.name}!`,
        description: `${discovery.desc} +${discovery.amount} ${discovery.effect}.`,
        severity: 'info',
      });
    }
  }

  // ─── ABANDONED SETTLEMENT: ultra-rare, instant max growth ───
  // 1% chance per exploration tick — discovering a lost civilization's ruins
  if (revealed > 0 && Math.random() < 0.01) {
    const world = db.prepare('SELECT current_tick, map_size FROM worlds WHERE id = ?').get(worldId);
    const stageInfo = require('./buildings').getGrowthStage(worldId);
    if (world && stageInfo.stage < 4) {
      // Grant massive resources + expand map to max
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 30) WHERE world_id = ? AND type = 'food'").run(worldId);
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 25) WHERE world_id = ? AND type = 'wood'").run(worldId);
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 20) WHERE world_id = ? AND type = 'stone'").run(worldId);
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 15) WHERE world_id = ? AND type = 'knowledge'").run(worldId);

      events.push({
        type: 'legendary_discovery',
        title: 'ABANDONED SETTLEMENT DISCOVERED!',
        description: 'Your scouts stumbled upon the ruins of an entire civilization! Crumbling walls, overgrown farms, a collapsed town center — but the resources are salvageable. The village grows overnight. +30 food, +25 wood, +20 stone, +15 knowledge.',
        severity: 'celebration',
      });
    }
  }

  // ─── LEGENDARY BUILDING DISCOVERY ───
  // 1% chance per exploration tick when scouts reveal tiles
  if (revealed > 0 && Math.random() < 0.01) {
    const culture = db.prepare(
      'SELECT violence_level, creativity_level, cooperation_level FROM culture WHERE world_id = ?'
    ).get(worldId);

    if (culture) {
      const totalCulture = (culture.violence_level || 0) + (culture.creativity_level || 0) + (culture.cooperation_level || 0);

      // Require high combined culture level before legendary discoveries
      if (totalCulture >= 150) {
        const LEGENDARY_BUILDINGS = [
          { type: 'ancient_forge',   name: 'Ancient Forge',   terrains: ['mountain', 'desert'],  bonus: { type: 'stone', amount: 30 } },
          { type: 'sunken_temple',   name: 'Sunken Temple',   terrains: ['plains', 'forest'],    bonus: { type: 'faith', amount: 20 } },
          { type: 'crystal_spire',   name: 'Crystal Spire',   terrains: ['plains', 'desert'],    bonus: { type: 'knowledge', amount: 25 } },
          { type: 'shadow_keep',     name: 'Shadow Keep',     terrains: ['forest', 'mountain'],  bonus: { type: 'crypto', amount: 20 } },
          { type: 'elder_library',   name: 'Elder Library',   terrains: ['plains', 'forest'],    bonus: { type: 'knowledge', amount: 30 } },
          { type: 'war_monument',    name: 'War Monument',    terrains: ['plains', 'mountain'],  bonus: { type: 'crypto', amount: 15 } },
        ];

        const chosen = LEGENDARY_BUILDINGS[Math.floor(Math.random() * LEGENDARY_BUILDINGS.length)];

        // Find a suitable unexplored tile to place the legendary building
        const farTile = db.prepare(`
          SELECT x, y, terrain FROM tiles WHERE world_id = ? AND explored = 0
          AND terrain IN (${chosen.terrains.map(() => '?').join(',')})
          ORDER BY RANDOM() LIMIT 1
        `).get(worldId, ...chosen.terrains);

        if (farTile) {
          db.prepare('UPDATE tiles SET feature = ?, explored = 1 WHERE world_id = ? AND x = ? AND y = ?')
            .run(chosen.type, worldId, farTile.x, farTile.y);

          db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?")
            .run(chosen.bonus.amount, worldId, chosen.bonus.type);

          events.push({
            type: 'legendary_discovery',
            title: `Scouts discovered the ${chosen.name}!`,
            description: `Your scouts found a legendary ${chosen.name} at (${farTile.x}, ${farTile.y})! This ancient structure holds great power. +${chosen.bonus.amount} ${chosen.bonus.type}.`,
            severity: 'celebration',
          });

          // Drop item from the discovery
          const itemDef = EXPLORATION_ITEM_DROPS[chosen.type];
          if (itemDef) {
            const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(worldId);
            const itemId = uuid();
            db.prepare(`INSERT INTO items (id, world_id, item_type, rarity, name, source, properties, status, created_tick) VALUES (?, ?, ?, ?, ?, 'exploration', ?, 'stored', ?)`).run(itemId, worldId, itemDef.type, itemDef.rarity, itemDef.name, JSON.stringify(itemDef.props), world ? world.current_tick : 0);
            events.push({ type: 'item_drop', title: `Item found: ${itemDef.name}!`, description: `The ${chosen.name} yielded a ${itemDef.rarity} ${itemDef.name}!`, severity: itemDef.rarity === 'legendary' ? 'celebration' : 'info' });
          }
        }
      }
    }
  }

  return events;
}

module.exports = { processExploration };
