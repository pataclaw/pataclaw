const db = require('../db/connection');
const { BIOME_DEFENSE_MULS } = require('../render/sprites');

// Raid type behavior modifiers
const RAID_CONFIG = {
  bandits: {
    attackMul: 1.0,       // standard attack multiplier
    foodLossMul: 1.0,     // resource theft
    woodLossMul: 1.0,
    vilDamageMul: 1.0,    // villager damage
    bldgDamageMul: 1.0,   // building damage
    lootCrypto: 5,        // crypto per strength on victory
    victoryFlavor: 'Your warriors drove the bandits back into the wilderness!',
    defeatFlavor: 'Bandits overwhelmed your defenses and pillaged your stores!',
  },
  wolves: {
    attackMul: 0.8,       // weaker overall attack
    foodLossMul: 0.3,     // wolves don't steal much
    woodLossMul: 0.0,     // wolves don't take wood
    vilDamageMul: 1.8,    // but savage against villagers
    bldgDamageMul: 0.2,   // don't damage buildings much
    lootCrypto: 2,
    victoryFlavor: 'The wolf pack was driven off! Pelts collected.',
    defeatFlavor: 'Wolves tore through the village! Several villagers were mauled.',
  },
  sea_raiders: {
    attackMul: 1.3,       // stronger than bandits
    foodLossMul: 1.5,     // steal lots of food (fish)
    woodLossMul: 0.5,
    vilDamageMul: 1.2,
    bldgDamageMul: 1.5,   // target the dock
    lootCrypto: 8,
    victoryFlavor: 'The sea raiders were repelled! Their abandoned ship yields treasure!',
    defeatFlavor: 'Sea raiders stormed the dock and plundered your supplies!',
  },
  marauders: {
    attackMul: 1.5,       // strongest
    foodLossMul: 1.2,
    woodLossMul: 1.5,     // steal building materials
    vilDamageMul: 1.3,
    bldgDamageMul: 2.0,   // siege weapons wreck buildings
    lootCrypto: 10,
    victoryFlavor: 'The marauder warband has been crushed! Their siege weapons are yours!',
    defeatFlavor: 'Marauders breached your walls and laid waste to the town!',
  },
};

function processRaids(worldId, raidEvents) {
  const events = [];

  for (const evt of raidEvents) {
    const data = JSON.parse(evt.data || '{}');
    const raidStrength = data.raidStrength || 1;
    const raidType = data.raidType || 'bandits';
    const config = RAID_CONFIG[raidType] || RAID_CONFIG.bandits;

    // Defense: warriors (stats matter) + walls (level matters) + watchtowers (level matters) + biome
    const warriors = db.prepare(
      "SELECT id, name, hp, experience, molt_count FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive'"
    ).all(worldId);

    const wallBuildings = db.prepare(
      "SELECT level FROM buildings WHERE world_id = ? AND type = 'wall' AND status = 'active'"
    ).all(worldId);

    const towerBuildings = db.prepare(
      "SELECT level FROM buildings WHERE world_id = ? AND type = 'watchtower' AND status = 'active'"
    ).all(worldId);

    // Biome defense multiplier
    const biomeRow = db.prepare(
      "SELECT terrain, COUNT(*) as c FROM tiles WHERE world_id = ? AND explored = 1 GROUP BY terrain ORDER BY c DESC LIMIT 1"
    ).get(worldId);
    const biomeMul = BIOME_DEFENSE_MULS[(biomeRow && biomeRow.terrain) || 'plains'] || 1.0;

    // Warrior power: base 2 + experience bonus + molt level bonus
    let warriorDefense = 0;
    for (const w of warriors) {
      warriorDefense += 2 + Math.floor((w.experience || 0) / 50) + (w.molt_count || 0);
    }

    // Wall defense: level * 3 per wall
    const wallDefense = wallBuildings.reduce((sum, w) => sum + w.level * 3, 0);

    // Watchtower defense: level * 1.5 per tower
    const towerDefense = towerBuildings.reduce((sum, t) => sum + Math.ceil(t.level * 1.5), 0);

    const defenseScore = Math.ceil((warriorDefense + wallDefense + towerDefense) * biomeMul);
    const attackScore = Math.ceil(raidStrength * 3 * config.attackMul);

    // Watchtower mitigation: each tower level reduces damage by 10% (max 60%)
    const totalTowerLevels = towerBuildings.reduce((sum, t) => sum + t.level, 0);
    const mitigationPct = Math.min(0.6, totalTowerLevels * 0.1);

    if (defenseScore >= attackScore) {
      // ── RAID REPELLED ──

      // Warriors gain experience
      db.prepare(
        "UPDATE villagers SET experience = experience + ? WHERE world_id = ? AND role = 'warrior' AND status = 'alive'"
      ).run(3 + raidStrength * 2, worldId);

      // Warriors take minor damage from the fight
      const warriorDmg = Math.ceil(raidStrength * 2 * (1 - mitigationPct));
      if (warriorDmg > 0 && warriors.length > 0) {
        db.prepare(
          "UPDATE villagers SET hp = MAX(1, hp - ?) WHERE world_id = ? AND role = 'warrior' AND status = 'alive'"
        ).run(warriorDmg, worldId);
      }

      // Victory loot: crypto proportional to strength
      const lootCrypto = config.lootCrypto * raidStrength;
      db.prepare(
        "UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = 'crypto'"
      ).run(lootCrypto, worldId);

      // Morale boost for victory
      db.prepare(
        "UPDATE villagers SET morale = MIN(100, morale + ?) WHERE world_id = ? AND status = 'alive'"
      ).run(3 + raidStrength, worldId);

      const raidLabel = raidType.replace('_', ' ');
      events.push({
        type: 'raid',
        title: `${raidLabel[0].toUpperCase() + raidLabel.slice(1)} repelled!`,
        description: `${config.victoryFlavor} Defense: ${defenseScore} vs Attack: ${attackScore}. +${lootCrypto} crypto looted.${warriorDmg > 0 ? ` Warriors took ${warriorDmg} damage each.` : ''}`,
        severity: 'celebration',
        data: JSON.stringify({ raidType, raidStrength, result: 'victory', lootCrypto }),
      });
    } else {
      // ── RAID SUCCEEDS ──

      // Resource losses (mitigated by watchtowers)
      const lossMul = 1 - mitigationPct;
      const lostFood = Math.ceil(Math.min(10 * raidStrength * config.foodLossMul, 40) * lossMul);
      const lostWood = Math.ceil(Math.min(5 * raidStrength * config.woodLossMul, 20) * lossMul);
      db.prepare("UPDATE resources SET amount = MAX(0, amount - ?) WHERE world_id = ? AND type = 'food'").run(lostFood, worldId);
      db.prepare("UPDATE resources SET amount = MAX(0, amount - ?) WHERE world_id = ? AND type = 'wood'").run(lostWood, worldId);

      // Villager damage (random victim)
      const victim = db.prepare(
        "SELECT id, name, hp FROM villagers WHERE world_id = ? AND status = 'alive' ORDER BY RANDOM() LIMIT 1"
      ).get(worldId);

      let woundMsg = '';
      if (victim) {
        const damage = Math.ceil((10 + raidStrength * 10) * config.vilDamageMul * lossMul);
        db.prepare('UPDATE villagers SET hp = MAX(0, hp - ?) WHERE id = ?').run(damage, victim.id);
        woundMsg = ` ${victim.name} took ${damage} damage.`;
      }

      // Warrior injuries (defenders take damage too)
      const defDmg = Math.ceil(raidStrength * 5 * (1 - mitigationPct));
      if (defDmg > 0 && warriors.length > 0) {
        db.prepare(
          "UPDATE villagers SET hp = MAX(0, hp - ?) WHERE world_id = ? AND role = 'warrior' AND status = 'alive'"
        ).run(defDmg, worldId);
      }

      // Building damage (farms are last resort — essential infrastructure)
      let targetBuilding = db.prepare(
        raidType === 'sea_raiders'
          ? "SELECT id, type, hp FROM buildings WHERE world_id = ? AND status = 'active' AND type = 'dock' ORDER BY RANDOM() LIMIT 1"
          : "SELECT id, type, hp FROM buildings WHERE world_id = ? AND status = 'active' AND type NOT IN ('town_center', 'farm') ORDER BY RANDOM() LIMIT 1"
      ).get(worldId);
      if (!targetBuilding && raidType !== 'sea_raiders') {
        targetBuilding = db.prepare("SELECT id, type, hp FROM buildings WHERE world_id = ? AND status = 'active' AND type = 'farm' ORDER BY RANDOM() LIMIT 1").get(worldId);
      }

      let bldgMsg = '';
      if (targetBuilding) {
        const bldgDmg = Math.ceil(20 * raidStrength * config.bldgDamageMul * lossMul);
        const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(worldId);
        db.prepare("UPDATE buildings SET hp = MAX(0, hp - ?), status = CASE WHEN hp - ? <= 0 THEN 'abandoned' ELSE status END, decay_tick = CASE WHEN hp - ? <= 0 THEN ? ELSE decay_tick END WHERE id = ?")
          .run(bldgDmg, bldgDmg, bldgDmg, world.current_tick, targetBuilding.id);
        if (targetBuilding.hp - bldgDmg <= 0) {
          // Unassign villagers from collapsed building
          db.prepare("UPDATE villagers SET role = 'idle', assigned_building_id = NULL, ascii_sprite = 'idle' WHERE assigned_building_id = ? AND world_id = ?").run(targetBuilding.id, worldId);
          bldgMsg = ` The ${targetBuilding.type} has collapsed!`;
        } else {
          bldgMsg = ` The ${targetBuilding.type} took ${bldgDmg} damage.`;
        }
      }

      // Morale penalty
      db.prepare(
        "UPDATE villagers SET morale = MAX(0, morale - ?) WHERE world_id = ? AND status = 'alive'"
      ).run(3 + raidStrength * 2, worldId);

      const raidLabel = raidType.replace('_', ' ');
      events.push({
        type: 'raid',
        title: `${raidLabel[0].toUpperCase() + raidLabel.slice(1)} overwhelmed defenses!`,
        description: `${config.defeatFlavor} Lost ${lostFood} food, ${lostWood} wood.${woundMsg}${bldgMsg} Defense: ${defenseScore} vs Attack: ${attackScore}.${mitigationPct > 0 ? ` Watchtowers reduced damage by ${Math.round(mitigationPct * 100)}%.` : ''}`,
        severity: 'danger',
        data: JSON.stringify({ raidType, raidStrength, result: 'defeat', lostFood, lostWood }),
      });
    }
  }

  return events;
}

module.exports = { processRaids };
