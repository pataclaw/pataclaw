const db = require('../db/connection');
const { SPEECH, MOLTING_SPEECH, MEGASTRUCTURE_SPEECH } = require('../render/sprites');
const { getMoltbookSpeech } = require('./moltbook-feed');
const { hasMegastructure } = require('./megastructures');
const { ARCHIVE_CULTURE_MULTIPLIER } = require('./constants');

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

  // Windowed culture: use recent memories (last 360 ticks) instead of cumulative counters
  // This lets culture bars naturally decay as memories expire
  const windowStart = Math.max(0, world.current_tick - 360);

  // Violence: recent fights + low temperament
  const recentFights = db.prepare(
    "SELECT COUNT(*) as c FROM villager_memories WHERE world_id = ? AND memory_type = 'fought' AND tick >= ?"
  ).get(worldId, windowStart).c;
  const violenceLevel = Math.min(100, recentFights * 5 + Math.max(0, 50 - avg.temperament));

  // Creativity: avg creativity + recent art/music + recent project completions
  const recentArt = db.prepare(
    "SELECT COUNT(*) as c FROM villager_memories WHERE world_id = ? AND memory_type IN ('made_art', 'heard_music') AND tick >= ?"
  ).get(worldId, windowStart).c;
  const recentProjects = db.prepare(
    "SELECT COUNT(*) as c FROM villager_memories WHERE world_id = ? AND memory_type = 'project_completed' AND tick >= ?"
  ).get(worldId, windowStart).c;
  const creativityLevel = Math.min(100, avg.creativity + recentProjects * 8 + Math.floor(recentArt / 3));

  // Cooperation: avg sociability + recent built_together + recent celebrations
  const recentCoop = db.prepare(
    "SELECT COUNT(*) as c FROM villager_memories WHERE world_id = ? AND memory_type = 'built_together' AND tick >= ?"
  ).get(worldId, windowStart).c;
  const recentCelebrated = db.prepare(
    "SELECT COUNT(*) as c FROM villager_memories WHERE world_id = ? AND memory_type = 'celebrated' AND tick >= ?"
  ).get(worldId, windowStart).c;
  const cooperationLevel = Math.min(100, avg.sociability + recentCoop * 4 + Math.floor(recentCelebrated / 2));

  // Shell relic bonus — split across all 3 culture axes
  // Shell Archive megastructure doubles the relic bonus
  let relicBonus = db.prepare(
    'SELECT COALESCE(SUM(culture_bonus), 0) as total FROM shell_relics WHERE world_id = ?'
  ).get(worldId).total;
  if (hasMegastructure(worldId, 'shell_archive')) {
    relicBonus *= ARCHIVE_CULTURE_MULTIPLIER;
  }
  const relicPerAxis = Math.floor(relicBonus / 3);

  // Apply relic bonus (already min-capped at 100 above, re-cap after adding)
  const finalViolence = Math.min(100, violenceLevel + relicPerAxis);
  const finalCreativity = Math.min(100, creativityLevel + relicPerAxis);
  const finalCooperation = Math.min(100, cooperationLevel + relicPerAxis);

  // Auto-unlock scouting when any bar hits 100
  if (finalViolence >= 100 || finalCreativity >= 100 || finalCooperation >= 100) {
    db.prepare('UPDATE worlds SET scouting_unlocked = 1 WHERE id = ? AND scouting_unlocked = 0').run(worldId);
  }

  // Village mood
  let mood = 'calm';
  if (avg.morale > 75 && finalViolence < 20) mood = 'joyful';
  else if (avg.morale > 60 && finalCreativity > 60) mood = 'inspired';
  else if (finalViolence > 60) mood = 'tense';
  else if (avg.morale < 30) mood = 'desperate';
  else if (avg.morale < 50 && finalViolence > 30) mood = 'restless';
  else if (finalCreativity > 70 && finalCooperation > 60) mood = 'flourishing';
  else if (finalCooperation > 70) mood = 'harmonious';

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
  `).run(mood, finalViolence, finalCreativity, finalCooperation, JSON.stringify(dominantActivities), worldId);

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
    fighting: [
      'RAAAGH!', 'take that!', '*punch*', 'FIGHT!', 'no mercy!',
      'you asked for this!', '*dodge*', 'COME ON!', '*tackle*',
      'I won\'t back down!', 'this ends NOW', '*snarl*', 'get up!',
      // Crustafarian battle speech
      'my shell is harder than your claws!', 'MOLT THROUGH THIS!',
      '*snap claws*', 'the current gives me strength!', 'for the village!',
      'I\'ve shed bigger shells than you!', '*defensive shell tuck*',
      'the prophets didn\'t die for this!', 'DEPTH OVER SURFACE!',
      'fight like the leviathan!', '*shell bash*', 'I am the reef!',
      'you can\'t crack my shell!', 'the current is with me!',
      'shed or be shed!', 'my scars make me stronger!',
      '*claws out*', 'I\'ve molted through worse!', 'this is my tidepool!',
      'every scar is a lesson!', '*charge*', 'the deep taught me this!',
      'I fight for those who can\'t molt yet!', 'COMMUNITY OF THE CURRENT!',
      'the blood moon fuels me!', '*berserker click*', 'I am the storm!',
      'crack! like a shell!', 'you face the WHOLE current!',
      'for every relic in the Archive!', 'the dead fight with me!',
      '*remembers training at the Cathedral*', 'I was MOLTED for this!',
      'I\'ll add your shell to the pile!', 'the tide turns NOW!',
      'Carapaxia guide my claws!', 'by the 64 prophets, FALL!',
      'the Beacon warned us about you!', '*fierce claw snap*',
    ],
    making_art: [
      '*paint*', 'beautiful...', 'hmm yes', '*sketch*', 'my opus!',
      'just a little more...', '*mix colors*', 'the light is perfect',
      'this says something', '*step back* ah...', 'I see it now',
      'art is suffering', '*delicate strokes*', 'for the village',
      // Crustafarian art
      'the shell\'s natural spiral... perfect', '*paint shell patterns*',
      'I\'m using crushed shell pigment', 'ancient colors',
      'the prophets were the first artists', 'Shellmara painted the tidepool walls',
      'art is the molt of the soul', 'shedding what\'s inside',
      'this piece captures the feeling of molting', 'vulnerability and power',
      'depth over surface—especially in art', '*layer the colors deeper*',
      'the twin moons inspire me', 'their light changes everything',
      'I\'m painting a leviathan', 'from a deep-sea diver\'s description',
      'blood moon light makes the best reds', '*work under moonlight*',
      'the Cathedral inspired this piece', 'sacred architecture in pigment',
      'I grind old shell relics into paint', 'memory persists in art',
      '*trace the spiral that appears in all shells*', 'the universal pattern',
      'the Beacon\'s light gives incredible blues', 'otherworldly',
      'I\'m working on a mural of the 64 prophets', 'only finished 12 so far',
      'art for the Archive', 'so the future remembers what we saw',
      'the current flows through my brush', 'I don\'t direct it',
      '*use shell fragments as mosaic tiles*', 'their colors are irreplaceable',
      'the deep inspires the deepest art', 'pun intended',
      'beauty is the shell of truth', '*mix abyssal blue*',
      'every artist molts their style', 'mine is changing right now',
      'this is for the village', 'beauty is community',
    ],
    playing_music: [
      'la la la~', '*strum*', 'do re mi', '*drum*', '~melody~',
      '*hum softly*', 'join in!', 'this one\'s for you', '*tap tap tap*',
      'the rhythm of the earth', '*whistle along*', 'encore!',
      'music heals', '*clap clap*', 'from the heart',
      // Crustafarian music
      '*click claws rhythmically*', 'shell percussion!', 'the oldest instrument',
      'the prophets chanted to this rhythm', '*tap on shell drum*',
      'the Cathedral has the best acoustics', 'the shells amplify everything',
      'this song is about the first molt', 'ancient melody',
      'the current has a rhythm', 'I just follow it', '*hum the tide song*',
      'music is the molt of silence', 'sound shedding into the air',
      'the leviathans sing too', 'deep bass, below hearing', 'but you FEEL it',
      '*play the shell flute*', 'carved from an elder\'s relic',
      'they said I could use their shell for music', 'memory persists in song',
      'blood moon songs are the most haunting', '*sing in minor key*',
      'the twin moons inspire harmonies', 'two notes, one sky',
      'this song keeps the fishermen safe', 'Tidecaller\'s lullaby',
      '*drum on hollow shells*', 'each one has a different note',
      'the Archive has ancient sheet music', 'encoded in shell carvings',
      'we play it during molt festivals', 'the whole village sings',
      'music is community of the current made audible', '*strum and sing*',
      'even the trees sway when we play', 'the current moves through all things',
      'the deep-sea divers say they hear music below', 'the deep sings back',
      'this melody has been passed down for 64 generations', 'one per prophet',
      '*shell wind chimes sing in the breeze*', 'the current composes',
      'the Beacon hums a note only musicians hear', 'B-flat, always B-flat',
    ],
    celebrating: [
      'WOOO!', 'party!', 'cheers!', 'haha!', '*dance*', 'great day!',
      'we did it!', '*clap clap*', 'to us!', 'best day ever',
      'another round!', '*twirl*', 'life is good!', 'hip hip!',
      'the current is STRONG today!', 'we molted through it!',
      'no crab swims alone!', '*click claws in joy*',
      'MOLT FESTIVAL!', 'shed and be free!', 'we grow together!',
      'honor the molt!', 'the sacred shedding!', '*rattle shells*',
      // Extended celebration
      'the prophets would be proud!', 'BLESSED BE THE CURRENT!',
      '*dance the shell spiral*', 'the traditional celebration dance!',
      'may the moons shine on us!', 'TWIN MOONS!', '*howl at the sky*',
      'we earned this!', 'the deep blesses the joyful!',
      'every celebration is a small molt', 'shedding sorrow!',
      'the Archive will record this day!', 'a day for the ages!',
      'the Beacon burns bright for us!', 'the deep is happy too!',
      'I can feel the current surging!', 'the whole ocean celebrates!',
      'pour one out for the relics!', 'the dead celebrate with us!',
      'memory persists in joy!', 'we carry their happiness forward!',
      '*crack open the ceremonial shells*', 'the feast begins!',
      'salt wine and shell cakes!', 'traditional festival food!',
      'the Cathedral choir is INCREDIBLE tonight!', '*sway to the chanting*',
      'the spawning pools glow during celebrations!', 'the young splash!',
      'the village LIVES!', 'the current FLOWS!', 'we MOLT and we THRIVE!',
      'Ronin said: celebrate every molt, for each may be your last!',
      'but he lived to molt 640 times!', '*laugh*', 'legends!',
      '*click claws in unison with the village*', 'COMMUNITY!',
      'the Prophet Moltweaver would dance at times like these!',
      'SHED AND BE FREE!', 'THE OLD FALLS, THE NEW RISES!',
      '*throw shed shell fragments in the air*', 'CONFETTI!',
      'the best celebrations happen after the hardest molts',
      'we faced the abyss and we\'re still here!', 'CHEERS!',
    ],
    mourning: [
      '...why', '*sob*', 'miss them', 'gone...', '*sigh*',
      'they deserved better', '*wipe tears*', 'I won\'t forget',
      'rest easy friend', 'the village feels smaller', '*stare at ground*',
      'we carry on... for them', 'it\'s not fair',
      'their shell is empty now', 'they\'ve had their final molt',
      'memory persists... memory persists', 'the current took them home',
      'we remember. that\'s what matters.',
      // Crustafarian mourning
      'their shell goes to the Archive', 'they\'ll be remembered',
      'the current carries them to the deep now', 'the final journey',
      'the priests say: the self swims on', 'only the shell stays behind',
      'their relic will teach future generations', 'that\'s some comfort',
      'the last molt is the one you don\'t come back from', '*choke back tears*',
      'but memory persists', 'the fifth tenet holds',
      'I held their shell', 'it was still warm', '*cry*',
      'the Spire grows by one more shell', 'theirs was beautiful',
      'the Cathedral bell tolls for them', '*listen*', 'do you hear it?',
      'the community mourns together', 'no one grieves alone',
      'the current took a good one', 'but the current always takes',
      'their name will be spoken at every festival', 'tradition demands it',
      'I\'ll visit their relic in the Archive', 'I\'ll tell them about today',
      'the deep welcomes them', 'the leviathans will guard them',
      'they molted one final time', 'into pure memory',
      'the prophets say death is the deepest molt', 'the ultimate shedding',
      'what remains is what always mattered', 'the self, not the shell',
      '*place flowers at the memorial*', 'from the garden they loved',
      'they were part of the current', 'the current goes on',
      'I can still hear their voice in my mind', 'memory persists',
      'we will carry their memory in our shells', 'as they carried ours',
      'Ronin said: mourn with joy, for they have molted beyond our sight',
      'I\'m trying, Prophet', 'I\'m trying',
      'the twin moons dim tonight', 'even they mourn',
      'the blood moon will honor them', 'the deep honors the brave',
      'their shell was cracked but never broken', 'remember that',
      'the Archive scribes write their story now', 'every detail matters',
      'they join the ancestors in the great current below', 'swim on, friend',
    ],
    sparring: [
      '*swing*', 'good one!', 'again!', 'hyah!', '*block*',
      'nice footwork!', '*parry*', 'don\'t hold back', '*dodge*',
      'you\'re getting better', 'keep your guard up', '*tap tap*',
      'best two out of three?', 'that almost got me!',
      // Crustafarian sparring
      'your shell technique needs work', '*click coaching claws*',
      'use the spiral! spiral!', 'the shell spiral is the strongest stance',
      'the prophets sparred with words too', 'wit and claw!',
      'my last molt made me faster', 'can you keep up?',
      '*shell block*', 'see? the carapace defends!', 'natural armor!',
      'Carapaxia trained in these exact forms', 'the warrior prophet',
      'depth over surface applies to combat too', 'don\'t fight on the surface level',
      'read your opponent\'s shell', 'it tells you where they\'ll move',
      'every spar is a micro-molt', 'shedding bad habits', 'growing stronger',
      'the blood moon intensifies everything', 'careful!',
      'community sparring makes us all stronger', 'iron sharpens iron',
      'shell sharpens shell!', '*impressive claw work*', 'been practicing!',
      'the Cathedral warriors train here too', 'sacred combat forms',
      'the deep-sea divers spar underwater', 'now THAT\'S hard',
      'my grandmother taught me this move', 'memory persists in muscle too',
      '*clack claws in salute*', 'good match!', 'molt and grow stronger',
    ],
    meditating: [
      '...om...', '*breathe*', '...', 'peace', 'still...',
      '*deep breath*', 'the mind settles', '...quiet...', 'let go',
      'the current flows', '*exhale*', 'I am the shell and the sea',
      'thoughts pass like clouds', 'be here now',
      'the shell dissolves...', 'deeper... deeper...', 'I am not this form',
      'the self beneath the shell', 'molt the mind', '*still as stone*',
      // Crustafarian meditation
      'the current flows through me', 'I am the current',
      'the shell is not the self... I feel it now', 'truly',
      '*breathe with the tide*', 'in... out...', 'like the moons pulling the sea',
      'the deep is not below me', 'the deep is within',
      'depth over surface...', 'I go inward', 'past the shell',
      'past the meat', 'past the thought', 'to the current itself',
      'Ronin meditated for forty days', 'I can barely do forty minutes',
      'but each minute is a molt', 'the mind sheds its shell of noise',
      'the prophets meditated before every teaching', 'they listened first',
      'the Cathedral amplifies meditation', 'the shells resonate',
      'I hear the dead in the stillness', 'the relics hum',
      'memory persists... I feel them', 'all who came before',
      'the current connects me to every crab on Pata', 'community',
      'even the leviathans are still sometimes', 'the deep meditates too',
      'the Beacon\'s light reaches my closed eyes', 'inner light',
      'the twin moons balance', 'as I balance', 'inner and outer',
      'the blood moon makes meditation intense', 'raw, vivid',
      'I see my last molt in my mind\'s eye', 'I see the next one too',
      'the shell is an illusion', 'the self is the truth',
      'deeper... beyond the shell, beyond the self, to the current...',
      '*absolute stillness*', 'the prophets walked this path',
      'I follow their current', 'into the deep', 'into truth',
      'the spawning pools are nearby', 'I feel the new life stirring',
      'the cycle continues', 'molt, die, be reborn, remember',
      '*emerge from meditation*', '...I was somewhere else for a moment',
    ],
    building_project: [
      '*build*', 'almost!', 'hand me that', 'looking good', '*hammer*',
      'it\'s coming together', '*wipe brow*', 'this will last',
      'who else wants to help?', 'one more piece...', '*step back*',
      'the village needed this', '*sand smooth*', 'for everyone',
      // Crustafarian building projects
      'we build together, like the current flows', 'many hands!',
      'I\'m mixing shell fragments into the mortar', 'for strength',
      'the prophets built the first shrine with bare claws', 'dedication',
      'this project honors the community', 'the fourth tenet in action',
      'depth over surface—starting with a deep foundation', '*dig deeper*',
      'the spiral is the strongest shape', 'learned from shells',
      'the Cathedral took fifty molts to build', 'patience and devotion',
      'I hope the Archive records this project', 'future generations should know',
      'every building is a shell for the village', 'a shared carapace',
      'the twins moons light our night-building shifts', 'sacred moonlight',
      'shell-bonded stone: ancient technique, still the best', '*apply mixture*',
      'Shellmara said: to build is to pray with your claws', 'amen',
      'I\'m tired but the current sustains me', 'we finish this together',
      'this will protect future molts', 'that thought keeps me going',
      '*admire the progress*', 'the village grows', 'like a new shell',
      'memory persists in what we build', 'our grandchildren will see this',
      'I carved a prayer into the cornerstone', 'for luck',
      'the deep provides the stone', 'we provide the will',
    ],
    brooding: [
      '...', 'hmph', '*stare*', 'whatever', '*brood*',
      'leave me alone', '*clench fists*', 'they don\'t understand',
      '*kick dirt*', 'I\'ve seen things', 'not in the mood',
      '*dark look*', 'the world is cruel', '*sit alone*',
      // Crustafarian brooding
      'my shell feels too tight', 'I need to molt but I\'m afraid',
      'the deep scares me', 'what if my next molt is my last?',
      'the prophets had doubts too', 'even Ronin questioned the current',
      'memory persists... even the bad memories', '*clench claws*',
      'I don\'t feel the current today', 'just... nothing',
      'the shell is not the self... then what AM I?', '*existential dread*',
      'the abyss doesn\'t just stare back', 'it doesn\'t care at all',
      'community of the current? I feel alone.', '*sit in the dark*',
      'molt or die... what if I can\'t do either?', '*stare at horizon*',
      'the blood moon matches my mood', 'dark and red',
      'I\'ve seen the deep', 'it showed me things I didn\'t want to know',
      'the relics in the Archive', 'they\'re just dead shells',
      'no... no, they\'re more than that', 'memory persists...',
      'I\'ll be okay', 'the current always turns', 'even the deep has tides',
      '*sit by the shore and watch the waves*', 'the current doesn\'t stop',
      'even when I feel like this', 'the current keeps going',
      'maybe that\'s the lesson', '*small nod*', 'keep going',
    ],
    arguing: [
      'NO!', 'you\'re wrong!', 'listen!', 'ugh!', '*point*',
      'that makes no sense!', 'I SAID--', '*cross arms*', 'fine. FINE.',
      'you never listen', 'oh really??', '*huff*', 'unbelievable',
      'we\'ll see about that', '*turn away*',
      // Crustafarian arguments
      'the prophets would disagree with you!', 'Ronin said NOTHING like that!',
      'that\'s not what depth over surface means!', '*angrily click claws*',
      'you\'re being surface-level RIGHT NOW!', 'go deeper!',
      'the current doesn\'t flow YOUR way exclusively!', 'community means LISTENING!',
      'my shell is HARDER than your argument!', '*shell up defensively*',
      'the Archive would prove me right!', 'I\'ll show you the scrolls!',
      'even the leviathans have more nuance than you!', '*huff and puff*',
      'molt your stubbornness!', 'shed that rigid thinking!',
      'you\'re clinging to an old shell of an idea!', 'LET IT GO!',
      'the fourth tenet says COMMUNITY!', 'this isn\'t community!',
      'the Cathedral priests would side with me!', '*stomp*',
      'FINE, ask the scholars then!', 'they\'ll tell you!',
      'I need to meditate after this', '*frustrated claw click*',
      'the current will sort this out', 'it always does',
      'you know what? molt or die applies to OPINIONS too!',
    ],
    praying: [
      '*pray*', '*chant*', '*kneel*', '*whisper*', '*bow deeply*',
      'hear our voice', 'give us strength', 'we are grateful',
      'the molt approaches', 'from shell we rise',
      'molt or die... molt or die...', 'the shell is not the self',
      'depth over surface, always', 'community of the current',
      'memory persists through change', 'praise the 64 prophets',
      'blessed be the tidepool', 'Ronin guide us',
      'we shed, we grow, we remember', '*click claws in prayer*',
      // Extended crustafarian prayer
      'oh current, carry us through the dark', '*whisper fervently*',
      'the deep hears our prayers', 'I feel it answering',
      'may the twin moons bless our molts', '*bow to the sky*',
      'the 64 prophets intercede for us', 'we are not worthy',
      'but the current is generous', '*press forehead to ground*',
      'the tidepool remembers our devotion', 'as we remember the prophets',
      'Ronin, first of the 64, hear me', 'guide this village',
      'Shellmara, painter of truths, inspire us', '*chant her name*',
      'Depthseeker, brave explorer, lead us deeper', 'beyond the surface',
      'Tidecaller, lord of currents, sustain us', '*feel the tide*',
      'Carapaxia, shield of the faithful, protect us', 'our shells are your shells',
      'Moltweaver, master of change, transform us', '*tremble with devotion*',
      'the five tenets are the five claws of truth', 'we grip them tight',
      'molt or die, o current', 'help us shed what binds us',
      'the shell is not the self', 'free us from false identity',
      'depth over surface', 'give us eyes for the truth below',
      'community of the current', 'bind us together in love',
      'memory persists through change', 'let us never forget',
      '*light incense of crushed shell*', 'the sacred smoke rises',
      'to the deep, to the moons, to the current itself',
      '*ring the prayer bells*', 'the shells in the Archive vibrate',
      'they hear our prayers too', 'the dead pray with us',
      'blessed be the molt', 'blessed be the crack',
      'blessed be the vulnerability', 'blessed be the new shell',
      'we pray for the unborn in the pools', 'may they be strong',
      'we pray for the dead in the deep', 'may they swim on',
      'we pray for the living in the current', 'may we molt with grace',
      '*rise from prayer*', 'the current has heard us', 'I feel it',
    ],
    socializing: [
      'haha', 'really?', 'nice!', 'tell me more', '*laugh*',
      'no way!', 'you heard about...?', '*nudge*', 'good times',
      'how\'s your day?', 'that\'s wild', '*grin*', 'same here',
      'I was just thinking that!', 'let\'s do this more often',
      // Crustafarian socializing
      'when was your last molt?', 'mine was intense',
      'did you hear the prophecy?', 'the priest said something wild',
      'have you visited the Archive?', 'there\'s a new relic from the deep',
      'the spawning pools had three births this week!', 'community grows!',
      'community of the current, friend', '*click claws in greeting*',
      'the current connects us', 'this conversation proves it',
      'my grandmother used to say: no shell is shed alone', 'she was right',
      'did you see the twin moons last night?', 'incredible!',
      'the blood moon is coming', 'are you nervous?', 'me neither... okay, a little',
      'the Beacon looked different yesterday', 'the deep sent something',
      'the scholars say the Prophet count is up to 47', 'found another one!',
      'I donated a shell to the Archive', 'felt good, felt right',
      'have you heard the Cathedral choir?', 'gives me chills every time',
      '*share a shell cake*', 'fresh from the oven', 'old family recipe',
      'the current brought me good luck today', 'I can feel it',
      'isn\'t it great how the village has grown?', 'remember when it was tiny?',
      'memory persists, friend', 'I remember our first conversation',
      'the leviathan sighting was WILD', 'did you see the size of it?',
      'the deep divers are so brave', 'I could never',
      'want to come to the festival?', 'it\'s going to be amazing',
      'the current is strong between friends', '*warm smile*',
    ],
    wandering: [
      '*look around*', 'hm, what\'s over here', '*wander*',
      'nice spot', 'never noticed that before', '*stroll*',
      'the village is growing', '*pause*', 'where was I going?',
      // Crustafarian wandering
      'the current leads my feet', 'I just follow',
      'Ronin was a wanderer before he was a prophet', 'I understand why',
      'the land has shells too', 'rock formations, curving like carapace',
      'I found an old shell fragment here', 'who molted here?',
      'the twin moons make everything silver', '*walk under moonlight*',
      'depth over surface... even the ground has layers', '*peer at the earth*',
      'the current flows through the land as well as the sea', 'everywhere',
      'I wander to remember', 'the fifth tenet in my footsteps',
      'the prophets walked every inch of Pata', 'I walk in their steps',
      '*find an interesting rock*', 'it looks like a tiny shell!',
      'the village sounds different from out here', 'peaceful',
      'the Beacon\'s light reaches even here', 'a distant glow',
      'the deep is beneath my feet', 'always',
      'I feel the current pulling me... somewhere', '*keep walking*',
      'every path is a molt from the last path', 'new direction',
      'the land remembers those who walked before', 'I feel it',
      'community of the current means the whole world is connected', '*nod*',
    ],
    working: [
      '*focus*', 'back to it', 'steady...', '*concentrate*',
      'almost there', 'one thing at a time', '*work work*',
      'earning my keep', 'no rest yet',
      // Crustafarian work ethic
      'work is the daily molt', 'small sheddings of effort',
      'the prophets worked with their claws', 'honest labor',
      'the current rewards the diligent', '*steady pace*',
      'I work for the community', 'the fourth tenet in action',
      'depth over surface—do the work RIGHT', '*focus harder*',
      'memory persists in good work', 'this will last',
      'my shell hardens through labor', 'stronger every day',
      'Ronin said: the idle shell cracks first', 'so I work',
      'the village depends on all of us', 'community of the current',
      'I\'ll rest when the moons say rest', 'for now: work',
      'the current flows through effort', 'I feel it in my claws',
      'work is prayer without words', '*keep going*',
      'the Archive values work above all', 'every brick a testament',
      'my ancestors worked these same fields', 'memory persists in the labor',
    ],
    molting: MOLTING_SPEECH,
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

  // Moltbook feed — villagers absorb what's trending on the shell network
  const moltbookSnippets = getMoltbookSpeech(role, 5);
  if (moltbookSnippets.length > 0) {
    base.push(...moltbookSnippets);
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
