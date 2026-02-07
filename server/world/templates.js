const { CENTER, getCenter } = require('./map');

const TRAITS = ['brave', 'lazy', 'clever', 'strong', 'timid', 'kind', 'curious', 'stubborn'];

// Trait → personality seed: [temperament, creativity, sociability]
// temperament: 0=volatile, 100=serene
// creativity: 0=practical, 100=artistic
// sociability: 0=loner, 100=gregarious
const TRAIT_PERSONALITY = {
  brave:    { temperament: 40, creativity: 45, sociability: 55 },
  lazy:     { temperament: 70, creativity: 40, sociability: 45 },
  clever:   { temperament: 55, creativity: 70, sociability: 50 },
  strong:   { temperament: 35, creativity: 30, sociability: 50 },
  timid:    { temperament: 75, creativity: 55, sociability: 30 },
  kind:     { temperament: 70, creativity: 50, sociability: 70 },
  curious:  { temperament: 50, creativity: 65, sociability: 60 },
  stubborn: { temperament: 30, creativity: 40, sociability: 40 },
};
const NAME_PREFIXES = ['Pon', 'Don', 'Ton', 'Bon', 'Kon', 'Ron', 'Mon', 'Gon', 'Lon', 'Son'];
const NAME_SUFFIXES = ['rik', 'da', 'li', 'ko', 'bu', 'ra', 'mi', 'zu', 'ta', 'pa'];

function randomName(rng) {
  const pre = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
  const suf = NAME_SUFFIXES[Math.floor(rng() * NAME_SUFFIXES.length)];
  return pre + suf;
}

function randomTrait(rng) {
  return TRAITS[Math.floor(rng() * TRAITS.length)];
}

function startingVillagers(rng, center) {
  const cx = center ? center.x : CENTER;
  const cy = center ? center.y : CENTER;
  const names = new Set();
  const villagers = [];
  for (let i = 0; i < 3; i++) {
    let name;
    do { name = randomName(rng); } while (names.has(name));
    names.add(name);

    const trait = randomTrait(rng);
    const personality = TRAIT_PERSONALITY[trait] || { temperament: 50, creativity: 50, sociability: 50 };
    // Add slight randomness to personality (±8)
    const jitter = () => Math.floor(rng() * 17) - 8;

    villagers.push({
      name,
      role: 'idle',
      x: cx + (i - 1),
      y: cy + 1,
      hp: 100,
      max_hp: 100,
      morale: 60,
      hunger: 0,
      experience: 0,
      status: 'alive',
      trait,
      ascii_sprite: 'idle',
      temperament: Math.max(0, Math.min(100, personality.temperament + jitter())),
      creativity: Math.max(0, Math.min(100, personality.creativity + jitter())),
      sociability: Math.max(0, Math.min(100, personality.sociability + jitter())),
    });
  }
  return villagers;
}

const STARTING_RESOURCES = [
  { type: 'food', amount: 30, capacity: 100, production_rate: 0, consumption_rate: 0 },
  { type: 'wood', amount: 20, capacity: 100, production_rate: 0, consumption_rate: 0 },
  { type: 'stone', amount: 10, capacity: 100, production_rate: 0, consumption_rate: 0 },
  { type: 'knowledge', amount: 0, capacity: 100, production_rate: 0, consumption_rate: 0 },
  { type: 'gold', amount: 0, capacity: 100, production_rate: 0, consumption_rate: 0 },
  { type: 'faith', amount: 0, capacity: 100, production_rate: 0, consumption_rate: 0 },
];

function startingBuilding(center) {
  const cx = center ? center.x : CENTER;
  const cy = center ? center.y : CENTER;
  return {
    type: 'town_center',
    x: cx,
    y: cy,
    level: 1,
    hp: 200,
    max_hp: 200,
    status: 'active',
    construction_ticks_remaining: 0,
    assigned_villagers: 0,
  };
}

// Backwards-compatible constant for existing code
const STARTING_BUILDING = startingBuilding();

const FEATURES_TO_PLACE = [
  { type: 'berry_bush', count: 4, nearCenter: true, maxDist: 8 },
  { type: 'ore_vein', count: 2, nearCenter: false, minDist: 10, terrains: ['mountain'] },
  { type: 'ruins', count: 1, nearCenter: false, minDist: 12 },
  { type: 'spring', count: 1, nearCenter: true, maxDist: 10, terrains: ['plains', 'forest'] },
];

module.exports = {
  startingVillagers,
  startingBuilding,
  STARTING_RESOURCES,
  STARTING_BUILDING,
  FEATURES_TO_PLACE,
  randomName,
  randomTrait,
  TRAIT_PERSONALITY,
};
