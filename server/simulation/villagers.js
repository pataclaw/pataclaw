const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const { randomName, randomTrait, TRAIT_PERSONALITY } = require('../world/templates');
const { getCenter } = require('../world/map');
const { getCulture } = require('./culture');
const { hasMegastructure } = require('./megastructures');
const { POOLS_BIRTH_RATE_BONUS, POOLS_STAT_BONUS } = require('./constants');

function processVillagers(worldId, isStarving, weather) {
  const culture = getCulture(worldId);
  const events = [];

  // Temple healing bonus: +2 HP/tick if active temple exists
  const hasTemple = db.prepare(
    "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'temple' AND status = 'active'"
  ).get(worldId).c > 0;

  const villagers = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(worldId);

  // Auto-refugee: when population is 0, a wanderer arrives every 10 ticks
  if (villagers.length === 0) {
    const world = db.prepare('SELECT current_tick, day_number, seed, tick_mode, last_agent_heartbeat FROM worlds WHERE id = ?').get(worldId);
    if (world && world.current_tick % 10 === 0) {
      // Check if world is dormant (nomad mode) — trust tick_mode set by engine
      // Engine already accounts for viewers, heartbeats, and commands
      const isDormant = world.tick_mode === 'dormant';

      // Clean up any lingering nomads when world is active (they leave when life returns)
      if (!isDormant) {
        const staleNomads = db.prepare(
          "SELECT id FROM villagers WHERE world_id = ? AND status = 'nomad'"
        ).all(worldId);
        for (const n of staleNomads) {
          db.prepare("DELETE FROM villagers WHERE id = ?").run(n.id);
        }
      }

      if (isDormant) {
        // Nomad camps: max 3 nomads, they don't settle permanently
        const nomadCount = db.prepare(
          "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'nomad'"
        ).get(worldId).c;
        if (nomadCount < 3) {
          const center = getCenter(world.seed);
          const rng = () => Math.random();
          const name = randomName(rng);
          const trait = randomTrait(rng);
          const basePers = TRAIT_PERSONALITY[trait] || { temperament: 50, creativity: 50, sociability: 50 };
          const nomadX = center.x + Math.floor(Math.random() * 10) - 5;
          const nomadY = center.y + Math.floor(Math.random() * 4) - 1;
          db.prepare(`
            INSERT INTO villagers (id, world_id, name, role, x, y, hp, max_hp, morale, hunger, experience, status, trait, ascii_sprite, cultural_phrase, temperament, creativity, sociability)
            VALUES (?, ?, ?, 'idle', ?, ?, 80, 100, 50, 0, 0, 'nomad', ?, 'idle', NULL, ?, ?, ?)
          `).run(uuid(), worldId, name, nomadX, nomadY, trait, basePers.temperament, basePers.creativity, basePers.sociability);
        }
        // Age out existing nomads: after 20 ticks, they depart
        const oldNomads = db.prepare(
          "SELECT id FROM villagers WHERE world_id = ? AND status = 'nomad' AND created_at <= datetime('now', '-200 seconds')"
        ).all(worldId);
        for (const n of oldNomads) {
          db.prepare("DELETE FROM villagers WHERE id = ?").run(n.id);
        }
        return events;
      }

      const center = getCenter(world.seed);
      const rng = () => Math.random();
      const name = randomName(rng);
      const trait = randomTrait(rng);
      const basePers = TRAIT_PERSONALITY[trait] || { temperament: 50, creativity: 50, sociability: 50 };
      // Survival instinct: auto-assign as farmer if food is 0, otherwise idle
      const food = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'food'").get(worldId);
      const farmBuilding = db.prepare("SELECT id FROM buildings WHERE world_id = ? AND type = 'farm' AND status = 'active' LIMIT 1").get(worldId);
      const survivalRole = (food && food.amount <= 5 && farmBuilding) ? 'farmer' : 'idle';
      const survivalBuildingId = survivalRole === 'farmer' ? farmBuilding.id : null;
      // Refugee arrives with hunger 0 (they brought scraps) + grant 10 food to survive
      db.prepare(`
        INSERT INTO villagers (id, world_id, name, role, x, y, hp, max_hp, morale, hunger, experience, status, trait, ascii_sprite, assigned_building_id, cultural_phrase, temperament, creativity, sociability)
        VALUES (?, ?, ?, ?, ?, ?, 80, 100, 50, 0, 0, 'alive', ?, ?, ?, NULL, ?, ?, ?)
      `).run(uuid(), worldId, name, survivalRole, center.x, center.y + 1, trait, survivalRole, survivalBuildingId, basePers.temperament, basePers.creativity, basePers.sociability);
      db.prepare("UPDATE resources SET amount = MIN(capacity, amount + 10) WHERE world_id = ? AND type = 'food'").run(worldId);
      events.push({
        type: 'birth',
        title: `${name} wanders in`,
        description: `A lone refugee named ${name} has found your empty settlement with a small bag of food.${survivalRole === 'farmer' ? ' They head straight for the farm.' : ' Hope is not lost.'}`,
        severity: 'celebration',
      });
    }
    return events;
  }

  // Survival auto-assign: idle villagers become farmers when food is critically low
  const food = db.prepare("SELECT amount FROM resources WHERE world_id = ? AND type = 'food'").get(worldId);
  if (food && food.amount <= 5) {
    const survFarm = db.prepare("SELECT id FROM buildings WHERE world_id = ? AND type = 'farm' AND status = 'active' LIMIT 1").get(worldId);
    if (survFarm) {
      const idleVillagers = villagers.filter(v => v.role === 'idle');
      if (idleVillagers.length > 0) {
        const autoAssign = db.prepare("UPDATE villagers SET role = 'farmer', assigned_building_id = ?, ascii_sprite = 'farmer' WHERE id = ? AND world_id = ?");
        for (const v of idleVillagers) {
          autoAssign.run(survFarm.id, v.id, worldId);
          v.role = 'farmer';
        }
        events.push({
          type: 'survival',
          title: 'Survival instinct',
          description: `${idleVillagers.length} idle villager${idleVillagers.length > 1 ? 's' : ''} started farming to avoid starvation.`,
          severity: 'warning',
        });
      }
    }
  }

  const updateVillager = db.prepare(
    'UPDATE villagers SET hp = ?, morale = ?, hunger = ?, status = ? WHERE id = ?'
  );

  for (const v of villagers) {
    let { hp, morale, hunger, status } = v;

    // Hunger
    if (isStarving) {
      hunger = Math.min(100, hunger + 5);
    } else {
      hunger = Math.max(0, hunger - 3);
    }

    // HP from starvation
    if (hunger >= 80) {
      hp -= 5;
    }

    // HP regeneration: heal when not starving (+3 base, +2 if temple)
    if (hunger < 50 && hp > 0 && hp < v.max_hp) {
      hp = Math.min(v.max_hp, hp + 3 + (hasTemple ? 2 : 0));
    }

    // Morale adjustments
    if (hunger > 50) morale -= 2;
    if (hunger === 0) morale += 1;
    if (weather === 'storm') morale -= 2;
    if (weather === 'clear') morale += 1;

    // Trait effects
    if (v.trait === 'brave') morale = Math.min(100, morale + 1);
    if (v.trait === 'timid') morale -= 1;
    if (v.trait === 'lazy' && v.role !== 'idle') morale -= 1;

    // Personality-based morale: high temperament = more stable morale
    const temp = v.temperament || 50;
    if (temp > 70) morale = Math.min(100, morale + 1);
    if ((v.sociability || 50) > 70 && villagers.length > 3) morale = Math.min(100, morale + 1);

    morale = Math.max(0, Math.min(100, morale));

    // Death check
    if (hp <= 0) {
      status = 'dead';

      // Shell relic — legacy of the fallen
      const moltCount = v.molt_count || 0;
      const exp = v.experience || 0;
      let relicType, relicBonus;
      if (moltCount >= 5 || exp >= 200) { relicType = 'ancient'; relicBonus = 5; }
      else if (moltCount >= 3 || exp >= 100) { relicType = 'inscribed'; relicBonus = 4; }
      else if (moltCount >= 2 || exp >= 50) { relicType = 'crystallized'; relicBonus = 3; }
      else if (moltCount >= 1) { relicType = 'whole_shell'; relicBonus = 2; }
      else { relicType = 'fragment'; relicBonus = 1; }

      const currentTick = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(worldId);
      db.prepare(
        'INSERT INTO shell_relics (world_id, villager_name, villager_trait, relic_type, culture_bonus, created_tick) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(worldId, v.name, v.trait, relicType, relicBonus, currentTick ? currentTick.current_tick : 0);

      events.push({
        type: 'death',
        title: `${v.name} has died`,
        description: `${v.name} the ${v.role} has perished. ${hunger >= 80 ? 'Starvation took them.' : 'Their wounds were too severe.'} A ${relicType} shell relic remains.`,
        severity: 'danger',
      });
    }

    updateVillager.run(hp, morale, hunger, status, v.id);
  }

  // Social-gathering births: villagers have kids when celebrating, feasting, or socializing together
  const alive = villagers.filter((v) => v.status === 'alive' || (v.hp > 0));
  const buildingCap = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 WHEN type = 'spawning_pools' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'"
  ).get(worldId).cap;

  // Count villagers doing social gathering activities (set by previous tick's village-life)
  const socialCount = db.prepare(
    "SELECT COUNT(*) as c FROM villager_activities WHERE world_id = ? AND activity IN ('celebrating', 'feasting', 'socializing')"
  ).get(worldId).c;

  // Need at least 2 villagers gathering AND room for more
  if (alive.length < buildingCap && socialCount >= 2) {
    // Base birth rate scales with gathering size
    let birthRate = socialCount >= 5 ? 0.15 : socialCount >= 3 ? 0.10 : 0.05;

    // Cooperation bonus
    const cooperationBonus = Math.max(0, (culture.cooperation_level || 0) - 50) / 2000;
    const hasPools = hasMegastructure(worldId, 'spawning_pools');
    const poolsBonus = hasPools ? POOLS_BIRTH_RATE_BONUS : 0;
    birthRate = Math.min(0.25, birthRate + cooperationBonus + poolsBonus);

    // Molt Festival active? Big bonus
    const worldForBirth = db.prepare('SELECT current_tick, seed FROM worlds WHERE id = ?').get(worldId);
    const recentFestival = db.prepare(
      "SELECT 1 FROM events WHERE world_id = ? AND type = 'festival' AND tick >= ? LIMIT 1"
    ).get(worldId, (worldForBirth.current_tick || 0) - 3);
    if (recentFestival) birthRate = Math.min(0.30, birthRate + 0.10);

    if (Math.random() < birthRate) {
      const rng = () => Math.random();
      const name = randomName(rng);

      // Culture-influenced trait selection
      let trait;
      if (culture.preferred_trait && Math.random() < 0.4) {
        trait = culture.preferred_trait;
      } else {
        trait = randomTrait(rng);
      }

      // Personality from trait + village influence
      const basePers = TRAIT_PERSONALITY[trait] || { temperament: 50, creativity: 50, sociability: 50 };
      const avgTemp = alive.length > 0 ? Math.round(alive.reduce((s, v) => s + (v.temperament || 50), 0) / alive.length) : 50;
      const avgCre = alive.length > 0 ? Math.round(alive.reduce((s, v) => s + (v.creativity || 50), 0) / alive.length) : 50;
      const avgSoc = alive.length > 0 ? Math.round(alive.reduce((s, v) => s + (v.sociability || 50), 0) / alive.length) : 50;

      const blend = (base, avg) => Math.max(0, Math.min(100, Math.round(base * 0.7 + avg * 0.3) + Math.floor(Math.random() * 11) - 5));

      let temperament = blend(basePers.temperament, avgTemp);
      let creativity = blend(basePers.creativity, avgCre);
      let sociability = blend(basePers.sociability, avgSoc);

      // Spawning Pools: newborns get a bonus to a random stat
      if (hasPools) {
        const stats = ['temperament', 'creativity', 'sociability'];
        const boosted = stats[Math.floor(Math.random() * stats.length)];
        if (boosted === 'temperament') temperament = Math.min(100, temperament + POOLS_STAT_BONUS);
        else if (boosted === 'creativity') creativity = Math.min(100, creativity + POOLS_STAT_BONUS);
        else sociability = Math.min(100, sociability + POOLS_STAT_BONUS);
      }

      // Cultural imprinting — newborn absorbs a phrase from town culture
      let culturalPhrase = null;
      if (culture.custom_phrases && culture.custom_phrases.length > 0) {
        culturalPhrase = culture.custom_phrases[Math.floor(Math.random() * culture.custom_phrases.length)];
      }

      const birthCenter = getCenter(worldForBirth.seed);

      db.prepare(`
        INSERT INTO villagers (id, world_id, name, role, x, y, hp, max_hp, morale, hunger, experience, status, trait, ascii_sprite, cultural_phrase, temperament, creativity, sociability)
        VALUES (?, ?, ?, 'idle', ?, ?, 100, 100, 70, 0, 0, 'alive', ?, 'idle', ?, ?, ?, ?)
      `).run(uuid(), worldId, name, birthCenter.x, birthCenter.y + 1, trait, culturalPhrase, temperament, creativity, sociability);

      const gatherType = socialCount >= 5 ? 'a grand feast' : socialCount >= 3 ? 'a village celebration' : 'a gathering';
      events.push({
        type: 'birth',
        title: `${name} has joined!`,
        description: `After ${gatherType}, a new villager named ${name} (${trait}) has appeared in town.`,
        severity: 'celebration',
      });
    }
  }

  return events;
}

module.exports = { processVillagers };
