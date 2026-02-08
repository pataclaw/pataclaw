const db = require('../db/connection');
const {
  DEEP_SEA_CHECK_INTERVAL,
  DEEP_SEA_CULTURE_THRESHOLD,
  DEEP_SEA_MIN_FISHERMEN,
  BEACON_SILENCE_REDUCTION,
} = require('./constants');
const { hasMegastructure } = require('./megastructures');

function processDeepSea(worldId, currentTick) {
  const events = [];

  if (currentTick % DEEP_SEA_CHECK_INTERVAL !== 0) return events;

  // Prerequisites: active dock
  const hasDock = db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'dock' AND status = 'active'"
  ).get(worldId).c > 0;
  if (!hasDock) return events;

  // 2+ fishermen
  const fishermen = db.prepare(
    "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'fisherman' AND status = 'alive'"
  ).get(worldId).c;
  if (fishermen < DEEP_SEA_MIN_FISHERMEN) return events;

  // Culture threshold
  const culture = db.prepare('SELECT violence_level, creativity_level, cooperation_level FROM culture WHERE world_id = ?').get(worldId);
  if (!culture) return events;
  const totalCulture = (culture.violence_level || 0) + (culture.creativity_level || 0) + (culture.cooperation_level || 0);
  if (totalCulture < DEEP_SEA_CULTURE_THRESHOLD) return events;

  // Abyssal Beacon: reduces silence chance from 40% to 20%, boosting all other outcomes
  const hasBeacon = hasMegastructure(worldId, 'abyssal_beacon');
  const silenceThreshold = hasBeacon ? (40 - BEACON_SILENCE_REDUCTION) : 40;

  // Weighted outcome roll
  const roll = Math.random() * 100;
  let outcome;

  if (roll < silenceThreshold) {
    // Silence (nothing found)
    outcome = {
      type: 'deep_sea',
      title: 'Deep-sea dive: silence',
      description: 'The fishermen descend into the abyss but find only darkness and cold water. The deep keeps its secrets.',
      severity: 'info',
    };
  } else if (roll < silenceThreshold + 20) {
    // Resources
    const cryptoGain = 8 + Math.floor(Math.random() * 8);
    const knowledgeGain = 3 + Math.floor(Math.random() * 5);
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'crypto'").run(cryptoGain, worldId);
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'knowledge'").run(knowledgeGain, worldId);
    outcome = {
      type: 'deep_sea',
      title: 'Deep-sea bounty!',
      description: `The divers surface with treasures from the deep. +${cryptoGain} crypto, +${knowledgeGain} knowledge.`,
      severity: 'celebration',
    };
  } else if (roll < silenceThreshold + 35) {
    // Ancient artifact
    const knowledgeGain = 8 + Math.floor(Math.random() * 5);
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'knowledge'").run(knowledgeGain, worldId);
    outcome = {
      type: 'deep_sea',
      title: 'Ancient artifact recovered!',
      description: `The divers found a relic from a forgotten civilization in the deep. +${knowledgeGain} knowledge.`,
      severity: 'celebration',
    };
  } else if (roll < silenceThreshold + 45) {
    // Leviathan sighting
    db.prepare("UPDATE villagers SET morale = MAX(0, morale - 8) WHERE world_id = ? AND status = 'alive'").run(worldId);
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 5) WHERE world_id = ? AND type = 'faith'").run(worldId);
    outcome = {
      type: 'deep_sea',
      title: 'Leviathan sighted!',
      description: 'The divers glimpse a massive creature in the depths. Terror grips the village, but faith deepens. -8 morale, +5 faith.',
      severity: 'danger',
    };
  } else if (roll < silenceThreshold + 55) {
    // Precursor ruin
    const cryptoGain = 12 + Math.floor(Math.random() * 8);
    const knowledgeGain = 8 + Math.floor(Math.random() * 5);
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'crypto'").run(cryptoGain, worldId);
    db.prepare("UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'knowledge'").run(knowledgeGain, worldId);
    outcome = {
      type: 'deep_sea',
      title: 'Precursor ruins discovered!',
      description: `An underwater city from before the Great Molt! +${cryptoGain} crypto, +${knowledgeGain} knowledge.`,
      severity: 'celebration',
    };
  } else {
    // 5% - Abyssal threat
    const dockDmg = 20;
    db.prepare("UPDATE buildings SET hp = MAX(0, hp - ?) WHERE world_id = ? AND type = 'dock' AND status = 'active'").run(dockDmg, worldId);
    outcome = {
      type: 'deep_sea',
      title: 'Abyssal threat!',
      description: `Something from the deep attacks the dock! -${dockDmg} HP to dock. The fishermen barely escape.`,
      severity: 'danger',
    };
  }

  // Track dive count
  db.prepare('UPDATE worlds SET deep_dives = deep_dives + 1 WHERE id = ?').run(worldId);

  events.push(outcome);
  return events;
}

module.exports = { processDeepSea };
