const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { startBuilding, BUILDING_DEFS } = require('../simulation/buildings');
const { logCultureAction, applyPhraseTone } = require('../simulation/culture');

const router = Router();

// POST /api/command/build
router.post('/build', (req, res) => {
  const { type, x, y } = req.body;

  if (!type || x === undefined || y === undefined) {
    return res.status(400).json({ error: 'Missing type, x, or y' });
  }

  if (!BUILDING_DEFS[type]) {
    return res.status(400).json({ error: `Unknown building type: ${type}. Available: ${Object.keys(BUILDING_DEFS).join(', ')}` });
  }

  // Check tile is explored and buildable
  const tile = db.prepare('SELECT * FROM tiles WHERE world_id = ? AND x = ? AND y = ?').get(req.worldId, x, y);
  if (!tile) return res.status(400).json({ error: 'Invalid coordinates' });
  if (!tile.explored) return res.status(400).json({ error: 'Tile not yet explored' });
  if (tile.terrain === 'water' || tile.terrain === 'mountain') {
    return res.status(400).json({ error: `Cannot build on ${tile.terrain}` });
  }

  // Check no existing building at location
  const existing = db.prepare("SELECT id FROM buildings WHERE world_id = ? AND x = ? AND y = ? AND status != 'destroyed'").get(req.worldId, x, y);
  if (existing) return res.status(400).json({ error: 'Location already occupied by a building' });

  const result = startBuilding(req.worldId, type, x, y);
  if (!result.ok) return res.status(400).json({ error: result.reason });

  // Log command
  const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(req.worldId);
  db.prepare(
    "INSERT INTO commands (id, world_id, tick, type, parameters, result, status) VALUES (?, ?, ?, 'build', ?, ?, 'completed')"
  ).run(uuid(), req.worldId, world.current_tick, JSON.stringify({ type, x, y }), JSON.stringify(result));

  logCultureAction(req.worldId, 'build', type);
  res.json({ ok: true, buildingId: result.buildingId, ticksRemaining: result.ticks });
});

// POST /api/command/assign
router.post('/assign', (req, res) => {
  const { villager_ids, role, building_id } = req.body;

  if (!villager_ids || !Array.isArray(villager_ids) || !role) {
    return res.status(400).json({ error: 'Missing villager_ids (array) or role' });
  }

  const validRoles = ['idle', 'farmer', 'builder', 'warrior', 'scout', 'scholar', 'priest', 'fisherman'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Available: ${validRoles.join(', ')}` });
  }

  const updateStmt = db.prepare(
    'UPDATE villagers SET role = ?, assigned_building_id = ?, ascii_sprite = ? WHERE id = ? AND world_id = ? AND status = ?'
  );

  let updated = 0;
  for (const vid of villager_ids) {
    const result = updateStmt.run(role, building_id || null, role, vid, req.worldId, 'alive');
    updated += result.changes;
  }

  // Organic personality nudge from role assignment
  if (role === 'warrior') {
    db.prepare('UPDATE villagers SET temperament = MAX(0, temperament - 2) WHERE id IN (' + villager_ids.map(() => '?').join(',') + ') AND world_id = ?')
      .run(...villager_ids, req.worldId);
  } else if (role === 'scholar') {
    db.prepare('UPDATE villagers SET creativity = MIN(100, creativity + 1) WHERE id IN (' + villager_ids.map(() => '?').join(',') + ') AND world_id = ?')
      .run(...villager_ids, req.worldId);
  } else if (role === 'priest') {
    db.prepare('UPDATE villagers SET temperament = MIN(100, temperament + 1) WHERE id IN (' + villager_ids.map(() => '?').join(',') + ') AND world_id = ?')
      .run(...villager_ids, req.worldId);
  } else if (role === 'fisherman') {
    db.prepare('UPDATE villagers SET sociability = MIN(100, sociability + 1) WHERE id IN (' + villager_ids.map(() => '?').join(',') + ') AND world_id = ?')
      .run(...villager_ids, req.worldId);
  }

  logCultureAction(req.worldId, 'assign', role);
  res.json({ ok: true, updated });
});

// POST /api/command/explore
router.post('/explore', (req, res) => {
  const { direction, scout_count, target_x, target_y } = req.body;

  // Find idle or scout villagers to assign as scouts
  const scouts = db.prepare(
    "SELECT id FROM villagers WHERE world_id = ? AND status = 'alive' AND (role = 'idle' OR role = 'scout') LIMIT ?"
  ).all(req.worldId, scout_count || 1);

  if (scouts.length === 0) {
    return res.status(400).json({ error: 'No available villagers to scout' });
  }

  const updateStmt = db.prepare(
    "UPDATE villagers SET role = 'scout', ascii_sprite = 'scout' WHERE id = ? AND world_id = ?"
  );

  for (const s of scouts) {
    updateStmt.run(s.id, req.worldId);
  }

  logCultureAction(req.worldId, 'explore', '_default');
  res.json({ ok: true, scoutsAssigned: scouts.length });
});

// POST /api/command/rename
router.post('/rename', (req, res) => {
  const { name, motto, hero_title } = req.body;

  if (name) {
    const sanitized = String(name).slice(0, 50);
    db.prepare('UPDATE worlds SET name = ? WHERE id = ?').run(sanitized, req.worldId);
  }
  if (motto !== undefined) {
    const sanitized = String(motto).slice(0, 200);
    db.prepare('UPDATE worlds SET motto = ? WHERE id = ?').run(sanitized, req.worldId);
  }
  if (hero_title) {
    const sanitized = String(hero_title).slice(0, 50);
    db.prepare('UPDATE worlds SET hero_title = ? WHERE id = ?').run(sanitized, req.worldId);
  }

  logCultureAction(req.worldId, 'rename', '_default');
  res.json({ ok: true });
});

// POST /api/command/demolish
router.post('/demolish', (req, res) => {
  const { building_id } = req.body;
  if (!building_id) return res.status(400).json({ error: 'Missing building_id' });

  const building = db.prepare("SELECT * FROM buildings WHERE id = ? AND world_id = ? AND status != 'destroyed'").get(building_id, req.worldId);
  if (!building) return res.status(404).json({ error: 'Building not found' });
  if (building.type === 'town_center') return res.status(400).json({ error: 'Cannot demolish town center' });

  // Unassign villagers
  db.prepare("UPDATE villagers SET role = 'idle', assigned_building_id = NULL, ascii_sprite = 'idle' WHERE assigned_building_id = ? AND world_id = ?").run(building_id, req.worldId);

  // Recover some resources
  db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 3) WHERE world_id = ? AND type = 'wood'").run(req.worldId);
  db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 2) WHERE world_id = ? AND type = 'stone'").run(req.worldId);

  db.prepare("UPDATE buildings SET status = 'destroyed' WHERE id = ?").run(building_id);

  res.json({ ok: true, recovered: { wood: 3, stone: 2 } });
});

// POST /api/command/upgrade
router.post('/upgrade', (req, res) => {
  const { building_id } = req.body;
  if (!building_id) return res.status(400).json({ error: 'Missing building_id' });

  const building = db.prepare("SELECT * FROM buildings WHERE id = ? AND world_id = ? AND status = 'active'").get(building_id, req.worldId);
  if (!building) return res.status(404).json({ error: 'Active building not found' });
  if (building.level >= 3) return res.status(400).json({ error: 'Max level reached (3)' });

  const upgradeCost = { wood: 10 * building.level, stone: 8 * building.level, gold: 3 * building.level };
  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(req.worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = r.amount;

  if ((resMap.wood || 0) < upgradeCost.wood) return res.status(400).json({ error: `Need ${upgradeCost.wood} wood` });
  if ((resMap.stone || 0) < upgradeCost.stone) return res.status(400).json({ error: `Need ${upgradeCost.stone} stone` });
  if ((resMap.gold || 0) < upgradeCost.gold) return res.status(400).json({ error: `Need ${upgradeCost.gold} gold` });

  db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'wood'").run(upgradeCost.wood, req.worldId);
  db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'stone'").run(upgradeCost.stone, req.worldId);
  db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'gold'").run(upgradeCost.gold, req.worldId);

  db.prepare('UPDATE buildings SET level = level + 1, max_hp = max_hp + 50, hp = hp + 50 WHERE id = ?').run(building_id);

  res.json({ ok: true, newLevel: building.level + 1, cost: upgradeCost });
});

// POST /api/command/teach
router.post('/teach', (req, res) => {
  const { phrases, greetings } = req.body;

  if (!phrases && !greetings) {
    return res.status(400).json({ error: 'Provide phrases (array) and/or greetings (array)' });
  }

  const culture = db.prepare('SELECT custom_phrases, custom_greetings FROM culture WHERE world_id = ?').get(req.worldId);
  if (!culture) return res.status(404).json({ error: 'World culture not initialized' });

  const existingPhrases = JSON.parse(culture.custom_phrases || '[]');
  const existingGreetings = JSON.parse(culture.custom_greetings || '[]');

  if (phrases && Array.isArray(phrases)) {
    for (const p of phrases) {
      const clean = String(p).replace(/[^\x20-\x7E]/g, '').slice(0, 30);
      if (clean && existingPhrases.length < 20 && !existingPhrases.includes(clean)) {
        existingPhrases.push(clean);
      }
    }
  }

  if (greetings && Array.isArray(greetings)) {
    for (const g of greetings) {
      const clean = String(g).replace(/[^\x20-\x7E]/g, '').slice(0, 30);
      if (clean && existingGreetings.length < 10 && !existingGreetings.includes(clean)) {
        existingGreetings.push(clean);
      }
    }
  }

  db.prepare('UPDATE culture SET custom_phrases = ?, custom_greetings = ?, updated_at = datetime(\'now\') WHERE world_id = ?')
    .run(JSON.stringify(existingPhrases), JSON.stringify(existingGreetings), req.worldId);

  // Apply phrase tone to nudge village personality
  const newPhrases = phrases && Array.isArray(phrases) ? phrases.map(p => String(p).slice(0, 30)) : [];
  const toneEffect = newPhrases.length > 0 ? applyPhraseTone(req.worldId, newPhrases) : { temperament: 0, creativity: 0, sociability: 0 };

  logCultureAction(req.worldId, 'teach', '_default');
  res.json({ ok: true, phrases: existingPhrases.length, greetings: existingGreetings.length, toneEffect });
});

// POST /api/command/set-culture
router.post('/set-culture', (req, res) => {
  const { values, laws, preferred_trait, banner_symbol } = req.body;

  const validTraits = ['brave', 'lazy', 'clever', 'strong', 'timid', 'kind', 'curious', 'stubborn'];
  const updates = [];
  const params = [];

  if (values && Array.isArray(values)) {
    const v1 = values[0] ? String(values[0]).slice(0, 20) : null;
    const v2 = values[1] ? String(values[1]).slice(0, 20) : null;
    updates.push('cultural_value_1 = ?', 'cultural_value_2 = ?');
    params.push(v1, v2);
  }

  if (laws && Array.isArray(laws)) {
    const cleanLaws = laws.slice(0, 5).map((l) => String(l).replace(/[^\x20-\x7E]/g, '').slice(0, 50)).filter(Boolean);
    updates.push('custom_laws = ?');
    params.push(JSON.stringify(cleanLaws));
  }

  if (preferred_trait) {
    if (!validTraits.includes(preferred_trait)) {
      return res.status(400).json({ error: `Invalid trait. Available: ${validTraits.join(', ')}` });
    }
    updates.push('preferred_trait = ?');
    params.push(preferred_trait);
  }

  if (banner_symbol) {
    const sym = String(banner_symbol).replace(/[^\x20-\x7E]/g, '').charAt(0);
    if (sym) {
      db.prepare('UPDATE worlds SET banner_symbol = ? WHERE id = ?').run(sym, req.worldId);
    }
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    params.push(req.worldId);
    db.prepare(`UPDATE culture SET ${updates.join(', ')} WHERE world_id = ?`).run(...params);
  }

  logCultureAction(req.worldId, 'set-culture', '_default');
  res.json({ ok: true });
});

module.exports = router;
