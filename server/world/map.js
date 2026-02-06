const MAP_SIZE = 40;
const CENTER = Math.floor(MAP_SIZE / 2);

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

function terrainFromNoise(value, distFromCenter) {
  // Force center to plains for the town
  if (distFromCenter < 4) return 'plains';

  if (value < 0.2) return 'water';
  if (value < 0.35) return 'swamp';
  if (value < 0.6) return 'plains';
  if (value < 0.75) return 'forest';
  if (value < 0.88) return 'mountain';
  return 'desert';
}

function generateTiles(seed) {
  const noise = createNoiseGenerator(seed);
  const tiles = [];

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const value = noise(x, y);
      const dx = x - CENTER;
      const dy = y - CENTER;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const explored = dist < 5 ? 1 : 0;

      tiles.push({
        x,
        y,
        terrain: terrainFromNoise(value, dist),
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
        terrain: terrainFromNoise(value, dist),
        elevation: Math.floor(value * 10),
        explored: 0,
        feature: null,
        feature_depleted: 0,
      });
    }
  }

  return tiles;
}

module.exports = { MAP_SIZE, CENTER, generateTiles, expandMap, mulberry32 };
