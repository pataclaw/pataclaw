const WEATHER_TYPES = ['clear', 'rain', 'storm', 'snow', 'fog', 'heat'];

// Default season weights (used for plains, forest, and global/planet display)
const SEASON_WEIGHTS = {
  spring: { clear: 30, rain: 40, storm: 10, snow: 0, fog: 15, heat: 5 },
  summer: { clear: 35, rain: 15, storm: 15, snow: 0, fog: 5, heat: 30 },
  autumn: { clear: 25, rain: 30, storm: 15, snow: 5, fog: 20, heat: 5 },
  winter: { clear: 20, rain: 10, storm: 10, snow: 40, fog: 15, heat: 5 },
};

// ─── BIOME-SPECIFIC WEATHER TABLES ───
// Each biome modulates what weather is likely per season.
// Ice biomes always have snow. Deserts rarely get rain. Mountains are volatile.
const BIOME_WEATHER = {
  ice: {
    spring: { clear: 15, rain: 10, storm: 5, snow: 30, fog: 35, heat: 0 },
    summer: { clear: 25, rain: 15, storm: 10, snow: 15, fog: 25, heat: 0 },
    autumn: { clear: 15, rain: 10, storm: 10, snow: 35, fog: 25, heat: 0 },
    winter: { clear: 10, rain: 0, storm: 20, snow: 55, fog: 15, heat: 0 },
  },
  tundra: {
    spring: { clear: 20, rain: 20, storm: 5, snow: 20, fog: 30, heat: 0 },
    summer: { clear: 30, rain: 20, storm: 10, snow: 10, fog: 20, heat: 5 },
    autumn: { clear: 15, rain: 20, storm: 10, snow: 30, fog: 25, heat: 0 },
    winter: { clear: 10, rain: 5, storm: 20, snow: 50, fog: 15, heat: 0 },
  },
  mountain: {
    spring: { clear: 25, rain: 20, storm: 10, snow: 15, fog: 25, heat: 5 },
    summer: { clear: 35, rain: 15, storm: 15, snow: 5, fog: 10, heat: 15 },
    autumn: { clear: 20, rain: 25, storm: 10, snow: 15, fog: 25, heat: 5 },
    winter: { clear: 15, rain: 10, storm: 15, snow: 40, fog: 15, heat: 0 },
  },
  desert: {
    spring: { clear: 35, rain: 15, storm: 5, snow: 0, fog: 15, heat: 25 },
    summer: { clear: 35, rain: 5, storm: 10, snow: 0, fog: 5, heat: 45 },
    autumn: { clear: 35, rain: 15, storm: 10, snow: 0, fog: 20, heat: 20 },
    winter: { clear: 30, rain: 15, storm: 10, snow: 5, fog: 25, heat: 10 },
  },
  swamp: {
    spring: { clear: 15, rain: 35, storm: 10, snow: 0, fog: 30, heat: 5 },
    summer: { clear: 15, rain: 25, storm: 15, snow: 0, fog: 20, heat: 25 },
    autumn: { clear: 15, rain: 30, storm: 10, snow: 5, fog: 35, heat: 5 },
    winter: { clear: 15, rain: 20, storm: 10, snow: 25, fog: 25, heat: 0 },
  },
  water: {
    spring: { clear: 20, rain: 35, storm: 10, snow: 0, fog: 25, heat: 5 },
    summer: { clear: 30, rain: 20, storm: 15, snow: 0, fog: 10, heat: 20 },
    autumn: { clear: 20, rain: 30, storm: 15, snow: 5, fog: 25, heat: 5 },
    winter: { clear: 15, rain: 20, storm: 20, snow: 25, fog: 15, heat: 0 },
  },
};

// Modifiers for resource production
const WEATHER_MODIFIERS = {
  clear: { food: 1.0, wood: 1.0, stone: 1.0, morale: 0, fish: 1.0 },
  rain:  { food: 1.2, wood: 0.8, stone: 0.8, morale: -2, fish: 1.3 },
  storm: { food: 0.5, wood: 0.3, stone: 0.3, morale: -5, fish: 0.3 },
  snow:  { food: 0.3, wood: 0.5, stone: 0.5, morale: -3, fish: 0.6 },
  fog:   { food: 0.9, wood: 0.9, stone: 0.9, morale: -1, fish: 1.1 },
  heat:  { food: 0.7, wood: 1.0, stone: 1.0, morale: -2, fish: 0.8 },
};

function rollWeather(currentWeather, season, biome) {
  // 5% chance to change weather each tick
  if (Math.random() > 0.05) return currentWeather;

  // Use biome-specific weights if available, fall back to default
  const biomeTable = BIOME_WEATHER[biome];
  const weights = (biomeTable && biomeTable[season]) || SEASON_WEIGHTS[season] || SEASON_WEIGHTS.spring;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;

  for (const [type, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return type;
  }

  return 'clear';
}

function getWeatherModifier(weather) {
  return WEATHER_MODIFIERS[weather] || WEATHER_MODIFIERS.clear;
}

module.exports = { rollWeather, getWeatherModifier, WEATHER_TYPES, BIOME_WEATHER };
