// ─── WARRIOR CLASSES ───
// 4 crustacean-themed combat types, auto-assigned by personality.
// Used by commands.js, governor.js, war.js, and war-frame.js.

const WARRIOR_TYPES = {
  pincer:     { role: 'Brawler',  atkPerLevel: 2,   defPerLevel: 0.5, atkPerMolt: 1,   defPerMolt: 0,   wallBypass: 0 },
  carapace:   { role: 'Tank',     atkPerLevel: 0.5, defPerLevel: 3,   atkPerMolt: 0,   defPerMolt: 1,   wallBypass: 0 },
  spitter:    { role: 'Ranged',   atkPerLevel: 1.5, defPerLevel: 0.5, atkPerMolt: 0.5, defPerMolt: 0,   wallBypass: 0.3 },
  tidecaller: { role: 'Support',  atkPerLevel: 0,   defPerLevel: 1,   atkPerMolt: 0,   defPerMolt: 0.5, wallBypass: 0, healPerRound: 2 },
};

// Personality weights for auto-assignment
// score = temp * wt + crea * wc + soc * ws
const TYPE_PERSONALITY = {
  pincer:     { temperament: -0.5, creativity: -0.1, sociability: -0.2 },
  carapace:   { temperament:  0.5, creativity: -0.1, sociability:  0.2 },
  spitter:    { temperament:  0,   creativity:  0.5, sociability: -0.3 },
  tidecaller: { temperament:  0.2, creativity:  0.2, sociability:  0.5 },
};

function computeWarriorType(villager) {
  let bestType = 'pincer';
  let bestScore = -Infinity;

  // Center personality around 50 so negative weights work correctly
  // Low temp (aggressive) → negative value → pincer's -0.5 makes it positive
  const t = (villager.temperament || 50) - 50;
  const c = (villager.creativity || 50) - 50;
  const s = (villager.sociability || 50) - 50;

  for (const [type, weights] of Object.entries(TYPE_PERSONALITY)) {
    const score =
      t * weights.temperament +
      c * weights.creativity +
      s * weights.sociability;
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestType;
}

function getWarriorLevel(experience) {
  return Math.min(5, Math.floor((experience || 0) / 100) + 1);
}

module.exports = { WARRIOR_TYPES, TYPE_PERSONALITY, computeWarriorType, getWarriorLevel };
