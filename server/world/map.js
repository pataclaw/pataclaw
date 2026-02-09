const MAP_SIZE = 40;
const CENTER = Math.floor(MAP_SIZE / 2);

// Seed-based center offset: town spawns at different positions per world
function getCenter(seed, mapSize) {
  mapSize = mapSize || MAP_SIZE;
  const half = Math.floor(mapSize / 2);
  const cx = half + ((seed % 11) - 5);
  const cy = half + (((seed >> 4) % 11) - 5);
  return { x: cx, y: cy };
}

// Simple seeded pseudo-random number generator
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── BIOME WEIGHT SYSTEM ───
// Each world's seed deterministically produces a unique biome blend.
// The power curve creates spiky distributions where 1-2 biomes dominate.

const BIOME_ORDER = ['water', 'swamp', 'plains', 'forest', 'mountain', 'desert'];
const BIOME_BASELINE = { water: 0.20, swamp: 0.15, plains: 0.25, forest: 0.15, mountain: 0.13, desert: 0.12 };
const BLEND_FACTOR = 0.6; // 60% weight-derived, 40% baseline

function deriveBiomeWeights(seed) {
  const rng = mulberry32(seed ^ 0xBEEFCAFE);
  const raw = [];
  for (let i = 0; i < 6; i++) raw.push(rng());

  // Power curve: amplifies dominant biomes, suppresses weak ones
  const powered = raw.map(v => Math.pow(v, 2.5));
  const total = powered.reduce((s, v) => s + v, 0);

  const weights = {};
  for (let i = 0; i < BIOME_ORDER.length; i++) {
    weights[BIOME_ORDER[i]] = powered[i] / total;
  }
  return weights;
}

function biomeThresholds(weights) {
  // Blend baseline with seed-derived weights
  const bands = {};
  let sum = 0;
  for (const b of BIOME_ORDER) {
    bands[b] = BIOME_BASELINE[b] * (1 - BLEND_FACTOR) + weights[b] * BLEND_FACTOR;
    sum += bands[b];
  }
  // Normalize and build cumulative thresholds
  let cumulative = 0;
  const thresholds = {};
  for (const b of BIOME_ORDER) {
    cumulative += bands[b] / sum;
    thresholds[b] = cumulative;
  }
  return thresholds;
}

function centerTerrain(thresholds) {
  // Find dominant non-water biome by largest band width
  let best = 'plains';
  let bestWidth = 0;
  let prev = thresholds.water;
  for (const b of BIOME_ORDER.slice(1)) { // skip water
    const width = thresholds[b] - prev;
    if (width > bestWidth) { bestWidth = width; best = b; }
    prev = thresholds[b];
  }
  return best;
}

// Simple 2D noise using value noise with interpolation
function createNoiseGenerator(seed) {
  const rng = mulberry32(seed);
  const grid = [];
  const GRID_SIZE = 8;

  for (let i = 0; i <= GRID_SIZE; i++) {
    grid[i] = [];
    for (let j = 0; j <= GRID_SIZE; j++) {
      grid[i][j] = rng();
    }
  }

  function lerp(a, b, t) {
    return a + t * (b - a);
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  return function noise(x, y) {
    const sx = (x / MAP_SIZE) * GRID_SIZE;
    const sy = (y / MAP_SIZE) * GRID_SIZE;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    const fx = smoothstep(sx - ix);
    const fy = smoothstep(sy - iy);

    const a = lerp(grid[ix][iy], grid[ix + 1] ? grid[ix + 1][iy] : grid[ix][iy], fx);
    const b = lerp(
      grid[ix][iy + 1] !== undefined ? grid[ix][iy + 1] : grid[ix][iy],
      grid[ix + 1] && grid[ix + 1][iy + 1] !== undefined ? grid[ix + 1][iy + 1] : grid[ix][iy],
      fx
    );

    return lerp(a, b, fy);
  };
}

function terrainFromNoise(value, distFromCenter, y, mapSize, thresholds) {
  // Center spawn area: biome-appropriate land (never water)
  if (distFromCenter < 3) {
    return thresholds ? centerTerrain(thresholds) : 'plains';
  }
  // Transition ring: 50% center terrain, 50% natural
  if (distFromCenter < 5 && thresholds) {
    // Use noise to decide: low noise = center terrain, high noise = natural
    if (value < 0.5) return centerTerrain(thresholds);
  }

  // Ice/tundra polar zone (top rows)
  if (mapSize && y < mapSize * 0.18) {
    if (value < 0.15) return 'water';
    if (value < 0.45) return 'tundra';
    return 'ice';
  }

  // Weight-shifted terrain classification
  if (thresholds) {
    if (value < thresholds.water) return 'water';
    if (value < thresholds.swamp) return 'swamp';
    if (value < thresholds.plains) return 'plains';
    if (value < thresholds.forest) return 'forest';
    if (value < thresholds.mountain) return 'mountain';
    return 'desert';
  }

  // Legacy fallback (no thresholds passed)
  if (value < 0.2) return 'water';
  if (value < 0.35) return 'swamp';
  if (value < 0.6) return 'plains';
  if (value < 0.75) return 'forest';
  if (value < 0.88) return 'mountain';
  return 'desert';
}

function generateTiles(seed, center) {
  const noise = createNoiseGenerator(seed);
  const weights = deriveBiomeWeights(seed);
  const thresholds = biomeThresholds(weights);
  const cx = center ? center.x : CENTER;
  const cy = center ? center.y : CENTER;
  const tiles = [];

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const value = noise(x, y);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const explored = dist < 5 ? 1 : 0;

      tiles.push({
        x,
        y,
        terrain: terrainFromNoise(value, dist, y, MAP_SIZE, thresholds),
        elevation: Math.floor(value * 10),
        explored,
        feature: null,
        feature_depleted: 0,
      });
    }
  }

  return tiles;
}

// Expand map to a larger size — generates only NEW tiles
function expandMap(worldId, seed, oldSize, newSize) {
  const rng = mulberry32(seed * 7 + 31); // offset seed for expansion terrain
  const weights = deriveBiomeWeights(seed);
  const thresholds = biomeThresholds(weights);
  const tiles = [];

  for (let y = 0; y < newSize; y++) {
    for (let x = 0; x < newSize; x++) {
      // Skip tiles that already exist in the old map
      if (x < oldSize && y < oldSize) continue;

      // Hash-based terrain: deterministic per (seed, x, y)
      const h = mulberry32(seed ^ (x * 73856093) ^ (y * 19349663));
      const value = h();
      const cx = Math.floor(newSize / 2);
      const cy = Math.floor(newSize / 2);
      const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));

      tiles.push({
        x,
        y,
        terrain: terrainFromNoise(value, dist, y, newSize, thresholds),
        elevation: Math.floor(value * 10),
        explored: 0,
        feature: null,
        feature_depleted: 0,
      });
    }
  }

  return tiles;
}

module.exports = { MAP_SIZE, CENTER, getCenter, generateTiles, expandMap, mulberry32, deriveBiomeWeights, biomeThresholds };
