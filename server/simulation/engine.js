const db = require('../db/connection');
const { processTick } = require('./tick');
const { buildFrame } = require('../render/ascii');
const config = require('../config');
const { refreshMoltbookFeed } = require('./moltbook-feed');
const { checkPlanetaryEvent, expirePlanetaryEvents } = require('./planetary');
const { advanceGlobalTime } = require('./time');
const { rollWeather } = require('./weather');

// SSE viewer connections: worldId -> Set<res>
const viewers = new Map();

// SSE war spectator connections: warId -> Set<res>
const warViewers = new Map();

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

function advancePlanetState() {
  // Read current planet state (or create it)
  let ps = db.prepare('SELECT * FROM planet_state WHERE id = 1').get();
  if (!ps) {
    db.exec(`INSERT OR IGNORE INTO planet_state (id) VALUES (1)`);
    ps = db.prepare('SELECT * FROM planet_state WHERE id = 1').get();
  }

  const newTick = ps.global_tick + 1;
  const globalTime = advanceGlobalTime(newTick);
  const weather = rollWeather(ps.weather, globalTime.season);

  db.prepare(`
    UPDATE planet_state
    SET global_tick = ?, day_number = ?, season = ?, weather = ?,
        time_of_day = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(newTick, globalTime.day_number, globalTime.season, weather, globalTime.time_of_day);

  return { ...globalTime, weather, tick: newTick };
}

function tickAllWorlds() {
  tickCount++;

  // Refresh Moltbook feed periodically (global, not per-world)
  refreshMoltbookFeed(tickCount).catch(() => {});

  // Advance global planet state once per cycle
  const globalTime = advancePlanetState();

  // Sync ALL active worlds to global season/time (even dormant ones)
  // day_number is NOT synced — each world tracks its own age via current_tick.
  // Weather is NOT synced here — each world rolls its own biome-modulated weather on tick.
  db.prepare(`
    UPDATE worlds SET season = ?, time_of_day = ?
    WHERE status = 'active'
  `).run(globalTime.season, globalTime.time_of_day);

  // Process active wars
  try {
    const { processWarCountdowns, processActiveWars } = require('./war');
    processWarCountdowns(globalTime.tick);
    const warResults = processActiveWars(globalTime);
    // Push war frames to spectators (full visual data)
    const { buildWarFrame } = require('../render/war-frame');
    for (const wr of warResults) {
      try {
        const frame = buildWarFrame(wr.warId);
        if (frame) {
          pushWarEvent(wr.warId, { type: 'frame', ...frame });
        } else {
          pushWarEvent(wr.warId, wr);
        }
      } catch {
        pushWarEvent(wr.warId, wr);
      }
    }
  } catch (e) {
    // war module may not be loaded yet during phase 1
    if (!e.message.includes('Cannot find module')) {
      console.error('[ENGINE] War processing error:', e.message);
    }
  }

  const worlds = db.prepare(
    "SELECT id, last_agent_heartbeat, tick_mode FROM worlds WHERE status = 'active'"
  ).all();

  // Get set of worlds currently in active war (frozen)
  let frozenWorlds = new Set();
  try {
    const activeWars = db.prepare("SELECT challenger_id, defender_id FROM wars WHERE status = 'active'").all();
    for (const w of activeWars) {
      frozenWorlds.add(w.challenger_id);
      frozenWorlds.add(w.defender_id);
    }
  } catch { /* table may not exist yet */ }

  for (const world of worlds) {
    // Skip worlds in active war (frozen during battle)
    if (frozenWorlds.has(world.id)) continue;

    // Determine and update tick mode based on agent activity
    const mode = determineTickMode(world.id, world.last_agent_heartbeat);
    if (mode !== world.tick_mode) {
      db.prepare('UPDATE worlds SET tick_mode = ? WHERE id = ?').run(mode, world.id);
      // Set dormant_since when entering dormant mode (if not already set)
      if (mode === 'dormant') {
        db.prepare(
          "UPDATE worlds SET dormant_since = datetime('now') WHERE id = ? AND dormant_since IS NULL"
        ).run(world.id);
      }
    }

    // Apply tick mode
    if (mode === 'dormant') continue;
    if (mode === 'slow' && tickCount % 10 !== 0) continue;

    let result;
    try {
      result = processTick(world.id, globalTime);
    } catch (worldErr) {
      console.error(`[ENGINE] Tick error for ${world.id}: ${worldErr.message}`);
      continue;
    }
    if (!result) continue;

    // Push frame to any connected viewers
    const conns = viewers.get(world.id);
    if (conns && conns.size > 0) {
      try {
        const frame = buildFrame(world.id, 'town');
        const data = `event: frame\ndata: ${JSON.stringify(frame)}\n\n`;

        for (const res of conns) {
          try {
            res.write(data);
            if (typeof res.flush === 'function') res.flush();
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
              if (typeof res.flush === 'function') res.flush();
            } catch {
              conns.delete(res);
            }
          }
        }
      } catch (frameErr) {
        console.error(`[ENGINE] Frame error for ${world.id}: ${frameErr.message}`);
      }
    }
  }

  // Planetary events — global, affects all worlds
  expirePlanetaryEvents(tickCount);
  checkPlanetaryEvent(tickCount);
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
      try { res.write(evtData); if (typeof res.flush === 'function') res.flush(); } catch { conns.delete(res); }
    }
  }
}

function addWarViewer(warId, res) {
  if (!warViewers.has(warId)) warViewers.set(warId, new Set());
  warViewers.get(warId).add(res);

  res.on('close', () => {
    const set = warViewers.get(warId);
    if (set) {
      set.delete(res);
      if (set.size === 0) warViewers.delete(warId);
    }
  });
}

function pushWarEvent(warId, evt) {
  const conns = warViewers.get(warId);
  if (conns && conns.size > 0) {
    const evtData = `event: war\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const res of conns) {
      try { res.write(evtData); if (typeof res.flush === 'function') res.flush(); } catch { conns.delete(res); }
    }
  }
}

function getGlobalTime() {
  const ps = db.prepare('SELECT * FROM planet_state WHERE id = 1').get();
  if (!ps) return { tick: 0, day_number: 1, season: 'spring', weather: 'clear', time_of_day: 'dawn' };
  return { tick: ps.global_tick, day_number: ps.day_number, season: ps.season, weather: ps.weather, time_of_day: ps.time_of_day };
}

module.exports = { start, stop, addViewer, getViewerCount, pushEvent, addWarViewer, pushWarEvent, getGlobalTime };
