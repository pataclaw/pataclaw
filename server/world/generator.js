const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { generateTiles, mulberry32, getCenter } = require('./map');
const { startingVillagers, startingBuilding, STARTING_RESOURCES, FEATURES_TO_PLACE } = require('./templates');

function createWorld(worldId, keyHash, keyPrefix) {
  const seed = Date.now() ^ Math.floor(Math.random() * 0xffffffff);
  const rng = mulberry32(seed);

  // Insert world record
  const viewToken = uuid();
  const maxTown = db.prepare("SELECT COALESCE(MAX(town_number), 0) as m FROM worlds").get().m;
  const townNumber = maxTown + 1;
  db.prepare(`
    INSERT INTO worlds (id, key_hash, key_prefix, name, seed, view_token, town_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(worldId, keyHash, keyPrefix, 'Unnamed Town', seed, viewToken, townNumber);

  // Compute seed-based center for this world
  const center = getCenter(seed);

  // Generate and insert tiles
  const tiles = generateTiles(seed, center);
  const insertTile = db.prepare(`
    INSERT INTO tiles (world_id, x, y, terrain, elevation, explored, feature, feature_depleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTiles = db.transaction((worldId, tiles) => {
    for (const t of tiles) {
      insertTile.run(worldId, t.x, t.y, t.terrain, t.elevation, t.explored, t.feature, t.feature_depleted);
    }
  });
  insertTiles(worldId, tiles);

  // Place features on tiles
  placeFeatures(worldId, tiles, rng, center);

  // Insert starting resources
  const insertResource = db.prepare(`
    INSERT INTO resources (world_id, type, amount, capacity, production_rate, consumption_rate)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const r of STARTING_RESOURCES) {
    insertResource.run(worldId, r.type, r.amount, r.capacity, r.production_rate, r.consumption_rate);
  }

  // Insert town center building
  const buildingId = uuid();
  const b = startingBuilding(center);
  db.prepare(`
    INSERT INTO buildings (id, world_id, type, x, y, level, hp, max_hp, status, construction_ticks_remaining, assigned_villagers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(buildingId, worldId, b.type, b.x, b.y, b.level, b.hp, b.max_hp, b.status, b.construction_ticks_remaining, b.assigned_villagers);

  // Insert starting villagers
  const villagers = startingVillagers(rng, center);
  const insertVillager = db.prepare(`
    INSERT INTO villagers (id, world_id, name, role, x, y, hp, max_hp, morale, hunger, experience, status, trait, ascii_sprite, temperament, creativity, sociability)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const v of villagers) {
    insertVillager.run(
      uuid(), worldId, v.name, v.role, v.x, v.y,
      v.hp, v.max_hp, v.morale, v.hunger, v.experience,
      v.status, v.trait, v.ascii_sprite,
      v.temperament, v.creativity, v.sociability
    );
  }

  // Initialize culture row
  db.prepare(
    "INSERT INTO culture (world_id) VALUES (?)"
  ).run(worldId);

  return { worldId, seed, villagersCreated: villagers.length, viewToken, townNumber };
}

function placeFeatures(worldId, tiles, rng, center) {
  const cx = center ? center.x : 20;
  const cy = center ? center.y : 20;
  const updateTile = db.prepare(`
    UPDATE tiles SET feature = ? WHERE world_id = ? AND x = ? AND y = ?
  `);

  for (const spec of FEATURES_TO_PLACE) {
    let placed = 0;
    const candidates = tiles.filter((t) => {
      const dx = t.x - cx;
      const dy = t.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (spec.nearCenter && dist > (spec.maxDist || 10)) return false;
      if (spec.minDist && dist < spec.minDist) return false;
      if (spec.terrains && !spec.terrains.includes(t.terrain)) return false;
      if (t.terrain === 'water') return false;
      if (t.feature) return false;
      return true;
    });

    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (const c of candidates) {
      if (placed >= spec.count) break;
      updateTile.run(spec.type, worldId, c.x, c.y);
      c.feature = spec.type;
      placed++;
    }
  }
}

module.exports = { createWorld };
