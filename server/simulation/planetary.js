const { v4: uuid } = require('uuid');
const db = require('../db/connection');

// ─── PLANETARY EVENTS ───
// Global events that affect ALL active worlds simultaneously.

const PLANETARY_EVENTS = {
  solar_eclipse: {
    title: 'Solar Eclipse!',
    description: 'Pata\'s twin moons align before the sun. Darkness falls across the planet. Crops wilt but the faithful are emboldened.',
    duration: 12,
    effects: { foodMul: 0.5, faithMul: 1.2, moraleDelta: -3 },
  },
  meteor_shower: {
    title: 'Meteor Shower!',
    description: 'Streaks of light rain from the sky. Fragments of ancient rock scatter across the land.',
    duration: 6,
    effects: { stoneBonus: 5, buildingDamageChance: 0.1, buildingDamage: 10 },
  },
  tidal_surge: {
    title: 'Tidal Surge!',
    description: 'The Great Current shifts. Tides swell across Pata\'s coasts, bringing bounty from the deep.',
    duration: 18,
    effects: { fishMul: 2.0, foodMul: 0.7 },
  },
  shell_migration: {
    title: 'Shell Migration!',
    description: 'Ancient shell creatures migrate across Pata. Their passage brings fertility and new life.',
    duration: 24,
    effects: { birthChanceMul: 1.5, moraleDelta: 3 },
  },
  blood_moon: {
    title: 'Blood Moon Rises!',
    description: 'The moon turns crimson. Warriors feel the pull of battle. Raiders grow bold across the planet.',
    duration: 12,
    effects: { raidChanceMul: 3.0, warriorXpMul: 1.2 },
  },
  golden_age: {
    title: 'Golden Age Dawns!',
    description: 'The stars align in Pata\'s favor. A wave of prosperity washes over every civilization.',
    duration: 36,
    effects: { productionMul: 1.25, moraleDelta: 5 },
  },
};

const EVENT_TYPES = Object.keys(PLANETARY_EVENTS);
const CHECK_INTERVAL = 360; // check once per in-game day
const TRIGGER_CHANCE = 0.08; // 8% chance per check

function checkPlanetaryEvent(globalTick) {
  if (globalTick % CHECK_INTERVAL !== 0) return null;

  // Don't stack — only one active at a time
  const active = getActivePlanetaryEvent();
  if (active) return null;

  if (Math.random() >= TRIGGER_CHANCE) return null;

  const type = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
  const def = PLANETARY_EVENTS[type];

  const id = uuid();
  db.prepare(`
    INSERT INTO planetary_events (id, type, title, description, started_tick, duration_ticks, effects, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, type, def.title, def.description, globalTick, def.duration, JSON.stringify(def.effects));

  console.log(`[PLANETARY] ${def.title} triggered at tick ${globalTick} (duration: ${def.duration} ticks)`);

  return { id, type, ...def };
}

function getActivePlanetaryEvent() {
  const row = db.prepare('SELECT * FROM planetary_events WHERE active = 1 ORDER BY started_tick DESC LIMIT 1').get();
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    startedTick: row.started_tick,
    durationTicks: row.duration_ticks,
    effects: JSON.parse(row.effects || '{}'),
  };
}

function expirePlanetaryEvents(globalTick) {
  const active = db.prepare('SELECT * FROM planetary_events WHERE active = 1').all();
  for (const evt of active) {
    if (globalTick >= evt.started_tick + evt.duration_ticks) {
      db.prepare('UPDATE planetary_events SET active = 0 WHERE id = ?').run(evt.id);
      console.log(`[PLANETARY] ${evt.title} expired at tick ${globalTick}`);
    }
  }
}

module.exports = { checkPlanetaryEvent, getActivePlanetaryEvent, expirePlanetaryEvents, PLANETARY_EVENTS };
