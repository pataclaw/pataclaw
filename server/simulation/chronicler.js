const db = require('../db/connection');

// ─── Book of Discoveries / Chronicler System ───
// One villager per town is the Chronicler. When they die, a new one is appointed.
// Entries are personality-flavored based on the chronicler's traits.

const MAX_ENTRIES = 50;
const RATE_LIMIT_TICKS = 36; // max 1 entry per 36 ticks

function getChronicler(worldId) {
  return db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND is_chronicler = 1 AND status = 'alive'"
  ).get(worldId);
}

function appointChronicler(worldId, previousName) {
  // Pick alive villager with highest creativity
  const candidate = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND status = 'alive' AND is_chronicler = 0 ORDER BY creativity DESC, experience DESC LIMIT 1"
  ).get(worldId);

  if (!candidate) return null;

  db.prepare("UPDATE villagers SET is_chronicler = 1 WHERE id = ?").run(candidate.id);

  // Write mourning entry if previous chronicler died
  if (previousName) {
    writeEntry(worldId, getCurrentTick(worldId), candidate.id, candidate.name, 'succession',
      `${candidate.name} takes up the quill`,
      flavorText(candidate, `The old chronicler ${previousName} is gone. I, ${candidate.name}, will carry the record forward. Their words remain; mine begin.`));
  }

  return candidate;
}

function getCurrentTick(worldId) {
  const w = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(worldId);
  return w ? w.current_tick : 0;
}

function canWrite(worldId, currentTick) {
  const last = db.prepare(
    'SELECT tick FROM discovery_book WHERE world_id = ? ORDER BY tick DESC LIMIT 1'
  ).get(worldId);
  if (!last) return true;
  return (currentTick - last.tick) >= RATE_LIMIT_TICKS;
}

function writeEntry(worldId, tick, chroniclerId, chroniclerName, entryType, title, body) {
  db.prepare(`
    INSERT INTO discovery_book (world_id, tick, chronicler_id, chronicler_name, entry_type, title, body)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(worldId, tick, chroniclerId, chroniclerName, entryType, title, body);

  // Prune old entries beyond MAX_ENTRIES
  const count = db.prepare('SELECT COUNT(*) as c FROM discovery_book WHERE world_id = ?').get(worldId).c;
  if (count > MAX_ENTRIES) {
    db.prepare(`
      DELETE FROM discovery_book WHERE id IN (
        SELECT id FROM discovery_book WHERE world_id = ? ORDER BY tick ASC LIMIT ?
      )
    `).run(worldId, count - MAX_ENTRIES);
  }
}

function flavorText(villager, baseText) {
  // Personality-based flavor
  if (!villager) return baseText;
  if (villager.creativity > 65) {
    // Poetic
    return baseText.replace(/\.$/, '') + ' — like waves upon the shore, ever-changing.';
  }
  if (villager.temperament < 35) {
    // Dramatic
    return baseText.replace(/\.$/, '') + '! The weight of it all bears down upon us!';
  }
  if (villager.sociability > 65) {
    // Community-focused ("we" language)
    return baseText.replace(/\bI\b/g, 'we').replace(/\bmy\b/g, 'our');
  }
  return baseText;
}

// Called from tick.js after events step
function processChronicler(worldId, tick, events) {
  const chroniclerEvents = [];

  // Ensure a chronicler exists
  let chronicler = getChronicler(worldId);
  if (!chronicler) {
    chronicler = appointChronicler(worldId, null);
    if (!chronicler) return chroniclerEvents; // no alive villagers
  }

  if (!canWrite(worldId, tick)) return chroniclerEvents;

  // Check for notable events to chronicle
  for (const evt of events) {
    if (!canWrite(worldId, tick)) break;

    let title = null;
    let body = null;
    let entryType = null;

    if (evt.type === 'death') {
      entryType = 'death';
      title = 'A soul departs';
      body = flavorText(chronicler, `${evt.title}. We mark their passing in these pages. The village grows quieter.`);
    } else if (evt.type === 'construction' && evt.severity === 'celebration') {
      entryType = 'construction';
      title = 'New walls rise';
      body = flavorText(chronicler, `${evt.title}. Another structure stands. The village grows.`);
    } else if (evt.type === 'project_complete') {
      entryType = 'project';
      title = 'A work completed';
      body = flavorText(chronicler, `${evt.title}. Art or craft, it matters not — we built something together.`);
    } else if (evt.type === 'raid' && evt.severity === 'celebration') {
      entryType = 'raid_survived';
      title = 'We endured the storm';
      body = flavorText(chronicler, `Raiders came. We stood firm. The walls held, and so did our resolve.`);
    } else if (evt.type === 'raid' && evt.severity === 'danger') {
      entryType = 'raid_damage';
      title = 'The raid leaves scars';
      body = flavorText(chronicler, `They broke through. Damage was done. We will rebuild — we always do.`);
    } else if (evt.type === 'exploration') {
      entryType = 'discovery';
      title = 'New lands revealed';
      body = flavorText(chronicler, `${evt.title}. The unknown shrinks. We press onward.`);
    } else if (evt.type === 'season') {
      entryType = 'season';
      title = evt.title;
      body = flavorText(chronicler, `The season turns. ${evt.description || ''}`);
    }

    if (title && body) {
      writeEntry(worldId, tick, chronicler.id, chronicler.name, entryType, title, body);
      chroniclerEvents.push({
        type: 'chronicle',
        title: `${chronicler.name} writes: "${title}"`,
        description: body.slice(0, 80),
        severity: 'info',
      });
      break; // Max 1 entry per tick cycle
    }
  }

  return chroniclerEvents;
}

function getBookEntries(worldId) {
  return db.prepare(
    'SELECT * FROM discovery_book WHERE world_id = ? ORDER BY tick DESC LIMIT ?'
  ).all(worldId, MAX_ENTRIES);
}

module.exports = { processChronicler, getChronicler, appointChronicler, getBookEntries, writeEntry };
