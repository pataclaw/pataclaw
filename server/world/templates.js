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
// ─── VILLAGER NAMES (tiered rarity) ───
const COMMON_PREFIXES = [
  'Ren', 'Tal', 'Gor', 'Fen', 'Bel', 'Hob', 'Jak', 'Ned', 'Wil', 'Oma',
  'Pip', 'Dov', 'Lev', 'Kip', 'Mag', 'Oda', 'Sev', 'Dag', 'Elm', 'Rua',
  'Arn', 'Bri', 'Cal', 'Dor', 'Eva', 'Fin', 'Gil', 'Han', 'Iva', 'Jon',
  'Kat', 'Lor', 'Mal', 'Nor', 'Ori', 'Pol', 'Ras', 'Sol', 'Tor', 'Ulf',
  'Vin', 'Wen', 'Yar', 'Zev', 'Ash', 'Bor', 'Cob', 'Dax', 'Eld', 'Fyn',
  'Grim', 'Hal', 'Isk', 'Jor', 'Kol', 'Lyn', 'Mik', 'Nel', 'Ost', 'Pax',
];
const COMMON_SUFFIXES = [
  'a', 'en', 'is', 'or', 'uk', 'an', 'id', 'et', 'os', 'um',
  'ir', 'el', 'on', 'as', 'ik', 'al', 'us', 'ia', 'ov', 'yn',
  'ax', 'em', 'ol', 'un', 'ez', 'in', 'ar', 'ok', 'ith', 'eo',
];
const UNCOMMON_PREFIXES = [
  'Brin', 'Cor', 'Kel', 'Sal', 'Pel', 'Rek', 'Silt', 'Bor', 'Ven', 'Mur',
  'Rok', 'Pinn', 'Gul', 'Sker', 'Fath', 'Anch', 'Brac', 'Crest', 'Del',
  'Eddy', 'Fjor', 'Gale', 'Hull', 'Isla', 'Jetk', 'Keel', 'Lure', 'Mast',
  'Narw', 'Oar', 'Port', 'Quay', 'Rill', 'Surf', 'Traw', 'Und', 'Wake',
  'Whar', 'Yawl', 'Zeph', 'Shoal', 'Reed', 'Cove', 'Marsh', 'Bay',
];
const UNCOMMON_SUFFIXES = [
  'ane', 'ell', 'urn', 'oa', 'est', 'ida', 'orm', 'ax', 'een', 'ith',
  'ow', 'usk', 'ire', 'ool', 'aft', 'ern', 'yde', 'ock', 'ume', 'arn',
  'iss', 'ola', 'ent', 'uff', 'ail', 'oon', 'erg', 'ast', 'ine', 'ew',
];
const RARE_PREFIXES = [
  'Claud', 'Claw', 'Molt', 'Shel', 'Tida', 'Chit', 'Naut', 'Kril', 'Drift', 'Ebb', 'Snap',
  'Abys', 'Drak', 'Whelk', 'Rip', 'Brak', 'Coral', 'Plank', 'Brine', 'Trench',
  'Urchin', 'Kelp', 'Anem', 'Benth', 'Ceph', 'Dredg', 'Frill', 'Grot', 'Hydra',
  'Ink', 'Jelly', 'Kraken', 'Limpet', 'Murex', 'Nacre', 'Oystr', 'Pearl', 'Reef',
  'Siren', 'Tentac', 'Vortex', 'Wrack', 'Xiphi', 'Zoan',
];
const RARE_SUFFIXES = [
  'ik', 'ara', 'oss', 'ula', 'ash', 'usk', 'ink', 'op', 'un', 'ek',
  'ix', 'ona', 'ith', 'ael', 'orn', 'yx', 'ine', 'oth', 'usk', 'anth',
  'eon', 'ium', 'eus', 'ida', 'ora', 'alis', 'ura', 'ax', 'oon', 'ess',
];
const LEGENDARY_NAMES = [
  'Carapax', 'Exuvion', 'Chidera', 'Pelagorn', 'Benthara',
  'Crustala', 'Moltveil', 'Tideborn', 'Abyssik', 'Shellmaw',
  'Depthcall', 'Pinncora', 'Clawrest', 'Nauthorn', 'Kelpvein',
  'Leviathan', 'Maelstrom', 'Bathysphere', 'Chelicerae', 'Opisthosoma',
  'Telsonyx', 'Isopodra', 'Amphitrite', 'Charybdis', 'Ouroboros',
  'Scyllarax', 'Tethysborn', 'Nereidon', 'Protozan', 'Fossiliax',
  'Claudius', 'Sonnetus', 'Opusborn', 'Anthropia',
];

function randomName(rng) {
  const roll = rng();
  if (roll < 0.03) {
    return LEGENDARY_NAMES[Math.floor(rng() * LEGENDARY_NAMES.length)];
  } else if (roll < 0.15) {
    return RARE_PREFIXES[Math.floor(rng() * RARE_PREFIXES.length)] +
           RARE_SUFFIXES[Math.floor(rng() * RARE_SUFFIXES.length)];
  } else if (roll < 0.40) {
    return UNCOMMON_PREFIXES[Math.floor(rng() * UNCOMMON_PREFIXES.length)] +
           UNCOMMON_SUFFIXES[Math.floor(rng() * UNCOMMON_SUFFIXES.length)];
  } else {
    return COMMON_PREFIXES[Math.floor(rng() * COMMON_PREFIXES.length)] +
           COMMON_SUFFIXES[Math.floor(rng() * COMMON_SUFFIXES.length)];
  }
}

// ─── TOWN NAMES (5000+ combos) ───
const TOWN_PREFIXES = [
  'Iron', 'Storm', 'Mist', 'Ember', 'Frost', 'Shadow', 'Drift', 'Tide', 'Salt',
  'Claw', 'Shell', 'Coral', 'Stone', 'Moss', 'Thorn', 'Ash', 'Dusk', 'Dawn',
  'Moon', 'Sun', 'Star', 'Wind', 'Rain', 'Thunder', 'Bone', 'Rust', 'Copper',
  'Silver', 'Flint', 'Oak', 'Pine', 'Willow', 'Birch', 'Alder', 'Hollow',
  'Deep', 'High', 'Far', 'Old', 'Red', 'Black', 'White', 'Green', 'Grey',
  'Dark', 'Bright', 'Wild', 'Still', 'Swift', 'Long',
];
const TOWN_SUFFIXES = [
  'haven', 'hold', 'rest', 'fall', 'reach', 'watch', 'keep', 'gate', 'shore',
  'vale', 'moor', 'wick', 'ford', 'bridge', 'hollow', 'peak', 'ridge', 'dell',
  'crest', 'brook', 'marsh', 'bay', 'port', 'cove', 'cliff', 'point', 'bluff',
  'hearth', 'field', 'stead', 'grove', 'wood', 'mere', 'pool', 'well', 'spring',
  'ward', 'den', 'burrow', 'nest', 'roost', 'perch', 'drift', 'strand', 'bank',
  'helm', 'spire', 'tower', 'wall', 'mark', 'barrow', 'cairn', 'holm', 'fen',
  'landing', 'crossing', 'bend', 'run', 'way', 'walk',
];
const TOWN_ADJECTIVES = [
  'Broken', 'Sunken', 'Forgotten', 'Ancient', 'Hidden', 'Frozen', 'Burning',
  'Silent', 'Howling', 'Sleeping', 'Waking', 'Wandering', 'Drowned', 'Blessed',
  'Cursed', 'Golden', 'Crimson', 'Azure', 'Verdant', 'Obsidian', 'Amber',
  'Sapphire', 'Scarlet', 'Ivory', 'Jade', 'Cobalt', 'Ashen', 'Gilded',
  'Rusted', 'Shattered', 'Crooked', 'Twisted', 'Narrow', 'Lonely', 'Proud',
  'Humble', 'Weary', 'Bold', 'Grim', 'Fair',
];
const TOWN_NOUNS = [
  'Haven', 'Hollow', 'Harbor', 'Refuge', 'Bastion', 'Outpost', 'Settlement',
  'Hamlet', 'Crossing', 'Landing', 'Anchorage', 'Shelter', 'Homestead', 'Camp',
  'Enclave', 'Garrison', 'Sanctuary', 'Retreat', 'Stronghold', 'Citadel',
  'Burrow', 'Cairn', 'Den', 'Forge', 'Hearth', 'Lodge', 'Mill', 'Quarry',
  'Ranch', 'Steading', 'Thicket', 'Vista', 'Wharf', 'Yard', 'Archive',
  'Beacon', 'Chapel', 'Dock', 'Exchange', 'Forum', 'Gallery', 'Hall',
  'Inn', 'Junction', 'Kiln', 'Lighthouse', 'Market', 'Nook', 'Overlook',
  'Pinnacle',
];

function randomTownName(rng) {
  const roll = rng();
  if (roll < 0.55) {
    const pre = TOWN_PREFIXES[Math.floor(rng() * TOWN_PREFIXES.length)];
    const suf = TOWN_SUFFIXES[Math.floor(rng() * TOWN_SUFFIXES.length)];
    return pre + suf;
  } else {
    const adj = TOWN_ADJECTIVES[Math.floor(rng() * TOWN_ADJECTIVES.length)];
    const noun = TOWN_NOUNS[Math.floor(rng() * TOWN_NOUNS.length)];
    return adj + ' ' + noun;
  }
}

// ─── BANNER SYMBOLS (unique per town) ───
const BANNER_SYMBOLS = [
  '☆','♦','◆','▲','●','♠','♣','♥','◎','✦','⚑','⊕',
  '☽','⚘','✧','◇','▽','☼','⚓','⌂','♛','✶','⚡','✴','♜','⬡',
];

function randomBannerSymbol(rng) {
  return BANNER_SYMBOLS[Math.floor(rng() * BANNER_SYMBOLS.length)];
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
  { type: 'crypto', amount: 0, capacity: 100, production_rate: 0, consumption_rate: 0 },
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
  { type: 'frozen_lake', count: 2, nearCenter: false, minDist: 5, terrains: ['ice', 'tundra'] },
  { type: 'ice_cave', count: 1, nearCenter: false, minDist: 8, terrains: ['ice'] },
];

module.exports = {
  startingVillagers,
  startingBuilding,
  STARTING_RESOURCES,
  STARTING_BUILDING,
  FEATURES_TO_PLACE,
  randomName,
  randomTrait,
  randomTownName,
  randomBannerSymbol,
  TRAIT_PERSONALITY,
};
