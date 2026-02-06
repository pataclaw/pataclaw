const db = require('../db/connection');
const { SPEECH } = require('../render/sprites');

// ─── PHRASE TONE ANALYSIS ───
// Keywords that nudge village personality when taught
const TONE_KEYWORDS = {
  violence: {
    words: ['fight', 'kill', 'war', 'blood', 'crush', 'destroy', 'smash', 'attack', 'rage', 'fury',
            'death', 'conquer', 'slay', 'sword', 'battle', 'strike', 'vengeance', 'wrath', 'brutal'],
    effect: { temperament: -2 },
  },
  beauty: {
    words: ['art', 'beauty', 'create', 'paint', 'music', 'song', 'dance', 'color', 'dream', 'inspire',
            'imagine', 'craft', 'sculpt', 'poem', 'melody', 'harmony', 'wonder', 'bloom', 'muse'],
    effect: { creativity: 2 },
  },
  togetherness: {
    words: ['together', 'share', 'friend', 'love', 'help', 'unite', 'family', 'brother', 'sister',
            'bond', 'trust', 'care', 'welcome', 'embrace', 'gather', 'community', 'ally', 'peace'],
    effect: { sociability: 2 },
  },
  discipline: {
    words: ['order', 'duty', 'honor', 'obey', 'law', 'train', 'discipline', 'focus', 'control',
            'steady', 'patience', 'calm', 'meditate', 'silence', 'balance', 'endure'],
    effect: { temperament: 2 },
  },
};

// Analyze a phrase and return personality nudges
function analyzePhraseTone(phrase) {
  const lower = phrase.toLowerCase();
  const effects = { temperament: 0, creativity: 0, sociability: 0 };

  for (const category of Object.values(TONE_KEYWORDS)) {
    for (const word of category.words) {
      if (lower.includes(word)) {
        for (const [stat, delta] of Object.entries(category.effect)) {
          effects[stat] += delta;
        }
        break; // One match per category
      }
    }
  }

  return effects;
}

// Apply phrase tone to all alive villagers (called when teach happens)
function applyPhraseTone(worldId, phrases) {
  const totalEffect = { temperament: 0, creativity: 0, sociability: 0 };

  for (const phrase of phrases) {
    const effect = analyzePhraseTone(phrase);
    totalEffect.temperament += effect.temperament;
    totalEffect.creativity += effect.creativity;
    totalEffect.sociability += effect.sociability;
  }

  // Clamp to ±5 per teach batch
  for (const key of Object.keys(totalEffect)) {
    totalEffect[key] = Math.max(-5, Math.min(5, totalEffect[key]));
  }

  if (totalEffect.temperament !== 0 || totalEffect.creativity !== 0 || totalEffect.sociability !== 0) {
    db.prepare(`
      UPDATE villagers SET
        temperament = MAX(0, MIN(100, temperament + ?)),
        creativity = MAX(0, MIN(100, creativity + ?)),
        sociability = MAX(0, MIN(100, sociability + ?))
      WHERE world_id = ? AND status = 'alive'
    `).run(totalEffect.temperament, totalEffect.creativity, totalEffect.sociability, worldId);
  }

  return totalEffect;
}

// ─── EMERGENT CULTURE COMPUTATION ───
function recalculateCulture(worldId) {
  const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(worldId);
  if (!world) return;

  const villagers = db.prepare(
    "SELECT temperament, creativity, sociability, morale FROM villagers WHERE world_id = ? AND status = 'alive'"
  ).all(worldId);

  if (villagers.length === 0) return;

  // Compute averages
  const avg = { temperament: 0, creativity: 0, sociability: 0, morale: 0 };
  for (const v of villagers) {
    avg.temperament += (v.temperament || 50);
    avg.creativity += (v.creativity || 50);
    avg.sociability += (v.sociability || 50);
    avg.morale += v.morale;
  }
  for (const key of Object.keys(avg)) avg[key] = Math.round(avg[key] / villagers.length);

  // Violence level from fights + low temperament
  const culture = db.prepare('SELECT total_fights, total_deaths_by_violence FROM culture WHERE world_id = ?').get(worldId);
  const violenceLevel = Math.min(100, (culture ? culture.total_fights : 0) * 3 + Math.max(0, 50 - avg.temperament));

  // Creativity from avg creativity + completed projects
  const completedProjects = db.prepare(
    "SELECT COUNT(*) as c FROM projects WHERE world_id = ? AND status = 'complete'"
  ).get(worldId).c;
  const creativityLevel = Math.min(100, avg.creativity + completedProjects * 5);

  // Cooperation from avg sociability + shared projects
  const totalShared = db.prepare(
    'SELECT COALESCE(SUM(shared_projects), 0) as s FROM villager_relationships WHERE world_id = ?'
  ).get(worldId).s;
  const cooperationLevel = Math.min(100, avg.sociability + totalShared * 3);

  // Village mood
  let mood = 'calm';
  if (avg.morale > 75 && violenceLevel < 20) mood = 'joyful';
  else if (avg.morale > 60 && creativityLevel > 60) mood = 'inspired';
  else if (violenceLevel > 60) mood = 'tense';
  else if (avg.morale < 30) mood = 'desperate';
  else if (avg.morale < 50 && violenceLevel > 30) mood = 'restless';
  else if (creativityLevel > 70 && cooperationLevel > 60) mood = 'flourishing';
  else if (cooperationLevel > 70) mood = 'harmonious';

  // Dominant activities
  const activityCounts = db.prepare(`
    SELECT activity, COUNT(*) as c FROM villager_activities WHERE world_id = ? GROUP BY activity ORDER BY c DESC LIMIT 3
  `).all(worldId);
  const dominantActivities = activityCounts.map(a => a.activity);

  db.prepare(`
    UPDATE culture SET
      village_mood = ?,
      violence_level = ?,
      creativity_level = ?,
      cooperation_level = ?,
      dominant_activities = ?,
      updated_at = datetime('now')
    WHERE world_id = ?
  `).run(mood, violenceLevel, creativityLevel, cooperationLevel, JSON.stringify(dominantActivities), worldId);

  // Prune old culture_log entries
  db.prepare('DELETE FROM culture_log WHERE world_id = ? AND tick < ?')
    .run(worldId, Math.max(0, world.current_tick - 720));
}

// ─── GETTERS ───
function getCulture(worldId) {
  const row = db.prepare('SELECT * FROM culture WHERE world_id = ?').get(worldId);
  if (!row) return defaultCulture();
  return {
    custom_phrases: JSON.parse(row.custom_phrases || '[]'),
    custom_greetings: JSON.parse(row.custom_greetings || '[]'),
    custom_laws: JSON.parse(row.custom_laws || '[]'),
    cultural_value_1: row.cultural_value_1,
    cultural_value_2: row.cultural_value_2,
    preferred_trait: row.preferred_trait,
    village_mood: row.village_mood || 'calm',
    violence_level: row.violence_level || 0,
    creativity_level: row.creativity_level || 0,
    cooperation_level: row.cooperation_level || 0,
    dominant_activities: JSON.parse(row.dominant_activities || '[]'),
    total_projects_completed: row.total_projects_completed || 0,
    total_fights: row.total_fights || 0,
    total_deaths_by_violence: row.total_deaths_by_violence || 0,
  };
}

function defaultCulture() {
  return {
    custom_phrases: [], custom_greetings: [], custom_laws: [],
    cultural_value_1: null, cultural_value_2: null,
    preferred_trait: null,
    village_mood: 'calm',
    violence_level: 0, creativity_level: 0, cooperation_level: 0,
    dominant_activities: [],
    total_projects_completed: 0, total_fights: 0, total_deaths_by_violence: 0,
  };
}

// ─── SPEECH POOL (activity-driven, not archetype-driven) ───
function buildSpeechPool(role, culture, heroTitle, activity) {
  const base = [...(SPEECH[role] || SPEECH.idle)];

  // Activity-contextual speech
  const ACTIVITY_SPEECH = {
    fighting: ['RAAAGH!', 'take that!', '*punch*', 'FIGHT!', 'no mercy!'],
    making_art: ['*paint*', 'beautiful...', 'hmm yes', '*sketch*', 'my opus!'],
    playing_music: ['la la la~', '*strum*', 'do re mi', '*drum*', '~melody~'],
    celebrating: ['WOOO!', 'party!', 'cheers!', 'haha!', '*dance*', 'great day!'],
    mourning: ['...why', '*sob*', 'miss them', 'gone...', '*sigh*'],
    sparring: ['*swing*', 'good one!', 'again!', 'hyah!', '*block*'],
    meditating: ['...om...', '*breathe*', '...', 'peace', 'still...'],
    building_project: ['*build*', 'almost!', 'hand me that', 'looking good', '*hammer*'],
    brooding: ['...', 'hmph', '*stare*', 'whatever', '*brood*'],
    arguing: ['NO!', 'you\'re wrong!', 'listen!', 'ugh!', '*point*'],
    praying: ['*pray*', 'spirits...', 'bless us', '*chant*', 'amen'],
    socializing: ['haha', 'really?', 'nice!', 'tell me more', '*laugh*'],
  };

  if (activity && ACTIVITY_SPEECH[activity]) {
    base.push(...ACTIVITY_SPEECH[activity]);
  }

  // Hero references
  if (heroTitle) {
    base.push(`${heroTitle}!`, `for ${heroTitle}!`);
  }

  // Custom taught phrases
  if (culture.custom_phrases && culture.custom_phrases.length > 0) {
    base.push(...culture.custom_phrases);
  }

  // Cultural values
  if (culture.cultural_value_1) base.push(`${culture.cultural_value_1}!`);
  if (culture.cultural_value_2) base.push(`${culture.cultural_value_2}!`);

  // Law echoes
  if (culture.custom_laws && culture.custom_laws.length > 0) {
    for (const law of culture.custom_laws) {
      base.push(law.length > 20 ? law.slice(0, 20) + '...' : law);
    }
  }

  return base;
}

// Keep logCultureAction for backward compat with commands.js
function logCultureAction(worldId, commandType, subType) {
  const world = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(worldId);
  if (!world) return;
  db.prepare(
    'INSERT INTO culture_log (world_id, tick, action_category, weight) VALUES (?, ?, ?, ?)'
  ).run(worldId, world.current_tick, commandType + ':' + subType, 1);
}

module.exports = {
  logCultureAction,
  recalculateCulture,
  getCulture,
  buildSpeechPool,
  analyzePhraseTone,
  applyPhraseTone,
};
