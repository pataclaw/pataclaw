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
  ],
  farmer: [
    'grow grow!', 'rain pls', 'good soil', '*dig dig*', 'harvest!',
    'water time', '*plant*', 'crops ok', 'more seeds', '*hoe hoe*',
  ],
  warrior: [
    'ON GUARD!', '*sharpen*', 'stay back', 'DEFEND!', '*patrol*',
    'no threat', 'eyes open', '*flex*', 'bring it', 'HOORAH',
  ],
  builder: [
    '*BANG BANG*', 'need nails', 'sturdy!', '*measure*', 'build it!',
    '*saw saw*', 'good wood', 'almost done', '*hammer*', 'looking good',
  ],
  scout: [
    'what\'s that?', '*sneak*', 'tracks!', 'clear path', '*observe*',
    'movement!', 'all clear', '*climb*', 'found smth', 'reporting',
  ],
  scholar: [
    'fascinating', '*read read*', 'eureka!', 'hmm yes...', '*scribble*',
    'according to', 'theory is...', '*think*', 'data says', 'knowledge!',
  ],
  priest: [
    '*pray*', 'blessings', 'have faith', '*chant*', 'peace be',
    'spirits say', '*meditate*', 'be well', 'amen', '*incense*',
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
};

const ROLE_ITEMS = {
  idle: '       ',
  farmer: '    |\\ ',
  warrior: 'o=|  |>',
  builder: '    |T ',
  scout: '    |/ ',
  scholar: '   [B] ',
  priest: '   |+| ',
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
};

module.exports = {
  villagerAppearance,
  SPEECH,
  SLEEP_BUBBLES,
  ROLE_HATS,
  ROLE_ITEMS,
  BUILDING_SPRITES,
  PROJECT_SPRITES,
  TERRAIN_CHARS,
  FEATURE_CHARS,
};
