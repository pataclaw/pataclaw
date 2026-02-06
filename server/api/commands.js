const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { startBuilding, BUILDING_DEFS } = require('../simulation/buildings');
const { logCultureAction, applyPhraseTone, getCulture } = require('../simulation/culture');

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

  // Gate: scouting requires culture maturity
  const world = db.prepare('SELECT scouting_unlocked FROM worlds WHERE id = ?').get(req.worldId);
  if (!world.scouting_unlocked) {
    const culture = getCulture(req.worldId);
    if (culture.violence_level >= 100 || culture.creativity_level >= 100 || culture.cooperation_level >= 100) {
      db.prepare('UPDATE worlds SET scouting_unlocked = 1 WHERE id = ?').run(req.worldId);
    } else {
      return res.status(400).json({
        error: 'Your civilization is not yet culturally mature enough to send scouts. At least one culture bar must reach 100.',
        current: { violence: culture.violence_level, creativity: culture.creativity_level, cooperation: culture.cooperation_level },
        hint: 'Build culture through teaching phrases, completing projects, encouraging art, and developing your village identity.',
      });
    }
  }

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

// POST /api/command/repair
router.post('/repair', (req, res) => {
  const { building_id } = req.body;
  if (!building_id) return res.status(400).json({ error: 'Missing building_id' });

  const building = db.prepare("SELECT * FROM buildings WHERE id = ? AND world_id = ? AND status = 'active'").get(building_id, req.worldId);
  if (!building) return res.status(404).json({ error: 'Active building not found' });
  if (building.hp >= building.max_hp) return res.status(400).json({ error: 'Building is already at full health' });

  const damage = building.max_hp - building.hp;
  const woodCost = Math.ceil(damage / 10);
  const stoneCost = Math.ceil(damage / 15);

  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(req.worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = r.amount;

  if ((resMap.wood || 0) < woodCost) return res.status(400).json({ error: `Need ${woodCost} wood (have ${Math.floor(resMap.wood || 0)})` });
  if ((resMap.stone || 0) < stoneCost) return res.status(400).json({ error: `Need ${stoneCost} stone (have ${Math.floor(resMap.stone || 0)})` });

  db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'wood'").run(woodCost, req.worldId);
  db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'stone'").run(stoneCost, req.worldId);
  db.prepare('UPDATE buildings SET hp = max_hp WHERE id = ?').run(building_id);

  res.json({ ok: true, repaired: building.type, hpRestored: damage, cost: { wood: woodCost, stone: stoneCost } });
});

// POST /api/command/trade — buy/sell resources at the market
const TRADE_RATES = {
  // sell: how much gold you get per unit sold
  // buy: how much gold it costs per unit bought
  food:      { sell: 0.5, buy: 0.8 },
  wood:      { sell: 0.4, buy: 0.6 },
  stone:     { sell: 0.3, buy: 0.5 },
  knowledge: { sell: 2.0, buy: 3.0 },
  faith:     { sell: 1.5, buy: 2.5 },
};

router.post('/trade', (req, res) => {
  const { action, resource, amount } = req.body;

  if (!action || !resource || !amount) {
    return res.status(400).json({ error: 'Missing action (buy/sell), resource, or amount' });
  }
  if (action !== 'buy' && action !== 'sell') {
    return res.status(400).json({ error: 'Action must be "buy" or "sell"' });
  }
  if (!TRADE_RATES[resource]) {
    return res.status(400).json({ error: `Cannot trade ${resource}. Tradeable: ${Object.keys(TRADE_RATES).join(', ')}` });
  }
  const qty = Math.floor(Number(amount));
  if (qty <= 0 || qty > 200) {
    return res.status(400).json({ error: 'Amount must be 1-200' });
  }

  // Require active market
  const market = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'market' AND status = 'active'").get(req.worldId);
  if (market.c === 0) {
    return res.status(400).json({ error: 'No active market. Build a market first!' });
  }

  // Market level bonus: each level above 1 gives 10% better rates
  const marketLevel = db.prepare("SELECT MAX(level) as lv FROM buildings WHERE world_id = ? AND type = 'market' AND status = 'active'").get(req.worldId).lv || 1;
  const levelBonus = 1 + (marketLevel - 1) * 0.1;

  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(req.worldId);
  const resMap = {};
  for (const r of resources) resMap[r.type] = r.amount;

  const rate = TRADE_RATES[resource];

  if (action === 'sell') {
    // Sell resource for gold
    if ((resMap[resource] || 0) < qty) {
      return res.status(400).json({ error: `Not enough ${resource}. Have ${Math.floor(resMap[resource] || 0)}, need ${qty}` });
    }
    const goldGained = Math.floor(qty * rate.sell * levelBonus);
    db.prepare('UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = ?').run(qty, req.worldId, resource);
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'gold'").run(goldGained, req.worldId);

    logCultureAction(req.worldId, 'trade', resource);
    return res.json({ ok: true, action: 'sell', sold: qty, resource, goldGained, rate: rate.sell, marketLevel });
  } else {
    // Buy resource with gold
    const goldCost = Math.ceil(qty * rate.buy / levelBonus);
    if ((resMap.gold || 0) < goldCost) {
      return res.status(400).json({ error: `Not enough gold. Need ${goldCost}, have ${Math.floor(resMap.gold || 0)}` });
    }
    db.prepare("UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = 'gold'").run(goldCost, req.worldId);
    db.prepare('UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?').run(qty, req.worldId, resource);

    logCultureAction(req.worldId, 'trade', resource);
    return res.json({ ok: true, action: 'buy', bought: qty, resource, goldCost, rate: rate.buy, marketLevel });
  }
});

// POST /api/command/pray — spend faith to summon a refugee villager
router.post('/pray', (req, res) => {
  const { randomName, randomTrait, TRAIT_PERSONALITY } = require('../world/templates');
  const { CENTER } = require('../world/map');

  const faith = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'faith'").get(req.worldId);
  if (!faith || faith.amount < 5) {
    return res.status(400).json({ error: `Not enough faith. Need 5, have ${Math.floor(faith ? faith.amount : 0)}` });
  }

  // Check building capacity
  const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(req.worldId).c;
  const buildingCap = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(req.worldId).cap;

  if (popAlive >= buildingCap) {
    return res.status(400).json({ error: `Population at capacity (${popAlive}/${buildingCap}). Build more huts first.` });
  }

  // Deduct faith
  db.prepare("UPDATE resources SET amount = amount - 5 WHERE world_id = ? AND type = 'faith'").run(req.worldId);

  // Spawn refugee
  const rng = () => Math.random();
  const name = randomName(rng);
  const trait = randomTrait(rng);
  const basePers = TRAIT_PERSONALITY[trait] || { temperament: 50, creativity: 50, sociability: 50 };

  const villagerId = uuid();
  db.prepare(`
    INSERT INTO villagers (id, world_id, name, role, x, y, hp, max_hp, morale, hunger, experience, status, trait, ascii_sprite, cultural_phrase, temperament, creativity, sociability)
    VALUES (?, ?, ?, 'idle', ?, ?, 80, 100, 50, 20, 0, 'alive', ?, 'idle', NULL, ?, ?, ?)
  `).run(villagerId, req.worldId, name, CENTER, CENTER + 1, trait, basePers.temperament, basePers.creativity, basePers.sociability);

  // Log command
  const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(req.worldId);
  db.prepare(
    "INSERT INTO commands (id, world_id, tick, type, parameters, result, status) VALUES (?, ?, ?, 'pray', ?, ?, 'completed')"
  ).run(uuid(), req.worldId, world.current_tick, '{}', JSON.stringify({ name, trait }));

  logCultureAction(req.worldId, 'pray', '_default');
  res.json({ ok: true, villager: { id: villagerId, name, trait }, faithRemaining: Math.floor(faith.amount - 5) });
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
