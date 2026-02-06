// Time system: 6 ticks per day phase, 6 phases per day = 36 ticks/day
// 90 days per season, 4 seasons per year

const DAY_PHASES = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const TICKS_PER_PHASE = 6;
const PHASES_PER_DAY = DAY_PHASES.length;
const TICKS_PER_DAY = TICKS_PER_PHASE * PHASES_PER_DAY; // 36
const DAYS_PER_SEASON = 90;

function advanceTime(world) {
  const tick = world.current_tick + 1;
  const phaseIndex = Math.floor((tick % TICKS_PER_DAY) / TICKS_PER_PHASE);
  const time_of_day = DAY_PHASES[phaseIndex];
  const day_number = Math.floor(tick / TICKS_PER_DAY) + 1;
  const seasonIndex = Math.floor(((day_number - 1) % (DAYS_PER_SEASON * 4)) / DAYS_PER_SEASON);
  const season = SEASONS[seasonIndex];

  return { tick, time_of_day, day_number, season };
}

function isNight(time_of_day) {
  return time_of_day === 'night' || time_of_day === 'dusk';
}

module.exports = { advanceTime, isNight, DAY_PHASES, SEASONS, TICKS_PER_DAY, DAYS_PER_SEASON };
