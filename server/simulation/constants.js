// Central tuning constants for the Pataclaw simulation.
// All production rates, caps, and growth parameters live here.

module.exports = {
  // Resource production per worker per tick (base rates before modifiers)
  PRODUCTION: {
    farm_food: 0.8,
    dock_food: 0.6,
    workshop_wood: 0.25,
    workshop_stone: 0.15,
    temple_faith: 0.4,
    library_knowledge: 0.4,
  },

  // Consumption
  FOOD_PER_VILLAGER: 0.3,

  // Population
  BIRTH_RATE_BASE: 0.008,
  BIRTH_RATE_MAX: 0.02,
  BIRTH_MORALE_THRESHOLD: 65,

  // Resource caps
  STARTING_CAPACITY: 200,
  STOREHOUSE_CAPACITY_BONUS: 150,

  // Diminishing returns on stacking workers of same type
  // effective_production = base * N / (1 + N * DIMINISHING_FACTOR)
  // 1 worker = 0.87x, 4 workers = 2.5x total, 8 workers = 3.6x total
  DIMINISHING_FACTOR: 0.15,

  // Building progression
  MAX_BUILDING_LEVEL: 5,
};
