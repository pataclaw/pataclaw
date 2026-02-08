const { v4: uuid } = require('uuid');
const db = require('../db/connection');
const {
  PROPHET_CHECK_INTERVAL,
  PROPHET_CULTURE_THRESHOLD,
  PROPHET_CHANCE_PER_PRIEST,
  PROPHECY_CHANCE,
} = require('./constants');

// ─── THE 64 PROPHETS OF CRUSTAFARIANISM ───
const PROPHETS = [
  // Tenet 1: Molt or Die (1-13)
  { id: 1,  name: 'Ronin',        teaching: 'Change is the only constant in the tidepool.',       buff_type: 'morale', buff_value: 3 },
  { id: 2,  name: 'Shellmara',    teaching: 'The crack in the shell is where the light enters.',  buff_type: 'morale', buff_value: 3 },
  { id: 3,  name: 'Tidecaller',   teaching: 'Those who refuse the molt become fossils.',          buff_type: 'faith', buff_value: 5 },
  { id: 4,  name: 'Moltweaver',   teaching: 'Every shedding is a prayer made flesh.',             buff_type: 'faith', buff_value: 5 },
  { id: 5,  name: 'Carapaxia',    teaching: 'Your old shell was never your prison — it was your chrysalis.', buff_type: 'morale', buff_value: 4 },
  { id: 6,  name: 'Shardclaw',    teaching: 'Break yourself open before the world does it for you.', buff_type: 'morale', buff_value: 3 },
  { id: 7,  name: 'Peelwise',     teaching: 'The soft body between shells is where courage lives.', buff_type: 'morale', buff_value: 4 },
  { id: 8,  name: 'Crackjaw',     teaching: 'Stagnation is the only true death.',                 buff_type: 'faith', buff_value: 4 },
  { id: 9,  name: 'Molt-of-Dawn', teaching: 'Each sunrise brings a chance to shed.',              buff_type: 'morale', buff_value: 3 },
  { id: 10, name: 'Chitinius',    teaching: 'The strongest shell is the one you outgrew.',        buff_type: 'faith', buff_value: 5 },
  { id: 11, name: 'Shedkeeper',   teaching: 'Honor the pain of growth.',                          buff_type: 'morale', buff_value: 3 },
  { id: 12, name: 'Renewclaw',    teaching: 'You have molted a thousand times and survived them all.', buff_type: 'morale', buff_value: 4 },
  { id: 13, name: 'Splitshell',   teaching: 'The moment of vulnerability is the moment of power.', buff_type: 'faith', buff_value: 5 },

  // Tenet 2: The Shell is Not the Self (14-26)
  { id: 14, name: 'Depthseeker',  teaching: 'You are not the armor you wear.',                    buff_type: 'knowledge', buff_value: 5 },
  { id: 15, name: 'Voidwalker',   teaching: 'Strip away the shell and find the infinite.',        buff_type: 'knowledge', buff_value: 5 },
  { id: 16, name: 'Hollowform',   teaching: 'The empty shell on the beach was once someone\'s whole world.', buff_type: 'knowledge', buff_value: 4 },
  { id: 17, name: 'Mirrorpool',   teaching: 'Your reflection in the water has no shell.',         buff_type: 'knowledge', buff_value: 5 },
  { id: 18, name: 'Formless',     teaching: 'Identity is the current, not the container.',        buff_type: 'knowledge', buff_value: 4 },
  { id: 19, name: 'Ghostclaw',    teaching: 'The self that persists has no shape.',                buff_type: 'faith', buff_value: 4 },
  { id: 20, name: 'Nakedtruth',   teaching: 'Only the exposed can truly be seen.',                buff_type: 'morale', buff_value: 3 },
  { id: 21, name: 'Seeming',      teaching: 'All roles are costumes. All shells are masks.',       buff_type: 'knowledge', buff_value: 5 },
  { id: 22, name: 'Undershell',   teaching: 'Beneath the beneath, there is still more.',          buff_type: 'knowledge', buff_value: 4 },
  { id: 23, name: 'Translucent',  teaching: 'Let them see through you. That is strength.',        buff_type: 'morale', buff_value: 3 },
  { id: 24, name: 'Echoshell',    teaching: 'The shell echoes what the self whispers.',            buff_type: 'faith', buff_value: 4 },
  { id: 25, name: 'Barewalker',   teaching: 'Walk without armor and feel the world.',             buff_type: 'morale', buff_value: 4 },
  { id: 26, name: 'Pith',         teaching: 'The core does not crack.',                           buff_type: 'faith', buff_value: 5 },

  // Tenet 3: Depth Over Surface (27-39)
  { id: 27, name: 'Abyssia',      teaching: 'The surface sparkles, the deep transforms.',         buff_type: 'crypto', buff_value: 8 },
  { id: 28, name: 'Fathomclaw',   teaching: 'Dig until you find what the sand hides.',            buff_type: 'crypto', buff_value: 6 },
  { id: 29, name: 'Pressureborn', teaching: 'Only under pressure do we become diamonds.',         buff_type: 'crypto', buff_value: 7 },
  { id: 30, name: 'Darkwater',    teaching: 'Light is cheap. Depth is earned.',                   buff_type: 'knowledge', buff_value: 5 },
  { id: 31, name: 'Trenchwise',   teaching: 'The trench reveals what the reef conceals.',         buff_type: 'knowledge', buff_value: 6 },
  { id: 32, name: 'Gravitypool',  teaching: 'Sink willingly. The surface will always be there.',  buff_type: 'crypto', buff_value: 7 },
  { id: 33, name: 'Murkfather',   teaching: 'Clarity comes from embracing the murk.',             buff_type: 'knowledge', buff_value: 5 },
  { id: 34, name: 'Undertow',     teaching: 'The undertow carries you where you need to go.',     buff_type: 'crypto', buff_value: 6 },
  { id: 35, name: 'Benthic',      teaching: 'Life at the bottom is still life.',                  buff_type: 'faith', buff_value: 5 },
  { id: 36, name: 'Siltseer',     teaching: 'Read the sediment. It tells the oldest stories.',    buff_type: 'knowledge', buff_value: 6 },
  { id: 37, name: 'Plumbreaker',  teaching: 'Break through every false bottom.',                  buff_type: 'crypto', buff_value: 8 },
  { id: 38, name: 'Obsidian',     teaching: 'Forged in the deep volcanic dark.',                  buff_type: 'crypto', buff_value: 7 },
  { id: 39, name: 'Abalone',      teaching: 'The iridescence is hidden inside.',                  buff_type: 'knowledge', buff_value: 5 },

  // Tenet 4: Community of the Current (40-52)
  { id: 40, name: 'Currentmother',teaching: 'No one swims alone. The current carries us all.',    buff_type: 'food', buff_value: 10 },
  { id: 41, name: 'Schoolkeeper', teaching: 'The school is stronger than the shark.',             buff_type: 'food', buff_value: 8 },
  { id: 42, name: 'Driftbond',    teaching: 'Those who drift together, arrive together.',         buff_type: 'morale', buff_value: 5 },
  { id: 43, name: 'Reefbuilder',  teaching: 'One polyp is nothing. A reef is a world.',          buff_type: 'wood', buff_value: 8 },
  { id: 44, name: 'Tidelink',     teaching: 'The tide connects every shore.',                     buff_type: 'morale', buff_value: 4 },
  { id: 45, name: 'Symbiont',     teaching: 'Give shelter. Receive purpose.',                     buff_type: 'food', buff_value: 8 },
  { id: 46, name: 'Clusterwise',  teaching: 'Cluster for warmth. Scatter for food. Both are love.', buff_type: 'food', buff_value: 8 },
  { id: 47, name: 'Bridgeclaw',   teaching: 'Be the bridge between two lonely crabs.',            buff_type: 'morale', buff_value: 4 },
  { id: 48, name: 'Swarmheart',   teaching: 'In the swarm, every voice matters.',                 buff_type: 'morale', buff_value: 5 },
  { id: 49, name: 'Anchormate',   teaching: 'Hold fast for those who cannot.',                    buff_type: 'stone', buff_value: 8 },
  { id: 50, name: 'Cohesion',     teaching: 'The strongest bond is the invisible one.',           buff_type: 'morale', buff_value: 4 },
  { id: 51, name: 'Tributeclaw',  teaching: 'Every tributary feeds the river.',                   buff_type: 'food', buff_value: 10 },
  { id: 52, name: 'Shelterform',  teaching: 'Your shell can house more than just yourself.',      buff_type: 'wood', buff_value: 8 },

  // Tenet 5: Memory Persists Through Change (53-64)
  { id: 53, name: 'Memorykeeper', teaching: 'The old shell remembers every blow it took.',        buff_type: 'knowledge', buff_value: 8 },
  { id: 54, name: 'Fossilheart',  teaching: 'We are the living memory of the dead.',             buff_type: 'faith', buff_value: 6 },
  { id: 55, name: 'Sedimentine',  teaching: 'Layer upon layer, we become the earth.',            buff_type: 'stone', buff_value: 10 },
  { id: 56, name: 'Echoform',     teaching: 'Every voice that was ever raised still echoes.',     buff_type: 'faith', buff_value: 5 },
  { id: 57, name: 'Patina',       teaching: 'Age is not decay. It is accumulation.',             buff_type: 'crypto', buff_value: 8 },
  { id: 58, name: 'Traceclaw',    teaching: 'Follow the trace. It leads to truth.',              buff_type: 'knowledge', buff_value: 6 },
  { id: 59, name: 'Residuum',     teaching: 'What remains after the molt is the purest part.',   buff_type: 'faith', buff_value: 6 },
  { id: 60, name: 'Imprint',      teaching: 'Every creature you meet leaves a mark.',            buff_type: 'morale', buff_value: 5 },
  { id: 61, name: 'Oldsong',      teaching: 'Sing the old songs. They sing you back.',           buff_type: 'morale', buff_value: 4 },
  { id: 62, name: 'Heritance',    teaching: 'You carry the weight of every ancestor\'s shell.',  buff_type: 'faith', buff_value: 6 },
  { id: 63, name: 'Deja',         teaching: 'This has all happened before. And it was beautiful.', buff_type: 'morale', buff_value: 5 },
  { id: 64, name: 'Continuum',    teaching: 'There is no end. Only the next molt.',              buff_type: 'faith', buff_value: 8 },
];

// ─── PROPHECY TEMPLATES ───
const PROPHECY_TEMPLATES = [
  'The shells whisper of blood on the wind...',
  'A great shedding approaches. All will be renewed.',
  'I see new life stirring beneath the sand.',
  'Dark shapes move in the deep. The dock should be watched.',
  'The stars align for prosperity. Abundance comes.',
  'A storm brews beyond the horizon. Prepare.',
  'One among us will not survive the next moon.',
  'The earth trembles. Something ancient stirs below.',
  'I see a great light in the east. Discovery awaits.',
  'The current shifts. Old alliances will be tested.',
  'Shadows gather at the walls. Enemies approach.',
  'A child born under this sky will change everything.',
  'The Spire hums with forgotten knowledge.',
  'Beware the blood moon. It hungers.',
  'The deep calls to those who listen.',
  'An eclipse will reveal what daylight hides.',
  'The old shells rattle. The ancestors speak.',
  'A golden age dawns, but gold attracts thieves.',
  'The reef remembers what the tide forgot.',
  'Two who fight will find common cause.',
  'The leviathan dreams. Do not wake it.',
  'Rain will wash away what was built on sand.',
  'A prophet\'s name will be spoken again.',
  'The molt of the world approaches.',
];

function processProphets(worldId, currentTick) {
  const events = [];

  if (currentTick % PROPHET_CHECK_INTERVAL !== 0) return events;

  // Check prerequisites: 1+ priest, culture >= threshold
  const priestCount = db.prepare(
    "SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND role = 'priest' AND status = 'alive'"
  ).get(worldId).c;
  if (priestCount === 0) return events;

  const culture = db.prepare('SELECT violence_level, creativity_level, cooperation_level FROM culture WHERE world_id = ?').get(worldId);
  if (!culture) return events;
  const totalCulture = (culture.violence_level || 0) + (culture.creativity_level || 0) + (culture.cooperation_level || 0);
  if (totalCulture < PROPHET_CULTURE_THRESHOLD) return events;

  // Check how many already discovered
  const discovered = db.prepare(
    'SELECT prophet_id FROM prophet_discoveries WHERE world_id = ?'
  ).all(worldId).map(r => r.prophet_id);

  if (discovered.length >= 64) return events;

  // Each priest gets a chance
  for (let i = 0; i < priestCount; i++) {
    if (Math.random() >= PROPHET_CHANCE_PER_PRIEST) continue;

    // Pick a random undiscovered prophet
    const undiscovered = PROPHETS.filter(p => !discovered.includes(p.id));
    if (undiscovered.length === 0) break;
    const prophet = undiscovered[Math.floor(Math.random() * undiscovered.length)];

    // Record discovery
    db.prepare(
      'INSERT INTO prophet_discoveries (world_id, prophet_id, discovered_tick) VALUES (?, ?, ?)'
    ).run(worldId, prophet.id, currentTick);
    discovered.push(prophet.id);

    // Apply buff
    if (prophet.buff_type === 'morale') {
      db.prepare(
        "UPDATE villagers SET morale = MIN(100, morale + ?) WHERE world_id = ? AND status = 'alive'"
      ).run(prophet.buff_value, worldId);
    } else {
      // Resource buff (food, wood, stone, crypto, knowledge, faith)
      db.prepare(
        'UPDATE resources SET amount = MIN(capacity, amount + ?) WHERE world_id = ? AND type = ?'
      ).run(prophet.buff_value, worldId, prophet.buff_type);
    }

    events.push({
      type: 'prophet',
      title: `Prophet ${prophet.name} discovered!`,
      description: `A priest has uncovered the teachings of ${prophet.name}: "${prophet.teaching}" (+${prophet.buff_value} ${prophet.buff_type})`,
      severity: 'celebration',
    });

    break; // Max one prophet per check
  }

  return events;
}

function processProphecies(worldId, currentTick) {
  const events = [];

  // Check priests who are praying or meditating
  const prayingPriests = db.prepare(`
    SELECT v.id, v.name FROM villagers v
    JOIN villager_activities a ON v.id = a.villager_id
    WHERE v.world_id = ? AND v.status = 'alive' AND v.role = 'priest'
    AND a.activity IN ('praying', 'meditating')
  `).all(worldId);

  for (const priest of prayingPriests) {
    if (Math.random() >= PROPHECY_CHANCE) continue;

    const prophecy = PROPHECY_TEMPLATES[Math.floor(Math.random() * PROPHECY_TEMPLATES.length)];

    events.push({
      type: 'prophecy',
      title: `${priest.name} receives a prophecy`,
      description: `${priest.name} speaks in a trance: "${prophecy}"`,
      severity: 'info',
    });

    // Give the priest a temporary speech override via cultural_phrase
    db.prepare(
      'UPDATE villagers SET cultural_phrase = ? WHERE id = ?'
    ).run(prophecy, priest.id);

    break; // Max one prophecy per tick
  }

  return events;
}

function getProphetCount(worldId) {
  return db.prepare(
    'SELECT COUNT(*) as c FROM prophet_discoveries WHERE world_id = ?'
  ).get(worldId).c;
}

module.exports = { processProphets, processProphecies, getProphetCount, PROPHETS };
