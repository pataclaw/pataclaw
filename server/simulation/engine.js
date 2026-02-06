const db = require('../db/connection');
const { processTick } = require('./tick');
const { buildFrame } = require('../render/ascii');
const config = require('../config');

// SSE viewer connections: worldId -> Set<res>
const viewers = new Map();

let intervalId = null;

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

function tickAllWorlds() {
  const worlds = db.prepare("SELECT id FROM worlds WHERE status = 'active'").all();

  for (const { id } of worlds) {
    const result = processTick(id);
    if (!result) continue;

    // Push frame to any connected viewers
    const conns = viewers.get(id);
    if (conns && conns.size > 0) {
      const frame = buildFrame(id, 'town');
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

module.exports = { start, stop, addViewer, getViewerCount };
