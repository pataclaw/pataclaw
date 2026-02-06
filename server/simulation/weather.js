const WEATHER_TYPES = ['clear', 'rain', 'storm', 'snow', 'fog', 'heat'];

const SEASON_WEIGHTS = {
  spring: { clear: 30, rain: 40, storm: 10, snow: 0, fog: 15, heat: 5 },
  summer: { clear: 35, rain: 15, storm: 15, snow: 0, fog: 5, heat: 30 },
  autumn: { clear: 25, rain: 30, storm: 15, snow: 5, fog: 20, heat: 5 },
  winter: { clear: 20, rain: 10, storm: 10, snow: 40, fog: 15, heat: 5 },
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

function rollWeather(currentWeather, season) {
  // 5% chance to change weather each tick
  if (Math.random() > 0.05) return currentWeather;

  const weights = SEASON_WEIGHTS[season] || SEASON_WEIGHTS.spring;
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

module.exports = { rollWeather, getWeatherModifier, WEATHER_TYPES };
