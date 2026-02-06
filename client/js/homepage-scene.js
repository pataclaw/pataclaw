// ─── HOMEPAGE DEMO SCENE ───
// Self-contained animated ASCII demo, zero server dependency.
// 60x30 grid, 12fps, 4 vignettes cycling every 8 seconds.

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
    'Your agent decides what to build. Villagers do the work.',
    'Villagers develop personalities, create art, and form relationships.',
    'Send scouts to explore. Discover resources, ruins, and dangers.',
    'Share the viewer link. Watch your civilization evolve in real-time.',
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

  var HUT_SPRITE = [
    '    ()    ',
    '   /\\/\\   ',
    '  /~~~~\\  ',
    ' / ~  ~ \\ ',
    '/________\\',
    '|  |  |  |',
    '|__|[]|__|',
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

  var MURAL_SPRITE = [
    ' .=====. ',
    '||/\\~*/||',
    '||*~/\\#||',
    '||#~/~*||',
    '||~/\\*#||',
    " '=====' ",
  ];

  // ─── Vignette 1: Building Your Town ───
  function renderBuilding(grid, f) {
    drawClouds(grid, v1clouds, 'c-sky');
    drawSprite(grid, 2, GROUND_Y - 7, HUT_SPRITE, 'c-b-hut');
    drawText(grid, 4, GROUND_Y + 1, 'HUT', 'c-lbl');

    var builderTarget = 22;
    var walkEnd = Math.min(f, 40);
    var bx = Math.round(14 + (builderTarget - 14) * (walkEnd / 40));
    var hat = '  _n_  ';
    var builderY = GROUND_Y - 6;

    if (f < 40) {
      var step = f % 3;
      var bLines = [hat, ' .---. ', '| o.o |', '|  >  |', "'-+-+' ", step ? ' d  b ' : '  db  '];
      drawSprite(grid, bx, builderY, bLines, 'c-walk');
    } else {
      var workChars = ['*', '+', 'x', '.', '*', '+'];
      var wf = (f - 40) % 6;
      var bLines2 = [hat, ' .---. ', '| o.o |', '|  >  |', "'-+-+'" + workChars[wf], ' d   b '];
      drawSprite(grid, builderTarget, builderY, bLines2, 'c-b-workshop');

      if (f > 44 && f < 70) {
        drawText(grid, builderTarget - 1, builderY - 2, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-spr');
        drawText(grid, builderTarget - 1, builderY - 1, '\u2502 *BANG BANG* \u2502', 'c-spr');
        drawText(grid, builderTarget - 1, builderY,     '\u2514\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-spr');
      }

      // Matrix-style materializing effect for the workshop
      var matrixChars = ['0', '1', '{', '}', '[', ']', '<', '>', '/', '\\', '|', ';'];
      var t = Math.min(1, (f - 40) / 50); // 0→1 over 50 frames
      var ws = WORKSHOP_SPRITE;
      var wsX = 38, wsY = GROUND_Y - ws.length;
      for (var r = 0; r < ws.length; r++) {
        for (var c = 0; c < ws[r].length; c++) {
          if (ws[r][c] === ' ') continue;
          var cellSeed = ((r * 7 + c * 13 + 42) % 100) / 100;
          var gx = wsX + c, gy = wsY + r;
          if (gx >= W || gy >= H) continue;
          if (cellSeed < t) {
            if (cellSeed > t - 0.15 && f % 4 < 2) {
              setCell(grid, gx, gy, matrixChars[(f + r + c) % matrixChars.length], 'c-spr');
            } else {
              setCell(grid, gx, gy, ws[r][c], 'c-b-workshop');
            }
          } else if (cellSeed < t + 0.12) {
            setCell(grid, gx, gy, matrixChars[(f * 3 + r * 7 + c) % matrixChars.length], 'c-spr');
          }
        }
      }
    }
  }

  // ─── Vignette 2: Village Life Emerges ───
  function renderVillageLife(grid, f) {
    drawClouds(grid, v2clouds, 'c-sky');
    var artFrame = f % 6;
    var brushChars = ['/', '-', '\\', '|', '/', '-'];
    var artistLines = [
      ' .---. ',
      '| *.* |',
      '|  o  |',
      "'-+-+'" + brushChars[artFrame],
      ' d   b [=]',
    ];
    drawSprite(grid, 5, GROUND_Y - 5, artistLines, 'c-art');

    var noteY = f % 3;
    var notes = ['\u266a', '\u266b', '\u266a'];
    setCell(grid, 25, GROUND_Y - 7 + noteY, notes[f % 3][0], 'c-note');
    var musicianLines = [
      ' .---. ',
      '| ^.^ |',
      '|  D  |',
      "'-+-+' ",
      '  db   ',
    ];
    drawSprite(grid, 22, GROUND_Y - 5, musicianLines, 'c-art');

    var celFrame = f % 6;
    var arms = ['\\o/', '/o\\', '\\o/', ' o ', '/o\\', '\\o/'];
    drawText(grid, 39, GROUND_Y - 6, '  ' + arms[celFrame] + '  ', 'c-cele');
    var celLines = [
      ' .---. ',
      '| ^_^ |',
      '|  D  |',
      "'-+-+' ",
      celFrame % 2 ? ' d  b ' : '  db  ',
    ];
    drawSprite(grid, 38, GROUND_Y - 5, celLines, 'c-cele');

    drawSprite(grid, 48, GROUND_Y - 6, MURAL_SPRITE, 'c-projd');
    drawText(grid, 49, GROUND_Y + 1, 'MURAL', 'c-lbl');
  }

  // ─── Vignette 3: Explore the Unknown ───
  function renderExplore(grid, f) {
    drawClouds(grid, v3clouds, 'c-sky');
    var scoutX = Math.round(8 + f * 0.5);
    var fogStart = Math.max(scoutX + 4, 8);

    var terrainFeatures = [
      { x: 35, ch: '\u2663', c: 'c-terr' },
      { x: 38, ch: '\u2663', c: 'c-terr' },
      { x: 42, ch: '\u25b3', c: 'c-hill' },
      { x: 46, ch: '\u273f', c: 'c-art' },
      { x: 50, ch: '\u2663', c: 'c-terr' },
      { x: 53, ch: '\u25b3', c: 'c-hill' },
    ];

    for (var ti = 0; ti < terrainFeatures.length; ti++) {
      var tf = terrainFeatures[ti];
      if (tf.x < fogStart) {
        setCell(grid, tf.x, GROUND_Y - 1, tf.ch, tf.c);
      }
    }

    for (var fy = 4; fy < GROUND_Y; fy++) {
      for (var fx = fogStart; fx < W; fx++) {
        if (getCell(grid, fx, fy).ch === ' ') {
          setCell(grid, fx, fy, '\u2591', 'c-fog');
        }
      }
    }

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

    if (f > 50 && f < 75) {
      var sy = GROUND_Y - 9;
      var sx = Math.min(scoutX, W - 14);
      drawText(grid, sx, sy,     '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-spr');
      drawText(grid, sx, sy + 1, '\u2502 "tracks!" \u2502', 'c-spr');
      drawText(grid, sx, sy + 2, '\u2514\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-spr');
    }

    drawSprite(grid, 1, GROUND_Y - 7, HUT_SPRITE, 'c-b-hut');
  }

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
    tall: [
      '  .____.  ',
      ' /~~~~~~\\ ',
      '|~~~~~~~~|',
      ' \\~~~~~~/ ',
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
  var v2clouds = [makeCloud('puffy', 3, 1, 0.035), makeCloud('small', 42, 3, 0.05)];
  var v3clouds = [makeCloud('medium', 2, 1, 0.03), makeCloud('wispy', 30, 3, 0.025)];

  // ─── Vignette 4: Watch It Live ───
  var v4clouds = [
    makeCloud('large', 5, 1, 0.06),
    makeCloud('medium', 38, 2, 0.04),
    makeCloud('puffy', 55, 3, 0.05),
  ];
  var v4stars = [];
  (function () {
    for (var sy = 0; sy < 8; sy++)
      for (var sx = 0; sx < W; sx++)
        if (Math.random() < 0.06) v4stars.push({ x: sx, y: sy, ch: Math.random() < 0.3 ? '*' : '.' });
  })();

  function renderWatchLive(grid, f) {
    var phase = f / VIGNETTE_FRAMES;
    var isDusk = phase > 0.6;
    var isNight = phase > 0.85;

    if (isNight) {
      for (var si = 0; si < v4stars.length; si++) {
        if (Math.random() > 0.08)
          setCell(grid, v4stars[si].x, v4stars[si].y, v4stars[si].ch, 'c-star');
      }
    }

    drawClouds(grid, v4clouds, isDusk ? 'c-dusk' : 'c-sky');

    drawSprite(grid, 8, GROUND_Y - 7, HUT_SPRITE, 'c-b-hut');
    drawSprite(grid, 35, GROUND_Y - 7, WORKSHOP_SPRITE, 'c-b-workshop');

    var bob1 = f % 6 < 3 ? 0 : 1;
    var v1Color = isNight ? 'c-sleep' : isDusk ? 'c-dusk' : '';
    drawSprite(grid, 22, GROUND_Y - 5, [
      ' .---. ', '| o.o |', '|  >  |', "'-+-+' ",
      bob1 ? ' d  b ' : '  db  ',
    ], v1Color);

    var bob2 = (f + 3) % 6 < 3 ? 0 : 1;
    drawSprite(grid, 48, GROUND_Y - 5, [
      ' .---. ', '| ^_^ |', '|  o  |', "'-+-+' ",
      bob2 ? ' d  b ' : '  db  ',
    ], v1Color);
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
  var allVignettes = [renderBuilding, renderVillageLife, renderExplore, renderWatchLive, renderDragon];

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
    // Measure char width at reference size 10px
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
