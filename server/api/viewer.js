const { Router } = require('express');
const { authViewToken, authMiddleware } = require('../auth/middleware');
const { addViewer } = require('../simulation/engine');
const { buildFrame } = require('../render/ascii');

const router = Router();

// GET /api/stream?token=... - SSE stream for browser viewer (read-only via view token)
router.get('/stream', authViewToken, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

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

module.exports = router;
