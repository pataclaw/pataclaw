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
  { name: 'verdant', ground: ['~','*','.',"'"], groundAlt: [',',';','`','"'], groundSparse: [' ','.','.','`'], border: '\u2248', decor: ['\u2663','\u273f','Y','\u2740','\u2698'], gndClass: 'c-gnd-v', bldClass: 'c-civ-v', decClass: 'c-dec-v' },
  { name: 'stone',   ground: ['#','=','.',':'], groundAlt: ['%','=','-',';'], groundSparse: ['.','.',':','`'], border: '\u25ac', decor: ['\u25c6','\u25aa','\u25b3','\u25a0','\u25c8'], gndClass: 'c-gnd-s', bldClass: 'c-civ-s', decClass: 'c-dec-s' },
  { name: 'mystic',  ground: ['*','\u00b7','\u00b0','~'], groundAlt: ['+','\u00b7','.','\u00b0'], groundSparse: ['.','\u00b7',' ','.'], border: '\u2726', decor: ['\u25c7','\u2020','\u25cb','\u2605','\u2721'], gndClass: 'c-gnd-m', bldClass: 'c-civ-m', decClass: 'c-dec-m' },
  { name: 'desert',  ground: ['~','.','\u00b0',','], groundAlt: ['-','.',',',';'], groundSparse: ['.',' ',',','.'], border: '\u2261', decor: ['}','\u222b','\u25cb','\u2042','\u2217'], gndClass: 'c-gnd-d', bldClass: 'c-civ-d', decClass: 'c-dec-d' },
  { name: 'frost',   ground: ['*','.','\u00b7',"'"], groundAlt: ['+','.','\u00b7',','], groundSparse: [' ','.','\u00b7',' '], border: '\u2500', decor: ['\u25bd','*','\u25c7','\u2736','\u2746'], gndClass: 'c-gnd-f', bldClass: 'c-civ-f', decClass: 'c-dec-f' },
  { name: 'ember',   ground: ['^','~','.','*'], groundAlt: ['v','~','-','+'], groundSparse: ['.',' ','~','.'], border: '\u2584', decor: ['^','~','\u25cf','\u2666','\u2739'], gndClass: 'c-gnd-e', bldClass: 'c-civ-e', decClass: 'c-dec-e' },
];
var civStyle = null;

const ROLE_HATS = {
  idle: '       ', farmer: '  ,^,  ', warrior: ' ]=+=[ ',
  builder: '  _n_  ', scout: '  />   ', scholar: '  _=_  ', priest: '  _+_  ',
  fisherman: '  ~o~  ',
};

var ROLE_NAME_COLORS = {
  idle: 'c-n-idle', farmer: 'c-n-farmer', warrior: 'c-n-warrior',
  builder: 'c-n-builder', scout: 'c-n-scout', scholar: 'c-n-scholar',
  priest: 'c-n-priest', fisherman: 'c-n-fisherman',
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
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) return;
  grid[y][x] = { ch: ch, c: c || '' };
}

function getCell(grid, x, y) {
  return grid[y][x];
}

function escChar(ch) {
  if (ch == null || typeof ch !== 'string' || ch.length === 0) return ' ';
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
      if (!cell) {
        if (runClass === '') { run += ' '; } else { if (run) html += wrapRun(run, runClass); run = ' '; runClass = ''; }
        continue;
      }
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
    updatePlanetaryBanner(data.planetaryEvent);
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
    if (v.status !== 'alive') continue;
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

  // ─── CELESTIAL SYSTEM: Sun, Moon, Stars ───
  var dayProgress = (world.current_tick % 36) / 36; // 0.0 → ~0.97
  var horizonY = groundY - 2;
  var arcHeight = 26;

  // Sun: visible dawn (0.0) → dusk end (0.833)
  if (dayProgress < 0.833) {
    var sunProg = dayProgress / 0.833;
    var sunX = Math.floor(sunProg * (W - 10)) + 5;
    var sunY = Math.floor(horizonY - Math.sin(sunProg * Math.PI) * arcHeight);
    sunY = Math.max(1, Math.min(horizonY, sunY));
    if (sunX >= 0 && sunX < W && sunY >= 0 && sunY < groundY) {
      setCell(grid, sunX, sunY, 'O', 'c-sun');
      // Glow around sun
      var glowOff = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1]];
      for (var gi = 0; gi < glowOff.length; gi++) {
        var gx = sunX + glowOff[gi][0], gy = sunY + glowOff[gi][1];
        if (gx >= 0 && gx < W && gy >= 0 && gy < groundY && getCell(grid, gx, gy).ch === ' ') {
          setCell(grid, gx, gy, '.', 'c-sunglow');
        }
      }
    }
  }

  // Moon: visible dusk (0.667) → dawn end (0.167) wrapping
  var moonStart = 0.667, moonDur = 0.5;
  var moonRaw = dayProgress - moonStart;
  if (moonRaw < 0) moonRaw += 1.0;
  var moonProg = moonRaw / moonDur;
  if (moonProg >= 0 && moonProg <= 1.0 && (dayProgress >= moonStart || dayProgress < 0.167)) {
    var moonX = Math.floor(moonProg * (W - 10)) + 5;
    var moonY = Math.floor(horizonY - Math.sin(moonProg * Math.PI) * arcHeight);
    moonY = Math.max(1, Math.min(horizonY, moonY));
    if (moonX >= 0 && moonX < W && moonY >= 0 && moonY < groundY) {
      setCell(grid, moonX, moonY, 'C', 'c-moon');
      var mGlow = [[-1,0],[1,0],[0,-1]];
      for (var mi = 0; mi < mGlow.length; mi++) {
        var mx = moonX + mGlow[mi][0], my = moonY + mGlow[mi][1];
        if (mx >= 0 && mx < W && my >= 0 && my < groundY && getCell(grid, mx, my).ch === ' ') {
          setCell(grid, mx, my, '.', 'c-moonglow');
        }
      }
    }
  }

  // Stars: fade in during late dusk, full at night, fade out during dawn
  var starVis = 0;
  if (dayProgress >= 0.75) starVis = Math.min(1.0, (dayProgress - 0.75) / 0.083);
  else if (dayProgress < 0.083) starVis = 1.0;
  else if (dayProgress < 0.167) starVis = Math.max(0, 1.0 - (dayProgress - 0.083) / 0.083);

  if (starVis > 0) {
    if (!starField || (lastTimeOfDay !== 'night' && lastTimeOfDay !== 'dusk' && world.time_of_day !== lastTimeOfDay)) {
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
      if (Math.random() < starVis * 0.92) {
        setCell(grid, starField[si].x, starField[si].y, starField[si].ch, 'c-star');
      }
    }
  } else {
    starField = null;
  }
  lastTimeOfDay = world.time_of_day;

  // Clouds (rendered before weather particles, after stars)
  renderClouds(grid, W, world.weather);

  // Hills — 3 layered depth ranges
  // Far hills (background, subtle)
  for (var hx = 0; hx < W; hx++) {
    var hFar = Math.floor(Math.sin(hx * 0.04) * 2.5 + Math.sin(hx * 0.09 + 2) * 1.5 + Math.cos(hx * 0.02) * 1);
    for (var dy = 0; dy <= Math.max(0, hFar + 2); dy++) {
      var hy = 8 - hFar + dy;
      if (hy >= 0 && hy < groundY - 10 && getCell(grid, hx, hy).ch === ' ') {
        setCell(grid, hx, hy, '\u00b7', 'c-hill-far');
      }
    }
  }
  // Mid hills
  for (var hx = 0; hx < W; hx++) {
    var hMid = Math.floor(Math.sin(hx * 0.07) * 2 + Math.sin(hx * 0.13 + 1) * 1.5 + Math.cos(hx * 0.03) * 1);
    for (var dy = 0; dy <= Math.max(0, hMid + 2); dy++) {
      var hy = 10 - hMid + dy;
      if (hy >= 0 && hy < groundY - 8 && getCell(grid, hx, hy).ch === ' ') {
        var isPeak = dy === 0 && hMid > 1;
        setCell(grid, hx, hy, isPeak ? '\u25b4' : '\u25aa', 'c-hill-mid');
      }
    }
  }
  // Near hills (foreground, bold)
  for (var hx = 0; hx < W; hx++) {
    var hNear = Math.floor(Math.sin(hx * 0.11) * 1.5 + Math.sin(hx * 0.19 + 3) * 1 + Math.cos(hx * 0.06) * 0.8);
    for (var dy = 0; dy <= Math.max(0, hNear + 1); dy++) {
      var hy = 13 - hNear + dy;
      if (hy >= 0 && hy < groundY - 6 && getCell(grid, hx, hy).ch === ' ') {
        var isPeak = dy === 0 && hNear > 0;
        setCell(grid, hx, hy, isPeak ? '\u25b2' : '#', 'c-hill-near');
      }
    }
  }

  // Persistent weather particles — per-type colors
  var wCharMap = { rain: '.', storm: '/', snow: '*', fog: '\u2591', heat: '~' };
  var wColorMap = { rain: 'c-w-rain', storm: 'c-w-storm', snow: 'c-w-snow', fog: 'c-w-fog', heat: 'c-w-heat' };
  var wChar = wCharMap[world.weather];
  var wColor = wColorMap[world.weather] || 'c-w-rain';
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

    // Storm: lightning bolt effect (4% of frames)
    if (world.weather === 'storm' && Math.random() < 0.04) {
      var lx = 5 + Math.floor(Math.random() * (W - 10));
      var ly = 2 + Math.floor(Math.random() * 6);
      var boltLen = 4 + Math.floor(Math.random() * 6);
      for (var li = 0; li < boltLen; li++) {
        var boltY = ly + li;
        var boltX = lx + (li % 2 === 0 ? 0 : (Math.random() < 0.5 ? 1 : -1));
        if (boltX >= 0 && boltX < W && boltY >= 0 && boltY < groundY) {
          var boltCh = li % 2 === 0 ? '/' : '\\';
          setCell(grid, boltX, boltY, boltCh, 'c-w-lightning');
        }
      }
    }

    // Fog: ground-level density layer
    if (world.weather === 'fog') {
      for (var fx = 0; fx < W; fx++) {
        for (var fy = groundY - 3; fy < groundY; fy++) {
          if (Math.random() < 0.25 && getCell(grid, fx, fy).ch === ' ') {
            setCell(grid, fx, fy, '\u2592', 'c-w-fog-dense');
          }
        }
      }
    }

    // Snow: accumulation dots along ground line
    if (world.weather === 'snow') {
      for (var sx = 0; sx < W; sx++) {
        if (Math.random() < 0.3 && getCell(grid, sx, groundY - 1).ch === ' ') {
          setCell(grid, sx, groundY - 1, '.', 'c-w-snow');
        }
      }
    }
  } else {
    weatherParticles.length = 0;
  }

  // Ground — multi-layer animated grass with biome zones, 4 depth tiers, vegetation
  var waveChars = civStyle ? civStyle.ground : [',', "'", '`', '.'];
  var waveCharsAlt = civStyle ? civStyle.groundAlt : [',', ';', '`', '"'];
  var waveCharsSparse = civStyle ? civStyle.groundSparse : [' ', '.', '.', '`'];
  var borderChar = civStyle ? civStyle.border : '\u2550';
  var gndColor = civStyle ? civStyle.gndClass : 'c-gnd';
  var gndColorL = gndColor + 'l'; // light variant
  var gndColorM = gndColor + 'm'; // mid-accent variant
  var gndColorD = gndColor + 'd'; // deep variant
  var groundDepth = H - groundY - 1; // total ground rows
  var wSeed = (world.seed || 0);
  for (var gx = 0; gx < W; gx++) {
    setCell(grid, gx, groundY, borderChar, gndColor);
    // Biome zone: 3 zones based on horizontal position
    var biomeZone = (gx + wSeed) % 3;
    var zoneChars = biomeZone === 0 ? waveChars : (biomeZone === 1 ? waveCharsAlt : waveCharsSparse);

    for (var gy = groundY + 1; gy < H; gy++) {
      var depth = (gy - groundY - 1) / groundDepth; // 0.0 near border → 1.0 at bottom
      // 4 depth tiers: light (0-0.25), mid-accent (0.25-0.45), base (0.45-0.65), deep (0.65-1.0)
      var rowColor = depth < 0.25 ? gndColorL : (depth < 0.45 ? gndColorM : (depth > 0.65 ? gndColorD : gndColor));

      // Layer 1: primary wave
      var wave1 = Math.sin((gx * 0.3) + (gy * 0.5) - (waveCounter * 0.10));
      // Layer 2: secondary wave (slower, different frequency)
      var wave2 = Math.sin((gx * 0.15) + (gy * 0.8) - (waveCounter * 0.06));
      // Layer 3: micro-texture wave (frequency varies by biome zone)
      var wave3Freq = biomeZone === 0 ? 0.5 : (biomeZone === 1 ? 0.7 : 0.4);
      var wave3 = Math.sin((gx * wave3Freq) + (gy * 0.3) - (waveCounter * 0.04));
      var combined = wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.2;
      var charIdx = Math.floor((combined + 1) * 2) % zoneChars.length;

      if (Math.abs(combined) > 0.12) {
        setCell(grid, gx, gy, zoneChars[charIdx], rowColor);
      } else if (civStyle) {
        // Vegetation at different depth levels
        var vegSeed = ((gx * 7 + gy * 13 + wSeed) % 100);
        if (depth < 0.35 && vegSeed < 5) {
          // Flowers in light zone (5%)
          setCell(grid, gx, gy, civStyle.decor[vegSeed % civStyle.decor.length], civStyle.decClass);
        } else if (depth >= 0.35 && depth < 0.65 && vegSeed < 2) {
          // Rocks in mid zone (2%)
          setCell(grid, gx, gy, vegSeed % 2 === 0 ? 'o' : '\u00b7', 'c-veg-rock');
        } else if (depth >= 0.65 && vegSeed < 1) {
          // Fungi/roots in deep zone (1%)
          setCell(grid, gx, gy, '\u00a7', 'c-veg-root');
        }
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
  var dockRenderX = -1; // track dock position for water rendering
  var farmPositions = []; // track farm positions for crop rendering
  for (var bi = 0; bi < data.buildings.length; bi++) {
    var b = data.buildings[bi];
    var sprite = b.sprite;
    if (!sprite) continue;
    if (b.type === 'dock') dockRenderX = bx;
    if (b.type === 'farm') farmPositions.push({ x: bx, w: sprite[0].length, id: b.id });
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

    } else if (b.status === 'decaying') {
      // Decaying building — full sprite with procedural damage overlay
      var hpPct = b.max_hp > 0 ? b.hp / b.max_hp : 0;
      var damageRate = 0.2 + (1 - hpPct) * 0.2; // 20-40% chars replaced
      var DECAY_CHARS = ['.', ',', "'", '`', ':', ';'];
      for (var r = 0; r < sh; r++) {
        for (var c = 0; c < sw; c++) {
          var fx = bx + c, fy = bsy + r;
          if (fx < W && fy >= 0 && fy < H && sprite[r][c] !== ' ') {
            if (seededRand(b.id, r, c) < damageRate) {
              var dch = DECAY_CHARS[(r * 7 + c * 3 + waveCounter) % DECAY_CHARS.length];
              setCell(grid, fx, fy, dch, 'c-decay-bld');
            } else {
              setCell(grid, fx, fy, sprite[r][c], bColor);
            }
          }
        }
      }
      // HP bar below sprite
      var hpBarW = Math.min(sw, 10);
      var hpFilled = Math.round(hpPct * hpBarW);
      var hpBar = '[' + '\u2588'.repeat(hpFilled) + '\u2591'.repeat(hpBarW - hpFilled) + ']';
      var hpColor = hpPct < 0.3 ? 'c-fight' : hpPct < 0.6 ? 'c-decay' : 'c-bar';
      for (var hi = 0; hi < hpBar.length && bx + hi < W; hi++) {
        setCell(grid, bx + hi, groundY + 2, hpBar[hi], hpColor);
      }

    } else if (b.status === 'abandoned') {
      // Abandoned building — heavily degraded (50% chars replaced with ruin markers)
      var RUIN_CHARS = ['#', '.', ',', '/', '\\', '|', '_'];
      for (var r = 0; r < sh; r++) {
        for (var c = 0; c < sw; c++) {
          var fx = bx + c, fy = bsy + r;
          if (fx < W && fy >= 0 && fy < H && sprite[r][c] !== ' ') {
            if (seededRand(b.id, r, c) < 0.5) {
              var rch = RUIN_CHARS[(r * 5 + c * 11) % RUIN_CHARS.length];
              setCell(grid, fx, fy, rch, 'c-abandoned');
            } else {
              setCell(grid, fx, fy, sprite[r][c], 'c-abandoned');
            }
          }
        }
      }

    } else if (b.status === 'rubble') {
      // Rubble — small 2-row debris pile
      var rubbleChars = ['#', '.', '=', ',', '/', '\\'];
      var rw = Math.min(sw, 7);
      for (var r = 0; r < 2; r++) {
        for (var c = 0; c < rw; c++) {
          var fx = bx + c, fy = groundY - 2 + r;
          if (fx < W && fy >= 0 && fy < H) {
            var rc = rubbleChars[(r * 3 + c * 7 + hashBuildingId(b.id || '')) % rubbleChars.length];
            setCell(grid, fx, fy, rc, 'c-rubble');
          }
        }
      }

    } else if (b.status === 'overgrown') {
      // Overgrown — nature reclaims
      var overChars = ['~', '*', ',', '.', '^', '`'];
      var ow = Math.min(sw, 7);
      for (var r = 0; r < 2; r++) {
        for (var c = 0; c < ow; c++) {
          var fx = bx + c, fy = groundY - 2 + r;
          if (fx < W && fy >= 0 && fy < H) {
            var oc = overChars[(r * 5 + c * 3 + hashBuildingId(b.id || '')) % overChars.length];
            setCell(grid, fx, fy, oc, 'c-overgrown');
          }
        }
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

    // Building label with status indicators
    var label = b.type.replace('_', ' ').toUpperCase();
    if (b.level > 1) label += ' L' + b.level;
    var lblClass = 'c-b-' + b.type;
    if (b.status === 'decaying') {
      label += ' [!]';
      lblClass = 'c-decay';
    } else if (b.status === 'abandoned') {
      label += ' [X]';
      lblClass = 'c-abandoned';
    } else if (b.status === 'rubble') {
      label = 'RUBBLE';
      lblClass = 'c-rubble';
    } else if (b.status === 'overgrown') {
      label = '';
    } else {
      if (b.level >= 3) lblClass += '-t3';
      else if (b.level >= 2) lblClass += '-t2';
    }
    var lx = bx + Math.floor((sw - Math.min(label.length, sw)) / 2);
    for (var li = 0; li < label.length && lx + li < W; li++) {
      setCell(grid, lx + li, groundY + 1, label[li], lblClass);
    }

    bx += sw + 2;
    if (bx > W - 14) break;
  }

  // Civilization decorations — scatter themed elements along ground
  if (civStyle && data.world.seed !== undefined) {
    var decorSeed = Math.abs(data.world.seed);
    for (var di = 0; di < 12; di++) {
      var dx = ((decorSeed * 7 + di * 31 + di * di * 13) % (W - 6)) + 3;
      if (getCell(grid, dx, groundY - 1).ch !== ' ') continue;
      var decorCh = civStyle.decor[di % civStyle.decor.length];
      setCell(grid, dx, groundY - 1, decorCh, civStyle.decClass);

      // Bush clusters (2-wide) every 3rd item
      if (di % 3 === 0 && dx + 1 < W && getCell(grid, dx + 1, groundY - 1).ch === ' ') {
        setCell(grid, dx + 1, groundY - 1, civStyle.decor[(di + 2) % civStyle.decor.length], civStyle.decClass);
      }

      // Taller decorations (stem + top) every 2nd item
      if (di % 2 === 0 && getCell(grid, dx, groundY - 2).ch === ' ') {
        var tallCh = di % 4 === 0 ? '|' : civStyle.decor[(di + 1) % civStyle.decor.length];
        setCell(grid, dx, groundY - 2, tallCh, civStyle.decClass);
        // Extra tall: add a top piece for every 4th
        if (di % 4 === 0 && getCell(grid, dx, groundY - 3).ch === ' ') {
          setCell(grid, dx, groundY - 3, civStyle.decor[(di + 3) % civStyle.decor.length], civStyle.decClass);
        }
      }
    }
  }

  // ─── WATER VISUALS (dock-dependent) ───
  if (dockRenderX >= 0) {
    var waterChars = ['\u2248', '~', '\u00b7', '-'];
    var waterStartX = Math.max(0, dockRenderX - 3);
    var waterEndX = Math.min(W, dockRenderX + 25);
    // Shore and surface water (above ground line)
    for (var wy = groundY - 2; wy < groundY; wy++) {
      for (var wx = waterStartX; wx < waterEndX; wx++) {
        if (getCell(grid, wx, wy).ch === ' ') {
          var ww = Math.sin((wx * 0.25) + (wy * 0.4) - (waveCounter * 0.12));
          var wci = Math.floor((ww + 1) * 2) % waterChars.length;
          setCell(grid, wx, wy, waterChars[wci], 'c-waterl');
        }
      }
    }
    // Deep water below ground (replaces ground)
    for (var wy2 = groundY; wy2 < H; wy2++) {
      for (var wx2 = waterStartX; wx2 < waterEndX; wx2++) {
        var ww2 = Math.sin((wx2 * 0.2) + (wy2 * 0.3) - (waveCounter * 0.15));
        var wci2 = Math.floor((ww2 + 1) * 2) % waterChars.length;
        setCell(grid, wx2, wy2, waterChars[wci2], wy2 === groundY ? 'c-waterl' : 'c-water');
      }
    }
    // Occasional fish
    if (waveCounter % 90 < 3) {
      var fishX = waterStartX + 5 + Math.floor(Math.sin(waveCounter * 0.05) * 8 + 8);
      if (fishX >= waterStartX && fishX + 2 < waterEndX && groundY - 1 >= 0) {
        var fishStr = waveCounter % 180 < 90 ? '><>' : '<><';
        for (var fi = 0; fi < 3; fi++) {
          if (getCell(grid, fishX + fi, groundY - 1).ch !== ' ') continue;
          setCell(grid, fishX + fi, groundY - 1, fishStr[fi], 'c-fish');
        }
      }
    }
  }

  // ─── CROP VISUALS (farm-dependent) ───
  if (data.crops && data.crops.length > 0 && farmPositions.length > 0) {
    var CROP_SPRITES = {
      shellgrain: ['. .', '.|.', '{@}', '{' + '\u263c' + '}'],
      tideweed:   ['...', '~.~', '~#~', '~' + '\u2618' + '~'],
      moltfruit:  ['. .', '(.)', '(o)', '(' + '\u25ce' + ')'],
      deepkelp:   ['. .', '|.|', '|#|', '|' + '\u2021' + '|'],
      clawroot:   ['. .', '\\|/', '\\V/', '\\' + '\u2726' + '/'],
    };
    // Build map of farm_id -> position
    var farmPosMap = {};
    for (var fpi = 0; fpi < farmPositions.length; fpi++) {
      farmPosMap[farmPositions[fpi].id] = farmPositions[fpi];
    }
    for (var ci = 0; ci < data.crops.length; ci++) {
      var crop = data.crops[ci];
      var fp = farmPosMap[crop.farm_id];
      if (!fp) continue;
      var cropSprites = CROP_SPRITES[crop.crop_type];
      if (!cropSprites) continue;
      var stage = Math.min(3, crop.growth_stage);
      var cropStr = cropSprites[stage];
      var cropColor = stage >= 3 ? 'c-croph' : 'c-crop';
      // Place crop to the right of the farm building
      var cropX = fp.x + fp.w + 1 + (ci % 3) * 4;
      var cropY = groundY - 1;
      for (var csi = 0; csi < cropStr.length && cropX + csi < W; csi++) {
        if (cropStr[csi] !== ' ' && cropX + csi >= 0) {
          if (getCell(grid, cropX + csi, cropY).ch === ' ') {
            setCell(grid, cropX + csi, cropY, cropStr[csi], cropColor);
          }
        }
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
    var ap = v.appearance || { eyes: 'o o', mouth: '___', head: '.---.', body: '|===|' };
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

    // Name under ground — colored by role, bright variant for experienced villagers
    var nameY = groundY + 1;
    var name = v.name.slice(0, 7);
    var nx = x + Math.floor((7 - name.length) / 2);
    var nameClass = ROLE_NAME_COLORS[role] || 'c-n-idle';
    if ((v.experience || 0) > 200) nameClass += '-hi';
    for (var ni = 0; ni < name.length && nx + ni < W; ni++) {
      if (nx + ni >= 0) setCell(grid, nx + ni, nameY, name[ni], nameClass);
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
  document.getElementById('town-name').textContent = (w.town_number ? '#' + w.town_number + ' ' : '') + (w.name || 'Unnamed Town');
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
      '<span class="citizen-face">[' + esc(v.appearance ? v.appearance.eyes : 'o o') + ']</span>' +
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
    var isDecaying = b.status === 'decaying';
    var isAbandoned = b.status === 'abandoned';
    var isRubble = b.status === 'rubble';
    var statusClass = isConstructing ? 'building-constructing' : isDecaying ? 'building-decaying' : isAbandoned ? 'building-abandoned' : isRubble ? 'building-rubble' : '';
    var statusText = isConstructing ? 'building...' : isDecaying ? 'decaying' : b.status;
    var hpPct = b.max_hp > 0 ? Math.round((b.hp / b.max_hp) * 100) : 100;
    var hpClass = hpPct < 30 ? ' hp-critical' : hpPct < 60 ? ' hp-warning' : '';
    var showHp = (b.status === 'active' || b.status === 'decaying') && hpPct < 100;
    brow.innerHTML =
      '<div class="building-row"><span class="building-name">' + esc(b.type.replace('_', ' ')) + ' Lv' + b.level + '</span>' +
      '<span class="building-status ' + statusClass + '">' + statusText + '</span></div>' +
      (isConstructing ? '<div class="building-bar"><div class="building-bar-fill" style="width:' + Math.max(0, 100 - b.construction_ticks_remaining * 10) + '%"></div></div>' : '') +
      (showHp ? '<div class="building-hp"><div class="building-hp-fill' + hpClass + '" style="width:' + hpPct + '%"></div></div>' : '');
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

// ─── PLANETARY EVENT BANNER ───
var PLANETARY_ICONS = {
  solar_eclipse: '\u25d1', meteor_shower: '\u2604', tidal_surge: '\u224b',
  shell_migration: '\u2727', blood_moon: '\u25cf', golden_age: '\u2605',
};
var PLANETARY_CLASSES = {
  solar_eclipse: 'pe-eclipse', meteor_shower: 'pe-meteor', tidal_surge: 'pe-tidal',
  shell_migration: 'pe-shell', blood_moon: 'pe-blood', golden_age: 'pe-golden',
};

function updatePlanetaryBanner(evt) {
  var el = document.getElementById('planetary-banner');
  if (!el) return;
  if (!evt) {
    el.classList.add('hidden');
    return;
  }
  var icon = PLANETARY_ICONS[evt.type] || '\u2731';
  var cls = PLANETARY_CLASSES[evt.type] || 'pe-golden';
  el.className = 'planetary-banner ' + cls;
  el.innerHTML = '<span class="pe-icon">' + icon + '</span> ' + esc(evt.title) + ' <span class="pe-desc">' + esc(evt.description || '') + '</span>';
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
