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

  // Monolith / Spire of Shells
  MONOLITH_SCAFFOLD_RATE: 5,
  MONOLITH_SCAFFOLD_COMPLETE: 100,
  MONOLITH_DECAY_INTERVAL: 72,
  MONOLITH_MAINTENANCE_INTERVAL: 36,
  MONOLITH_MAINTENANCE_WOOD: 1,
  MONOLITH_MAINTENANCE_STONE: 1,
  MONOLITH_LONGING_PENALTY: 1,

  // Chronicler
  CHRONICLER_RATE_LIMIT_TICKS: 36,
  CHRONICLER_MAX_ENTRIES: 50,

  // Molt Festival
  MOLT_FESTIVAL_INTERVAL: 360,
  MOLT_FESTIVAL_CULTURE_THRESHOLD: 100,
  MOLT_FESTIVAL_MORALE_BOOST: 15,
  MOLT_FESTIVAL_SCAFFOLD_BONUS: 25,

  // Villager Molting
  MOLT_INTERVAL: 80,
  MOLT_CHANCE: 0.05,
  MOLT_DURATION: 3,
  MOLT_STAT_BOOST: 2,
  MOLT_HP_BOOST: 5,

  // Prophets
  PROPHET_CHECK_INTERVAL: 36,
  PROPHET_CULTURE_THRESHOLD: 50,
  PROPHET_CHANCE_PER_PRIEST: 0.03,

  // Deep-Sea Exploration
  DEEP_SEA_CHECK_INTERVAL: 12,
  DEEP_SEA_CULTURE_THRESHOLD: 75,
  DEEP_SEA_MIN_FISHERMEN: 2,

  // Prophecy
  PROPHECY_CHANCE: 0.02,

  // Megastructures
  ARCHIVE_CULTURE_MULTIPLIER: 2,        // Shell Archive doubles relic culture bonus
  BEACON_SILENCE_REDUCTION: 20,         // Abyssal Beacon: silence chance drops from 40% to 20%
  CATHEDRAL_MOLT_BOOST_MULTIPLIER: 2,   // Molt Cathedral: 2x stat boost on molt completion
  CATHEDRAL_MOLT_DURATION_REDUCTION: 1, // Molt Cathedral: molt finishes 1 tick faster
  POOLS_BIRTH_RATE_BONUS: 0.015,        // Spawning Pools: +1.5% birth rate
  POOLS_STAT_BONUS: 3,                  // Spawning Pools: newborns get +3 to a random stat
};
