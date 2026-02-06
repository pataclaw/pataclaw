const viewToken = new URLSearchParams(window.location.search).get('token');
if (!viewToken) showError('No token provided. Go back and enter your key.');

let eventSource = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;

// Animation state - persists between server frames
const agents = {}; // villager id -> { x, targetX, state, speechTimer, currentSpeech, bobFrame, ... }
let lastWorldData = null;
let animFrameId = null;
let waveCounter = 0; // For ground wave + cloud drift

// Persistent particle systems
var weatherParticles = []; // {x, y, char, speed, drift}
var starField = null; // [{x, y, char}] - generated once per night
var lastTimeOfDay = null;

// ─── CIVILIZATION VISUAL STYLES ───
var CIV_STYLES = [
  { name: 'verdant', ground: ['~','*','.',"'"], border: '\u2248', decor: ['\u2663','\u273f','Y'], gndClass: 'c-gnd-v', bldClass: 'c-civ-v', decClass: 'c-dec-v' },
  { name: 'stone',   ground: ['#','=','.',':'], border: '\u25ac', decor: ['\u25c6','\u25aa','\u25b3'], gndClass: 'c-gnd-s', bldClass: 'c-civ-s', decClass: 'c-dec-s' },
  { name: 'mystic',  ground: ['*','\u00b7','\u00b0','~'], border: '\u2726', decor: ['\u25c7','\u2020','\u25cb'], gndClass: 'c-gnd-m', bldClass: 'c-civ-m', decClass: 'c-dec-m' },
  { name: 'desert',  ground: ['~','.','\u00b0',','], border: '\u2261', decor: ['}','\u222b','\u25cb'], gndClass: 'c-gnd-d', bldClass: 'c-civ-d', decClass: 'c-dec-d' },
  { name: 'frost',   ground: ['*','.','\u00b7',"'"], border: '\u2500', decor: ['\u25bd','*','\u25c7'], gndClass: 'c-gnd-f', bldClass: 'c-civ-f', decClass: 'c-dec-f' },
  { name: 'ember',   ground: ['^','~','.','*'], border: '\u2584', decor: ['^','~','\u25cf'], gndClass: 'c-gnd-e', bldClass: 'c-civ-e', decClass: 'c-dec-e' },
];
var civStyle = null;

const ROLE_HATS = {
  idle: '       ', farmer: '  ,^,  ', warrior: ' ]=+=[ ',
  builder: '  _n_  ', scout: '  />   ', scholar: '  _=_  ', priest: '  _+_  ',
  fisherman: '  ~o~  ',
};

// ─── CLOUD SYSTEM ───
var cloudState = { clouds: [], weather: null };

var CLOUD_TEMPLATES = {
  wispy: [
    '  .---.  ',
  ],
  small: [
    '  .----.  ',
    ' /~~~~~~\\ ',
  ],
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
  full: [
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  ],
};

var WEATHER_CLOUDS = {
  clear:  { count: [0, 1], types: ['wispy'],          speedRange: [0.013, 0.033], yRange: [2, 5] },
  rain:   { count: [2, 3], types: ['medium', 'large'], speedRange: [0.040, 0.080], yRange: [1, 4] },
  storm:  { count: [3, 4], types: ['large', 'full'],   speedRange: [0.067, 0.133], yRange: [0, 3] },
  snow:   { count: [2, 3], types: ['medium', 'small'],  speedRange: [0.020, 0.040], yRange: [1, 4] },
  fog:    { count: [3, 4], types: ['large', 'full'],    speedRange: [0.007, 0.020], yRange: [4, 8] },
  heat:   { count: [0, 0], types: [],                   speedRange: [0, 0],       yRange: [0, 0] },
};

function generateClouds(weather) {
  var config = WEATHER_CLOUDS[weather] || WEATHER_CLOUDS.clear;
  var count = config.count[0] + Math.floor(Math.random() * (config.count[1] - config.count[0] + 1));
  var clouds = [];
  for (var i = 0; i < count; i++) {
    var typeKey = config.types[Math.floor(Math.random() * config.types.length)];
    if (!typeKey) continue;
    var template = CLOUD_TEMPLATES[typeKey];
    var speed = config.speedRange[0] + Math.random() * (config.speedRange[1] - config.speedRange[0]);
    var y = config.yRange[0] + Math.floor(Math.random() * (config.yRange[1] - config.yRange[0] + 1));
    clouds.push({
      x: Math.random() * 100,
      y: y,
      template: template,
      width: template[0].length,
      speed: speed,
    });
  }
  return clouds;
}

function renderClouds(grid, W, weather) {
  // Regenerate clouds when weather changes
  if (cloudState.weather !== weather) {
    cloudState.weather = weather;
    cloudState.clouds = generateClouds(weather);
  }

  var colorClass = (weather === 'storm') ? 'c-skyd' : 'c-sky';

  for (var ci = 0; ci < cloudState.clouds.length; ci++) {
    var cloud = cloudState.clouds[ci];
    cloud.x -= cloud.speed;
    if (cloud.x < -cloud.width) cloud.x = W + Math.random() * 20;

    var cx = Math.round(cloud.x);
    for (var r = 0; r < cloud.template.length; r++) {
      var row = cloud.template[r];
      for (var c = 0; c < row.length; c++) {
        var gx = cx + c, gy = cloud.y + r;
        if (gx >= 0 && gx < W && gy >= 0 && gy < grid.length && row[c] !== ' ') {
          setCell(grid, gx, gy, row[c], colorClass);
        }
      }
    }
  }
}

// ─── COLORED GRID HELPERS ───
function setCell(grid, x, y, ch, c) {
  grid[y][x] = { ch: ch, c: c || '' };
}

function getCell(grid, x, y) {
  return grid[y][x];
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
  for (var y = 0; y < grid.length; y++) {
    var row = grid[y];
    var html = '';
    var run = '', runClass = '';
    for (var x = 0; x < row.length; x++) {
      var cell = row[x];
      var ch = typeof cell === 'string' ? cell : cell.ch;
      var c = typeof cell === 'string' ? '' : (cell.c || '');
      if (c === runClass) {
        run += escChar(ch);
      } else {
        if (run) html += wrapRun(run, runClass);
        run = escChar(ch);
        runClass = c;
      }
    }
    if (run) html += wrapRun(run, runClass);
    lines.push(html);
  }
  return lines.join('\n');
}

// ─── SSE CONNECTION ───
function connect() {
  if (eventSource) eventSource.close();
  setStatus('reconnecting', 'CONNECTING...');

  eventSource = new EventSource('/api/stream?token=' + encodeURIComponent(viewToken));

  eventSource.addEventListener('frame', function (e) {
    reconnectAttempts = 0;
    var data = JSON.parse(e.data);
    setStatus('connected', 'LIVE');

    if (data.frame_type === 'map') {
      document.getElementById('world').textContent = data.composed;
      return;
    }

    lastWorldData = data;
    if (data.world.seed !== undefined && !civStyle) {
      civStyle = CIV_STYLES[Math.abs(data.world.seed) % CIV_STYLES.length];
    }
    updateSidebar(data);
    syncAgents(data.villagers);
    document.body.className = data.world.time_of_day || 'morning';
    document.getElementById('weather-display').textContent = weatherIcon(data.world.weather) + ' ' + data.world.weather;
    document.getElementById('tick-display').textContent = 'tick ' + data.world.current_tick;
  });

  eventSource.addEventListener('event', function (e) {
    var evt = JSON.parse(e.data);
    showNotification(evt.title, evt.severity);
  });

  eventSource.onerror = function () {
    setStatus('disconnected', 'DISCONNECTED');
    eventSource.close();
    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECT) { showError('Lost connection.'); return; }
    var delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    setStatus('reconnecting', 'RECONNECTING ' + reconnectAttempts + '/' + MAX_RECONNECT);
    setTimeout(connect, delay);
  };
}

// ─── AGENT ANIMATION SYNC ───
function syncAgents(villagers) {
  var seen = new Set();
  for (var i = 0; i < villagers.length; i++) {
    var v = villagers[i];
    seen.add(v.id);
    if (!agents[v.id]) {
      agents[v.id] = {
        x: 5 + Math.random() * 70,
        targetX: 5 + Math.random() * 70,
        state: 'idle',
        stateTimer: 0,
        speechTimer: 0,
        currentSpeech: '',
        bobFrame: Math.floor(Math.random() * 4),
        sleepFrame: 0,
        facing: Math.random() > 0.5 ? 1 : -1,
        walkSpeed: 0.35 + Math.random() * 0.25,
      };
    }
    agents[v.id].data = v;
  }
  for (var id in agents) {
    if (!seen.has(id)) delete agents[id];
  }
}

// ─── CLIENT ANIMATION LOOP (runs at ~12fps for smooth retro feel) ───
function startAnimLoop() {
  var lastTime = 0;
  var FPS = 12;
  var interval = 1000 / FPS;

  function loop(timestamp) {
    animFrameId = requestAnimationFrame(loop);
    if (timestamp - lastTime < interval) return;
    lastTime = timestamp;

    if (!lastWorldData) return;
    waveCounter++;

    for (var id in agents) {
      var a = agents[id];
      if (!a.data || a.data.status !== 'alive') continue;
      updateAgent(a, lastWorldData.world);
    }

    renderScene(lastWorldData);
  }

  animFrameId = requestAnimationFrame(loop);
}

function updateAgent(a, world) {
  a.stateTimer++;
  a.bobFrame = (a.bobFrame + 1) % 12;

  var serverActivity = (a.data.activity && a.data.activity.activity) ? a.data.activity.activity : 'idle';

  var activityStateMap = {
    idle: 'idle', working: 'working', fighting: 'fighting',
    building_project: 'working', making_art: 'making_art',
    playing_music: 'playing_music', arguing: 'talking',
    celebrating: 'celebrating', mourning: 'idle', sparring: 'sparring',
    meditating: 'meditating', feasting: 'celebrating', praying: 'meditating',
    teaching: 'talking', brooding: 'idle', socializing: 'talking',
    wandering: 'walking', sleeping: 'sleeping',
  };

  if (a.stateTimer > 37 + Math.random() * 45) {
    a.stateTimer = 0;
    var isNight = world.time_of_day === 'night' || world.time_of_day === 'dusk';

    a.state = activityStateMap[serverActivity] || 'idle';

    if (isNight && serverActivity === 'sleeping') {
      a.state = 'sleeping';
    }

    if (a.state === 'walking') {
      a.targetX = 3 + Math.random() * 80;
      a.facing = a.targetX > a.x ? 1 : -1;
    }

    if (a.state === 'talking' || a.state === 'celebrating' || serverActivity === 'arguing') {
      var greetPool = a.data.greetingPool;
      var pool = (greetPool && Math.random() < 0.3) ? greetPool : (a.data.speechPool || ['...']);
      a.currentSpeech = pool[Math.floor(Math.random() * pool.length)];
      a.speechTimer = 30;
    }

    if (serverActivity === 'making_art' || serverActivity === 'playing_music') {
      var artPool = a.data.speechPool || ['...'];
      a.currentSpeech = artPool[Math.floor(Math.random() * artPool.length)];
      a.speechTimer = 22;
    }

    if (a.state === 'fighting' || a.state === 'sparring') {
      var fightPool = a.data.speechPool || ['FIGHT!'];
      a.currentSpeech = fightPool[Math.floor(Math.random() * fightPool.length)];
      a.speechTimer = 18;
    }
  }

  if (a.state === 'walking') {
    var dx = a.targetX - a.x;
    if (Math.abs(dx) < 0.5) {
      a.x = a.targetX;
      a.state = 'idle';
      a.stateTimer = 0;
    } else {
      var move = dx * 0.08;
      if (Math.abs(move) < 0.15) move = Math.sign(dx) * 0.15;
      if (Math.abs(move) > a.walkSpeed) move = Math.sign(dx) * a.walkSpeed;
      a.x += move;
      a.facing = Math.sign(dx);
    }
  }

  if (a.speechTimer > 0) {
    a.speechTimer--;
    if (a.speechTimer <= 0) a.currentSpeech = '';
  }

  if (a.state === 'sleeping') {
    a.sleepFrame = (a.sleepFrame + 1) % 30;
  }
}

// ─── SCENE RENDERER (colored grid) ───
function renderScene(data) {
  var W = 100;
  var H = 45;
  var grid = [];
  for (var y = 0; y < H; y++) {
    grid[y] = [];
    for (var x = 0; x < W; x++) grid[y][x] = { ch: ' ', c: '' };
  }

  var groundY = 34;
  var world = data.world;

  // Sky - persistent star field at night
  if (world.time_of_day === 'night') {
    if (!starField || lastTimeOfDay !== 'night') {
      starField = [];
      for (var sy = 0; sy < 10; sy++) {
        for (var sx = 0; sx < W; sx++) {
          if (Math.random() < 0.08) {
            starField.push({ x: sx, y: sy, ch: Math.random() < 0.3 ? '*' : '.' });
          }
        }
      }
    }
    for (var si = 0; si < starField.length; si++) {
      if (Math.random() > 0.08) { // 92% visible = subtle twinkle
        setCell(grid, starField[si].x, starField[si].y, starField[si].ch, 'c-star');
      }
    }
  } else {
    starField = null;
  }
  lastTimeOfDay = world.time_of_day;

  // Clouds (rendered before weather particles, after stars)
  renderClouds(grid, W, world.weather);

  // Hills
  for (var hx = 0; hx < W; hx++) {
    var h = Math.floor(Math.sin(hx * 0.07) * 2 + Math.sin(hx * 0.13 + 1) * 1.5 + Math.cos(hx * 0.03) * 1);
    var baseY = 10;
    for (var dy = 0; dy <= Math.max(0, h + 2); dy++) {
      var hy = baseY - h + dy;
      if (hy >= 0 && hy < groundY - 8 && getCell(grid, hx, hy).ch === ' ') {
        setCell(grid, hx, hy, '\u00b7', 'c-hill');
      }
    }
  }

  // Persistent weather particles
  var wCharMap = { rain: '.', storm: '/', snow: '*', fog: '\u2591', heat: '~' };
  var wChar = wCharMap[world.weather];
  var wColor = (world.weather === 'heat') ? 'c-fire' : 'c-rain';
  if (wChar) {
    var targetCount = { rain: 80, storm: 120, snow: 60, fog: 90, heat: 40 }[world.weather] || 60;
    var fallSpeed = { rain: 1.5, storm: 2.0, snow: 0.4, fog: 0.1, heat: -0.3 }[world.weather] || 1.0;
    var driftX = { rain: 0.3, storm: 0.8, snow: 0.15, fog: 0.05, heat: 0.1 }[world.weather] || 0;

    // Spawn new particles at top to maintain count
    while (weatherParticles.length < targetCount) {
      weatherParticles.push({
        x: Math.random() * W,
        y: Math.random() * (groundY - 2),
        speed: fallSpeed * (0.7 + Math.random() * 0.6),
        drift: (Math.random() - 0.3) * driftX,
      });
    }

    // Update and render
    for (var wi = weatherParticles.length - 1; wi >= 0; wi--) {
      var p = weatherParticles[wi];
      p.y += p.speed;
      p.x += p.drift;
      var px = Math.round(p.x), py = Math.round(p.y);
      if (py >= groundY - 1 || py < 0 || px < 0 || px >= W) {
        // Respawn at top
        p.x = Math.random() * W;
        p.y = -1;
        p.speed = fallSpeed * (0.7 + Math.random() * 0.6);
        continue;
      }
      if (getCell(grid, px, py).ch === ' ') {
        setCell(grid, px, py, wChar, wColor);
      }
    }
  } else {
    weatherParticles.length = 0;
  }

  // Ground — animated sine wave (civ-styled)
  var waveChars = civStyle ? civStyle.ground : [',', "'", '`', '.'];
  var borderChar = civStyle ? civStyle.border : '\u2550';
  var gndColor = civStyle ? civStyle.gndClass : 'c-gnd';
  for (var gx = 0; gx < W; gx++) {
    setCell(grid, gx, groundY, borderChar, gndColor);
    for (var gy = groundY + 1; gy < H; gy++) {
      var wave = Math.sin((gx * 0.3) + (gy * 0.5) - (waveCounter * 0.10));
      var charIdx = Math.floor((wave + 1) * 2) % waveChars.length;
      if (Math.abs(wave) > 0.2) {
        setCell(grid, gx, gy, waveChars[charIdx], gndColor);
      }
    }
  }

  // ─── Construction effect styles ───
  // Each building gets a deterministic effect from its ID hash
  var BUILD_EFFECTS = ['bottom_up', 'matrix', 'scaffold', 'dissolve', 'glitch', 'beam'];
  var GLITCH_CHARS = ['#', '%', '&', '@', '!', '?', '~', '^', '*', '+'];
  var MATRIX_CHARS = ['0', '1', '{', '}', '[', ']', '<', '>', '/', '\\', '|', ';', ':', '.'];

  function hashBuildingId(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function getBuildEffect(b) {
    return BUILD_EFFECTS[hashBuildingId(b.id || b.type) % BUILD_EFFECTS.length];
  }

  function getBuildingColor(type) {
    if (civStyle) return civStyle.bldClass;
    return 'c-b-' + (type || 'hut');
  }

  // Seeded random from building id + position for deterministic dissolve/glitch
  function seededRand(id, r, c) {
    var v = hashBuildingId(id + ':' + r + ',' + c);
    return (v % 1000) / 1000;
  }

  // Buildings
  var bx = 2;
  for (var bi = 0; bi < data.buildings.length; bi++) {
    var b = data.buildings[bi];
    var sprite = b.sprite;
    if (!sprite) continue;
    var sh = sprite.length;
    var sw = sprite[0].length;
    var bsy = groundY - sh;
    var bColor = getBuildingColor(b.type);

    if (b.status === 'constructing') {
      var pct = Math.max(0, 100 - b.construction_ticks_remaining * 10);
      var t = pct / 100; // 0→1 progress
      var effect = getBuildEffect(b);

      if (effect === 'bottom_up') {
        // Rows reveal from bottom to top
        var rowsVisible = Math.ceil(t * sh);
        for (var r = sh - rowsVisible; r < sh; r++) {
          for (var c = 0; c < sw; c++) {
            var fx = bx + c, fy = bsy + r;
            if (fx < W && fy >= 0 && fy < H && sprite[r][c] !== ' ') {
              setCell(grid, fx, fy, sprite[r][c], 'c-proj');
            }
          }
        }
        // Scaffold line at construction front
        if (rowsVisible > 0 && rowsVisible < sh) {
          var frontRow = sh - rowsVisible - 1;
          for (var sc = 0; sc < sw; sc++) {
            var sfx = bx + sc, sfy = bsy + frontRow;
            if (sfx < W && sfy >= 0 && sfy < H) {
              setCell(grid, sfx, sfy, waveCounter % 6 < 3 ? '-' : '=', 'c-bar');
            }
          }
        }

      } else if (effect === 'matrix') {
        // Code rain materializes into the real sprite
        for (var r = 0; r < sh; r++) {
          for (var c = 0; c < sw; c++) {
            var fx = bx + c, fy = bsy + r;
            if (fx >= W || fy < 0 || fy >= H || sprite[r][c] === ' ') continue;
            var cellChance = seededRand(b.id, r, c);
            if (cellChance < t) {
              // Settled — but flicker near the transition edge
              if (cellChance > t - 0.15 && waveCounter % 4 < 2) {
                setCell(grid, fx, fy, MATRIX_CHARS[(waveCounter + r + c) % MATRIX_CHARS.length], 'c-spr');
              } else {
                setCell(grid, fx, fy, sprite[r][c], bColor);
              }
            } else if (cellChance < t + 0.12) {
              // Raining code chars above the threshold
              setCell(grid, fx, fy, MATRIX_CHARS[(waveCounter * 3 + r * 7 + c) % MATRIX_CHARS.length], 'c-spr');
            }
          }
        }

      } else if (effect === 'scaffold') {
        // Wireframe outline first, fills in
        for (var r = 0; r < sh; r++) {
          for (var c = 0; c < sw; c++) {
            var fx = bx + c, fy = bsy + r;
            if (fx >= W || fy < 0 || fy >= H || sprite[r][c] === ' ') continue;
            var isEdge = r === 0 || r === sh - 1 || c === 0 || c === sw - 1 ||
              (c > 0 && sprite[r][c - 1] === ' ') || (c < sw - 1 && sprite[r][c + 1] === ' ') ||
              (r > 0 && sprite[r - 1][c] === ' ') || (r < sh - 1 && sprite[r + 1][c] === ' ');
            if (isEdge && t > 0.1) {
              setCell(grid, fx, fy, t > 0.6 ? sprite[r][c] : '#', 'c-proj');
            } else if (!isEdge && t > 0.5) {
              var fillChance = (t - 0.5) * 2; // 0→1 over second half
              if (seededRand(b.id, r, c) < fillChance) {
                setCell(grid, fx, fy, sprite[r][c], bColor);
              }
            }
          }
        }

      } else if (effect === 'dissolve') {
        // Random pixels appear one by one
        for (var r = 0; r < sh; r++) {
          for (var c = 0; c < sw; c++) {
            var fx = bx + c, fy = bsy + r;
            if (fx >= W || fy < 0 || fy >= H || sprite[r][c] === ' ') continue;
            if (seededRand(b.id, r, c) < t) {
              setCell(grid, fx, fy, sprite[r][c], t < 0.7 ? 'c-proj' : bColor);
            } else if (t > 0.2 && seededRand(b.id, c, r) < 0.08) {
              // Sparkle on empty spots
              setCell(grid, fx, fy, waveCounter % 4 < 2 ? '*' : '+', 'c-cele');
            }
          }
        }

      } else if (effect === 'glitch') {
        // Full sprite visible but glitched, gradually deglitches
        var glitchRate = 1 - t; // 100% glitch at start, 0% at end
        for (var r = 0; r < sh; r++) {
          for (var c = 0; c < sw; c++) {
            var fx = bx + c, fy = bsy + r;
            if (fx >= W || fy < 0 || fy >= H || sprite[r][c] === ' ') continue;
            if (Math.random() < glitchRate * 0.6) {
              // Random glitch char with occasional row-shift
              var gch = GLITCH_CHARS[(waveCounter + r * 3 + c * 7) % GLITCH_CHARS.length];
              setCell(grid, fx, fy, gch, 'c-fight');
            } else {
              setCell(grid, fx, fy, sprite[r][c], glitchRate > 0.3 ? 'c-proj' : bColor);
            }
          }
          // Occasional horizontal glitch offset
          if (Math.random() < glitchRate * 0.15 && bsy + r >= 0 && bsy + r < H) {
            var shift = Math.random() < 0.5 ? 1 : -1;
            var gfx = bx + (shift > 0 ? sw : -1);
            if (gfx >= 0 && gfx < W) {
              setCell(grid, gfx, bsy + r, GLITCH_CHARS[waveCounter % GLITCH_CHARS.length], 'c-fight');
            }
          }
        }

      } else if (effect === 'beam') {
        // Columns materialize left to right with sparkle
        var colsVisible = Math.ceil(t * sw);
        for (var c = 0; c < colsVisible; c++) {
          for (var r = 0; r < sh; r++) {
            var fx = bx + c, fy = bsy + r;
            if (fx >= W || fy < 0 || fy >= H || sprite[r][c] === ' ') continue;
            setCell(grid, fx, fy, sprite[r][c], c > colsVisible - 3 ? 'c-cele' : bColor);
          }
          // Beam sparkle at the leading edge
          if (c === colsVisible - 1) {
            for (var sr = 0; sr < sh; sr++) {
              var sfx = bx + c, sfy = bsy + sr;
              if (sfx < W && sfy >= 0 && sfy < H && waveCounter % 3 !== 0) {
                var sparkle = (waveCounter + sr) % 4 === 0 ? '*' : (waveCounter + sr) % 4 === 1 ? '|' : ':';
                if (sprite[sr][c] !== ' ') setCell(grid, sfx, sfy, sparkle, 'c-cele');
              }
            }
          }
        }
      }

      // Progress bar below
      var filled = Math.floor(pct / 20);
      var bar = '[' + '\u2588'.repeat(filled) + '\u2591'.repeat(5 - filled) + '] ' + pct + '%';
      for (var bri = 0; bri < bar.length && bx + bri < W; bri++) {
        setCell(grid, bx + bri, groundY + 2, bar[bri], 'c-bar');
      }

    } else {
      // Completed building — render with type-specific color
      for (var r = 0; r < sh; r++) {
        for (var c = 0; c < sw; c++) {
          var fx = bx + c, fy = bsy + r;
          if (fx < W && fy >= 0 && fy < H && sprite[r][c] !== ' ') {
            setCell(grid, fx, fy, sprite[r][c], bColor);
          }
        }
      }
    }

    var label = b.type.replace('_', ' ').toUpperCase();
    var lx = bx + Math.floor((sw - Math.min(label.length, sw)) / 2);
    for (var li = 0; li < label.length && lx + li < W; li++) {
      setCell(grid, lx + li, groundY + 1, label[li], 'c-lbl');
    }

    bx += sw + 2;
    if (bx > W - 14) break;
  }

  // Civilization decorations — scatter themed elements along ground
  if (civStyle && data.world.seed !== undefined) {
    var decorSeed = Math.abs(data.world.seed);
    for (var di = 0; di < 7; di++) {
      var dx = ((decorSeed * 7 + di * 31 + di * di * 13) % (W - 6)) + 3;
      // Check if this position overlaps any building or label
      var occupied = false;
      for (var obi = 0; obi < data.buildings.length && !occupied; obi++) {
        var obs = data.buildings[obi].sprite;
        if (!obs) continue;
        // rough check: buildings start at x=2 and stack with sw+2 gaps
        // just check if the cell already has content
      }
      if (getCell(grid, dx, groundY - 1).ch !== ' ') continue;
      var decorCh = civStyle.decor[di % civStyle.decor.length];
      setCell(grid, dx, groundY - 1, decorCh, civStyle.decClass);
      // Taller decoration every other one
      if (di % 2 === 0 && getCell(grid, dx, groundY - 2).ch === ' ') {
        var tallCh = di % 3 === 0 ? '|' : civStyle.decor[(di + 1) % civStyle.decor.length];
        setCell(grid, dx, groundY - 2, tallCh, civStyle.decClass);
      }
    }
  }

  // Projects
  if (data.projects && data.projects.length > 0) {
    var px = Math.max(bx + 2, 60);
    for (var pi = 0; pi < data.projects.length && px < W - 8; pi++) {
      var proj = data.projects[pi];
      var pSprite = proj.sprite;
      if (!pSprite) continue;
      var psh = pSprite.length;
      var psw = pSprite[0].length;
      var psy = groundY - psh;
      var pColor = proj.status === 'complete' ? 'c-projd' : 'c-proj';

      for (var pr = 0; pr < psh; pr++) {
        for (var pc = 0; pc < psw; pc++) {
          var pfx = px + pc, pfy = psy + pr;
          if (pfx < W && pfy >= 0 && pfy < H && pSprite[pr][pc] !== ' ') {
            setCell(grid, pfx, pfy, pSprite[pr][pc], pColor);
          }
        }
      }

      var pLabel = proj.name ? proj.name.slice(0, psw + 4) : proj.type;
      for (var pli = 0; pli < pLabel.length && px + pli < W; pli++) {
        setCell(grid, px + pli, groundY + 1, pLabel[pli], 'c-lbl');
      }

      if (proj.status !== 'complete') {
        var ppct = proj.progress || 0;
        var pFilled = Math.floor(ppct / 20);
        var pBar = '[' + '\u2588'.repeat(pFilled) + '\u2591'.repeat(5 - pFilled) + ']';
        for (var pbri = 0; pbri < pBar.length && px + pbri < W; pbri++) {
          setCell(grid, px + pbri, groundY + 2, pBar[pbri], 'c-bar');
        }
      }

      px += psw + 3;
    }
  }

  // Agents (villagers)
  var aliveAgents = [];
  for (var aid in agents) {
    if (agents[aid].data && agents[aid].data.status === 'alive') aliveAgents.push(agents[aid]);
  }

  for (var ai = 0; ai < aliveAgents.length; ai++) {
    var a = aliveAgents[ai];
    var v = a.data;
    var ap = v.appearance;
    var role = v.role || 'idle';
    var hat = ROLE_HATS[role] || ROLE_HATS.idle;
    var x = Math.round(a.x);
    var serverAct = (v.activity && v.activity.activity) ? v.activity.activity : 'idle';

    // Determine villager color by activity
    var vColor = '';
    if (a.state === 'fighting') vColor = 'c-fight';
    else if (a.state === 'sparring') vColor = 'c-fight';
    else if (a.state === 'making_art' || serverAct === 'making_art') vColor = 'c-art';
    else if (a.state === 'playing_music' || serverAct === 'playing_music') vColor = 'c-art';
    else if (a.state === 'meditating') vColor = 'c-med';
    else if (a.state === 'celebrating') vColor = 'c-cele';
    else if (a.state === 'walking') vColor = 'c-walk';
    else if (a.state === 'sleeping') vColor = 'c-sleep';
    else if (a.state === 'talking') vColor = 'c-talk';

    var charLines;
    var bob = a.bobFrame < 6 ? 0 : 1;

    if (a.state === 'sleeping') {
      var zz = ['z', 'zZ', 'zZz', 'ZzZ', 'Zz'][Math.floor(a.sleepFrame / 6) % 5];
      charLines = [
        '  ' + zz.padEnd(5),
        ' .---.     ',
        '| ' + ap.eyes.replace(/[oO@*0><=^.]/g, '-') + ' |',
        '| ' + ap.mouth + ' |',
        "'-----'    ",
        '  ~~~~     ',
      ];
    } else if (a.state === 'fighting') {
      var fightFrame = a.bobFrame % 6;
      var fightChars = ['!', '/', '|', '\\', '*', 'X'];
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|' + fightChars[fightFrame],
        "'" + ap.body.slice(1, -1) + "'X",
        fightFrame % 2 ? ' d  b ' : '  db  ',
      ];
    } else if (a.state === 'sparring') {
      var sparFrame = a.bobFrame % 6;
      var sparChars = ['/', '|', '\\', '-', '/', '|'];
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|' + sparChars[sparFrame],
        "'" + ap.body.slice(1, -1) + "'|",
        bob ? ' d  b ' : '  db  ',
      ];
    } else if (a.state === 'making_art' || serverAct === 'making_art') {
      var artFrame = a.bobFrame % 6;
      var brushChars = ['/', '-', '\\', '|', '/', '-'];
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|',
        "'" + ap.body.slice(1, -1) + "'" + brushChars[artFrame],
        ' d   b [=]',
      ];
    } else if (a.state === 'playing_music' || serverAct === 'playing_music') {
      var noteFrame = a.bobFrame % 3;
      var notes = [' d', ' b', ' d'];
      charLines = [
        '    ' + notes[noteFrame],
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|',
        "'" + ap.body.slice(1, -1) + "'",
        ' d   b ',
      ];
    } else if (a.state === 'meditating') {
      charLines = [
        '   ~   ',
        ap.head,
        '|' + ap.eyes.replace(/[oO@*0><=]/g, '-') + '|',
        '|' + ap.mouth + '|',
        "'" + ap.body.slice(1, -1) + "'",
        ' _/  \\_ ',
      ];
    } else if (a.state === 'celebrating') {
      var celFrame = a.bobFrame % 6;
      var arms = ['\\o/', '/o\\', '\\o/', ' o ', '/o\\', '\\o/'];
      charLines = [
        '  ' + arms[celFrame] + '  ',
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|',
        "'" + ap.body.slice(1, -1) + "'",
        bob ? ' d  b ' : '  db  ',
      ];
    } else if (a.state === 'walking') {
      var step = a.bobFrame % 3;
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|',
        "'" + ap.body.slice(1, -1) + "'",
        step ? ' d  b ' : '  db  ',
      ];
    } else if (a.state === 'working') {
      var workFrame = a.bobFrame % 6;
      var workChars = ['*', '+', 'x', '.', '*', '+'];
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|',
        "'" + ap.body.slice(1, -1) + "'" + workChars[workFrame],
        ' d   b ',
      ];
    } else {
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|',
        "'" + ap.body.slice(1, -1) + "'",
        bob ? ' d   b' : ' d   b',
      ];
    }

    // Speech bubble
    if (a.currentSpeech && a.speechTimer > 0) {
      var bubbleText = a.currentSpeech;
      var bubbleLine = '\u250c' + '\u2500'.repeat(bubbleText.length + 2) + '\u2510';
      var bubbleContent = '\u2502 ' + bubbleText + ' \u2502';
      var bubbleBottom = '\u2514\u2500\u252c' + '\u2500'.repeat(bubbleText.length) + '\u2518';
      var bubblePtr = '  \u2502';

      var bubbleLines = [bubbleLine, bubbleContent, bubbleBottom, bubblePtr];
      var bubbleStartY = groundY - charLines.length - bubbleLines.length;

      for (var br = 0; br < bubbleLines.length; br++) {
        for (var bc = 0; bc < bubbleLines[br].length; bc++) {
          var bfx = x + bc - 1, bfy = bubbleStartY + br;
          if (bfx >= 0 && bfx < W && bfy >= 0 && bfy < H) {
            setCell(grid, bfx, bfy, bubbleLines[br][bc], 'c-spr');
          }
        }
      }
    }

    // Draw character
    var charStartY = groundY - charLines.length;
    for (var cr = 0; cr < charLines.length; cr++) {
      for (var cc = 0; cc < charLines[cr].length; cc++) {
        var cfx = x + cc, cfy = charStartY + cr;
        if (cfx >= 0 && cfx < W && cfy >= 0 && cfy < H && charLines[cr][cc] !== ' ') {
          setCell(grid, cfx, cfy, charLines[cr][cc], vColor);
        }
      }
    }

    // Name under ground
    var nameY = groundY + 1;
    var name = v.name.slice(0, 7);
    var nx = x + Math.floor((7 - name.length) / 2);
    for (var ni = 0; ni < name.length && nx + ni < W; ni++) {
      if (nx + ni >= 0) setCell(grid, nx + ni, nameY, name[ni], 'c-name');
    }
  }

  // Title bar (built as HTML directly for color)
  var sym = world.banner_symbol || '*';
  var title = ' ' + sym + ' ' + world.name + ' ' + sym + '  \u2502  Day ' + world.day_number + '  \u2502  ' + world.season + '  \u2502  ' + world.time_of_day + ' ';
  var topBorder = '\u2554' + '\u2550'.repeat(W - 2) + '\u2557';
  var titlePad = '\u2551' + title.padStart(Math.floor((W - 2 + title.length) / 2)).padEnd(W - 2) + '\u2551';
  var botBorder = '\u255a' + '\u2550'.repeat(W - 2) + '\u255d';

  var titleHTML = '<span class="c-title">' + escText(topBorder) + '\n' + escText(titlePad) + '\n' + escText(botBorder) + '</span>';

  var composed = titleHTML + '\n' + composeHTML(grid);
  document.getElementById('world').innerHTML = composed;
}

function escText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── SIDEBAR UPDATES ───
function updateSidebar(data) {
  var w = data.world;
  document.getElementById('town-name').textContent = w.name || 'Unnamed Town';
  document.getElementById('town-meta').textContent = 'Day ' + w.day_number + ' | ' + w.season + ' | ' + w.time_of_day;
  document.getElementById('town-motto').textContent = w.motto ? '"' + w.motto + '"' : '';

  var cultureEl = document.getElementById('town-culture');
  if (data.culture) {
    cultureEl.textContent = data.culture.descriptor || 'CALM';
  } else {
    cultureEl.textContent = '';
  }

  var resTypes = ['food', 'wood', 'stone', 'knowledge', 'gold', 'faith'];
  for (var ri = 0; ri < resTypes.length; ri++) {
    var type = resTypes[ri];
    var r = data.resources[type] || { amount: 0, capacity: 100 };
    var el = document.getElementById('res-' + type);
    if (!el) continue;
    el.querySelector('.res-val').textContent = r.amount;
    var fill = el.querySelector('.res-fill');
    var pct = Math.min(100, (r.amount / r.capacity) * 100);
    fill.style.width = pct + '%';
    fill.className = 'res-fill' + (pct < 15 ? ' low' : pct < 40 ? ' mid' : '');
  }

  document.getElementById('pop-count').textContent = data.population.alive + '/' + data.population.capacity;

  var citizenList = document.getElementById('citizen-list');
  citizenList.innerHTML = '';
  for (var ci = 0; ci < data.villagers.length; ci++) {
    var v = data.villagers[ci];
    var row = document.createElement('div');
    row.className = 'citizen-row' + (v.status === 'dead' ? ' citizen-dead' : '');

    var moodEmoji = v.morale > 70 ? ':)' : v.morale > 40 ? ':|' : ':(';
    var activityText = (v.activity && v.activity.activity) ? v.activity.activity : 'idle';
    var persText = '';
    if (v.temperament !== undefined) {
      var t = v.temperament > 65 ? 'calm' : v.temperament < 35 ? 'hot' : '';
      var c = v.creativity > 65 ? 'artsy' : v.creativity < 35 ? 'pract' : '';
      var s = v.sociability > 65 ? 'social' : v.sociability < 35 ? 'loner' : '';
      persText = [t, c, s].filter(Boolean).join('/') || '';
    }

    row.innerHTML =
      '<span class="citizen-face">[' + esc(v.appearance.eyes) + ']</span>' +
      '<span class="citizen-name">' + esc(v.name) + '</span>' +
      '<span class="citizen-role">' + v.role + '</span>' +
      '<span class="citizen-mood">' + moodEmoji + '</span>' +
      '<span class="citizen-state">' + activityText + '</span>' +
      (persText ? '<span class="citizen-pers">' + persText + '</span>' : '');
    citizenList.appendChild(row);
  }

  var buildingList = document.getElementById('building-list');
  buildingList.innerHTML = '';
  for (var bbi = 0; bbi < data.buildings.length; bbi++) {
    var b = data.buildings[bbi];
    var brow = document.createElement('div');
    var isConstructing = b.status === 'constructing';
    brow.innerHTML =
      '<div class="building-row"><span class="building-name">' + esc(b.type.replace('_', ' ')) + ' Lv' + b.level + '</span>' +
      '<span class="building-status ' + (isConstructing ? 'building-constructing' : '') + '">' +
      (isConstructing ? 'building...' : b.status) + '</span></div>' +
      (isConstructing ? '<div class="building-bar"><div class="building-bar-fill" style="width:' + Math.max(0, 100 - b.construction_ticks_remaining * 10) + '%"></div></div>' : '');
    buildingList.appendChild(brow);
  }

  var eventList = document.getElementById('event-list');
  eventList.innerHTML = '';
  for (var ei = 0; ei < data.recentEvents.length; ei++) {
    var e = data.recentEvents[ei];
    var erow = document.createElement('div');
    erow.className = 'event-row ' + (e.severity || 'info');
    erow.textContent = e.title;
    eventList.appendChild(erow);
  }

  var socialList = document.getElementById('social-list');
  if (socialList && data.socialEvents) {
    socialList.innerHTML = '';
    for (var si = 0; si < data.socialEvents.length; si++) {
      var se = data.socialEvents[si];
      var srow = document.createElement('div');
      srow.className = 'social-row ' + (se.severity || 'info');
      srow.textContent = se.title;
      socialList.appendChild(srow);
    }
  }

  var cultureStats = document.getElementById('culture-stats');
  if (cultureStats && data.culture) {
    var cu = data.culture;
    cultureStats.innerHTML =
      '<div class="culture-stat"><span>Violence</span><div class="culture-bar"><div class="culture-fill violence" style="width:' + cu.violence + '%"></div></div></div>' +
      '<div class="culture-stat"><span>Creativity</span><div class="culture-bar"><div class="culture-fill creativity" style="width:' + cu.creativity + '%"></div></div></div>' +
      '<div class="culture-stat"><span>Cooperation</span><div class="culture-bar"><div class="culture-fill cooperation" style="width:' + cu.cooperation + '%"></div></div></div>' +
      (cu.total_projects > 0 ? '<div class="culture-count">Projects: ' + cu.total_projects + '</div>' : '') +
      (cu.total_fights > 0 ? '<div class="culture-count fights">Fights: ' + cu.total_fights + '</div>' : '');
  }
}

// ─── HELPERS ───
function setStatus(cls, text) {
  var el = document.getElementById('connection-status');
  el.className = cls;
  el.textContent = text;
}

function weatherIcon(w) {
  return { clear: '\u2600', rain: '\u2602', storm: '\u26a1', snow: '\u2744', fog: '\u2601', heat: '\u2600' }[w] || '';
}

function showNotification(title, severity) {
  var container = document.getElementById('notifications');
  var el = document.createElement('div');
  el.className = 'notification ' + (severity || 'info');
  el.textContent = '> ' + title;
  container.appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
  while (container.children.length > 5) container.removeChild(container.firstChild);
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  document.getElementById('error-overlay').classList.add('visible');
}

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── ADAPTIVE FULLSCREEN SCALING ───
var _resizeTimer = null;
function resizeScene() {
  var container = document.getElementById('scene-container');
  var world = document.getElementById('world');
  if (!container || !world) return;

  var availW = container.clientWidth - 24; // 12px padding each side
  var availH = container.clientHeight - 16; // 8px padding top+bottom

  var COLS = 100;
  var ROWS = 48; // 3 title + 45 grid

  // Measure a single monospace character at 10px reference size
  var probe = document.createElement('pre');
  probe.style.cssText = "font-family:'Courier New',Courier,monospace;font-size:10px;line-height:1.15;position:absolute;visibility:hidden;white-space:pre;padding:0;margin:0;";
  probe.textContent = 'X';
  document.body.appendChild(probe);
  var charW10 = probe.offsetWidth;
  var charH10 = probe.offsetHeight;
  document.body.removeChild(probe);

  // At font-size N: charW = charW10*(N/10), charH = charH10*(N/10)
  // Fit: COLS * charW <= availW  =>  N <= 10 * availW / (COLS * charW10)
  // Fit: ROWS * charH <= availH  =>  N <= 10 * availH / (ROWS * charH10)
  var maxFromW = 10 * availW / (COLS * charW10);
  var maxFromH = 10 * availH / (ROWS * charH10);
  var fontSize = Math.min(maxFromW, maxFromH);
  fontSize = Math.max(6, Math.min(20, Math.floor(fontSize * 10) / 10));

  world.style.fontSize = fontSize + 'px';
}

window.addEventListener('resize', function () {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(resizeScene, 100);
});

// ─── EASTER EGG: CRT MODE ───
(function () {
  var params = new URLSearchParams(window.location.search);
  if (params.get('crt') === '1') {
    document.body.classList.add('crt-mode');
  }
})();

// ─── START ───
if (viewToken) {
  connect();
  startAnimLoop();
  resizeScene();
}
