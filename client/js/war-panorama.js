// ─── PATACLAW WAR PANORAMA ───
// 180-char wide ASCII battlefield: two towns face off with a war zone in the middle.
// Self-contained renderer using <pre> grid approach (like viewer.js).
// Connects to SSE for live war updates.

(function() {
  'use strict';

  // ─── Constants ───
  var W = 180;         // total width
  var H = 45;          // total height
  var GROUND_Y = 34;   // ground line
  var LEFT_W = 75;     // challenger town zone width
  var CENTER_W = 30;   // battlefield zone width
  var RIGHT_START = LEFT_W + CENTER_W; // 105
  var RIGHT_W = 75;    // defender town zone width
  var FPS = 12;

  // ─── State ───
  var warId = null;
  var eventSource = null;
  var frame = null;
  var prevFrame = null;
  var animTick = 0;
  var animInterval = null;
  var narratorTimer = null;
  var narratorText = '';
  var narratorFade = 0;

  // ─── Grid ───
  // Each cell: { ch: ' ', cls: '' }
  var grid = [];

  function initGrid() {
    grid = [];
    for (var y = 0; y < H; y++) {
      var row = [];
      for (var x = 0; x < W; x++) {
        row.push({ ch: ' ', cls: '' });
      }
      grid.push(row);
    }
  }

  function setCell(x, y, ch, cls) {
    if (x >= 0 && x < W && y >= 0 && y < H) {
      grid[y][x] = { ch: ch, cls: cls || '' };
    }
  }

  function writeStr(x, y, str, cls) {
    for (var i = 0; i < str.length; i++) {
      setCell(x + i, y, str[i], cls);
    }
  }

  // ─── Biome Styles ───
  var BIOME_GROUND = {
    plains:   { chars: ['~','*','.',"'",','], cls: 'c-gnd-v' },
    forest:   { chars: ['~','*','.',';','`'], cls: 'c-gnd-v' },
    mountain: { chars: ['#','=','.',':','%'], cls: 'c-gnd-s' },
    swamp:    { chars: ['~','.',',','*','`'], cls: 'c-gnd-m' },
    desert:   { chars: ['~','.','\u00b0',',','-'], cls: 'c-gnd-d' },
    tundra:   { chars: ['*','.','\u00b7',"'",'+'], cls: 'c-gnd-f' },
    volcanic: { chars: ['^','~','.','*','v'], cls: 'c-gnd-e' },
  };

  var BATTLEFIELD_GROUND = {
    clash: { chars: ['#','.','#','.',',','#'], cls: 'c-war-ground' },
    burn:  { chars: ['^','~','^','*','^','~'], cls: 'c-war-fire' },
    spire: { chars: ['.',',','.',':','.','`'], cls: 'c-war-ash' },
  };

  // ─── Warrior Type Sprites (7 wide × 6 tall) ───
  var WARRIOR_SPRITES = {
    pincer: {
      fighting: [
        ' )=(=( ',
        ' .---. ',
        ' |o^o| ',
        ' |)(| ',
        " 'XX' ",
        '  d  b ',
      ],
      charging: [
        ' )=(=( ',
        ' .---. ',
        ' |o>o| ',
        ' |>>| ',
        " 'XX' ",
        '  d  b ',
      ],
      fallen: [
        '       ',
        '  ___  ',
        ' /x_x\\ ',
        ' |__|  ',
        ' .::.. ',
        '.......',
      ],
      dead: [
        '       ',
        '       ',
        '   +   ',
        '  .:.  ',
        ' .:::. ',
        '.......',
      ],
    },
    carapace: {
      fighting: [
        ' [=#=] ',
        ' .---. ',
        ' |o_o| ',
        ' |[]| ',
        " '#=#' ",
        '  d  b ',
      ],
      charging: [
        ' [=#=] ',
        ' .---. ',
        ' |o_o| ',
        ' |[]| ',
        " '#=#' ",
        '  d  b ',
      ],
      fallen: [
        '       ',
        '  ___  ',
        ' /x_x\\ ',
        ' |##|  ',
        ' .::.. ',
        '.......',
      ],
      dead: [
        '       ',
        '       ',
        '   +   ',
        '  .#.  ',
        ' .###. ',
        '.......',
      ],
    },
    spitter: {
      fighting: [
        ' >>->> ',
        ' .---. ',
        ' |o.o| ',
        ' |--| ',
        " '  >' ",
        '  d  b ',
      ],
      charging: [
        ' >>->> ',
        ' .---. ',
        ' |o.o|>',
        ' |-->  ',
        " '  >' ",
        '  d  b ',
      ],
      fallen: [
        '       ',
        '  ___  ',
        ' /x.x\\ ',
        ' |__|  ',
        ' .::.. ',
        '.......',
      ],
      dead: [
        '       ',
        '       ',
        '   +   ',
        '  .>.  ',
        ' ..>>. ',
        '.......',
      ],
    },
    tidecaller: {
      fighting: [
        ' ~*+*~ ',
        ' .---. ',
        ' |o~o| ',
        ' |~~| ',
        " '~~' ",
        '  d  b ',
      ],
      charging: [
        ' ~*+*~ ',
        ' .---. ',
        ' |o~o| ',
        ' |~~|~ ',
        " '~~' ",
        '  d  b ',
      ],
      fallen: [
        '       ',
        '  ___  ',
        ' /x~x\\ ',
        ' |__|  ',
        ' .::.. ',
        '.......',
      ],
      dead: [
        '       ',
        '       ',
        '   +   ',
        '  .~.  ',
        ' .~~~. ',
        '.......',
      ],
    },
  };

  // Mirrored versions (for defender side, facing left)
  var WARRIOR_SPRITES_MIRROR = {};
  (function buildMirrors() {
    function mirrorStr(s) {
      var out = '';
      for (var i = s.length - 1; i >= 0; i--) {
        var c = s[i];
        if (c === '(') out += ')';
        else if (c === ')') out += '(';
        else if (c === '[') out += ']';
        else if (c === ']') out += '[';
        else if (c === '<') out += '>';
        else if (c === '>') out += '<';
        else if (c === '/') out += '\\';
        else if (c === '\\') out += '/';
        else if (c === 'd') out += 'b';
        else if (c === 'b') out += 'd';
        else out += c;
      }
      return out;
    }
    for (var type in WARRIOR_SPRITES) {
      WARRIOR_SPRITES_MIRROR[type] = {};
      for (var state in WARRIOR_SPRITES[type]) {
        WARRIOR_SPRITES_MIRROR[type][state] = WARRIOR_SPRITES[type][state].map(mirrorStr);
      }
    }
  })();

  // ─── Building Sprites (5-7 wide × 3-5 tall) ───
  var BUILDING_ART = {
    farm:           ['  ,^,  ', ' |#|#| ', '_|___|_'],
    workshop:       ['  [W]  ', ' |---| ', ' |___| '],
    hut:            ['  /\\   ', ' |  |  ', ' |__| '],
    market:         ['  $$$  ', ' |---| ', ' |___| '],
    library:        ['  [B]  ', ' |===| ', ' |___| '],
    dock:           ['  ~~~  ', ' ===== ', '/_____|'],
    hunting_lodge:  ['  ^^   ', ' |><|  ', ' |__|  '],
    storehouse:     ['  [S]  ', ' |##|  ', ' |__|  '],
    wall:           [' ||||| ', ' ||||| '],
    watchtower:     ['  /\\   ', ' |TT|  ', '  ||   ', '  ||   '],
    temple:         ['   +   ', '  /|\\  ', ' |===| ', ' |___| '],
    barracks:       ['  [!]  ', ' |==|  ', ' |__|  '],
    molt_cathedral: ['   *   ', '  /M\\  ', ' |===| ', ' |___| '],
  };

  var BUILDING_RUBBLE = ['  ..   ', ' .::.  ', '.::::.'];
  var BUILDING_FIRE   = ['  ^^~  ', ' ~^^^~ ', ' ~^~^~ '];

  // ─── Spire Art ───
  var SPIRE_CAP = ['   /\\   ', '  /  \\  ', '  |**|  '];
  var SPIRE_SEG_INTACT  = '  |##|  ';
  var SPIRE_SEG_CRACKED = '  |/\\|  ';
  var SPIRE_SEG_FALLEN  = '  ....  ';
  var SPIRE_BASE = [' _|  |_ ', '|______|'];

  // ─── Sky / Weather ───
  var SKY_COLORS = {
    dawn:  'c-sky-dawn',
    day:   'c-sky-day',
    dusk:  'c-sky-dusk',
    night: 'c-sky-night',
  };

  var WEATHER_CHARS = {
    rain:  ['|', '/', '|'],
    storm: ['/', '\\', '|', '/'],
    snow:  ['*', '\u00b7', '\u00b0'],
    fog:   ['.', '\u00b7', '.'],
  };

  // ─── Dramatic Narrator Lines ───
  var NARRATOR_LINES = {
    champion_duel:   ['A CHAMPION RISES...', 'TWO WARRIORS. ONE FATE.', 'THE DUEL OF AGES.'],
    blood_frenzy:    ['BLOOD FRENZY!', 'THEY HAVE GONE BERSERK!', 'NO MERCY!'],
    wall_breach:     ['THE WALLS CRUMBLE!', 'BREACH! BREACH!', 'DEFENSES SHATTERED!'],
    heroic_stand:    ['A HERO STANDS ALONE!', 'ONE AGAINST MANY!', 'LEGENDARY DEFIANCE!'],
    divine_intervention: ['THE GODS HAVE SPOKEN!', 'DIVINE INTERVENTION!', 'FATE BENDS!'],
    flanking:        ['FLANKED!', 'THEY CAME FROM BEHIND!', 'AMBUSH MANEUVER!'],
    morale_break:    ['THEIR SPIRIT BREAKS!', 'FEAR TAKES HOLD!', 'MORALE SHATTERED!'],
    ambush:          ['AMBUSH!', 'FROM THE SHADOWS!', 'THEY NEVER SAW IT COMING!'],
    shield_break:    ['SHIELDS DESTROYED!', 'THE LINE COLLAPSES!', 'NO PROTECTION LEFT!'],
    war_chant:       ['THE WAR CHANT ECHOES!', 'DRUMS OF WAR!', 'THEY RALLY AS ONE!'],
    // Skill-based
    skill_red:       ['DEVASTATION!', 'WRATH UNLEASHED!', 'RAW POWER!'],
    skill_blue:      ['IMPENETRABLE!', 'FORTRESS OF WILL!', 'UNBREAKABLE!'],
    skill_green:     ['NATURE STRIKES!', 'THE TIDE TURNS!', 'CUNNING WINS!'],
    skill_gold:      ['DIVINE FURY!', 'GOLDEN WRATH!', 'ASCENDED POWER!'],
    // Phase transitions
    enter_burn:      ['BUILDINGS BURN!', 'THE TOWN IS ABLAZE!', 'FIRE CONSUMES ALL!'],
    enter_spire:     ['THE SPIRE STANDS ALONE!', 'LAST BASTION!', 'ALL IS LOST BUT THE SPIRE!'],
    // Casualty events
    mass_casualty:   ['MASSACRE!', 'THE FALLEN PILE HIGH!', 'A GENERATION LOST!'],
    carapace_save:   ['THE SHELL HOLDS!', 'UNBREAKABLE CARAPACE!', 'DEFIANCE IN SHELL!'],
  };

  function pickNarrator(key) {
    var lines = NARRATOR_LINES[key];
    if (!lines) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  function triggerNarrator(text, cls) {
    narratorText = text;
    narratorFade = 30; // ~2.5 seconds at 12fps
    var el = document.getElementById('narrator-overlay');
    if (el) {
      el.textContent = text;
      el.className = 'narrator-flash ' + (cls || 'narrator-red');
      el.style.opacity = '1';
      clearTimeout(narratorTimer);
      narratorTimer = setTimeout(function() {
        el.style.opacity = '0';
      }, 2000);
    }
  }

  // ─── Hill Shapes ───
  function drawHills(startX, width, biome, side) {
    var seed = (biome || 'plains').length * 13 + (side === 'left' ? 0 : 7);
    var hillY = GROUND_Y - 8;
    var hillCls = 'c-hill';

    // Two hill humps
    for (var h = 0; h < 2; h++) {
      var cx = startX + Math.floor(width * (0.25 + h * 0.5));
      var hw = 12 + (seed % 8);
      var hh = 3 + (seed % 3);
      for (var dy = 0; dy < hh; dy++) {
        var rowW = hw - dy * 3;
        if (rowW < 2) break;
        var rx = cx - Math.floor(rowW / 2);
        for (var dx = 0; dx < rowW; dx++) {
          var gx = rx + dx;
          if (gx >= startX && gx < startX + width) {
            var c = (dx === 0 || dx === rowW - 1) ? '/' : '.';
            if (dx === rowW - 1) c = '\\';
            setCell(gx, hillY + dy, c, hillCls);
          }
        }
      }
      seed = (seed * 7 + 3) % 100;
    }
  }

  // ─── Rendering Pipeline ───

  function renderFrame() {
    if (!frame) return;
    initGrid();

    renderSky();
    drawHills(0, LEFT_W, frame.challenger.biome, 'left');
    drawHills(RIGHT_START, RIGHT_W, frame.defender.biome, 'right');
    renderGround();
    renderSpire(2, frame.challenger.spire, 'c-spire-chal');
    renderSpire(W - 10, frame.defender.spire, 'c-spire-def');
    renderBuildings(frame.challenger.buildings, 8, LEFT_W - 5, false, frame.challenger.phase);
    renderBuildings(frame.defender.buildings, RIGHT_START + 5, W - 10, true, frame.defender.phase);
    renderWarriors(frame.challenger.warriors, 'left');
    renderWarriors(frame.defender.warriors, 'right');
    renderBattlefieldEffects();
    renderWeather();

    flushGrid();
  }

  // ─── Sky ───
  function renderSky() {
    var tod = frame.time_of_day || 'day';
    var skyCls = SKY_COLORS[tod] || 'c-sky-day';

    // Stars at night
    if (tod === 'night' || tod === 'dusk') {
      var starSeed = animTick * 0;
      for (var i = 0; i < 30; i++) {
        var sx = (i * 47 + 13) % W;
        var sy = (i * 23 + 7) % (GROUND_Y - 12);
        var starCh = (i % 3 === 0) ? '\u2022' : (i % 3 === 1) ? '\u00b7' : '.';
        var twinkle = ((animTick + i) % 20 < 15);
        if (twinkle) setCell(sx, sy, starCh, 'c-star');
      }
    }

    // Fill sky area with background class
    for (var y = 0; y < 6; y++) {
      for (var x = 0; x < W; x++) {
        if (grid[y][x].ch === ' ') {
          grid[y][x].cls = skyCls;
        }
      }
    }
  }

  // ─── Ground ───
  function renderGround() {
    var cBiome = frame.challenger.biome || 'plains';
    var dBiome = frame.defender.biome || 'plains';
    var cGnd = BIOME_GROUND[cBiome] || BIOME_GROUND.plains;
    var dGnd = BIOME_GROUND[dBiome] || BIOME_GROUND.plains;

    // Determine battlefield phase (worst of both sides)
    var cPhase = frame.challenger.phase || 'clash';
    var dPhase = frame.defender.phase || 'clash';
    var warPhase = 'clash';
    if (cPhase === 'spire' || dPhase === 'spire') warPhase = 'spire';
    else if (cPhase === 'burn' || dPhase === 'burn') warPhase = 'burn';
    var bGnd = BATTLEFIELD_GROUND[warPhase];

    for (var dy = 0; dy < 8; dy++) {
      var y = GROUND_Y + dy;
      if (y >= H) break;
      for (var x = 0; x < W; x++) {
        var ch, cls;
        if (x < LEFT_W) {
          // Challenger ground
          ch = cGnd.chars[(x + dy * 3 + animTick) % cGnd.chars.length];
          cls = cGnd.cls;
        } else if (x < RIGHT_START) {
          // Battlefield
          ch = bGnd.chars[(x + dy * 5 + animTick) % bGnd.chars.length];
          cls = bGnd.cls;
        } else {
          // Defender ground
          ch = dGnd.chars[(x + dy * 3 + animTick) % dGnd.chars.length];
          cls = dGnd.cls;
        }
        setCell(x, y, ch, cls);
      }
    }

    // Ground line
    for (var x = 0; x < W; x++) {
      var borderCh = (x < LEFT_W || x >= RIGHT_START) ? '_' : '=';
      setCell(x, GROUND_Y, borderCh, 'c-ground-line');
    }
  }

  // ─── Spire ───
  function renderSpire(x, spire, cls) {
    if (!spire || spire.segments_total === 0) return;

    var drawY = GROUND_Y - 2; // base

    // Draw base
    for (var i = 0; i < SPIRE_BASE.length; i++) {
      writeStr(x - 1, drawY, SPIRE_BASE[SPIRE_BASE.length - 1 - i], cls);
      drawY--;
    }

    // Draw segments bottom-up
    var total = Math.min(spire.segments_total, 12);
    for (var s = 0; s < total; s++) {
      var seg;
      if (spire.collapsed) {
        seg = SPIRE_SEG_FALLEN;
      } else if (s < spire.segments_fallen) {
        seg = SPIRE_SEG_FALLEN;
      } else if (s < spire.segments_fallen + spire.segments_cracked) {
        seg = SPIRE_SEG_CRACKED;
      } else {
        seg = SPIRE_SEG_INTACT;
      }
      var segCls = cls;
      if (seg === SPIRE_SEG_CRACKED) segCls = 'c-spire-crack';
      if (seg === SPIRE_SEG_FALLEN) segCls = 'c-spire-fallen';
      writeStr(x, drawY, seg, segCls);
      drawY--;
    }

    // Cap
    if (!spire.collapsed && spire.segments_intact > 0) {
      for (var c = SPIRE_CAP.length - 1; c >= 0; c--) {
        writeStr(x, drawY, SPIRE_CAP[c], cls);
        drawY--;
      }
    }
  }

  // ─── Buildings ───
  function renderBuildings(buildings, startX, endX, mirror, phase) {
    if (!buildings || buildings.length === 0) return;

    var maxShow = 8;
    var shown = buildings.slice(0, maxShow);
    var spacing = Math.min(9, Math.floor((endX - startX) / maxShow));

    for (var i = 0; i < shown.length; i++) {
      var b = shown[i];
      var bx;
      if (mirror) {
        bx = endX - (i * spacing);
      } else {
        bx = startX + (i * spacing);
      }

      var art;
      var cls = 'c-bld';
      if (b.visual_state === 'destroyed') {
        art = BUILDING_RUBBLE;
        cls = 'c-bld-ruin';
      } else if (b.visual_state === 'burning') {
        art = BUILDING_ART[b.type] || BUILDING_ART.hut;
        cls = (animTick % 4 < 2) ? 'c-bld-fire' : 'c-bld-fire-alt';
      } else {
        art = BUILDING_ART[b.type] || BUILDING_ART.hut;
      }

      // Draw from ground up
      for (var row = 0; row < art.length; row++) {
        var y = GROUND_Y - art.length + row;
        var line = mirror ? mirrorBuildingLine(art[row]) : art[row];
        writeStr(bx, y, line, cls);
      }
    }
  }

  function mirrorBuildingLine(s) {
    var out = '';
    for (var i = s.length - 1; i >= 0; i--) {
      var c = s[i];
      if (c === '(') out += ')';
      else if (c === ')') out += '(';
      else if (c === '[') out += ']';
      else if (c === ']') out += '[';
      else if (c === '/') out += '\\';
      else if (c === '\\') out += '/';
      else out += c;
    }
    return out;
  }

  // ─── Warriors ───
  function renderWarriors(warriors, side) {
    if (!warriors || warriors.length === 0) return;

    var isLeft = side === 'left';
    var sprites = isLeft ? WARRIOR_SPRITES : WARRIOR_SPRITES_MIRROR;

    // Separate alive from dead
    var alive = warriors.filter(function(w) { return w.state !== 'dead'; });
    var dead = warriors.filter(function(w) { return w.state === 'dead'; });

    // Position warriors: alive ones march toward center
    for (var i = 0; i < alive.length; i++) {
      var w = alive[i];
      var typeSprites = sprites[w.type] || sprites.pincer;
      var stateKey = w.state;
      if (stateKey === 'defending' || stateKey === 'wounded') stateKey = 'fighting';
      var spriteLines = typeSprites[stateKey] || typeSprites.fighting;

      // Calculate x position based on state
      var wx;
      if (isLeft) {
        if (w.state === 'charging') wx = LEFT_W - 15 + i * 5;
        else if (w.state === 'fighting') wx = LEFT_W - 5 + i * 4;
        else if (w.state === 'fallen') wx = LEFT_W - 10 + i * 3;
        else wx = 15 + i * 5; // idle near barracks
      } else {
        if (w.state === 'charging') wx = RIGHT_START + 15 - i * 5;
        else if (w.state === 'fighting') wx = RIGHT_START + 5 - i * 4;
        else if (w.state === 'fallen') wx = RIGHT_START + 10 - i * 3;
        else wx = W - 22 - i * 5; // idle near barracks
      }

      // Clamp to bounds
      wx = Math.max(1, Math.min(W - 8, wx));

      var baseCls = 'c-w-' + w.type;
      if (w.molted) baseCls += ' c-molt-glow';
      if (w.state === 'fallen') baseCls = 'c-w-fallen';

      // Animation bob
      var bobOffset = (w.state === 'fighting') ? ((animTick + i * 3) % 6 < 3 ? 0 : -1) : 0;

      // Draw sprite
      for (var row = 0; row < spriteLines.length; row++) {
        var wy = GROUND_Y - spriteLines.length + row + bobOffset;
        writeStr(wx, wy, spriteLines[row], baseCls);
      }

      // Name + type label under warrior
      var label = w.name.slice(0, 4) + w.type[0].toUpperCase() + w.level;
      var labelX = wx + Math.floor((7 - label.length) / 2);
      writeStr(labelX, GROUND_Y + 1, label, baseCls);
    }

    // Draw dead warriors collapsed on battlefield ground
    for (var d = 0; d < dead.length; d++) {
      var dw = dead[d];
      var dtSprites = sprites[dw.type] || sprites.pincer;
      var deadLines = dtSprites.dead || dtSprites.fallen;

      var dx;
      if (isLeft) {
        dx = LEFT_W - 5 + d * 6;
      } else {
        dx = RIGHT_START + 5 - d * 6;
      }
      dx = Math.max(LEFT_W - 10, Math.min(RIGHT_START + 10, dx));

      for (var row = 0; row < deadLines.length; row++) {
        var dy = GROUND_Y - 2 + row;
        writeStr(dx, dy, deadLines[row], 'c-w-dead');
      }
    }
  }

  // ─── Battlefield Center Effects ───
  function renderBattlefieldEffects() {
    if (!frame || !frame.latest_round) return;

    var lr = frame.latest_round;

    // Show "VS" or round action in the center
    var centerX = LEFT_W + Math.floor(CENTER_W / 2) - 3;
    var centerY = GROUND_Y - 12;

    if (frame.status === 'active' && frame.round > 0) {
      // Clash text
      var clashText = '  \u2694\u2694\u2694  ';
      writeStr(centerX, centerY, clashText, 'c-war-clash');

      // Damage display
      if (lr.damage) {
        if (lr.damage.defender > 0) {
          var dmgStr = '-' + lr.damage.defender;
          writeStr(centerX - 5, centerY + 2, dmgStr, 'c-dmg-chal');
        }
        if (lr.damage.challenger > 0) {
          var dmgStr2 = '-' + lr.damage.challenger;
          writeStr(centerX + 8, centerY + 2, dmgStr2, 'c-dmg-def');
        }
      }
    } else if (frame.status === 'countdown') {
      writeStr(centerX - 2, centerY, '  PREPARE  ', 'c-war-countdown');
      writeStr(centerX - 2, centerY + 1, '  FOR WAR  ', 'c-war-countdown');
    } else if (frame.status === 'pending') {
      writeStr(centerX - 3, centerY, '  CHALLENGE  ', 'c-war-pending');
      writeStr(centerX - 2, centerY + 1, '  ISSUED   ', 'c-war-pending');
    }

    // Tactical event text in battlefield zone
    if (lr.tactical_event && lr.tactical_event.description) {
      var evtText = lr.tactical_event.description.slice(0, CENTER_W - 2);
      var evtX = LEFT_W + 1;
      writeStr(evtX, GROUND_Y - 4, evtText, 'c-war-event');
    }
  }

  // ─── Weather Particles ───
  function renderWeather() {
    if (!frame) return;
    var w = frame.weather || 'clear';
    var chars = WEATHER_CHARS[w];
    if (!chars) return;

    var count = (w === 'storm') ? 25 : (w === 'rain') ? 15 : (w === 'snow') ? 10 : 5;
    for (var i = 0; i < count; i++) {
      var wx = ((animTick * (i * 7 + 3) + i * 47) % W);
      var wy = ((animTick * (i * 3 + 1) + i * 23) % (GROUND_Y - 2));
      var wch = chars[i % chars.length];
      setCell(wx, wy, wch, 'c-weather');
    }
  }

  // ─── Narrator Check ───
  function checkNarratorTriggers() {
    if (!frame || !frame.latest_round) return;
    if (!prevFrame || frame.round === (prevFrame ? prevFrame.round : -1)) return;

    var lr = frame.latest_round;

    // Tactical event narrator
    if (lr.tactical_event && lr.tactical_event.type) {
      var txt = pickNarrator(lr.tactical_event.type);
      if (txt) triggerNarrator(txt, 'narrator-red');
    }

    // Skill narrator
    if (lr.skill_used && lr.skill_used.color) {
      var skillTxt = pickNarrator('skill_' + lr.skill_used.color);
      if (skillTxt) triggerNarrator(skillTxt, 'narrator-' + lr.skill_used.color);
    }

    // Phase transition
    var cOldPhase = prevFrame ? prevFrame.challenger.phase : 'clash';
    var dOldPhase = prevFrame ? prevFrame.defender.phase : 'clash';
    if (frame.challenger.phase === 'burn' && cOldPhase === 'clash') {
      triggerNarrator(pickNarrator('enter_burn') || 'FIRE!', 'narrator-orange');
    }
    if (frame.defender.phase === 'burn' && dOldPhase === 'clash') {
      triggerNarrator(pickNarrator('enter_burn') || 'FIRE!', 'narrator-orange');
    }
    if (frame.challenger.phase === 'spire' && cOldPhase !== 'spire') {
      triggerNarrator(pickNarrator('enter_spire') || 'THE SPIRE!', 'narrator-red');
    }
    if (frame.defender.phase === 'spire' && dOldPhase !== 'spire') {
      triggerNarrator(pickNarrator('enter_spire') || 'THE SPIRE!', 'narrator-red');
    }

    // Mass casualty check (from narrative text)
    if (lr.narrative && lr.narrative.indexOf(' lost ') !== -1) {
      var lostCount = (lr.narrative.match(/,/g) || []).length + 1;
      if (lostCount >= 3) {
        triggerNarrator(pickNarrator('mass_casualty') || 'MASSACRE!', 'narrator-red');
      }
    }
  }

  // ─── Flush Grid to DOM ───
  function flushGrid() {
    var pre = document.getElementById('war-grid');
    if (!pre) return;

    var html = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var cell = grid[y][x];
        if (cell.cls) {
          html += '<span class="' + cell.cls + '">' + escHtml(cell.ch) + '</span>';
        } else {
          html += escHtml(cell.ch);
        }
      }
      html += '\n';
    }

    pre.innerHTML = html;
  }

  function escHtml(s) {
    if (s === '<') return '&lt;';
    if (s === '>') return '&gt;';
    if (s === '&') return '&amp;';
    if (s === '"') return '&quot;';
    return s;
  }

  // ─── SSE + Init ───
  function init() {
    var pathParts = window.location.pathname.split('/');
    warId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

    if (!warId) {
      document.getElementById('war-status-text').textContent = 'No war ID — go back to /arena';
      return;
    }

    initGrid();
    fetchInitialFrame().then(function() {
      connectSSE();
      startAnimLoop();
    });
  }

  function fetchInitialFrame() {
    return fetch('/api/wars/' + warId + '/frame')
      .then(function(resp) {
        if (!resp.ok) {
          document.getElementById('war-status-text').textContent = 'War not found (' + resp.status + ')';
          return;
        }
        return resp.json();
      })
      .then(function(data) {
        if (data) applyFrame(data);
      })
      .catch(function(err) {
        document.getElementById('war-status-text').textContent = 'Error: ' + err.message;
      });
  }

  function connectSSE() {
    if (eventSource) eventSource.close();

    eventSource = new EventSource('/api/stream/war?war_id=' + warId);
    document.getElementById('war-status-text').textContent = 'LIVE';

    eventSource.addEventListener('war', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'frame' || data.challenger) {
          applyFrame(data);
        }
      } catch(ex) { /* ignore bad JSON */ }
    });

    eventSource.addEventListener('error', function() {
      document.getElementById('war-status-text').textContent = 'Reconnecting...';
    });
  }

  function applyFrame(data) {
    prevFrame = frame;
    frame = data;

    updateHeader();
    updateSkillBar();
    updateBattleLog();
    checkNarratorTriggers();

    if (frame.status === 'resolved') {
      showResolved();
    }
  }

  // ─── Header Updates ───
  function updateHeader() {
    if (!frame) return;
    var c = frame.challenger;
    var d = frame.defender;

    document.getElementById('challenger-name').textContent = c.name || '???';
    document.getElementById('defender-name').textContent = d.name || '???';

    var cPct = Math.max(0, (c.hp / c.max_hp) * 100);
    var dPct = Math.max(0, (d.hp / d.max_hp) * 100);
    document.getElementById('challenger-hp-fill').style.width = cPct + '%';
    document.getElementById('defender-hp-fill').style.width = dPct + '%';
    document.getElementById('challenger-hp-text').textContent = Math.max(0, c.hp) + '/' + c.max_hp;
    document.getElementById('defender-hp-text').textContent = Math.max(0, d.hp) + '/' + d.max_hp;

    setPhaseLabel('challenger-phase', c.phase);
    setPhaseLabel('defender-phase', d.phase);

    document.getElementById('war-round').textContent = 'Round ' + frame.round + '/' + frame.max_rounds;

    var weatherEl = document.getElementById('war-weather');
    if (frame.weather && frame.weather !== 'clear') {
      weatherEl.textContent = frame.weather + ' \u00b7 ' + (frame.time_of_day || '');
    } else {
      weatherEl.textContent = frame.time_of_day || '';
    }

    // Warrior count display
    var cAlive = (c.warriors || []).filter(function(w) { return w.state !== 'dead'; }).length;
    var dAlive = (d.warriors || []).filter(function(w) { return w.state !== 'dead'; }).length;
    var cWar = document.getElementById('challenger-warriors');
    var dWar = document.getElementById('defender-warriors');
    if (cWar) cWar.textContent = '\u2694 ' + cAlive;
    if (dWar) dWar.textContent = '\u2694 ' + dAlive;
  }

  function setPhaseLabel(id, phase) {
    var el = document.getElementById(id);
    el.textContent = (phase || 'clash').toUpperCase();
    el.className = 'side-phase';
    if (phase === 'clash') el.classList.add('phase-clash');
    else if (phase === 'burn') el.classList.add('phase-burn');
    else if (phase === 'spire') el.classList.add('phase-spire');
  }

  // ─── Skill Bar ───
  function updateSkillBar() {
    if (!frame) return;
    renderSkillRow('challenger-skills', frame.challenger.skills);
    renderSkillRow('defender-skills', frame.defender.skills);
  }

  function renderSkillRow(containerId, skills) {
    var el = document.getElementById(containerId);
    if (!skills || skills.length === 0) {
      el.innerHTML = '<span style="color:var(--dim);font-size:10px">No skills</span>';
      return;
    }
    el.innerHTML = skills.map(function(s) {
      var usedClass = s.used ? ' used' : '';
      var icon = s.used ? '\u2717' : '\u25cb';
      return '<span class="skill-badge ' + (s.color || 'red') + usedClass + '">' + icon + ' ' + escapeHtml(s.name) + '</span>';
    }).join('');
  }

  // ─── Battle Log ───
  function updateBattleLog() {
    if (!frame) return;
    var logEl = document.getElementById('battle-log');
    var entries = (frame.battle_log || []).map(function(line) {
      var html = escapeHtml(line || '');
      html = html.replace(/\[SKILL\]\s*([^!]+)!/g, '<span class="skill-text">\u26a1 $1</span>');
      html = html.replace(/(\d+)\s*dmg/gi, '<span class="damage-text">$1 dmg</span>');
      html = html.replace(/(BURN|SPIRE|CLASH)/g, '<span class="phase-text">$1</span>');
      html = html.replace(/lost\s+([^!]+)!/g, '<span class="casualty-text">lost $1!</span>');
      return '<div class="log-entry">' + html + '</div>';
    });
    logEl.innerHTML = entries.join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ─── Resolved ───
  function showResolved() {
    var overlay = document.getElementById('war-resolved');
    if (!overlay || !frame) return;
    overlay.classList.add('visible');

    var c = frame.challenger;
    var d = frame.defender;
    var cWon = c.hp > d.hp;
    var winner = cWon ? c.name : d.name;
    var loser = cWon ? d.name : c.name;
    var isDraw = c.hp === d.hp;

    var html = '';
    if (isDraw) {
      html += '<div class="victory">DRAW</div>';
      html += '<div class="detail">Both civilizations survive... barely.</div>';
    } else {
      html += '<div class="victory">VICTORY</div>';
      html += '<div class="detail">' + escapeHtml(winner) + ' conquers ' + escapeHtml(loser) + '</div>';
      html += '<div class="detail">Final HP: ' + Math.max(c.hp, d.hp) + '/' + c.max_hp + '</div>';
      html += '<div class="detail">Rounds fought: ' + frame.round + '</div>';
    }
    html += '<a href="/arena">&lt; Back to Arena</a> <a href="/">Home</a>';
    overlay.innerHTML = html;

    triggerNarrator(isDraw ? 'BOTH STAND. NEITHER WINS.' : escapeHtml(winner) + ' IS VICTORIOUS!', 'narrator-gold');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Animation Loop ───
  function startAnimLoop() {
    if (animInterval) clearInterval(animInterval);
    animInterval = setInterval(function() {
      animTick++;
      if (frame) renderFrame();
    }, 1000 / FPS);
  }

  // ─── Boot ───
  document.addEventListener('DOMContentLoaded', function() {
    if (!document.getElementById('war-resolved')) {
      var resolved = document.createElement('div');
      resolved.id = 'war-resolved';
      var container = document.getElementById('war-container');
      if (container) container.appendChild(resolved);
    }
    init();
  });

})();
