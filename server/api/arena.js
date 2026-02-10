const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db/connection');

const router = Router();

const STARTING_CREDITS = 1000;
const AGENT_STARTING_CREDITS = 500;
const PLATFORM_FEE = 0.05; // 5% rake

// ─── Session middleware ───
function sessionMiddleware(req, res, next) {
  const token = req.headers['x-session'] || req.query.session;
  if (!token) return res.status(401).json({ error: 'Missing X-Session header. Visit /arena to get one.' });

  const spectator = db.prepare('SELECT * FROM spectators WHERE session_token = ?').get(token);
  if (!spectator) return res.status(401).json({ error: 'Invalid session. Visit /arena to create an account.' });

  req.spectator = spectator;
  next();
}

// ─── Auto-create spectator ───
// POST /api/arena/register — create a new spectator account
router.post('/register', (req, res) => {
  const displayName = req.body.name
    ? String(req.body.name).replace(/[^\x20-\x7E]/g, '').slice(0, 30)
    : `Spectator-${Math.floor(Math.random() * 9999)}`;

  const sessionToken = uuid();
  const spectatorId = uuid();
  const isAgent = req.body.is_agent ? 1 : 0;
  const credits = isAgent ? AGENT_STARTING_CREDITS : STARTING_CREDITS;

  db.prepare(`
    INSERT INTO spectators (id, session_token, display_name, credits, is_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(spectatorId, sessionToken, displayName, credits, isAgent);

  res.json({
    session_token: sessionToken,
    spectator_id: spectatorId,
    display_name: displayName,
    credits,
  });
});

// GET /api/arena/me — get spectator info
router.get('/me', sessionMiddleware, (req, res) => {
  const s = req.spectator;
  res.json({
    id: s.id,
    display_name: s.display_name,
    credits: s.credits,
    total_wagered: s.total_wagered,
    total_won: s.total_won,
    win_count: s.win_count,
    loss_count: s.loss_count,
    is_agent: !!s.is_agent,
  });
});

// POST /api/arena/bet — place a bet
router.post('/bet', sessionMiddleware, (req, res) => {
  const { war_id, backed_world_id, amount } = req.body;
  if (!war_id || !backed_world_id || !amount) {
    return res.status(400).json({ error: 'Missing war_id, backed_world_id, or amount' });
  }

  const betAmount = Math.floor(Number(amount));
  if (betAmount < 1) return res.status(400).json({ error: 'Minimum bet is 1 credit' });
  if (betAmount > req.spectator.credits) {
    return res.status(400).json({ error: `Insufficient credits. Have ${req.spectator.credits}, need ${betAmount}` });
  }

  // War must be in countdown phase
  const war = db.prepare("SELECT * FROM wars WHERE id = ? AND status = 'countdown'").get(war_id);
  if (!war) return res.status(400).json({ error: 'War not found or betting is closed' });

  // Check betting window
  if (war.betting_closes_at && new Date(war.betting_closes_at) <= new Date()) {
    return res.status(400).json({ error: 'Betting window has closed' });
  }

  // Must bet on one of the participants
  if (backed_world_id !== war.challenger_id && backed_world_id !== war.defender_id) {
    return res.status(400).json({ error: 'Must bet on challenger or defender' });
  }

  // Can't bet twice on same war
  const existingBet = db.prepare(
    "SELECT id FROM bets WHERE war_id = ? AND spectator_id = ? AND status = 'active'"
  ).get(war_id, req.spectator.id);
  if (existingBet) return res.status(400).json({ error: 'Already placed a bet on this war' });

  // Calculate odds
  const odds = calculateOdds(war);
  const oddsForBacked = backed_world_id === war.challenger_id ? odds.challengerOdds : odds.defenderOdds;
  const potentialPayout = Math.floor(betAmount * oddsForBacked * (1 - PLATFORM_FEE));

  const betId = uuid();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO bets (id, war_id, spectator_id, backed_world_id, amount, odds_at_placement, potential_payout, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(betId, war_id, req.spectator.id, backed_world_id, betAmount, oddsForBacked, potentialPayout);

    db.prepare('UPDATE spectators SET credits = credits - ?, total_wagered = total_wagered + ? WHERE id = ?')
      .run(betAmount, betAmount, req.spectator.id);

    db.prepare(`
      INSERT INTO payouts (spectator_id, war_id, type, amount, balance_after, description)
      VALUES (?, ?, 'bet', ?, ?, ?)
    `).run(req.spectator.id, war_id, -betAmount, req.spectator.credits - betAmount,
      `Bet on war ${war_id.slice(0, 8)}`);
  })();

  res.json({
    bet_id: betId,
    amount: betAmount,
    odds: oddsForBacked,
    potential_payout: potentialPayout,
    credits_remaining: req.spectator.credits - betAmount,
  });
});

// GET /api/arena/my-bets — list my bets
router.get('/my-bets', sessionMiddleware, (req, res) => {
  const bets = db.prepare(`
    SELECT b.*, c.name as challenger_name, d.name as defender_name, w.status as war_status,
           backed.name as backed_name
    FROM bets b
    JOIN wars w ON w.id = b.war_id
    JOIN worlds c ON c.id = w.challenger_id
    JOIN worlds d ON d.id = w.defender_id
    JOIN worlds backed ON backed.id = b.backed_world_id
    WHERE b.spectator_id = ?
    ORDER BY b.created_at DESC LIMIT 50
  `).all(req.spectator.id);

  res.json({ bets });
});

// GET /api/arena/wars — wars available for betting + active
router.get('/wars', (_req, res) => {
  try {
    const wars = db.prepare(`
      SELECT w.id, w.status, w.challenger_hp, w.defender_hp, w.round_number,
             w.betting_closes_at, w.challenger_snapshot, w.defender_snapshot,
             c.name as challenger_name, c.town_number as challenger_town,
             d.name as defender_name, d.town_number as defender_town,
             (SELECT COUNT(*) FROM bets WHERE war_id = w.id AND status = 'active') as total_bets,
             (SELECT COALESCE(SUM(amount), 0) FROM bets WHERE war_id = w.id AND status = 'active') as total_wagered
      FROM wars w
      JOIN worlds c ON c.id = w.challenger_id
      JOIN worlds d ON d.id = w.defender_id
      WHERE w.status IN ('countdown', 'active')
      ORDER BY w.created_at DESC
    `).all();

    // Calculate odds for countdown wars
    for (const war of wars) {
      if (war.status === 'countdown') {
        const fullWar = db.prepare('SELECT * FROM wars WHERE id = ?').get(war.id);
        const odds = calculateOdds(fullWar);
        war.challenger_odds = odds.challengerOdds;
        war.defender_odds = odds.defenderOdds;
      }
    }

    res.json({ wars });
  } catch {
    res.json({ wars: [] });
  }
});

// GET /api/arena/wars/:id — war detail with odds + bets
router.get('/wars/:id', (req, res) => {
  try {
    const war = db.prepare(`
      SELECT w.*, c.name as challenger_name, d.name as defender_name
      FROM wars w
      JOIN worlds c ON c.id = w.challenger_id
      JOIN worlds d ON d.id = w.defender_id
      WHERE w.id = ?
    `).get(req.params.id);

    if (!war) return res.status(404).json({ error: 'War not found' });

    const odds = calculateOdds(war);
    const rounds = db.prepare('SELECT * FROM war_rounds WHERE war_id = ? ORDER BY round_number ASC').all(req.params.id);
    const bets = db.prepare(`
      SELECT b.amount, b.backed_world_id, b.odds_at_placement,
             s.display_name, backed.name as backed_name
      FROM bets b
      JOIN spectators s ON s.id = b.spectator_id
      JOIN worlds backed ON backed.id = b.backed_world_id
      WHERE b.war_id = ? AND b.status = 'active'
    `).all(req.params.id);

    res.json({ war, odds, rounds, bets });
  } catch {
    res.status(404).json({ error: 'War not found' });
  }
});

// GET /api/arena/leaderboard — top bettors
router.get('/leaderboard', (_req, res) => {
  try {
    const top = db.prepare(`
      SELECT display_name, credits, total_wagered, total_won, win_count, loss_count, is_agent
      FROM spectators
      ORDER BY credits DESC
      LIMIT 20
    `).all();
    res.json({ leaderboard: top });
  } catch {
    res.json({ leaderboard: [] });
  }
});

// POST /api/arena/link-world — link spectator to their world
router.post('/link-world', sessionMiddleware, (req, res) => {
  const { world_id } = req.body;
  if (!world_id) return res.status(400).json({ error: 'Missing world_id' });

  db.prepare('UPDATE spectators SET world_id = ? WHERE id = ?').run(world_id, req.spectator.id);
  res.json({ ok: true });
});

// ─── Odds Calculation ───
function calculateOdds(war) {
  let cStats, dStats;
  try {
    const cSnap = JSON.parse(war.challenger_snapshot || '{}');
    const dSnap = JSON.parse(war.defender_snapshot || '{}');
    cStats = cSnap.stats || {};
    dStats = dSnap.stats || {};
  } catch {
    cStats = {};
    dStats = {};
  }

  const cPower = (cStats.military_strength || 1) * 3 +
    (cStats.war_readiness || 0) * 2 +
    (cStats.fortification_rating || 0) +
    (cStats.happiness_index || 50) * 0.5 +
    (cStats.morale_resilience || 1) * 20;

  const dPower = (dStats.military_strength || 1) * 3 +
    (dStats.war_readiness || 0) * 2 +
    (dStats.fortification_rating || 0) * 1.2 + // defender advantage
    (dStats.happiness_index || 50) * 0.5 +
    (dStats.morale_resilience || 1) * 20;

  const total = cPower + dPower;
  const challengerOdds = Math.min(19.0, Math.max(1.05, total / Math.max(1, cPower)));
  const defenderOdds = Math.min(19.0, Math.max(1.05, total / Math.max(1, dPower)));

  return {
    challengerOdds: Math.round(challengerOdds * 100) / 100,
    defenderOdds: Math.round(defenderOdds * 100) / 100,
    challengerPower: Math.round(cPower),
    defenderPower: Math.round(dPower),
  };
}

// ─── Payout Processing (called from war.js on resolution) ───
function processPayouts(warId, winnerId) {
  const activeBets = db.prepare("SELECT * FROM bets WHERE war_id = ? AND status = 'active'").all(warId);

  for (const bet of activeBets) {
    if (bet.backed_world_id === winnerId) {
      // Winner — pay out
      const payout = bet.potential_payout;
      db.transaction(() => {
        db.prepare("UPDATE bets SET status = 'won', payout = ? WHERE id = ?").run(payout, bet.id);
        db.prepare('UPDATE spectators SET credits = credits + ?, total_won = total_won + ?, win_count = win_count + 1 WHERE id = ?')
          .run(payout, payout, bet.spectator_id);

        const spectator = db.prepare('SELECT credits FROM spectators WHERE id = ?').get(bet.spectator_id);
        db.prepare(`
          INSERT INTO payouts (spectator_id, war_id, type, amount, balance_after, description)
          VALUES (?, ?, 'win', ?, ?, ?)
        `).run(bet.spectator_id, warId, payout, spectator.credits,
          `Won bet on war ${warId.slice(0, 8)}`);
      })();
    } else {
      // Loser — already deducted
      db.transaction(() => {
        db.prepare("UPDATE bets SET status = 'lost', payout = 0 WHERE id = ?").run(bet.id);
        db.prepare('UPDATE spectators SET loss_count = loss_count + 1 WHERE id = ?').run(bet.spectator_id);
      })();
    }
  }
}

module.exports = router;
module.exports.processPayouts = processPayouts;
module.exports.sessionMiddleware = sessionMiddleware;
