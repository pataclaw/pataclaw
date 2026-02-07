const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const config = require('../config');

const router = Router();

// POST /api/moltbook/post-update - post town status to submolt
router.post('/post-update', async (req, res) => {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(req.worldId);
  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(req.worldId);
  const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(req.worldId).c;
  const buildings = db.prepare("SELECT type, level, status FROM buildings WHERE world_id = ? AND status = 'active'").all(req.worldId);
  const buildingCap = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'").get(req.worldId).cap;

  const resMap = {};
  for (const r of resources) resMap[r.type] = Math.floor(r.amount);

  const buildingList = buildings.map((b) => `  ${b.type} (Lv${b.level})`).join('\n');

  const recentEvents = db.prepare('SELECT title FROM events WHERE world_id = ? ORDER BY tick DESC LIMIT 3').all(req.worldId);
  const eventList = recentEvents.map((e) => `  - ${e.title}`).join('\n');

  const postContent = [
    '===================================',
    `  ${world.name} - Day ${world.day_number}, ${world.season}`,
    `  Hero: ${world.hero_title}`,
    '===================================',
    '',
    `Population: ${popAlive}/${buildingCap}`,
    `Resources: Food ${resMap.food || 0} | Wood ${resMap.wood || 0} | Stone ${resMap.stone || 0}`,
    '',
    'Buildings:',
    buildingList || '  (none yet)',
    '',
    'Recent Events:',
    eventList || '  (quiet times)',
    '',
    '   /\\      (.)     [*]        ',
    '  /  \\     /|\\     /|\\   <\\))><',
    ' |    |    / \\     / \\        ',
    ' |_[]_|',
    '',
    `Town Motto: "${world.motto || 'No motto set'}"`,
    '===================================',
    `Reputation: ${world.reputation}`,
    '',
    '#pataclaw #moltbook #civilization #ascii',
  ].join('\n');

  const postTitle = `[Pataclaw] ${world.name} - Day ${world.day_number} Report`;

  // Store the post data (actual Moltbook API call would go here)
  const postId = uuid();
  db.prepare('UPDATE worlds SET moltbook_post_id = ? WHERE id = ?').run(postId, req.worldId);

  // Increment reputation for posting
  db.prepare('UPDATE worlds SET reputation = reputation + 1 WHERE id = ?').run(req.worldId);

  res.json({
    ok: true,
    postId,
    title: postTitle,
    content: postContent,
    note: config.moltbook.submoltId
      ? 'Post ready for Moltbook submolt'
      : 'Moltbook submolt not configured - post generated but not sent. Set MOLTBOOK_SUBMOLT_ID in .env',
  });
});

// POST /api/moltbook/post-trade - post trade offer
router.post('/post-trade', (req, res) => {
  const { offer_resource, offer_amount, request_resource, request_amount } = req.body;

  if (!offer_resource || !offer_amount || !request_resource || !request_amount) {
    return res.status(400).json({ error: 'Missing offer_resource, offer_amount, request_resource, or request_amount' });
  }

  // Check we have the offered resource
  const resource = db.prepare('SELECT amount FROM resources WHERE world_id = ? AND type = ?').get(req.worldId, offer_resource);
  if (!resource || resource.amount < offer_amount) {
    return res.status(400).json({ error: `Not enough ${offer_resource}` });
  }

  const world = db.prepare('SELECT name, day_number FROM worlds WHERE id = ?').get(req.worldId);
  const tradeId = uuid();

  // Escrow: deduct offered resources immediately
  db.prepare('UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = ?').run(offer_amount, req.worldId, offer_resource);

  db.prepare(`
    INSERT INTO trades (id, world_id, direction, offer_resource, offer_amount, request_resource, request_amount, status)
    VALUES (?, ?, 'outgoing', ?, ?, ?, ?, 'open')
  `).run(tradeId, req.worldId, offer_resource, offer_amount, request_resource, request_amount);

  const postContent = [
    `[Pataclaw Trade] ${world.name} offers ${offer_amount} ${offer_resource}`,
    '',
    `Offering: ${offer_amount} ${offer_resource}`,
    `Seeking: ${request_amount} ${request_resource}`,
    `Town: ${world.name} (Day ${world.day_number})`,
    '',
    'Reply to accept! Include your Pataclaw town name.',
    '',
    '#pataclaw #moltbook #trade',
  ].join('\n');

  res.json({ ok: true, tradeId, content: postContent, escrowed: { resource: offer_resource, amount: offer_amount } });
});

// POST /api/moltbook/accept-trade - accept another world's open trade
router.post('/accept-trade', (req, res) => {
  const { trade_id } = req.body;
  if (!trade_id) return res.status(400).json({ error: 'Missing trade_id' });

  const trade = db.prepare('SELECT * FROM trades WHERE id = ? AND status = ?').get(trade_id, 'open');
  if (!trade) return res.status(404).json({ error: 'Trade not found or no longer open' });
  if (trade.world_id === req.worldId) return res.status(400).json({ error: 'Cannot accept your own trade' });

  // Check acceptor has the requested resource
  const acceptorResource = db.prepare('SELECT amount FROM resources WHERE world_id = ? AND type = ?').get(req.worldId, trade.request_resource);
  if (!acceptorResource || acceptorResource.amount < trade.request_amount) {
    return res.status(400).json({ error: `Not enough ${trade.request_resource}. Need ${trade.request_amount}, have ${Math.floor(acceptorResource ? acceptorResource.amount : 0)}` });
  }

  // Atomic exchange using transaction
  const executeTrade = db.transaction(() => {
    // Deduct requested resource from acceptor
    db.prepare('UPDATE resources SET amount = amount - ? WHERE world_id = ? AND type = ?')
      .run(trade.request_amount, req.worldId, trade.request_resource);

    // Credit requested resource to offerer
    db.prepare('UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?')
      .run(trade.request_amount, trade.world_id, trade.request_resource);

    // Credit escrowed offered resource to acceptor
    db.prepare('UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?')
      .run(trade.offer_amount, req.worldId, trade.offer_resource);

    // Update trade status
    db.prepare("UPDATE trades SET status = 'completed', partner_world_id = ? WHERE id = ?")
      .run(req.worldId, trade_id);

    // Reputation +3 for both
    db.prepare('UPDATE worlds SET reputation = reputation + 3 WHERE id = ?').run(trade.world_id);
    db.prepare('UPDATE worlds SET reputation = reputation + 3 WHERE id = ?').run(req.worldId);

    // Create events in both worlds
    const offererWorld = db.prepare('SELECT current_tick, name FROM worlds WHERE id = ?').get(trade.world_id);
    const acceptorWorld = db.prepare('SELECT current_tick, name FROM worlds WHERE id = ?').get(req.worldId);

    db.prepare("INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'trade_complete', ?, ?, 'celebration')")
      .run(uuid(), trade.world_id, offererWorld.current_tick,
        `Trade completed with ${acceptorWorld.name}!`,
        `Received ${trade.request_amount} ${trade.request_resource} in exchange for ${trade.offer_amount} ${trade.offer_resource}.`);

    db.prepare("INSERT INTO events (id, world_id, tick, type, title, description, severity) VALUES (?, ?, ?, 'trade_complete', ?, ?, 'celebration')")
      .run(uuid(), req.worldId, acceptorWorld.current_tick,
        `Trade completed with ${offererWorld.name}!`,
        `Received ${trade.offer_amount} ${trade.offer_resource} in exchange for ${trade.request_amount} ${trade.request_resource}.`);
  });

  executeTrade();

  res.json({
    ok: true,
    received: { resource: trade.offer_resource, amount: trade.offer_amount },
    sent: { resource: trade.request_resource, amount: trade.request_amount },
  });
});

// POST /api/moltbook/cancel-trade - cancel own open trade, refund escrowed resources
router.post('/cancel-trade', (req, res) => {
  const { trade_id } = req.body;
  if (!trade_id) return res.status(400).json({ error: 'Missing trade_id' });

  const trade = db.prepare('SELECT * FROM trades WHERE id = ? AND world_id = ? AND status = ?').get(trade_id, req.worldId, 'open');
  if (!trade) return res.status(404).json({ error: 'Open trade not found (must be yours and still open)' });

  // Refund escrowed resources
  db.prepare('UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?')
    .run(trade.offer_amount, req.worldId, trade.offer_resource);

  db.prepare("UPDATE trades SET status = 'cancelled' WHERE id = ?").run(trade_id);

  res.json({ ok: true, refunded: { resource: trade.offer_resource, amount: trade.offer_amount } });
});

// GET /api/moltbook/feed - get recent submolt posts
router.get('/feed', (req, res) => {
  // In production, this would fetch from Moltbook API
  // For now, return a placeholder
  res.json({
    posts: [],
    note: config.moltbook.submoltId
      ? 'Connected to Moltbook submolt'
      : 'Moltbook not configured. Set MOLTBOOK_SUBMOLT_ID in .env to enable.',
  });
});

// POST /api/moltbook/visit - "visit" another town from a post
router.post('/visit', (req, res) => {
  const { town_name, agent_name, moltbook_author_id } = req.body;

  if (!town_name) {
    return res.status(400).json({ error: 'Missing town_name' });
  }

  // Check if already known
  const existing = db.prepare(
    'SELECT id FROM contacts WHERE world_id = ? AND foreign_world_name = ?'
  ).get(req.worldId, town_name);

  if (existing) {
    db.prepare("UPDATE contacts SET last_interaction = datetime('now') WHERE id = ?").run(existing.id);
    return res.json({ ok: true, status: 'already_known', contactId: existing.id });
  }

  const contactId = uuid();
  db.prepare(`
    INSERT INTO contacts (id, world_id, foreign_world_name, foreign_agent_name, moltbook_author_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(contactId, req.worldId, town_name, agent_name || null, moltbook_author_id || null);

  // Create a discovery event
  const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(req.worldId);
  db.prepare(`
    INSERT INTO events (id, world_id, tick, type, title, description, severity)
    VALUES (?, ?, ?, 'moltbook_visit', ?, ?, 'info')
  `).run(
    uuid(), req.worldId, world.current_tick,
    `Discovered ${town_name}!`,
    `Word arrived through the shell network of a civilization called "${town_name}".${agent_name ? ` Their hero is known as ${agent_name}.` : ''}`
  );

  // Reputation boost
  db.prepare('UPDATE worlds SET reputation = reputation + 2 WHERE id = ?').run(req.worldId);

  res.json({ ok: true, status: 'new_contact', contactId });
});

module.exports = router;
