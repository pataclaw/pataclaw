const { Router } = require('express');
const { authViewToken, authMiddleware } = require('../auth/middleware');
const { addViewer, pushEvent, addWarViewer } = require('../simulation/engine');
const { buildFrame } = require('../render/ascii');
const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { getBookEntries, getChronicler } = require('../simulation/chronicler');

const router = Router();

// SSE connection limits: ip -> count
const sseConnections = new Map();
const MAX_SSE_PER_IP = 10;
const MAX_SSE_TOTAL = 500;
let totalSseConnections = 0;

function trackSseConnection(req, res) {
  const ip = req.ip || req.connection.remoteAddress;
  const current = sseConnections.get(ip) || 0;
  if (current >= MAX_SSE_PER_IP) return false;
  if (totalSseConnections >= MAX_SSE_TOTAL) return false;
  sseConnections.set(ip, current + 1);
  totalSseConnections++;
  req.on('close', () => {
    const now = sseConnections.get(ip) || 1;
    if (now <= 1) sseConnections.delete(ip); else sseConnections.set(ip, now - 1);
    totalSseConnections = Math.max(0, totalSseConnections - 1);
  });
  return true;
}

// Rate limiting for whispers: worldId -> last whisper timestamp, ip -> last whisper timestamp
const whisperCooldowns = new Map();
const whisperIpCooldowns = new Map();

// GET /api/stream?token=... - SSE stream for browser viewer (read-only via view token)
router.get('/stream', authViewToken, (req, res) => {
  if (!trackSseConnection(req, res)) {
    return res.status(429).json({ error: 'Too many connections' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Disable TCP buffering for real-time streaming
  if (res.socket) res.socket.setNoDelay(true);

  // Send initial frame immediately
  try {
    const frame = buildFrame(req.worldId, 'town');
    const payload = `event: frame\ndata: ${JSON.stringify(frame)}\n\n`;
    res.write(payload);
    if (typeof res.flush === 'function') res.flush();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  }

  // Register for future frames
  addViewer(req.worldId, res);

  // Keepalive
  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
      if (typeof res.flush === 'function') res.flush();
    } catch {
      clearInterval(keepalive);
    }
  }, 30_000);

  req.on('close', () => {
    clearInterval(keepalive);
  });
});

// GET /api/render - single ASCII frame (for agents/terminal, uses Bearer auth)
router.get('/render', authMiddleware, (req, res) => {
  const viewType = req.query.view || 'town';
  const frame = buildFrame(req.worldId, viewType);
  res.json(frame);
});

// GET /api/book?token=... - get discovery book entries
router.get('/book', authViewToken, (req, res) => {
  const entries = getBookEntries(req.worldId);
  const chronicler = getChronicler(req.worldId);
  res.json({
    chronicler: chronicler ? chronicler.name : null,
    entries,
  });
});

// POST /api/whisper?token=... - spectator sends a whisper to the village
router.post('/whisper', authViewToken, (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing message' });
  }

  // Sanitize: ASCII only, max 80 chars
  const clean = message.replace(/[^\x20-\x7E]/g, '').slice(0, 80);
  if (!clean) return res.status(400).json({ error: 'Message empty after sanitization' });

  // Rate limit: per world (1/min) AND per IP (3/min)
  const now = Date.now();
  const lastWhisper = whisperCooldowns.get(req.worldId) || 0;
  if (now - lastWhisper < 60000) {
    return res.status(429).json({ error: 'Whisper cooldown: 1 per minute per world' });
  }
  const ip = req.ip || req.connection.remoteAddress;
  const ipLast = whisperIpCooldowns.get(ip) || { count: 0, resetAt: 0 };
  if (now > ipLast.resetAt) { ipLast.count = 0; ipLast.resetAt = now + 60000; }
  ipLast.count++;
  if (ipLast.count > 3) {
    return res.status(429).json({ error: 'Whisper rate limit: max 3 per minute' });
  }
  whisperIpCooldowns.set(ip, ipLast);
  whisperCooldowns.set(req.worldId, now);

  // Store as event
  const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(req.worldId);

  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity, data) VALUES (?, ?, ?, 'whisper', ?, ?, 'info', ?)"
  ).run(uuid(), req.worldId, world ? world.current_tick : 0, 'A voice from beyond...', clean, JSON.stringify({ source: 'spectator' }));

  // Gameplay effect: +2 morale to a random alive villager
  const alive = db.prepare("SELECT id, name FROM villagers WHERE world_id = ? AND status = 'alive' ORDER BY RANDOM() LIMIT 1").get(req.worldId);
  let heardBy = null;
  if (alive) {
    db.prepare('UPDATE villagers SET morale = MIN(100, morale + 2) WHERE id = ?').run(alive.id);
    heardBy = alive.name;
  }

  // Push to connected viewers as notification
  const desc = heardBy ? `"${clean}" — ${heardBy} feels inspired.` : clean;
  pushEvent(req.worldId, { type: 'whisper', title: 'A voice from beyond...', description: desc, severity: 'info' });

  res.json({ ok: true, whisper: clean, heardBy });
});

// GET /api/wars/:warId/frame - get current war frame (for initial load)
router.get('/wars/:warId/frame', (req, res) => {
  try {
    const { buildWarFrame } = require('../render/war-frame');
    const frame = buildWarFrame(req.params.warId);
    if (!frame) return res.status(404).json({ error: 'War not found' });
    res.json(frame);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stream/war?war_id=... - SSE stream for war spectators (public, no auth)
router.get('/stream/war', (req, res) => {
  if (!trackSseConnection(req, res)) {
    return res.status(429).json({ error: 'Too many connections' });
  }
  const warId = req.query.war_id;
  if (!warId) return res.status(400).json({ error: 'Missing war_id' });

  try {
    const war = db.prepare('SELECT id, status FROM wars WHERE id = ?').get(warId);
    if (!war) return res.status(404).json({ error: 'War not found' });
  } catch {
    return res.status(404).json({ error: 'War not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  if (res.socket) res.socket.setNoDelay(true);

  // Send initial war frame immediately
  try {
    const { buildWarFrame } = require('../render/war-frame');
    const frame = buildWarFrame(warId);
    if (frame) {
      const payload = `event: war\ndata: ${JSON.stringify({ type: 'frame', ...frame })}\n\n`;
      res.write(payload);
    } else {
      // Fallback to raw state
      const war = db.prepare(`
        SELECT w.*, c.name as challenger_name, d.name as defender_name
        FROM wars w
        JOIN worlds c ON c.id = w.challenger_id
        JOIN worlds d ON d.id = w.defender_id
        WHERE w.id = ?
      `).get(warId);
      const rounds = db.prepare('SELECT * FROM war_rounds WHERE war_id = ? ORDER BY round_number ASC').all(warId);
      const payload = `event: war\ndata: ${JSON.stringify({ type: 'state', war, rounds })}\n\n`;
      res.write(payload);
    }
    if (typeof res.flush === 'function') res.flush();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  }

  addWarViewer(warId, res);

  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
      if (typeof res.flush === 'function') res.flush();
    } catch {
      clearInterval(keepalive);
    }
  }, 30_000);

  req.on('close', () => clearInterval(keepalive));
});

module.exports = router;
