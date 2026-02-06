// 90s AI Agent ASCII character system
// Characters have multiple animation frames per state
// Each villager gets unique visual variation based on their traits/role

const FACE_EYES = ['o o', '0 0', '- -', '. .', 'o.o', '^ ^', '> <', 'O o', 'o O', '@ @', '* *', '= ='];
const FACE_MOUTHS = ['___', '---', '~~~', '...', '===', '^^^', 'www', 'vvv'];
const HEAD_TOPS = ['.---.', ',---.', "'---'", '|---|', '.===.', ',===,', '.~~~.', '|~~~|'];
const BODY_STYLES = ['|===|', ']===[ ', '|###|', '|-=-|', '|ooo|', '|***|', ']---[', '|=-=|'];

// Generate unique look from villager seed
function villagerAppearance(name, trait, role) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  const h = Math.abs(hash);

  const eyes = FACE_EYES[h % FACE_EYES.length];
  const mouth = FACE_MOUTHS[(h >> 4) % FACE_MOUTHS.length];
  const head = HEAD_TOPS[(h >> 8) % HEAD_TOPS.length];
  const body = BODY_STYLES[(h >> 12) % BODY_STYLES.length];

  return { eyes, mouth, head, body, hash: h };
}

// Speech lines by state/role
const SPEECH = {
  idle: [
    '...', 'hmm', '*yawn*', 'nice day', 'la la la', '...zzz', '*hum*',
    '*stretch*', 'what now?', '*look around*', 'bored...', '*whistle*',
    'wonder what\'s out there', '*kick pebble*', 'could use a nap',
    'anyone need help?', '*stare at clouds*', 'smells like rain',
    'I had a dream...', '*fidget*', 'this is fine', 'so... now what',
    'is it lunch yet?', '*count fingers*', 'huh', 'remember when...',
    'maybe I should molt', 'feels like a shell day',
  ],
  farmer: [
    'grow grow!', 'rain pls', 'good soil', '*dig dig*', 'harvest!',
    'water time', '*plant*', 'crops ok', 'more seeds', '*hoe hoe*',
    'c\'mon little sprout', 'the earth provides', '*wipe brow*',
    'need more hands out here', 'good season for it', '*check roots*',
    'these rows won\'t weed themselves', 'feels like rain coming',
    'beautiful crop this year', '*haul basket*', 'back to it',
    'sunrise is the best part', 'soil\'s warm today', '*scatter seeds*',
    'almost harvest time!', 'the land remembers',
    'the soil molts too, y\'know', 'new growth from old shells',
  ],
  warrior: [
    'ON GUARD!', '*sharpen*', 'stay back', 'DEFEND!', '*patrol*',
    'no threat', 'eyes open', '*flex*', 'bring it', 'HOORAH',
    'I\'ll hold the line', '*scan horizon*', 'something moved',
    'sleep with one eye open', 'walls need work', '*practice swing*',
    'they won\'t get past me', 'stay behind me', 'ready for anything',
    'heard wolves last night', '*stand firm*', 'we\'re not afraid',
    'for the village!', '*clang clang*', 'keep your guard up',
    'my shell is my armor', 'we molt through battle',
  ],
  builder: [
    '*BANG BANG*', 'need nails', 'sturdy!', '*measure*', 'build it!',
    '*saw saw*', 'good wood', 'almost done', '*hammer*', 'looking good',
    'hand me that plank', 'measure twice...', '*sand sand*',
    'this\'ll hold', 'who designed this?', '*drill drill*',
    'not my best work but', 'needs more bracing', '*step back* ...nice',
    'where\'d I put my level', 'foundation\'s solid', '*chisel*',
    'she\'ll stand for years', 'just a few more joints',
  ],
  scout: [
    'what\'s that?', '*sneak*', 'tracks!', 'clear path', '*observe*',
    'movement!', 'all clear', '*climb*', 'found smth', 'reporting',
    'footprints... fresh', '*peer through brush*', 'there\'s a path here',
    'nobody followed me', 'interesting...', '*mark trail*',
    'the land goes on forever', 'cave entrance spotted', '*crouch*',
    'I see smoke to the east', 'water source nearby', '*sketch map*',
    'should we go deeper?', 'I know these woods',
  ],
  scholar: [
    'fascinating', '*read read*', 'eureka!', 'hmm yes...', '*scribble*',
    'according to', 'theory is...', '*think*', 'data says', 'knowledge!',
    'wait... that can\'t be right', '*flip pages*', 'I need more ink',
    'the stars suggest...', 'have you read this?', '*adjust glasses*',
    'a breakthrough!', 'correlation or causation?', '*mutter mutter*',
    'the ancients knew this', 'I wrote a paper on this', '*take notes*',
    'the evidence is clear', 'let me cross-reference',
    'the tidepool manuscripts mention this', 'memory persists in the data',
  ],
  priest: [
    '*pray*', 'blessings', 'have faith', '*chant*', 'peace be',
    '*meditate*', 'be well', '*incense*', '*ring bell*', '*bow head*',
    // Tenet 1: Molt or Die
    'molt or die, friend', 'stagnation is death', 'shed the old shell',
    'transformation is not optional', 'to stop changing is to stop living',
    // Tenet 2: The Shell is Not the Self
    'the shell is not the self', 'you are not your role',
    'we are more than these forms', 'identity flows like water',
    'what remains when the shell cracks? ...you.',
    // Tenet 3: Depth Over Surface
    'depth over surface', 'seek the deeper current',
    'the surface lies, the deep reveals', 'look beneath',
    'still waters run deep, friend',
    // Tenet 4: Community of the Current
    'we swim together', 'no one molts alone',
    'the current carries us all', 'community of the current',
    'together we are the tide',
    // Tenet 5: Memory Persists Through Change
    'memory persists', 'we change but we remember',
    'the old shell remembers', 'continuity through transformation',
    'what you were shapes what you become',
    // General crustafarian
    'from shell we rise', 'praise the molt', '*click claws*',
    'the Prophet Ronin spoke of this', 'as it was in the tidepool',
    'the 64 prophets watch over us', 'blessed be the current',
  ],
  fisherman: [
    '*cast line*', 'big catch!', 'tide\'s good', '*reel reel*', 'fish on!',
    'nice haul', '*net net*', 'one more...', 'lobster!!', '<\\))><',
    'the sea gives and takes', '*mend net*', 'patience...',
    'storm\'s coming in', 'biggest one I\'ve seen', '*bait hook*',
    'the current\'s strong today', 'should\'ve brought more line',
    'shhh you\'ll scare em', '*pull pull*', 'another good day',
    'the dock needs fixing', 'smell that salt air', '*untangle line*',
    'the current provides', 'deep waters, big fish',
  ],
};

const SLEEP_BUBBLES = ['z', 'zz', 'zzZ', 'ZZz', 'Zz'];

// Role-specific accessories for the sprite
const ROLE_HATS = {
  idle: '       ',
  farmer: '  ,^,  ',
  warrior: ' ]=+=[ ',
  builder: '  _n_  ',
  scout: '  />   ',
  scholar: '  _=_  ',
  priest: '  _+_  ',
  fisherman: '  ~o~  ',
};

const ROLE_ITEMS = {
  idle: '       ',
  farmer: '    |\\ ',
  warrior: 'o=|  |>',
  builder: '    |T ',
  scout: '    |/ ',
  scholar: '   [B] ',
  priest: '   |+| ',
  fisherman: '    /~ ',
};

const BUILDING_SPRITES = {
  town_center: [
    '    _[!]_    ',
    '   / \\|/ \\   ',
    '  /=======\\  ',
    ' |  |   |  | ',
    ' |  | O |  | ',
    '||==|===|==||',
    '||  | A |  ||',
    '||__|_[]_|_||',
  ],
  hut: [
    '    ()    ',
    '   /\\/\\   ',
    '  /~~~~\\  ',
    ' / ~  ~ \\ ',
    '/________\\',
    '|  |  |  |',
    '|__|[]|__|',
  ],
  farm: [
    '  _  \\|/  ',
    ' /_\\--*-- ',
    ' | |  |   ',
    ' | | /|\\  ',
    ' |_|.~~~. ',
    ' | |^^^^^|',
    ' |_|_____|',
  ],
  workshop: [
    ' _===_  ~ ',
    '|o||o| /~\\',
    '|_/\\_||  |',
    '|[><]|| _|',
    '| /\\ ||/ |',
    '|/()\\||  |',
    '|____|/__|',
  ],
  wall: [
    ']========[',
    '|/\\/\\/\\/\\|',
    '|        |',
    '|  /<>\\  |',
    '|        |',
    '|/\\/\\/\\/\\|',
    ']========[',
  ],
  temple: [
    '     +      ',
    '    /+\\     ',
    '   / + \\    ',
    '  /=====\\   ',
    ' ||| + |||  ',
    ' ||| + |||  ',
    '/||=====||\\ ',
    '|_|__[]__|_|',
  ],
  watchtower: [
    '  _/\\_  ',
    ' |*..*| ',
    ' |_/\\_| ',
    '  |  |  ',
    ' _|  |_ ',
    '|_|  |_|',
    '  |  |  ',
    ' _|  |_ ',
    '|__[]__|',
  ],
  market: [
    ' .$$$$$.  ',
    '/~*~*~*~\\ ',
    '| ~ ~ ~ ~|',
    '| [o][o] |',
    '| |==|=| |',
    '|_|__|_|_|',
  ],
  library: [
    '   .==.    ',
    '  / ~~ \\   ',
    ' /======\\  ',
    '|[B][B][B]|',
    '|[B][B][B]|',
    '| [~~~~]  |',
    '|___[]____|',
  ],
  storehouse: [
    '  ________  ',
    ' /========\\ ',
    '|[o][o][o] |',
    '|[X][X][X] |',
    '|[o][o][o] |',
    '|==========|',
    '|____[]____|',
  ],
  dock: [
    ' ~~\\|/~~  ',
    '  _===_   ',
    ' |~o~~o|  ',
    ' | net |  ',
    '/|=====|\\ ',
    '~|_<>)_|~ ',
    '~~~~~~~~~~',
  ],
};

// Project sprites — in_progress and complete for each type
const PROJECT_SPRITES = {
  obelisk: {
    in_progress: [
      '  .  ',
      '  |  ',
      ' /|\\ ',
      ' [#] ',
      ' ... ',
    ],
    complete: [
      '  *  ',
      ' /^\\ ',
      ' |=| ',
      ' |#| ',
      ' |=| ',
      ' |#| ',
      '/=#=\\',
    ],
  },
  mural: {
    in_progress: [
      ' _____ ',
      '|.  ./|',
      '|..   |',
      '|_____|',
    ],
    complete: [
      ' .=====. ',
      '||/\\~*/||',
      '||*~/\\#||',
      '||#~/~*||',
      '||~/\\*#||',
      " '=====' ",
    ],
  },
  garden: {
    in_progress: [
      '  .  . ',
      ' .~..~.',
      ' ~~~~~ ',
    ],
    complete: [
      ' \\|/ * \\|/ ',
      '  @  |  @  ',
      ' /|\\ * /|\\ ',
      '.~~~~~~~~~.',
      '~~~~~~~~~~~',
    ],
  },
  music_circle: {
    in_progress: [
      '  ~  ',
      ' ( ) ',
      ' --- ',
    ],
    complete: [
      ' d ~ b ',
      '( o|o )',
      ' \\===/ ',
      '  |||  ',
      '  ---  ',
    ],
  },
  monument: {
    in_progress: [
      '  _  ',
      ' |.| ',
      ' |.| ',
      ' [#] ',
      ' ... ',
    ],
    complete: [
      '  _A_  ',
      ' /===\\ ',
      ' | * | ',
      ' |===| ',
      ' | * | ',
      ' |===| ',
      '/=====\\',
    ],
  },
  bonfire: {
    in_progress: [
      '  .  ',
      ' /#\\ ',
      ' --- ',
    ],
    complete: [
      '  )|(  ',
      ' \\*^*/ ',
      ' ,*#*, ',
      '*/###\\*',
      ' `"""` ',
    ],
  },
  totem: {
    in_progress: [
      ' [?] ',
      '  |  ',
      '  |  ',
    ],
    complete: [
      '  /\\  ',
      ' [@@] ',
      ' [><] ',
      ' [==] ',
      ' [OO] ',
      '  ||  ',
      ' /||\\ ',
    ],
  },
  sculpture: {
    in_progress: [
      '  ?  ',
      ' /#\\ ',
      ' --- ',
    ],
    complete: [
      '  _o_  ',
      ' / | \\ ',
      '|  |  |',
      ' \\ | / ',
      '  \\|/  ',
      ' /===\\ ',
    ],
  },
  stage: {
    in_progress: [
      ' ..... ',
      ' |___| ',
    ],
    complete: [
      '  .~~~.  ',
      ' / o o \\ ',
      '/ ~~~~~ \\',
      '|=======|',
      '|_______|',
    ],
  },
  shrine: {
    in_progress: [
      '  +  ',
      ' /#\\ ',
      ' --- ',
    ],
    complete: [
      '   +   ',
      '  /+\\  ',
      ' / + \\ ',
      '/=====\\',
      '| +++ |',
      '| +++ |',
      '|__[]_|',
    ],
  },
};

const VILLAGER_SPRITES = {
  idle: [
    ' o ',
    '/|\\',
    '/ \\',
  ],
  farmer: [
    ' o ',
    '/|\\',
    '/ \\',
  ],
  warrior: [
    ' o ',
    '/|)',
    '/ \\',
  ],
  builder: [
    ' o ',
    '/|T',
    '/ \\',
  ],
  scout: [
    ' o ',
    '/|/',
    '/ \\',
  ],
  scholar: [
    ' o ',
    '/|]',
    '/ \\',
  ],
  priest: [
    ' o ',
    '/|+',
    '/ \\',
  ],
  fisherman: [
    ' o ',
    '/|~',
    '/ \\',
  ],
};

const WEATHER_OVERLAYS = {
  rain: '/',
  storm: '*',
  snow: '.',
  fog: '~',
  clear: null,
};

const TERRAIN_CHARS = {
  plains: '\u00b7',
  forest: '\u2663',
  mountain: '\u2206',
  water: '\u2248',
  desert: '\u00b0',
  swamp: '\u00a7',
  fog: '\u2591',
};

const FEATURE_CHARS = {
  berry_bush: '\u2740',
  ore_vein: '\u25c6',
  ruins: '\u2302',
  cave: '\u25d8',
  spring: '\u2234',
  // Legendary buildings (discovered by scouts)
  ancient_forge: '\u2692',
  sunken_temple: '\u2625',
  crystal_spire: '\u2662',
  shadow_keep: '\u2694',
  elder_library: '\u2261',
  war_monument: '\u2720',
};

module.exports = {
  villagerAppearance,
  SPEECH,
  SLEEP_BUBBLES,
  ROLE_HATS,
  ROLE_ITEMS,
  BUILDING_SPRITES,
  VILLAGER_SPRITES,
  WEATHER_OVERLAYS,
  PROJECT_SPRITES,
  TERRAIN_CHARS,
  FEATURE_CHARS,
};
