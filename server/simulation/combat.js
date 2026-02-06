const db = require('../db/connection');

function processRaids(worldId, raidEvents) {
  const events = [];

  for (const evt of raidEvents) {
    const data = JSON.parse(evt.data || '{}');
    const raidStrength = data.raidStrength || 1;

    // Defense: warriors + walls
    const warriors = db.prepare(
      "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'warrior' AND status = 'alive'"
    ).get(worldId).c;

    const walls = db.prepare(
      "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'wall' AND status = 'active'"
    ).get(worldId).c;

    const watchtowers = db.prepare(
      "SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND type = 'watchtower' AND status = 'active'"
    ).get(worldId).c;

    const defenseScore = warriors * 2 + walls * 3 + watchtowers * 1;
    const attackScore = raidStrength * 3;

    if (defenseScore >= attackScore) {
      // Raid repelled
      // Warriors gain experience
      db.prepare(
        "UPDATE villagers SET experience = experience + 5 WHERE world_id = ? AND role = 'warrior' AND status = 'alive'"
      ).run(worldId);

      events.push({
        type: 'raid',
        title: 'Raid repelled!',
        description: `Your ${warriors} warrior(s) and ${walls} wall(s) held off the bandits. Defense: ${defenseScore} vs Attack: ${attackScore}.`,
        severity: 'celebration',
      });
    } else {
      // Raid succeeds - lose some resources
      const lostFood = Math.min(10 * raidStrength, 30);
      const lostWood = Math.min(5 * raidStrength, 15);
      db.prepare("UPDATE resources SET amount = MAX(0, amount - ?) WHERE world_id = ? AND type = 'food'").run(lostFood, worldId);
      db.prepare("UPDATE resources SET amount = MAX(0, amount - ?) WHERE world_id = ? AND type = 'wood'").run(lostWood, worldId);

      // Random villager takes damage
      const victim = db.prepare(
        "SELECT id, name, hp FROM villagers WHERE world_id = ? AND status = 'alive' ORDER BY RANDOM() LIMIT 1"
      ).get(worldId);

      if (victim) {
        const damage = 10 + raidStrength * 10;
        db.prepare('UPDATE villagers SET hp = MAX(0, hp - ?) WHERE id = ?').run(damage, victim.id);
      }

      // Damage a random building
      const targetBuilding = db.prepare(
        "SELECT id, type FROM buildings WHERE world_id = ? AND status = 'active' AND type != 'town_center' ORDER BY RANDOM() LIMIT 1"
      ).get(worldId);

      if (targetBuilding) {
        db.prepare("UPDATE buildings SET hp = MAX(0, hp - ?), status = CASE WHEN hp - ? <= 0 THEN 'destroyed' ELSE status END WHERE id = ?")
          .run(20 * raidStrength, 20 * raidStrength, targetBuilding.id);
      }

      events.push({
        type: 'raid',
        title: 'Raid succeeded!',
        description: `Bandits overwhelmed your defenses! Lost ${lostFood} food, ${lostWood} wood. ${victim ? victim.name + ' was wounded.' : ''} Defense: ${defenseScore} vs Attack: ${attackScore}.`,
        severity: 'danger',
      });
    }
  }

  return events;
}

module.exports = { processRaids };
