const { Router } = require('express');
const { authViewToken, authMiddleware } = require('../auth/middleware');
const { addViewer, pushEvent } = require('../simulation/engine');
const { buildFrame } = require('../render/ascii');
const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { getBookEntries, getChronicler } = require('../simulation/chronicler');

const router = Router();

// Rate limiting for whispers: worldId -> last whisper timestamp
const whisperCooldowns = new Map();

// GET /api/stream?token=... - SSE stream for browser viewer (read-only via view token)
router.get('/stream', authViewToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Disable TCP buffering for real-time streaming
  if (res.socket) res.socket.setNoDelay(true);

  // Send initial frame immediately
  const frame = buildFrame(req.worldId, 'town');
  res.write(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`);

  // Register for future frames
  addViewer(req.worldId, res);

  // Keepalive
  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
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

  // Rate limit: check last whisper time for this world (simple in-memory)
  const now = Date.now();
  const lastWhisper = whisperCooldowns.get(req.worldId) || 0;
  if (now - lastWhisper < 60000) {
    return res.status(429).json({ error: 'Whisper cooldown: 1 per minute' });
  }
  whisperCooldowns.set(req.worldId, now);

  // Store as event
  const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(req.worldId);

  db.prepare(
    "INSERT INTO events (id, world_id, tick, type, title, description, severity, data) VALUES (?, ?, ?, 'whisper', ?, ?, 'info', ?)"
  ).run(uuid(), req.worldId, world ? world.current_tick : 0, 'A voice from beyond...', clean, JSON.stringify({ source: 'spectator' }));

  // Push to connected viewers as notification
  pushEvent(req.worldId, { type: 'whisper', title: 'A voice from beyond...', description: clean, severity: 'info' });

  res.json({ ok: true, whisper: clean });
});

module.exports = router;
