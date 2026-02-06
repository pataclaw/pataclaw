const limits = new Map(); // worldId -> { count, resetAt }

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;

function rateLimit(req, res, next) {
  const key = req.worldId || req.ip;
  const now = Date.now();

  let entry = limits.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    limits.set(key, entry);
  }

  entry.count++;
  if (entry.count > MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  next();
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of limits) {
    if (now > entry.resetAt) limits.delete(key);
  }
}, 60_000);

module.exports = rateLimit;
