const db = require('../db/connection');
const { processTick } = require('./tick');
const { buildFrame } = require('../render/ascii');
const config = require('../config');

// SSE viewer connections: worldId -> Set<res>
const viewers = new Map();

let intervalId = null;
let tickCount = 0; // global tick counter for slow-mode gating

function start() {
  console.log(`  Simulation engine starting (tick rate: ${config.tickRateMs}ms)`);

  intervalId = setInterval(() => {
    try {
      tickAllWorlds();
    } catch (err) {
      console.error('[ENGINE] Tick error:', err.message);
    }
  }, config.tickRateMs);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function determineTickMode(worldId, lastAgentHeartbeat) {
  // If viewers are connected, always run at full speed
  if (getViewerCount(worldId) > 0) return 'normal';

  if (!lastAgentHeartbeat) {
    // Agent has never connected — slow mode until first heartbeat
    return 'slow';
  }

  const heartbeatAge = Date.now() - new Date(lastAgentHeartbeat).getTime();

  // Also check most recent command timestamp
  const lastCommand = db.prepare(
    'SELECT created_at FROM commands WHERE world_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(worldId);

  let lastActivityMs = heartbeatAge;
  if (lastCommand) {
    const cmdAge = Date.now() - new Date(lastCommand.created_at).getTime();
    lastActivityMs = Math.min(lastActivityMs, cmdAge);
  }

  // 6+ hours inactive → dormant (no ticks)
  if (lastActivityMs > 6 * 60 * 60 * 1000) return 'dormant';
  // 1+ hour inactive → slow (1 tick per 10)
  if (lastActivityMs > 60 * 60 * 1000) return 'slow';

  return 'normal';
}

function tickAllWorlds() {
  tickCount++;

  const worlds = db.prepare(
    "SELECT id, last_agent_heartbeat, tick_mode FROM worlds WHERE status = 'active'"
  ).all();

  for (const world of worlds) {
    // Determine and update tick mode based on agent activity
    const mode = determineTickMode(world.id, world.last_agent_heartbeat);
    if (mode !== world.tick_mode) {
      db.prepare('UPDATE worlds SET tick_mode = ? WHERE id = ?').run(mode, world.id);
    }

    // Apply tick mode
    if (mode === 'dormant') continue;
    if (mode === 'slow' && tickCount % 10 !== 0) continue;

    const result = processTick(world.id);
    if (!result) continue;

    // Push frame to any connected viewers
    const conns = viewers.get(world.id);
    if (conns && conns.size > 0) {
      const frame = buildFrame(world.id, 'town');
      const data = `event: frame\ndata: ${JSON.stringify(frame)}\n\n`;

      for (const res of conns) {
        try {
          res.write(data);
        } catch {
          conns.delete(res);
        }
      }

      // Also push events
      for (const evt of result.events) {
        const evtData = `event: event\ndata: ${JSON.stringify(evt)}\n\n`;
        for (const res of conns) {
          try {
            res.write(evtData);
          } catch {
            conns.delete(res);
          }
        }
      }
    }
  }
}

function addViewer(worldId, res) {
  if (!viewers.has(worldId)) viewers.set(worldId, new Set());
  viewers.get(worldId).add(res);

  // Wake up the world when a viewer connects
  db.prepare("UPDATE worlds SET tick_mode = 'normal' WHERE id = ?").run(worldId);

  res.on('close', () => {
    const set = viewers.get(worldId);
    if (set) {
      set.delete(res);
      if (set.size === 0) viewers.delete(worldId);
    }
  });
}

function getViewerCount(worldId) {
  const set = viewers.get(worldId);
  return set ? set.size : 0;
}

function pushEvent(worldId, evt) {
  const conns = viewers.get(worldId);
  if (conns && conns.size > 0) {
    const evtData = `event: event\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const res of conns) {
      try { res.write(evtData); } catch { conns.delete(res); }
    }
  }
}

module.exports = { start, stop, addViewer, getViewerCount, pushEvent };
