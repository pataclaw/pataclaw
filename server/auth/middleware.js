const db = require('../db/connection');
const { verifyKey, keyPrefix } = require('./hash');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey) {
    return res.status(401).json({ error: 'Empty key' });
  }

  const prefix = keyPrefix(rawKey);
  const candidates = db.prepare('SELECT id, key_hash FROM worlds WHERE key_prefix = ? AND status = ?').all(prefix, 'active');

  for (const candidate of candidates) {
    try {
      const match = await verifyKey(rawKey, candidate.key_hash);
      if (match) {
        req.worldId = candidate.id;
        return next();
      }
    } catch {
      continue;
    }
  }

  return res.status(401).json({ error: 'Invalid key' });
}

// Same logic but reads key from query param (for SSE/browser viewer)
async function authQuery(req, res, next) {
  const rawKey = req.query.key;
  if (!rawKey) {
    return res.status(401).json({ error: 'Missing key query parameter' });
  }

  const prefix = keyPrefix(rawKey);
  const candidates = db.prepare('SELECT id, key_hash FROM worlds WHERE key_prefix = ? AND status = ?').all(prefix, 'active');

  for (const candidate of candidates) {
    try {
      const match = await verifyKey(rawKey, candidate.key_hash);
      if (match) {
        req.worldId = candidate.id;
        return next();
      }
    } catch {
      continue;
    }
  }

  return res.status(401).json({ error: 'Invalid key' });
}

// View token auth — read-only, no secret key needed
function authViewToken(req, res, next) {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Missing token query parameter' });
  }

  const world = db.prepare('SELECT id FROM worlds WHERE view_token = ? AND status = ?').get(token, 'active');
  if (!world) {
    return res.status(401).json({ error: 'Invalid view token' });
  }

  req.worldId = world.id;
  next();
}

// Play token auth: URL-safe token for browsing AIs (no secret key in URL)
function authPlayToken(req, res, next) {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Missing token. Use ?token=YOUR_PLAY_TOKEN' });
  }

  const world = db.prepare('SELECT id FROM worlds WHERE play_token = ? AND status = ?').get(token, 'active');
  if (!world) {
    return res.status(401).json({ error: 'Invalid play token' });
  }

  req.worldId = world.id;
  req.authMethod = 'play_token';
  next();
}

// Flexible auth: Bearer header (secret key) OR ?token= (play token)
async function authFlexible(req, res, next) {
  const authHeader = req.headers.authorization;

  // Try Bearer key first (POST-based agents)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rawKey = authHeader.slice(7);
    if (rawKey) {
      const prefix = keyPrefix(rawKey);
      const candidates = db.prepare('SELECT id, key_hash FROM worlds WHERE key_prefix = ? AND status = ?').all(prefix, 'active');
      for (const candidate of candidates) {
        try {
          const match = await verifyKey(rawKey, candidate.key_hash);
          if (match) {
            req.worldId = candidate.id;
            req.authMethod = 'secret_key';
            return next();
          }
        } catch { continue; }
      }
      return res.status(401).json({ error: 'Invalid key' });
    }
  }

  // Fall back to play token (GET-based browsing AIs)
  return authPlayToken(req, res, next);
}

module.exports = { authMiddleware, authQuery, authPlayToken, authFlexible, authViewToken };
