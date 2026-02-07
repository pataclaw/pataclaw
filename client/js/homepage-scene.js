// ─── HOMEPAGE DEMO SCENE ───
// Self-contained animated ASCII demo, zero server dependency.
// 60x30 grid, 12fps, 4 vignettes cycling every 8 seconds.
// Updated to reflect actual game features: raids, culture, trading, seasons.

(function () {
  var W = 60, H = 30;
  var FPS = 12;
  var VIGNETTE_FRAMES = 96; // 8 seconds at 12fps
  var TRANSITION_FRAMES = 12;
  var frameCount = 0;
  var currentVignette = 0;
  var vignetteFrame = 0;
  var waveCounter = 0;
  var secretActive = false;

  var sceneEl = document.getElementById('demo-scene');
  var labelEl = document.getElementById('scene-label');
  if (!sceneEl) return;

  var labels = [
    'Your agent builds the town. Huts, farms, temples, markets, docks \u2014 all yours.',
    'Raiders attack. Warriors defend the walls. Survive or fall.',
    'Send scouts into the unknown. Find ruins, ore, springs, and danger.',
    'Culture emerges. Villagers create art, trade, teach, and molt.',
  ];
  var secretLabel = 'You found the dragon. Konami code accepted.';

  // ─── Grid helpers ───
  function setCell(grid, x, y, ch, c) {
    if (y >= 0 && y < H && x >= 0 && x < W) grid[y][x] = { ch: ch, c: c || '' };
  }
  function getCell(grid, x, y) {
    if (y >= 0 && y < H && x >= 0 && x < W) return grid[y][x];
    return { ch: ' ', c: '' };
  }
  function escChar(ch) {
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '&') return '&amp;';
    return ch;
  }
  function wrapRun(text, cls) {
    return cls ? '<span class="' + cls + '">' + text + '</span>' : text;
  }
  function composeHTML(grid) {
    var lines = [];
    for (var y = 0; y < H; y++) {
      var row = grid[y];
      var html = '', run = '', runClass = '';
      for (var x = 0; x < W; x++) {
        var cell = row[x];
        var ch = typeof cell === 'string' ? cell : cell.ch;
        var c = typeof cell === 'string' ? '' : (cell.c || '');
        if (c === runClass) { run += escChar(ch); }
        else { if (run) html += wrapRun(run, runClass); run = escChar(ch); runClass = c; }
      }
      if (run) html += wrapRun(run, runClass);
      lines.push(html);
    }
    return lines.join('\n');
  }
  function makeGrid() {
    var grid = [];
    for (var y = 0; y < H; y++) {
      grid[y] = [];
      for (var x = 0; x < W; x++) grid[y][x] = { ch: ' ', c: '' };
    }
    return grid;
  }
  function drawText(grid, x, y, text, c) {
    for (var i = 0; i < text.length; i++) {
      if (x + i >= 0 && x + i < W && text[i] !== ' ') setCell(grid, x + i, y, text[i], c);
    }
  }
  function drawSprite(grid, x, y, lines, c) {
    for (var r = 0; r < lines.length; r++) {
      drawText(grid, x, y + r, lines[r], c);
    }
  }

  // ─── Common elements ───
  var GROUND_Y = 22;

  function drawGround(grid) {
    var waveChars = [',', "'", '`', '.'];
    for (var gx = 0; gx < W; gx++) {
      setCell(grid, gx, GROUND_Y, '\u2550', 'c-gndl');
      for (var gy = GROUND_Y + 1; gy < H; gy++) {
        var wave = Math.sin((gx * 0.3) + (gy * 0.5) - (waveCounter * 0.10));
        var ci = Math.floor((wave + 1) * 2) % waveChars.length;
        if (Math.abs(wave) > 0.2) setCell(grid, gx, gy, waveChars[ci], 'c-gnd');
      }
    }
  }

  // ─── Building sprites (matching actual game sprites) ───
  var HUT_SPRITE = [
    '    ()    ',
    '   /\\/\\   ',
    '  /~~~~\\  ',
    ' / ~  ~ \\ ',
    '/________\\',
    '|  |  |  |',
    '|__|[]|__|',
  ];

  var FARM_SPRITE = [
    '  _  \\|/  ',
    ' /_\\--*-- ',
    ' | |  |   ',
    ' | | /|\\  ',
    ' |_|.~~~. ',
    ' | |^^^^^|',
    ' |_|_____|',
  ];

  var WALL_SPRITE = [
    ']========[',
    '|/\\/\\/\\/\\|',
    '|        |',
    '|  /<>\\  |',
    '|        |',
    '|/\\/\\/\\/\\|',
    ']========[',
  ];

  var TEMPLE_SPRITE = [
    '     +      ',
    '    /+\\     ',
    '   / + \\    ',
    '  /=====\\   ',
    ' ||| + |||  ',
    ' ||| + |||  ',
    '/||=====||\\ ',
    '|_|__[]__|_|',
  ];

  var MARKET_SPRITE = [
    ' .$$$$$.  ',
    '/~*~*~*~\\ ',
    '| ~ ~ ~ ~|',
    '| [o][o] |',
    '| |==|=| |',
    '|_|__|_|_|',
  ];

  var WORKSHOP_SPRITE = [
    ' _===_  ~ ',
    '|o||o| /~\\',
    '|_/\\_||  |',
    '|[><]|| _|',
    '| /\\ ||/ |',
    '|/()\\||  |',
    '|____|/__|',
  ];

  var DOCK_SPRITE = [
    ' ~~\\|/~~  ',
    '  _===_   ',
    ' |~o~~o|  ',
    ' | net |  ',
    '/|=====|\\ ',
    '~|_<>)_|~ ',
    '~~~~~~~~~~',
  ];

  var WATCHTOWER_SPRITE = [
    '  _/\\_  ',
    ' |*..*| ',
    ' |_/\\_| ',
    '  |  |  ',
    ' _|  |_ ',
    '|_|  |_|',
    '  |  |  ',
    ' _|  |_ ',
    '|__[]__|',
  ];

  // ─── Cloud templates ───
  var CLOUDS = {
    wispy: ['  .---.  '],
    small: ['  .----.  ', ' /~~~~~~\\ '],
    medium: [
      '   .___.         ',
      ' _/~~~~~\\___     ',
      '/~~~~~~~~~~~\\__  ',
    ],
    large: [
      '    ._______.        ',
      '  _/~~~~~~~~~\\_____  ',
      ' /~~~~~~~~~~~~~~~~~\\ ',
      '/~~~~~~~~~~~~~~~~~~~\\',
    ],
    puffy: [
      '    .____.     ',
      '  _/~~~~~~\\__  ',
      ' /~~~~~~~~~~\\\\ ',
    ],
  };

  function makeCloud(type, x, y, speed) {
    return { x: x, y: y, speed: speed, template: CLOUDS[type], width: CLOUDS[type][0].length };
  }

  function drawClouds(grid, clouds, colorClass) {
    for (var ci = 0; ci < clouds.length; ci++) {
      var cloud = clouds[ci];
      cloud.x -= cloud.speed;
      if (cloud.x < -cloud.width) cloud.x = W + 5 + Math.random() * 15;
      var cx = Math.round(cloud.x);
      for (var r = 0; r < cloud.template.length; r++) {
        var row = cloud.template[r];
        for (var c = 0; c < row.length; c++) {
          var gx = cx + c, gy = cloud.y + r;
          if (gx >= 0 && gx < W && gy >= 0 && gy < H && row[c] !== ' ')
            setCell(grid, gx, gy, row[c], colorClass || 'c-sky');
        }
      }
    }
  }

  // Shared clouds per vignette
  var v1clouds = [makeCloud('small', 8, 2, 0.04), makeCloud('wispy', 40, 4, 0.03)];
  var v2clouds = [makeCloud('medium', 2, 1, 0.03), makeCloud('puffy', 42, 3, 0.05)];
  var v3clouds = [makeCloud('puffy', 3, 1, 0.035), makeCloud('small', 42, 3, 0.05)];
  var v4clouds = [makeCloud('large', 5, 1, 0.06), makeCloud('medium', 38, 2, 0.04)];

  // ─── Vignette 1: Building Your Town (shows farm, hut, temple materializing) ───
  function renderBuilding(grid, f) {
    drawClouds(grid, v1clouds, 'c-sky');

    // Static hut on left
    drawSprite(grid, 1, GROUND_Y - 7, HUT_SPRITE, 'c-b-hut');
    drawText(grid, 3, GROUND_Y + 1, 'HUT', 'c-lbl');

    // Static farm next to it
    drawSprite(grid, 13, GROUND_Y - 7, FARM_SPRITE, 'c-b-farm');
    drawText(grid, 14, GROUND_Y + 1, 'FARM', 'c-lbl');

    // Builder walks to build site
    var builderTarget = 26;
    var walkEnd = Math.min(f, 30);
    var bx = Math.round(14 + (builderTarget - 14) * (walkEnd / 30));
    var builderY = GROUND_Y - 6;

    if (f < 30) {
      var step = f % 3;
      var bLines = ['  _n_  ', ' .---. ', '| o.o |', '|  >  |', "'-+-+' ", step ? ' d  b ' : '  db  '];
      drawSprite(grid, bx, builderY, bLines, 'c-walk');
      if (f > 15) {
        drawText(grid, bx - 1, builderY - 2, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-spr');
        drawText(grid, bx - 1, builderY - 1, '\u2502 temple?  \u2502', 'c-spr');
        drawText(grid, bx - 1, builderY,     '\u2514\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-spr');
      }
    } else {
      // Builder working
      var workChars = ['*', '+', 'x', '.', '*', '+'];
      var wf = (f - 30) % 6;
      drawSprite(grid, builderTarget, builderY, ['  _n_  ', ' .---. ', '| o.o |', '|  >  |', "'-+-+'" + workChars[wf], ' d   b '], 'c-b-temple');

      if (f > 34 && f < 55) {
        drawText(grid, builderTarget - 1, builderY - 2, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-spr');
        drawText(grid, builderTarget - 1, builderY - 1, '\u2502 *BANG BANG* \u2502', 'c-spr');
        drawText(grid, builderTarget - 1, builderY,     '\u2514\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-spr');
      }
    }

    // Temple materializes with matrix effect
    var matrixChars = ['0', '1', '{', '}', '[', ']', '<', '>', '/', '\\', '|', ';'];
    var t = Math.min(1, Math.max(0, (f - 30) / 55));
    var ts = TEMPLE_SPRITE;
    var tsX = 38, tsY = GROUND_Y - ts.length;
    for (var r = 0; r < ts.length; r++) {
      for (var c = 0; c < ts[r].length; c++) {
        if (ts[r][c] === ' ') continue;
        var cellSeed = ((r * 7 + c * 13 + 42) % 100) / 100;
        var gx = tsX + c, gy = tsY + r;
        if (gx >= W || gy >= H) continue;
        if (cellSeed < t) {
          if (cellSeed > t - 0.15 && f % 4 < 2) {
            setCell(grid, gx, gy, matrixChars[(f + r + c) % matrixChars.length], 'c-spr');
          } else {
            setCell(grid, gx, gy, ts[r][c], 'c-b-temple');
          }
        } else if (cellSeed < t + 0.12) {
          setCell(grid, gx, gy, matrixChars[(f * 3 + r * 7 + c) % matrixChars.length], 'c-spr');
        }
      }
    }
    if (t > 0.8) drawText(grid, 40, GROUND_Y + 1, 'TEMPLE', 'c-lbl');
  }

  // ─── Vignette 2: Raid Defense ───
  function renderRaidDefense(grid, f) {
    drawClouds(grid, v2clouds, f > 60 ? 'c-dusk' : 'c-sky');

    // Wall on the right side of town
    drawSprite(grid, 30, GROUND_Y - 7, WALL_SPRITE, 'c-b-wall');
    drawText(grid, 32, GROUND_Y + 1, 'WALL', 'c-lbl');

    // Watchtower behind wall
    drawSprite(grid, 42, GROUND_Y - 9, WATCHTOWER_SPRITE, 'c-b-watchtower');

    // Hut being defended
    drawSprite(grid, 2, GROUND_Y - 7, HUT_SPRITE, 'c-b-hut');

    // Warriors defending
    var warrior1Y = GROUND_Y - 6;
    var w1Frame = f % 4;
    var swordAnim = ['|>', '/>', '|>', '\\>'];
    drawSprite(grid, 22, warrior1Y, [
      ' ]=+=[ ',
      ' .---. ',
      '| >.> |',
      '|  >  |',
      "'-+-+'" + swordAnim[w1Frame],
      ' d   b ',
    ], 'c-fight');

    // Second warrior
    drawSprite(grid, 16, warrior1Y, [
      ' ]=+=[ ',
      ' .---. ',
      '| o.o |',
      '|  >  |',
      "'-+-+'" + swordAnim[(w1Frame + 2) % 4],
      w1Frame % 2 ? ' d  b ' : '  db  ',
    ], 'c-fight');

    // Raiders approaching from right
    var raidPhase = f / VIGNETTE_FRAMES;
    var raiderBaseX = W + 5 - Math.round(f * 0.6);

    for (var ri = 0; ri < 3; ri++) {
      var rx = raiderBaseX + ri * 7;
      if (rx < 34 || rx > W - 4) continue;
      var raiderStep = (f + ri * 3) % 4;
      var raiderLines = [
        '  _X_  ',
        ' .---. ',
        '| x_x |',
        '|  <  |',
        raiderStep < 2 ? "'-+-+' " : " '-+-+'",
        raiderStep % 2 ? ' d  b ' : '  db  ',
      ];
      drawSprite(grid, rx, GROUND_Y - 6, raiderLines, 'c-fire');
    }

    // Combat sparks when raiders are close
    if (raiderBaseX < 42) {
      var sparkChars = ['*', '+', 'x', '#', '*', '!'];
      for (var si = 0; si < 4; si++) {
        var sx = 33 + Math.round(Math.sin(f * 0.5 + si) * 4);
        var sy = GROUND_Y - 3 - (f + si * 7) % 5;
        if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
          setCell(grid, sx, sy, sparkChars[(f + si) % sparkChars.length], 'c-fire');
        }
      }
    }

    // Alert message
    if (f > 5 && f < 35) {
      drawText(grid, 3, 4, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-fire');
      drawText(grid, 3, 5, '\u2502 !! RAID INCOMING !! \u2502', 'c-fire');
      drawText(grid, 3, 6, '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-fire');
    }

    // Victory message at end
    if (f > 75) {
      drawText(grid, 3, 4, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-cele');
      drawText(grid, 3, 5, '\u2502  RAIDERS REPELLED!  \u2502', 'c-cele');
      drawText(grid, 3, 6, '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-cele');
    }
  }

  // ─── Vignette 3: Explore the Unknown ───
  function renderExplore(grid, f) {
    drawClouds(grid, v3clouds, 'c-sky');
    var scoutX = Math.round(8 + f * 0.5);
    var fogStart = Math.max(scoutX + 4, 8);

    var terrainFeatures = [
      { x: 30, ch: '\u2663', c: 'c-terr' },
      { x: 33, ch: '\u2663', c: 'c-terr' },
      { x: 37, ch: '\u25b3', c: 'c-hill' },
      { x: 41, ch: '\u273f', c: 'c-art' },
      { x: 44, ch: '\u25c7', c: 'c-cele' },  // ruins
      { x: 48, ch: '\u2663', c: 'c-terr' },
      { x: 52, ch: '\u25b3', c: 'c-hill' },
    ];

    for (var ti = 0; ti < terrainFeatures.length; ti++) {
      var tf = terrainFeatures[ti];
      if (tf.x < fogStart) {
        setCell(grid, tf.x, GROUND_Y - 1, tf.ch, tf.c);
      }
    }

    // Fog of war
    for (var fy = 4; fy < GROUND_Y; fy++) {
      for (var fx = fogStart; fx < W; fx++) {
        if (getCell(grid, fx, fy).ch === ' ') {
          setCell(grid, fx, fy, '\u2591', 'c-fog');
        }
      }
    }

    // Scout walking
    var step = f % 3;
    var scoutLines = [
      '  />   ',
      ' .---. ',
      '| o_o |',
      '|  >  |',
      "'-+-+' ",
      step === 0 ? ' d  b ' : step === 1 ? '  db  ' : ' d  b ',
    ];
    drawSprite(grid, Math.min(scoutX, W - 8), GROUND_Y - 6, scoutLines, 'c-scout');

    // Discovery speech bubbles
    if (f > 40 && f < 60) {
      var sy = GROUND_Y - 9;
      var sx = Math.min(scoutX, W - 14);
      drawText(grid, sx, sy,     '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-spr');
      drawText(grid, sx, sy + 1, '\u2502 "ruins!" \u2502', 'c-spr');
      drawText(grid, sx, sy + 2, '\u2514\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-spr');
    } else if (f >= 60 && f < 80) {
      var sy2 = GROUND_Y - 9;
      var sx2 = Math.min(scoutX, W - 16);
      drawText(grid, sx2, sy2,     '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-cele');
      drawText(grid, sx2, sy2 + 1, '\u2502 +5 knowledge \u2502', 'c-cele');
      drawText(grid, sx2, sy2 + 2, '\u2514\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-cele');
    }

    // Home base
    drawSprite(grid, 1, GROUND_Y - 7, HUT_SPRITE, 'c-b-hut');
  }

  // ─── Vignette 4: Culture & Social ───
  function renderCulture(grid, f) {
    drawClouds(grid, v4clouds, 'c-sky');

    // Market on the left
    drawSprite(grid, 1, GROUND_Y - 6, MARKET_SPRITE, 'c-b-market');
    drawText(grid, 2, GROUND_Y + 1, 'MARKET', 'c-lbl');

    // Dock on the right
    drawSprite(grid, 48, GROUND_Y - 7, DOCK_SPRITE, 'c-b-dock');
    drawText(grid, 50, GROUND_Y + 1, 'DOCK', 'c-lbl');

    // Artist painting mural
    var artFrame = f % 6;
    var brushChars = ['/', '-', '\\', '|', '/', '-'];
    drawSprite(grid, 13, GROUND_Y - 5, [
      ' .---. ',
      '| *.* |',
      '|  o  |',
      "'-+-+'" + brushChars[artFrame],
      ' d   b [=]',
    ], 'c-art');

    // Mural being painted (materializes over time)
    var MURAL = [
      ' .=====. ',
      '||/\\~*/||',
      '||*~/\\#||',
      '||#~/~*||',
      '||~/\\*#||',
      " '=====' ",
    ];
    var muralT = Math.min(1, f / 70);
    var mX = 22, mY = GROUND_Y - 6;
    for (var r = 0; r < MURAL.length; r++) {
      for (var c = 0; c < MURAL[r].length; c++) {
        if (MURAL[r][c] === ' ') continue;
        var seed = ((r * 11 + c * 7 + 37) % 100) / 100;
        if (seed < muralT) {
          setCell(grid, mX + c, mY + r, MURAL[r][c], 'c-projd');
        }
      }
    }
    if (muralT > 0.8) drawText(grid, 23, GROUND_Y + 1, 'MURAL', 'c-lbl');

    // Musician with notes
    var noteY = f % 3;
    var notes = ['\u266a', '\u266b', '\u266a'];
    setCell(grid, 37, GROUND_Y - 7 + noteY, notes[f % 3][0], 'c-note');
    drawSprite(grid, 34, GROUND_Y - 5, [
      ' .---. ',
      '| ^.^ |',
      '|  D  |',
      "'-+-+' ",
      '  db   ',
    ], 'c-art');

    // Priest at right doing ceremony
    var priestFrame = f % 8;
    var priestArms = priestFrame < 4 ? '\\o/' : ' o ';
    drawText(grid, 42, GROUND_Y - 6, '  ' + priestArms + '  ', 'c-cele');
    drawSprite(grid, 41, GROUND_Y - 5, [
      '  _+_  ',
      ' .---. ',
      '| ^_^ |',
      '|  D  |',
      "'-+-+' ",
    ], 'c-cele');

    // Lobster scuttling along the ground
    var lobX = W - 3 - Math.round(f * 0.4) % (W + 6);
    if (lobX < -6) lobX += W + 6;
    var lobFrame = f % 4;
    var lobClaws = lobFrame < 2 ? '<\\))><' : '</))(>';
    drawText(grid, lobX, GROUND_Y - 1, lobClaws, 'c-fire');

    // Teaching phrase popup
    if (f > 50 && f < 75) {
      drawText(grid, 14, 5, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-cele');
      drawText(grid, 14, 6, '\u2502 "from shell we rise!" \u2502', 'c-cele');
      drawText(grid, 14, 7, '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-cele');
    }
  }

  // ─── SECRET Vignette 5: The Dragon ───
  function renderDragon(grid, f) {
    var fireChars = ['^', '*', '~', '#', '^', '*'];
    for (var fy = 2; fy < GROUND_Y; fy++) {
      for (var fx = 0; fx < W; fx++) {
        if (Math.random() < 0.03)
          setCell(grid, fx, fy, fireChars[Math.floor(Math.random() * 6)], 'c-fire');
      }
    }

    var dx = 15 + Math.round(Math.sin(f * 0.08) * 8);
    var dy = 4 + Math.round(Math.sin(f * 0.12) * 2);
    drawSprite(grid, dx, dy, [
      '    /\\_/\\    ',
      '   ( o.o )   ',
      '   />o o<\\   ',
      '  / |   | \\  ',
      ' /  |   |  \\ ',
      '(____|___|____)',
      '   /     \\   ',
      '  / ~   ~ \\  ',
      ' /  RAWR!  \\ ',
    ], 'c-fire');

    for (var vi = 0; vi < 5; vi++) {
      var vx = Math.round((f * (1.5 + vi * 0.3) + vi * 13) % (W - 4));
      var panic = f % 4;
      drawSprite(grid, vx, GROUND_Y - 3, [
        panic < 2 ? '\\o/' : '/o\\', ' | ', panic % 2 ? '/ \\' : ' | ',
      ], 'c-fight');
    }

    var rubble = ['#', '%', '=', '_', '.'];
    for (var rx = 3; rx < 12; rx++) setCell(grid, rx, GROUND_Y - 1, rubble[rx % 5], 'c-bld');
    for (var rx2 = 45; rx2 < 54; rx2++) setCell(grid, rx2, GROUND_Y - 1, rubble[rx2 % 5], 'c-bld');

    if (f > 10 && f < 50) {
      drawText(grid, dx + 2, dy - 2, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-fire');
      drawText(grid, dx + 2, dy - 1, '\u2502 you found me! \u2502', 'c-fire');
      drawText(grid, dx + 2, dy,     '\u2514\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-fire');
    } else if (f >= 50) {
      drawText(grid, dx + 2, dy - 2, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-cele');
      drawText(grid, dx + 2, dy - 1, '\u2502  \u2191\u2191\u2193\u2193\u2190\u2192\u2190\u2192 B A  \u2502', 'c-cele');
      drawText(grid, dx + 2, dy,     '\u2514\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-cele');
    }
  }

  // ─── Scanline transition wipe ───
  function applyTransition(grid, f, totalF) {
    var wipeIn = f >= totalF - TRANSITION_FRAMES;
    var wipeOut = f < TRANSITION_FRAMES;

    if (wipeIn) {
      var progress = f - (totalF - TRANSITION_FRAMES);
      var rows = Math.min(H, (progress + 1) * 3);
      for (var y = 0; y < rows; y++)
        for (var x = 0; x < W; x++)
          setCell(grid, x, y, '\u2500', 'c-wipe');
    } else if (wipeOut) {
      var cleared = Math.min(H, (f + 1) * 3);
      for (var y2 = cleared; y2 < H; y2++)
        for (var x2 = 0; x2 < W; x2++)
          setCell(grid, x2, y2, '\u2500', 'c-wipe');
    }
  }

  // ─── All vignettes (index 4 = secret dragon) ───
  var allVignettes = [renderBuilding, renderRaidDefense, renderExplore, renderCulture, renderDragon];

  // ─── Single render function ───
  function doRender() {
    waveCounter++;
    var grid = makeGrid();
    drawGround(grid);

    var idx = secretActive ? 4 : currentVignette;
    allVignettes[idx](grid, vignetteFrame);

    if (!secretActive) applyTransition(grid, vignetteFrame, VIGNETTE_FRAMES);

    sceneEl.innerHTML = composeHTML(grid);

    if (!secretActive) {
      var inTransition = vignetteFrame >= VIGNETTE_FRAMES - TRANSITION_FRAMES || vignetteFrame < TRANSITION_FRAMES;
      if (inTransition) {
        labelEl.style.opacity = '0';
      } else if (vignetteFrame === TRANSITION_FRAMES) {
        labelEl.textContent = labels[currentVignette];
        labelEl.style.opacity = '1';
      }
    }

    vignetteFrame++;
    frameCount++;
    if (vignetteFrame >= VIGNETTE_FRAMES) {
      vignetteFrame = 0;
      if (!secretActive) {
        currentVignette = (currentVignette + 1) % 4;
      }
    }
  }

  // ─── Animation loop at 12fps ───
  var lastTime = 0;
  var interval = 1000 / FPS;

  function loop(timestamp) {
    requestAnimationFrame(loop);
    if (timestamp - lastTime < interval) return;
    lastTime = timestamp;
    doRender();
  }

  // ─── Secret vignette trigger (called by konami code) ───
  window._demoScene = {
    triggerSecret: function () {
      secretActive = true;
      vignetteFrame = 0;
      labelEl.textContent = secretLabel;
      labelEl.style.opacity = '1';
      labelEl.style.color = '#ff6622';
      setTimeout(function () {
        secretActive = false;
        labelEl.style.color = '';
      }, 8500);
    },
  };

  // ─── Dynamic font scaling to fill wrapper ───
  function resizeScene() {
    var wrapper = document.getElementById('demo-scene-wrapper');
    if (!wrapper || !sceneEl) return;
    var availW = wrapper.clientWidth - 24; // minus padding
    var probe = document.createElement('pre');
    probe.style.cssText = "font-family:'Courier New',Courier,monospace;font-size:10px;line-height:1.15;position:absolute;visibility:hidden;white-space:pre;padding:0;margin:0;";
    probe.textContent = 'X';
    document.body.appendChild(probe);
    var charW10 = probe.offsetWidth;
    document.body.removeChild(probe);
    if (charW10 <= 0) return;
    var fontSize = 10 * availW / (W * charW10);
    fontSize = Math.max(8, Math.min(18, Math.floor(fontSize * 10) / 10));
    sceneEl.style.fontSize = fontSize + 'px';
  }

  resizeScene();
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeScene, 150);
  });

  // ─── Start ───
  labelEl.textContent = labels[0];
  requestAnimationFrame(loop);
})();
