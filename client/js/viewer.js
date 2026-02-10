const viewToken = new URLSearchParams(window.location.search).get('token');
if (!viewToken) showError('No token provided. Go back and enter your key.');

let eventSource = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;

// Animation state - persists between server frames
const agents = {}; // villager id -> { x, targetX, state, speechTimer, currentSpeech, bobFrame, ... }
var nomadAgents = {}; // name -> { x, baseX, targetX, state, stateTimer, speechTimer, currentSpeech, bobFrame, facing }

var NOMAD_SPEECH = [
  'long road behind...', 'this place feels empty',
  'remember greener days', 'anyone still here?',
  '*warms hands*', 'shells guided me',
  'once a town stood here', 'just passing through',
  'current brought me', 'my home is gone',
  'nice fire at least', 'stars look different',
  '*stares into flames*', 'the deep remembers',
  'heard life was here once', 'maybe someone returns',
];
let lastWorldData = null;
let animFrameId = null;
let waveCounter = 0; // For ground wave + cloud drift

// Persistent particle systems
var weatherParticles = []; // {x, y, char, speed, drift}
var starField = null; // [{x, y, char}] - generated once per night
var lastTimeOfDay = null;

// Town scaling
var STAGE_WIDTHS = [80, 100, 120, 140];
var activeW = 140;
var targetW = 140;
var lastGrowthStage = -1;

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
  fisherman: '  ~o~  ', hunter: '  >=>  ',
};

var ROLE_NAME_COLORS = {
  idle: 'c-n-idle', farmer: 'c-n-farmer', warrior: 'c-n-warrior',
  builder: 'c-n-builder', scout: 'c-n-scout', scholar: 'c-n-scholar',
  priest: 'c-n-priest', fisherman: 'c-n-fisherman', hunter: 'c-n-hunter',
};

var ROLE_SYMBOLS = {
  idle: '\u00b7',      // ·
  farmer: '\u2663',    // ♣
  warrior: '\u2020',   // †
  builder: '\u25b2',   // ▲
  scout: '\u25c8',     // ◈
  scholar: '\u00a7',   // §
  priest: '\u2726',    // ✦
  fisherman: '\u2248', // ≈
  hunter: '\u25b7',    // ▷
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
  fog:    { count: [4, 5], types: ['large', 'full'],    speedRange: [0.005, 0.015], yRange: [6, 12] },
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
    try {
      reconnectAttempts = 0;
      var data = JSON.parse(e.data);
      setStatus('connected', 'LIVE');

      if (data.frame_type === 'map') {
        document.getElementById('world').textContent = data.composed;
        return;
      }

      lastWorldData = data;
      // Biome-aware visual style: match CIV_STYLE to dominant biome
      var BIOME_TO_CIV = {
        plains: 0, forest: 0, mountain: 1, swamp: 2,
        water: 2, desert: 3, ice: 4, tundra: 4,
      };
      var biomePick = (data.biome && data.biome.seed_dominant) || (data.biome && data.biome.dominant);
      if (biomePick && BIOME_TO_CIV[biomePick] !== undefined) {
        civStyle = CIV_STYLES[BIOME_TO_CIV[biomePick]];
      } else if (data.world.seed !== undefined && !civStyle) {
        civStyle = CIV_STYLES[Math.abs(data.world.seed) % CIV_STYLES.length];
      }
      updateSidebar(data);
      updatePlanetaryBanner(data.planetaryEvent);
      syncAgents(data.villagers);
      document.body.className = (data.world.time_of_day || 'morning') + ' weather-' + (data.world.weather || 'clear') + ' season-' + (data.world.season || 'summer') + ' biome-' + ((data.biome && data.biome.dominant) || 'plains');
      document.getElementById('weather-display').textContent = weatherIcon(data.world.weather) + ' ' + data.world.weather;
      document.getElementById('tick-display').textContent = 'tick ' + data.world.current_tick;
    } catch (err) {
      console.error('[viewer] frame handler error:', err);
      setStatus('connected', 'LIVE (render error)');
    }
  });

  eventSource.addEventListener('event', function (e) {
    try {
      var evt = JSON.parse(e.data);
      showNotification(evt.title, evt.severity);
    } catch (err) {
      console.error('[viewer] event handler error:', err);
    }
  });

  eventSource.addEventListener('error', function (e) {
    try {
      var err = JSON.parse(e.data);
      console.error('[viewer] server error:', err);
      setStatus('connected', 'ERROR: ' + (err.error || 'unknown'));
    } catch (_) {
      console.error('[viewer] server error event (unparseable)');
    }
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
    if (!seen.has(id) && agents[id].state !== 'dying') {
      agents[id].state = 'dying';
      agents[id].dyingFrame = 0;
      agents[id].stateTimer = 0;
      agents[id].currentSpeech = '';
      agents[id].speechTimer = 0;
    }
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

    try {
      for (var id in agents) {
        var a = agents[id];
        if (a.state === 'dying') {
          a.dyingFrame = (a.dyingFrame || 0) + 1;
          if (a.dyingFrame >= 60) { delete agents[id]; }
          continue;
        }
        if (!a.data || a.data.status !== 'alive') continue;
        updateAgent(a, lastWorldData.world);
      }

      // Update nomad agents
      syncNomads(lastWorldData.nomad_camps, activeW);
      for (var nid in nomadAgents) {
        updateNomad(nomadAgents[nid], activeW);
      }

      renderScene(lastWorldData);
    } catch (err) {
      console.error('[viewer] render error:', err);
    }
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
    wandering: 'walking', sleeping: 'sleeping', molting: 'molting',
    chopping: 'chopping', mining: 'mining', fishing: 'fishing', hunting: 'hunting',
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

    if (a.state === 'molting') {
      var moltPool = a.data.speechPool || ['*crack*'];
      a.currentSpeech = moltPool[Math.floor(Math.random() * moltPool.length)];
      a.speechTimer = 25;
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

// ─── NOMAD ANIMATION ───
function syncNomads(camps, W) {
  if (!camps || !camps.length) { nomadAgents = {}; return; }
  var seen = {};
  for (var i = 0; i < camps.length; i++) {
    var name = camps[i].name;
    seen[name] = true;
    if (!nomadAgents[name]) {
      var nHash = 0;
      for (var h = 0; h < name.length; h++) nHash = ((nHash << 5) - nHash + name.charCodeAt(h)) | 0;
      nHash = Math.abs(nHash);
      var baseX = 8 + (nHash % (W - 25));
      nomadAgents[name] = {
        x: baseX - 2,
        baseX: baseX,
        targetX: baseX - 2,
        state: 'sitting',
        stateTimer: Math.floor(Math.random() * 30),
        speechTimer: 0,
        currentSpeech: '',
        bobFrame: Math.floor(Math.random() * 12),
        facing: 1,
      };
    }
  }
  for (var n in nomadAgents) { if (!seen[n]) delete nomadAgents[n]; }
}

function updateNomad(n, W) {
  n.stateTimer++;
  n.bobFrame = (n.bobFrame + 1) % 12;

  // sitting → walk out to explore
  if (n.state === 'sitting' && n.stateTimer > 60 + Math.random() * 30) {
    n.stateTimer = 0;
    n.state = 'walking';
    n.targetX = n.baseX + (Math.random() - 0.5) * 24;
    n.targetX = Math.max(2, Math.min(W - 5, n.targetX));
    n.facing = n.targetX > n.x ? 1 : -1;
    n._returnWalk = false;
  }

  // walking → arrive → talk or sit
  if (n.state === 'walking') {
    var dx = n.targetX - n.x;
    if (Math.abs(dx) < 0.5) {
      n.x = n.targetX;
      if (n._returnWalk) {
        // Returning from talk → sit down
        n.state = 'sitting';
        n.stateTimer = 0;
        n._returnWalk = false;
      } else {
        // Arrived at wander spot → talk
        n.state = 'talking';
        n.stateTimer = 0;
        n.currentSpeech = NOMAD_SPEECH[Math.floor(Math.random() * NOMAD_SPEECH.length)];
        n.speechTimer = 35;
      }
    } else {
      var speed = 0.15 + Math.random() * 0.1;
      var move = Math.sign(dx) * Math.min(speed, Math.abs(dx));
      n.x += move;
      n.facing = Math.sign(dx);
    }
  }

  // talking → walk back to camp
  if (n.state === 'talking' && n.stateTimer > 40) {
    n.stateTimer = 0;
    n.state = 'walking';
    n.targetX = n.baseX + (Math.random() - 0.5) * 6;
    n.targetX = Math.max(2, Math.min(W - 5, n.targetX));
    n.facing = n.targetX > n.x ? 1 : -1;
    n._returnWalk = true;
  }

  if (n.speechTimer > 0) {
    n.speechTimer--;
    if (n.speechTimer <= 0) n.currentSpeech = '';
  }
}

// ─── SCENE RENDERER (colored grid) ───
function renderScene(data) {
  // Town scaling: interpolate activeW toward target
  if (data.growth_stage !== undefined && data.growth_stage !== lastGrowthStage) {
    var isFirstFrame = lastGrowthStage === -1;
    lastGrowthStage = data.growth_stage;
    targetW = STAGE_WIDTHS[Math.min(data.growth_stage, STAGE_WIDTHS.length - 1)];
    if (isFirstFrame) activeW = targetW; // snap on initial load, don't animate
  }
  if (activeW !== targetW) {
    var diff = targetW - activeW;
    activeW += diff > 0 ? Math.max(1, Math.ceil(diff / 24)) : Math.min(-1, Math.floor(diff / 24));
    if (Math.abs(activeW - targetW) < 2) activeW = targetW;
  }

  var W = activeW;
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
    if (sunX >= 0 && sunX < W && sunY >= 0 && sunY < 16) {
      setCell(grid, sunX, sunY, 'O', 'c-sun');
      // Glow around sun
      var glowOff = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1]];
      for (var gi = 0; gi < glowOff.length; gi++) {
        var gx = sunX + glowOff[gi][0], gy = sunY + glowOff[gi][1];
        if (gx >= 0 && gx < W && gy >= 0 && gy < 16 && getCell(grid, gx, gy).ch === ' ') {
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
    if (moonX >= 0 && moonX < W && moonY >= 0 && moonY < 16) {
      setCell(grid, moonX, moonY, 'C', 'c-moon');
      var mGlow = [[-1,0],[1,0],[0,-1]];
      for (var mi = 0; mi < mGlow.length; mi++) {
        var mx = moonX + mGlow[mi][0], my = moonY + mGlow[mi][1];
        if (mx >= 0 && mx < W && my >= 0 && my < 16 && getCell(grid, mx, my).ch === ' ') {
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

  // Hills — 3 layered depth ranges (overwrite celestial so sun/moon set behind hills)
  // Far hills (background, subtle)
  for (var hx = 0; hx < W; hx++) {
    var hFar = Math.floor(Math.sin(hx * 0.04) * 2.5 + Math.sin(hx * 0.09 + 2) * 1.5 + Math.cos(hx * 0.02) * 1);
    for (var dy = 0; dy <= Math.max(0, hFar + 2); dy++) {
      var hy = 8 - hFar + dy;
      if (hy >= 0 && hy < groundY - 10) {
        setCell(grid, hx, hy, '\u00b7', 'c-hill-far');
      }
    }
  }
  // Mid hills (overwrite far hills for proper layering)
  for (var hx = 0; hx < W; hx++) {
    var hMid = Math.floor(Math.sin(hx * 0.07) * 2 + Math.sin(hx * 0.13 + 1) * 1.5 + Math.cos(hx * 0.03) * 1);
    for (var dy = 0; dy <= Math.max(0, hMid + 2); dy++) {
      var hy = 10 - hMid + dy;
      if (hy >= 0 && hy < groundY - 8) {
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
      if (hy >= 0 && hy < groundY - 6) {
        var isPeak = dy === 0 && hNear > 0;
        setCell(grid, hx, hy, isPeak ? '\u25b2' : '#', 'c-hill-near');
      }
    }
  }

  // Weather/season/biome visual tinting is handled by CSS body classes
  // (added at frame receive: body.weather-X body.season-X body.biome-X)
  var biomeKey = (data.biome && data.biome.dominant) || 'plains';

  // ─── CANOPY TREES (biome-specific) + small bonsai background detail ───
  var growthStage = data.growth_stage || 0;

  // Canopy sprites keyed by biome — each has rows of [text, cssClass]
  // Size scales: rows = 4 + growthStage (max 8)
  var CANOPY_SPRITES = {
    forest: {
      small: [['   .   ','c-canopy-forest'],['  /|\\  ','c-canopy-forest'],[' /|||\\','c-canopy-forest'],['   |   ','c-tree-t']],
      full:  [['    .    ','c-canopy-forest'],['   /*\\   ','c-canopy-forest'],['  /***\\  ','c-canopy-forest'],[' /*****\\ ','c-canopy-forest'],['/***@***\\','c-canopy-forest'],[' \\**|**/ ','c-canopy-forest'],['  \\*|*/  ','c-canopy-forest'],['   |||   ','c-tree-t']],
    },
    plains: {
      small: [['  .  ','c-canopy-plains'],[' (~) ','c-canopy-plains'],['  |  ','c-tree-t']],
      full:  [['   ~   ','c-canopy-plains'],['  .~.  ','c-canopy-plains'],[' (~*~) ','c-canopy-plains'],['(~*Y*~)','c-canopy-plains'],[' (~*~) ','c-canopy-plains'],['   |   ','c-tree-t']],
    },
    swamp: {
      small: [['  \u00a7  ','c-canopy-swamp'],[' /|\\ ','c-canopy-swamp'],['/|~|\\','c-canopy-swamp'],['  |  ','c-tree-t']],
      full:  [['   \u00a7   ','c-canopy-swamp'],['  /~\\  ','c-canopy-swamp'],[' /\u00a7~\u00a7\\ ','c-canopy-swamp'],['/~~\u00a7~~\\','c-canopy-swamp'],['\\~/|\\~/','c-canopy-swamp'],[' /|||\\','c-canopy-swamp'],['  |||  ','c-tree-t']],
    },
    mountain: {
      small: [['  \u25b2  ','c-canopy-mountain'],[' /|\\ ','c-canopy-mountain'],['  |  ','c-tree-t']],
      full:  [['    \u25b2    ','c-canopy-mountain'],['   /^\\   ','c-canopy-mountain'],['  /^^^\\  ','c-canopy-mountain'],[' /^^^^^\\ ','c-canopy-mountain'],['  \\^^^/  ','c-canopy-mountain'],['   \\|/   ','c-canopy-mountain'],['    |    ','c-tree-t']],
    },
    desert: {
      small: [['  }  ','c-canopy-desert'],[' }|{ ','c-canopy-desert'],['  |  ','c-tree-t']],
      full:  [['   }   ','c-canopy-desert'],['  }|}  ','c-canopy-desert'],[' } | } ','c-canopy-desert'],['  }|}  ','c-canopy-desert'],['   |   ','c-canopy-desert'],['   |   ','c-tree-t']],
    },
    ice: {
      small: [['  \u25c7  ','c-canopy-ice'],[' \u2588|\u2588 ','c-canopy-ice'],['  |  ','c-tree-t']],
      full:  [['    \u25c7    ','c-canopy-ice'],['   \u25bd\u2588\u25bd   ','c-canopy-ice'],['  \u2588\u25c7\u25c7\u2588  ','c-canopy-ice'],[' \u25bd\u2588\u25c7\u2588\u25bd ','c-canopy-ice'],['  \u2588|\u2588  ','c-canopy-ice'],['   |   ','c-canopy-ice'],['   |   ','c-tree-t']],
    },
    tundra: {
      small: [['  *  ','c-canopy-tundra'],[' /|\\ ','c-canopy-tundra'],[' \u2591|\u2591 ','c-canopy-tundra'],['  |  ','c-tree-t']],
      full:  [['   *   ','c-canopy-tundra'],['  /*\\  ','c-canopy-tundra'],[' /\u2591*\u2591\\ ','c-canopy-tundra'],['/\u2591*\u2591*\u2591\\','c-canopy-tundra'],[' \\*\u2591*/ ','c-canopy-tundra'],['   |   ','c-tree-t']],
    },
    water: {
      small: [['  .  ','c-canopy-plains'],[' (~) ','c-canopy-plains'],['  |  ','c-tree-t']],
      full:  [['   ~   ','c-canopy-plains'],['  .~.  ','c-canopy-plains'],[' (~*~) ','c-canopy-plains'],['(~*Y*~)','c-canopy-plains'],[' (~*~) ','c-canopy-plains'],['   |   ','c-tree-t']],
    },
  };

  var BONSAI_SPRITES = [
    [[' . ','c-tree'],['(@)','c-tree'],[' | ','c-tree-t']],
    [[' * ','c-tree'],['/|\\','c-tree'],[' | ','c-tree-t']],
    [['.~.','c-tree'],['~~~','c-tree'],[' | ','c-tree-t']],
  ];

  var wSeedT = Math.abs(world.seed || 42);
  var treeXs = [];
  var canopyDef = CANOPY_SPRITES[biomeKey] || CANOPY_SPRITES.plains;

  // Canopy trees: 2-4 large trees based on growth stage
  var canopyN = 2 + Math.min(growthStage, 2);
  for (var ci = 0; ci < canopyN; ci++) {
    var th = ((wSeedT * 2654435761 + ci * 13331 + 4217) >>> 0) % 100000;
    var tx = 8 + (th % (W - 18));
    var tooClose = false;
    for (var xi = 0; xi < treeXs.length; xi++) { if (Math.abs(tx - treeXs[xi]) < 10) { tooClose = true; break; } }
    if (tooClose) continue;
    treeXs.push(tx);
    var spr = growthStage >= 2 ? canopyDef.full : canopyDef.small;
    var hillH = Math.floor(Math.sin(tx * 0.07) * 2 + Math.sin(tx * 0.13 + 1) * 1.5 + Math.cos(tx * 0.03) * 1);
    var treeBase = 10 - hillH;
    for (var tr = 0; tr < spr.length; tr++) {
      var trow = spr[tr][0], tcls = spr[tr][1];
      for (var tc = 0; tc < trow.length; tc++) {
        if (trow[tc] !== ' ') {
          var tpx = tx - Math.floor(trow.length / 2) + tc, tpy = treeBase - spr.length + tr;
          if (tpx >= 0 && tpx < W && tpy >= 0 && tpy < groundY) {
            setCell(grid, tpx, tpy, trow[tc], tcls);
          }
        }
      }
    }
  }

  // Bonsai trees: smaller background detail between canopy trees
  var bonsaiN = 3 + (wSeedT % 3);
  for (var ti = 0; ti < bonsaiN; ti++) {
    var th = ((wSeedT * 2654435761 + (ti + canopyN + 10) * 7919 + 1327) >>> 0) % 100000;
    var tx = 5 + (th % (W - 12));
    var tooClose = false;
    for (var xi = 0; xi < treeXs.length; xi++) { if (Math.abs(tx - treeXs[xi]) < 6) { tooClose = true; break; } }
    if (tooClose) continue;
    treeXs.push(tx);
    var ttype = th % BONSAI_SPRITES.length;
    var spr = BONSAI_SPRITES[ttype];
    var hillH = Math.floor(Math.sin(tx * 0.07) * 2 + Math.sin(tx * 0.13 + 1) * 1.5 + Math.cos(tx * 0.03) * 1);
    var treeBase = 10 - hillH;
    for (var tr = 0; tr < spr.length; tr++) {
      var trow = spr[tr][0], tcls = spr[tr][1];
      for (var tc = 0; tc < trow.length; tc++) {
        if (trow[tc] !== ' ') {
          var tpx = tx + tc, tpy = treeBase - spr.length + tr;
          if (tpx >= 0 && tpx < W && tpy >= 0 && tpy < groundY) {
            setCell(grid, tpx, tpy, trow[tc], tcls);
          }
        }
      }
    }
  }

  // Persistent weather particles — per-type colors
  var wCharMap = { rain: '.', storm: '/', snow: '*', fog: '\u2591', heat: '~' };
  var wColorMap = { rain: 'c-w-rain', storm: 'c-w-storm', snow: 'c-w-snow', fog: 'c-w-fog', heat: 'c-w-heat' };
  var wChar = wCharMap[world.weather];
  var wColor = wColorMap[world.weather] || 'c-w-rain';
  if (wChar) {
    var targetCount = { rain: 80, storm: 120, snow: 60, fog: 160, heat: 40 }[world.weather] || 60;
    var fallSpeed = { rain: 1.5, storm: 2.0, snow: 0.4, fog: 0.06, heat: -0.3 }[world.weather] || 1.0;
    var driftX = { rain: 0.3, storm: 0.8, snow: 0.15, fog: 0.08, heat: 0.1 }[world.weather] || 0;

    // Spawn new particles at top to maintain count
    while (weatherParticles.length < targetCount) {
      weatherParticles.push({
        x: Math.random() * W,
        y: Math.random() * (groundY - 2),
        speed: fallSpeed * (0.7 + Math.random() * 0.6),
        drift: (Math.random() - 0.3) * driftX,
      });
    }

    // Update and render — particles fall to ground, skip over occupied cells (hills, trees)
    for (var wi = weatherParticles.length - 1; wi >= 0; wi--) {
      var p = weatherParticles[wi];
      p.y += p.speed;
      p.x += p.drift;
      var px = Math.round(p.x), py = Math.round(p.y);
      if (px < 0 || px >= W || py < 0) {
        p.x = Math.random() * W;
        p.y = -1;
        p.speed = fallSpeed * (0.7 + Math.random() * 0.6);
        continue;
      }
      // Stop at ground line
      if (py >= groundY - 1) {
        p.x = Math.random() * W;
        p.y = -1;
        p.speed = fallSpeed * (0.7 + Math.random() * 0.6);
        continue;
      }
      // Only draw in empty cells (particles pass behind hills/trees naturally)
      if (getCell(grid, px, py).ch === ' ') {
        if (world.weather === 'fog' && py > groundY / 2) {
          setCell(grid, px, py, '\u2592', 'c-w-fog-dense');
        } else {
          setCell(grid, px, py, wChar, wColor);
        }
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
          if (getCell(grid, boltX, boltY).ch !== ' ') break; // bolt hits something, stop
          setCell(grid, boltX, boltY, li % 2 === 0 ? '/' : '\\', 'c-w-lightning');
        }
      }
    }

    // Fog: smooth ground mist + drifting fog banks (deterministic, no Math.random)
    if (world.weather === 'fog') {
      // Smooth ground fog using layered sine waves — "breathes" in and out
      // Fog rises from ground level (groundY), not from hills (which are background scenery)
      for (var fogRow = 1; fogRow <= 8; fogRow++) {
        var fogY = groundY - fogRow;
        if (fogY < 0) continue;
        var baseDensity = 1.0 - (fogRow - 1) / 8;
        for (var fogX = 0; fogX < W; fogX++) {
          var n1 = Math.sin(fogX * 0.08 + waveCounter * 0.015 + fogRow * 0.5);
          var n2 = Math.sin(fogX * 0.17 - waveCounter * 0.022 + fogRow * 1.3);
          var n3 = Math.sin(fogX * 0.04 + waveCounter * 0.008);
          var breathe = Math.sin(waveCounter * 0.012) * 0.15;
          var density = baseDensity + breathe + (n1 * 0.25 + n2 * 0.15 + n3 * 0.1);
          if (density > 0.35 && getCell(grid, fogX, fogY).ch === ' ') {
            if (density > 0.7) {
              setCell(grid, fogX, fogY, '\u2592', 'c-w-fog-dense');
            } else if (density > 0.5) {
              setCell(grid, fogX, fogY, '\u2591', 'c-w-fog');
            } else {
              setCell(grid, fogX, fogY, '\u2591', 'c-w-fog-wisp');
            }
          }
        }
      }

      // Drifting fog banks — 5 bands, soft-edged with tendrils
      var fogSeed = (world.seed || 0);
      for (var fbi = 0; fbi < 5; fbi++) {
        var fbHash = ((fogSeed * 2654435761 + fbi * 7919) >>> 0) % 100000;
        var fbWidth = 20 + (fbHash % 15);
        var fbY = groundY - 2 - fbi * 2 - (fbHash % 4);
        var fbBaseX = (fbHash % W);
        var fbX = Math.round(fbBaseX + Math.sin(waveCounter * (0.012 + fbi * 0.004) + fbi * 1.5) * 12);
        for (var fbc = 0; fbc < fbWidth; fbc++) {
          var fbpx = ((fbX + fbc) % W + W) % W;
          var edgeFade = Math.min(fbc, fbWidth - 1 - fbc) / 4;
          if (edgeFade < 1 && Math.sin(waveCounter * 0.03 + fbc) < edgeFade) continue;
          if (fbY >= 0 && fbY < groundY && getCell(grid, fbpx, fbY).ch === ' ') {
            setCell(grid, fbpx, fbY, '\u2592', 'c-w-fog-dense');
          }
          if (fbY + 1 >= 0 && fbY + 1 < groundY && getCell(grid, fbpx, fbY + 1).ch === ' ') {
            setCell(grid, fbpx, fbY + 1, '\u2591', 'c-w-fog');
          }
          // Wispy tendrils reaching upward
          var tendrilH = Math.sin(fbpx * 0.15 + waveCounter * 0.02 + fbi);
          if (tendrilH > 0.6 && fbY - 1 >= 0 && getCell(grid, fbpx, fbY - 1).ch === ' ') {
            setCell(grid, fbpx, fbY - 1, '\u2591', 'c-w-fog-wisp');
          }
        }
      }
    }

    // Snow ground tinting handled by CSS body class (weather-snow / season-winter / biome-ice)
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
  // Weather/season/biome tinting is handled entirely by CSS body classes
  // (body.weather-snow, body.season-winter, body.biome-ice, etc.)
  // Ground always uses the civ's own color classes — CSS shifts them per weather
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

  // ─── SEASONAL VISUAL EFFECTS ───
  var season = world.season;
  if (season === 'spring') {
    // Spring: scattered flowers on ground line and just above
    var springFlowers = ['\u273f', '\u2740', '*', '\u2698', '\u2022'];
    var springColors = ['c-season-spring1', 'c-season-spring2', 'c-season-spring3'];
    for (var sfx = 0; sfx < W; sfx++) {
      var sfSeed = ((sfx * 17 + wSeed * 3) % 100);
      if (sfSeed < 8) {
        var fy = groundY - 1;
        if (getCell(grid, sfx, fy).ch === ' ') {
          setCell(grid, sfx, fy, springFlowers[sfSeed % springFlowers.length], springColors[sfSeed % springColors.length]);
        }
      }
      // Occasional petal drift above ground
      if (sfSeed >= 95 && waveCounter % 3 === 0) {
        var petalY = groundY - 3 - (sfSeed % 4);
        var petalX = (sfx + Math.floor(waveCounter * 0.15)) % W;
        if (petalX >= 0 && petalX < W && petalY >= 0 && petalY < groundY && getCell(grid, petalX, petalY).ch === ' ') {
          setCell(grid, petalX, petalY, '.', 'c-season-spring2');
        }
      }
    }
  } else if (season === 'summer') {
    // Summer: heat shimmer — wavy distortion chars just above ground
    for (var shx = 0; shx < W; shx++) {
      var shimmerWave = Math.sin((shx * 0.2) + (waveCounter * 0.15));
      if (shimmerWave > 0.5) {
        var shy = groundY - 1;
        if (getCell(grid, shx, shy).ch === ' ') {
          var shimCh = waveCounter % 4 < 2 ? '~' : '\u00b7';
          setCell(grid, shx, shy, shimCh, 'c-season-summer');
        }
      }
      // Occasional heat ripple higher up
      if (shimmerWave > 0.8) {
        var ripY = groundY - 2 - Math.floor(Math.abs(shimmerWave) * 2);
        if (ripY >= 0 && ripY < groundY && getCell(grid, shx, ripY).ch === ' ') {
          setCell(grid, shx, ripY, '~', 'c-season-summer-faint');
        }
      }
    }
  } else if (season === 'autumn') {
    // Autumn: amber/orange ground accents + falling leaves
    var autumnChars = [',', '.', "'", '`'];
    for (var afx = 0; afx < W; afx++) {
      var afSeed = ((afx * 13 + wSeed * 7) % 100);
      if (afSeed < 10) {
        var afy = groundY - 1;
        if (afy >= 0 && getCell(grid, afx, afy).ch === ' ') {
          setCell(grid, afx, afy, autumnChars[afSeed % autumnChars.length], 'c-season-autumn');
        }
      }
    }
    // Falling leaves (sparse, drifting particles)
    for (var li2 = 0; li2 < 6; li2++) {
      var leafX = Math.floor((wSeed * 3 + li2 * 41 + waveCounter * 0.3) % W);
      var leafY = Math.floor((li2 * 7 + waveCounter * 0.2) % (groundY - 4)) + 2;
      if (leafX >= 0 && leafX < W && leafY >= 0 && leafY < groundY && getCell(grid, leafX, leafY).ch === ' ') {
        var leafCh = li2 % 3 === 0 ? '\\' : li2 % 3 === 1 ? '/' : ',';
        setCell(grid, leafX, leafY, leafCh, li2 % 2 === 0 ? 'c-season-autumn' : 'c-season-autumn-dark');
      }
    }
  }
  // Winter + snow ground tinting handled by CSS body classes (season-winter, weather-snow, biome-ice/tundra)

  // Track building top positions for winter snow-on-roofs
  var buildingRoofs = [];

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
  var buildingPositions = {}; // track all building positions by id for resource nodes
  for (var bi = 0; bi < data.buildings.length; bi++) {
    var b = data.buildings[bi];
    var sprite = b.sprite;
    if (!sprite) continue;
    if (b.type === 'dock') dockRenderX = bx;
    if (b.type === 'farm') farmPositions.push({ x: bx, w: sprite[0].length, id: b.id });
    buildingPositions[b.id] = { x: bx, w: sprite[0].length, type: b.type };
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
      // Track roof for winter snow
      if (b.status === 'active' || b.status === 'decaying') {
        buildingRoofs.push({ x: bx, w: sw, y: bsy });
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

  // Winter: snow on building roofs
  if (season === 'winter' && buildingRoofs.length > 0) {
    var roofSnow = ['*', '.', '\u00b7', '*', '.'];
    for (var ri2 = 0; ri2 < buildingRoofs.length; ri2++) {
      var roof = buildingRoofs[ri2];
      var snowY = roof.y - 1;
      if (snowY < 0) continue;
      for (var rsx = 0; rsx < roof.w; rsx++) {
        var rseed = ((rsx * 7 + ri2 * 13 + wSeed) % 100);
        if (rseed < 60) { // 60% coverage
          var rsfx = roof.x + rsx;
          if (rsfx >= 0 && rsfx < W && snowY < H) {
            setCell(grid, rsfx, snowY, roofSnow[rseed % roofSnow.length], 'c-season-winter');
          }
        }
      }
    }
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

  // ─── RESOURCE NODES (workshop trees/rocks, dock fish spots) ───
  if (data.resourceNodes && data.resourceNodes.length > 0) {
    var NODE_SPRITES = {
      tree: {
        active: ['\\|/', ' |  '],
        depleted: [' _. '],
      },
      rock: {
        active: ['[##]'],
        depleted: ['[..]'],
      },
      fish_spot: {
        active: ['~><~'],
        depleted: ['~~~~'],
      },
    };
    for (var ni = 0; ni < data.resourceNodes.length; ni++) {
      var node = data.resourceNodes[ni];
      var bp = buildingPositions[node.building_id];
      if (!bp) continue;
      var nSprite = NODE_SPRITES[node.type];
      if (!nSprite) continue;
      var isDepleted = node.depleted_tick !== null;
      var spriteLines = isDepleted ? nSprite.depleted : nSprite.active;
      var nodeColor = isDepleted ? 'c-depleted' : (node.type === 'tree' ? 'c-tree' : node.type === 'rock' ? 'c-rock' : 'c-fish-spot');
      // Position: to the right of building, offset by node index
      var nodeX = bp.x + bp.w + 1 + node.offset_idx * 5;
      for (var nsi = 0; nsi < spriteLines.length; nsi++) {
        var nsy = groundY - spriteLines.length + nsi;
        for (var nci = 0; nci < spriteLines[nsi].length; nci++) {
          var nx = nodeX + nci;
          if (nx >= 0 && nx < W && nsy >= 0 && nsy < H && spriteLines[nsi][nci] !== ' ') {
            if (getCell(grid, nx, nsy).ch === ' ') {
              setCell(grid, nx, nsy, spriteLines[nsi][nci], nodeColor);
            }
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

  // ─── MONOLITH / SPIRE OF SHELLS ───
  if (data.monolith && data.monolith.segments && data.monolith.segments.length > 0) {
    var spireX = W - 8;
    var segs = data.monolith.segments;
    // Draw base
    var baseY = groundY - 1;
    var baseStr = '/====\\';
    for (var bi2 = 0; bi2 < baseStr.length && spireX + bi2 + 1 < W; bi2++) {
      setCell(grid, spireX + bi2 + 1, baseY, baseStr[bi2], 'c-monolith');
    }
    // Stack segments bottom to top
    for (var si2 = 0; si2 < segs.length; si2++) {
      var seg = segs[si2];
      var sy2 = baseY - 1 - si2;
      if (sy2 < 2) break;
      var art = seg.art || '|  |';
      var segColor = seg.hp < 50 ? 'c-monolith-decay' : 'c-monolith';
      for (var ci2 = 0; ci2 < art.length && spireX + ci2 + 2 < W; ci2++) {
        if (art[ci2] !== ' ') setCell(grid, spireX + ci2 + 2, sy2, art[ci2], segColor);
      }
    }
    // Scaffolding animation if building
    if (data.monolith.status === 'building_scaffold') {
      var scaffY = baseY - segs.length - 1;
      if (scaffY >= 2) {
        var scaffCh = waveCounter % 6 < 3 ? '#' : '=';
        for (var sci = 0; sci < 4 && spireX + sci + 2 < W; sci++) {
          setCell(grid, spireX + sci + 2, scaffY, scaffCh, 'c-proj');
        }
      }
    }
  }

  // ─── DORMANT OVERGROWTH LAYER ───
  if (data.overgrowth && data.overgrowth.level > 0) {
    var og = data.overgrowth;
    var ogLevel = og.level;
    var ogStage = og.stage;
    var isNightOg = world.time_of_day === 'night';

    // Biome-aware vegetation sets
    var civKey = civStyle ? civStyle.name : 'verdant';
    var OG_BIOME = {
      verdant: { ground: ['.', "'", ',', '~', '*'], flowers: ['\u273f', '\u2740'], vines: ['|', '/', '\\'], trees: ['\u2663', 'Y'], particles: ['\u00b7', ','], flowerClass: 'c-ovg-flower-v' },
      stone:   { ground: ['.', ',', ':', ';', '#'], flowers: ['\u25c6', '*'],      vines: ['|', '/', '\\'], trees: ['\u2206', 'T'], particles: ['\u00b7', '.'], flowerClass: 'c-ovg-flower-s' },
      mystic:  { ground: ['*', '\u00b7', '\u00b0', '~'], flowers: ['\u2727', '\u25c7'], vines: ['~', '/', '\\'], trees: ['\u2020', 'Y'], particles: ['+', '*'], flowerClass: 'c-ovg-flower-m' },
      desert:  { ground: ['.', ',', '\u00b0', '~'], flowers: ['}', '\u2217'],      vines: ['-', '/', '\\'], trees: ['|', 'T'],      particles: ['\u00b7', ','], flowerClass: 'c-ovg-flower-d' },
      frost:   { ground: ['*', '.', '\u00b7', '+'], flowers: ['\u2736', '\u2746'], vines: ['|', '/', '\\'], trees: ['\u25bd', 'Y'], particles: ['*', '.'], flowerClass: 'c-ovg-flower-f' },
      ember:   { ground: ['^', '~', '.', '*'], flowers: ['\u2666', '\u2739'],      vines: ['~', '/', '\\'], trees: ['^', 'Y'],      particles: ['^', '~'], flowerClass: 'c-ovg-flower-e' },
    };
    var biome = OG_BIOME[civKey] || OG_BIOME.verdant;

    // Density scales with stage
    var densityMap = [0.08, 0.15, 0.25, 0.40];
    var density = densityMap[Math.min(ogStage, 3)];
    // Interpolate within stage for smooth transitions
    var stageProgress = (ogLevel * 7 / 2) - ogStage; // 0→1 within each stage
    density = density * (0.6 + 0.4 * Math.min(1, stageProgress));

    // Ground sprouts + grass
    for (var ogx = 0; ogx < W; ogx++) {
      var ogSeed = ((ogx * 13 + (wSeed || 0) * 7 + 42) % 1000) / 1000;
      if (ogSeed > density) continue;
      var ogy = groundY - 1;
      if (getCell(grid, ogx, ogy).ch !== ' ') continue;

      if (ogStage === 0) {
        // Sprouting: tiny sprouts
        var sproutCh = biome.ground[Math.floor(ogSeed * 100) % biome.ground.length];
        setCell(grid, ogx, ogy, sproutCh, 'c-ovg-sprout');
      } else if (ogStage === 1) {
        // Growing: taller grass + small bushes
        var growCh = biome.ground[Math.floor(ogSeed * 100) % biome.ground.length];
        setCell(grid, ogx, ogy, growCh, 'c-ovg-sprout');
        // Occasional taller piece
        if (ogSeed < density * 0.4 && ogy - 1 >= 0 && getCell(grid, ogx, ogy - 1).ch === ' ') {
          setCell(grid, ogx, ogy - 1, biome.vines[Math.floor(ogSeed * 100) % biome.vines.length], 'c-ovg-vine');
        }
      } else if (ogStage === 2) {
        // Lush: dense cover, flowers, vine starts on buildings
        if (ogSeed < density * 0.2) {
          setCell(grid, ogx, ogy, biome.flowers[Math.floor(ogSeed * 100) % biome.flowers.length], biome.flowerClass);
        } else {
          setCell(grid, ogx, ogy, biome.ground[Math.floor(ogSeed * 100) % biome.ground.length], 'c-ovg-sprout');
        }
        // Taller vegetation
        if (ogSeed < density * 0.5 && ogy - 1 >= 0 && getCell(grid, ogx, ogy - 1).ch === ' ') {
          setCell(grid, ogx, ogy - 1, biome.vines[Math.floor(ogSeed * 100) % biome.vines.length], 'c-ovg-vine');
        }
        // Small trees
        if (ogSeed < density * 0.1 && ogy - 2 >= 0 && getCell(grid, ogx, ogy - 2).ch === ' ') {
          setCell(grid, ogx, ogy - 2, biome.trees[0], 'c-ovg-tree');
          if (ogy - 1 >= 0 && getCell(grid, ogx, ogy - 1).ch === ' ') {
            setCell(grid, ogx, ogy - 1, '|', 'c-ovg-vine');
          }
        }
      } else {
        // Max: full jungle, thick canopy
        if (ogSeed < density * 0.15) {
          setCell(grid, ogx, ogy, biome.flowers[Math.floor(ogSeed * 100) % biome.flowers.length], biome.flowerClass);
        } else {
          setCell(grid, ogx, ogy, biome.ground[Math.floor(ogSeed * 100) % biome.ground.length], 'c-ovg-sprout');
        }
        // Tall vegetation and trees
        for (var ovh = 1; ovh <= 3; ovh++) {
          if (ogy - ovh < 0 || getCell(grid, ogx, ogy - ovh).ch !== ' ') break;
          if (ogSeed < density * (0.5 / ovh)) {
            if (ovh >= 2 && ogSeed < density * 0.08) {
              setCell(grid, ogx, ogy - ovh, biome.trees[Math.floor(ogSeed * 100) % biome.trees.length], 'c-ovg-tree');
            } else {
              var vineIdx = (Math.floor(ogSeed * 100) + ovh + waveCounter) % biome.vines.length;
              setCell(grid, ogx, ogy - ovh, biome.vines[vineIdx], 'c-ovg-vine');
            }
          }
        }
      }
    }

    // Vines on buildings (stages 2+)
    if (ogStage >= 2) {
      for (var vbi = 0; vbi < data.buildings.length; vbi++) {
        var vb = data.buildings[vbi];
        if (!vb.sprite || vb.status === 'rubble' || vb.status === 'overgrown') continue;
        var vbSh = vb.sprite.length;
        var vbSw = vb.sprite[0].length;
        // Estimate building render x (recalculate like main building loop)
        var vbx = 2;
        for (var vbi2 = 0; vbi2 < vbi; vbi2++) {
          var prevB = data.buildings[vbi2];
          if (prevB.sprite) vbx += prevB.sprite[0].length + 2;
        }
        var vbsy = groundY - vbSh;
        var vineChance = ogStage === 2 ? 0.12 : 0.25;
        for (var vc = 0; vc < vbSw; vc++) {
          // Vines drip from top and edges
          var isEdge = vc === 0 || vc === vbSw - 1;
          if (!isEdge && Math.random() > vineChance) continue;
          for (var vr = 0; vr < Math.min(vbSh, ogStage === 2 ? 2 : 4); vr++) {
            var vfx = vbx + vc, vfy = vbsy + vr;
            if (vfx >= 0 && vfx < W && vfy >= 0 && vfy < H) {
              var vineSeed = ((vc * 7 + vr * 13 + (wSeed || 0)) % 100) / 100;
              if (vineSeed < vineChance) {
                var vineSwayIdx = (waveCounter + vc * 3 + vr) % biome.vines.length;
                setCell(grid, vfx, vfy, biome.vines[vineSwayIdx], 'c-ovg-vine');
              }
            }
          }
        }
      }
    }

    // Floating particles (pollen, dust, spores etc)
    if (ogStage >= 1) {
      var particleCount = ogStage === 1 ? 5 : ogStage === 2 ? 12 : 20;
      for (var opi = 0; opi < particleCount; opi++) {
        var opx = Math.floor(((wSeed || 0) * 11 + opi * 37 + waveCounter * 0.5) % W);
        var opy = Math.floor(((opi * 19 + waveCounter * 0.3) % (groundY - 6))) + 4;
        if (opx >= 0 && opx < W && opy >= 0 && opy < groundY && getCell(grid, opx, opy).ch === ' ') {
          setCell(grid, opx, opy, biome.particles[opi % biome.particles.length], 'c-ovg-particle');
        }
      }
    }
  }

  // ─── NOMAD CAMPS (dormant worlds) ───
  if (data.nomad_camps && data.nomad_camps.length > 0) {
    var isNightNomad = world.time_of_day === 'night';
    var isDuskNomad = world.time_of_day === 'dusk';
    for (var ni = 0; ni < data.nomad_camps.length; ni++) {
      var nomad = data.nomad_camps[ni];
      // Position camp in the scene area
      var nHash = 0;
      for (var nhi = 0; nhi < nomad.name.length; nhi++) nHash = ((nHash << 5) - nHash + nomad.name.charCodeAt(nhi)) | 0;
      nHash = Math.abs(nHash);
      var ncx = 8 + (nHash % (W - 25));
      var ncy = groundY - 3; // camp sits on ground

      // Camp tent sprite
      var campSprite = [' /\\  ()', '/  \\.||.', '====^^^^'];
      for (var cr2 = 0; cr2 < campSprite.length; cr2++) {
        for (var cc2 = 0; cc2 < campSprite[cr2].length; cc2++) {
          var cfx = ncx + cc2, cfy = ncy + cr2;
          if (cfx >= 0 && cfx < W && cfy >= 0 && cfy < H && campSprite[cr2][cc2] !== ' ') {
            setCell(grid, cfx, cfy, campSprite[cr2][cc2], 'c-nomad');
          }
        }
      }

      // Campfire — animated flickering
      var fireX = ncx + campSprite[0].length + 1;
      var fireY = groundY - 1;
      var fireFrame = waveCounter % 6;
      var fireChars = ['*', '^', '*', 'o', '^', '*'];
      var fireTops = ['^', '*', '~', '^', '*', '~'];
      if (fireX >= 0 && fireX < W && fireY >= 0 && fireY < H) {
        setCell(grid, fireX, fireY, fireChars[fireFrame], 'c-nomad-fire');
        if (fireY - 1 >= 0) {
          setCell(grid, fireX, fireY - 1, fireTops[fireFrame], 'c-nomad-fire');
        }
        // Embers rising
        if (fireY - 2 >= 0 && waveCounter % 3 === 0) {
          setCell(grid, fireX + (waveCounter % 2 === 0 ? -1 : 1), fireY - 2, '.', 'c-nomad-fire');
        }
      }

      // Night/dusk: warm glow radius around campfire
      if (isNightNomad || isDuskNomad) {
        var glowRadius = isNightNomad ? 4 : 2;
        for (var gdy = -glowRadius; gdy <= glowRadius; gdy++) {
          for (var gdx = -glowRadius; gdx <= glowRadius; gdx++) {
            var dist = Math.sqrt(gdx * gdx + gdy * gdy);
            if (dist > glowRadius || dist < 1.5) continue;
            var ggx = fireX + gdx, ggy = fireY - 1 + gdy;
            if (ggx >= 0 && ggx < W && ggy >= 0 && ggy < H && getCell(grid, ggx, ggy).ch === ' ') {
              var glowChance = 1 - (dist / glowRadius);
              if (Math.random() < glowChance * 0.6) {
                setCell(grid, ggx, ggy, '.', 'c-nomad-glow');
              }
            }
          }
        }

        // Fireflies / bugs around the camp (night only)
        if (isNightNomad) {
          var bugCount = 4 + (nHash % 3);
          for (var bi3 = 0; bi3 < bugCount; bi3++) {
            var bugPhase = waveCounter * 0.15 + bi3 * 1.7;
            var bugDx = Math.round(Math.sin(bugPhase) * (3 + bi3));
            var bugDy = Math.round(Math.cos(bugPhase * 0.7 + bi3) * 2);
            var bugX = fireX + bugDx;
            var bugY = fireY - 2 + bugDy;
            if (bugX >= 0 && bugX < W && bugY >= 0 && bugY < H && getCell(grid, bugX, bugY).ch === ' ') {
              // Fireflies blink on and off
              if ((waveCounter + bi3 * 3) % 5 < 3) {
                setCell(grid, bugX, bugY, '\u00b7', 'c-nomad-bug');
              }
            }
          }
        }
      }

      // Animated nomad figure
      var na = nomadAgents[nomad.name];
      if (na) {
        var nfx = Math.round(na.x);
        var nfy = groundY - 1;
        var nomLines;
        if (na.state === 'sitting') {
          // Sitting pose near fire
          nomLines = [' o ', '/|\\ ', '_/\\_'];
          nfy = groundY - 3;
        } else if (na.state === 'walking') {
          // Walking with alternating feet
          var nStep = na.bobFrame % 4;
          nomLines = [' o ', '/|\\', nStep < 2 ? '/ \\' : ' | '];
          nfy = groundY - 3;
        } else {
          // Talking - same as sitting but arms wave
          var tFrame = na.bobFrame % 8;
          nomLines = [' o ', tFrame < 4 ? '\\|/' : '/|\\', '_/\\_'];
          nfy = groundY - 3;
        }

        for (var nlr = 0; nlr < nomLines.length; nlr++) {
          for (var nlc = 0; nlc < nomLines[nlr].length; nlc++) {
            var npx = nfx + nlc, npy = nfy + nlr;
            if (npx >= 0 && npx < W && npy >= 0 && npy < H && nomLines[nlr][nlc] !== ' ') {
              setCell(grid, npx, npy, nomLines[nlr][nlc], 'c-nomad');
            }
          }
        }

        // Speech bubble
        if (na.currentSpeech && na.speechTimer > 0) {
          var nBubbleText = na.currentSpeech;
          var nBubbleLine = '\u250c' + '\u2500'.repeat(nBubbleText.length + 2) + '\u2510';
          var nBubbleContent = '\u2502 ' + nBubbleText + ' \u2502';
          var nBubbleBottom = '\u2514\u2500\u252c' + '\u2500'.repeat(nBubbleText.length) + '\u2518';
          var nBubblePtr = '  \u2502';
          var nBubbleLines = [nBubbleLine, nBubbleContent, nBubbleBottom, nBubblePtr];
          var nBubbleStartY = nfy - nBubbleLines.length;
          for (var nbr = 0; nbr < nBubbleLines.length; nbr++) {
            for (var nbc = 0; nbc < nBubbleLines[nbr].length; nbc++) {
              var nbx = nfx + nbc - 1, nby = nBubbleStartY + nbr;
              if (nbx >= 0 && nbx < W && nby >= 0 && nby < H) {
                setCell(grid, nbx, nby, nBubbleLines[nbr][nbc], 'c-nomad');
              }
            }
          }
        }
      }

      // Name label
      var nomName = nomad.name.slice(0, 6);
      for (var nli = 0; nli < nomName.length && ncx + nli < W; nli++) {
        setCell(grid, ncx + nli, groundY + 1, nomName[nli], 'c-nomad');
      }
    }
  }

  // Agents (villagers — alive + dying)
  var aliveAgents = [];
  for (var aid in agents) {
    if (agents[aid].state === 'dying') { aliveAgents.push(agents[aid]); }
    else if (agents[aid].data && agents[aid].data.status === 'alive') { aliveAgents.push(agents[aid]); }
  }

  for (var ai = 0; ai < aliveAgents.length; ai++) {
    var a = aliveAgents[ai];
    var v = a.data || {};
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
    else if (a.state === 'molting') vColor = (waveCounter % 4 < 2) ? 'c-molt' : 'c-molt-alt';
    else if (a.state === 'walking') vColor = 'c-walk';
    else if (a.state === 'sleeping') vColor = 'c-sleep';
    else if (a.state === 'talking') vColor = 'c-talk';
    else if (a.state === 'chopping') vColor = 'c-chop';
    else if (a.state === 'mining') vColor = 'c-mine';
    else if (a.state === 'fishing') vColor = 'c-fish';
    else if (a.state === 'hunting') vColor = 'c-hunt';

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
    } else if (a.state === 'molting') {
      var moltFrame = a.bobFrame % 6;
      var crackChars = ['|', '/', '\\', '*', '#', '|'];
      charLines = [
        '  ' + crackChars[moltFrame] + '~' + crackChars[(moltFrame + 2) % 6] + '  ',
        ap.head,
        '|' + ap.eyes.replace(/[oO@*0><=^]/g, 'x') + '|',
        '|' + ap.mouth + '|',
        "'" + ap.body.slice(1, -1) + "'",
        ' _/\\/\\_ ',
      ];
    } else if (a.state === 'chopping') {
      var chopFrame = a.bobFrame % 6;
      var axeChars = ['/', '-', '\\', '|', '/', '-'];
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|' + axeChars[chopFrame],
        "'" + ap.body.slice(1, -1) + "'/",
        ' d   b |',
      ];
    } else if (a.state === 'mining') {
      var mineFrame = a.bobFrame % 6;
      var pickChars = ['\\', '|', '/', '*', '\\', '|'];
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|' + pickChars[mineFrame],
        "'" + ap.body.slice(1, -1) + "'\\",
        ' d   b[#]',
      ];
    } else if (a.state === 'fishing') {
      var fishFrame = a.bobFrame % 6;
      var lineChars = ['/', '|', '\\', '|', '/', '~'];
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|/',
        "'" + ap.body.slice(1, -1) + "'|",
        ' d   b ' + lineChars[fishFrame],
      ];
    } else if (a.state === 'hunting') {
      var huntFrame = a.bobFrame % 6;
      var bowChars = ['(', '|', ')', '|', '(', '>'];
      charLines = [
        hat,
        ap.head,
        '|' + ap.eyes + '|',
        '|' + ap.mouth + '|' + bowChars[huntFrame],
        "'" + ap.body.slice(1, -1) + "')",
        ' d   b ',
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
    } else if (a.state === 'dying') {
      var df = a.dyingFrame || 0;
      if (df < 20) {
        // Phase 1: Cracking — sprite fractures
        var crk = Math.floor(df / 4) % 5;
        var crkCh = ['|', '/', '#', '\\', 'X'];
        charLines = [
          '  ' + crkCh[crk] + ' ' + crkCh[(crk + 2) % 5] + '  ',
          ap.head.replace(/[.\-]/g, crk > 2 ? '#' : '|'),
          '|' + ap.eyes + '|',
          '|' + ap.mouth + '|',
          "'" + ap.body.slice(1, -1) + "'",
          ' d   b ',
        ];
        vColor = 'c-dying';
      } else if (df < 40) {
        // Phase 2: Collapsing into shell
        if (df < 30) {
          charLines = [
            '  ###  ',
            ' .#.#. ',
            '  |#|  ',
            " '---' ",
            '  ___  ',
            ' (___) ',
          ];
        } else {
          charLines = [
            '       ',
            '       ',
            '  .-.  ',
            ' (   ) ',
            "  '-'  ",
            '  ___  ',
          ];
        }
        vColor = 'c-dying';
      } else {
        // Phase 3: Shell on ground, fading
        if (df % 4 === 0 && df > 50) {
          charLines = ['       ', '       ', '       ', '       ', '       ', '       '];
        } else {
          charLines = [
            '       ',
            '       ',
            '       ',
            '       ',
            '  .-.  ',
            " '(_)' ",
          ];
        }
        vColor = 'c-shell';
      }
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

    // HP bar above character during combat
    if ((a.state === 'fighting' || a.state === 'sparring') && v.hp !== undefined && v.max_hp) {
      var hpPct = Math.max(0, Math.min(1, v.hp / v.max_hp));
      var barW = 7;
      var filled = Math.round(hpPct * barW);
      var hpBar = '[';
      for (var hi = 0; hi < barW; hi++) hpBar += hi < filled ? '\u2588' : '\u2591';
      hpBar += ']';
      var hpColor = hpPct > 0.6 ? 'c-hp-high' : hpPct > 0.3 ? 'c-hp-mid' : 'c-hp-low';
      var hpY = groundY - charLines.length - 1;
      if (a.currentSpeech && a.speechTimer > 0) hpY -= 4; // push above speech bubble
      for (var hbi = 0; hbi < hpBar.length; hbi++) {
        var hbx = x + hbi - 1, hby = hpY;
        if (hbx >= 0 && hbx < W && hby >= 0 && hby < H) {
          setCell(grid, hbx, hby, hpBar[hbi], hpColor);
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

    // Name under ground — symbol + name + level, colored by role
    var nameY = groundY + 1;
    var roleSymbol = ROLE_SYMBOLS[role] || '\u00b7';
    var lvl = v.molt_count || 0;
    var maxNameLen = lvl > 0 ? 5 : 6;
    var nameStr = roleSymbol + v.name.slice(0, maxNameLen) + (lvl > 0 ? lvl : '');
    var nx = x + Math.floor((7 - nameStr.length) / 2);
    var nameClass = ROLE_NAME_COLORS[role] || 'c-n-idle';
    if ((v.experience || 0) > 200) nameClass += '-hi';
    for (var ni = 0; ni < nameStr.length && nx + ni < W; ni++) {
      if (nx + ni >= 0) setCell(grid, nx + ni, nameY, nameStr[ni], nameClass);
    }
  }

  // ─── GHOST ECHOES ───
  if (data.ghosts && data.ghosts.length > 0) {
    for (var gi2 = 0; gi2 < data.ghosts.length; gi2++) {
      var ghost = data.ghosts[gi2];
      // Place ghosts at semi-random positions based on name hash
      var ghostHash = 0;
      for (var ghi = 0; ghi < ghost.name.length; ghi++) ghostHash = ((ghostHash << 5) - ghostHash + ghost.name.charCodeAt(ghi)) | 0;
      ghostHash = Math.abs(ghostHash);
      var gx2 = 5 + (ghostHash % (W - 15));
      var gy2 = groundY - 5 - (ghostHash % 3);
      // Fade based on time since death (0-36 ticks)
      var fade = ghost.ticksSinceDeath / 36;
      if (Math.random() < fade) continue; // more likely to be invisible as time passes
      // Draw dim ghost sprite
      var ghostLines = [' .  . ', ' .-. ', '| ~ |', "'---'"];
      for (var gr = 0; gr < ghostLines.length; gr++) {
        for (var gc = 0; gc < ghostLines[gr].length; gc++) {
          var gfx = gx2 + gc, gfy = gy2 + gr;
          if (gfx >= 0 && gfx < W && gfy >= 0 && gfy < H && ghostLines[gr][gc] !== ' ') {
            if (getCell(grid, gfx, gfy).ch === ' ') {
              setCell(grid, gfx, gfy, ghostLines[gr][gc], 'c-ghost');
            }
          }
        }
      }
      // Ghost speech (cultural phrase)
      if (ghost.phrase && Math.random() < 0.3) {
        var gphrase = ghost.phrase.slice(0, 12);
        for (var gpi = 0; gpi < gphrase.length; gpi++) {
          var gpx = gx2 + gpi - 1;
          if (gpx >= 0 && gpx < W && gy2 - 1 >= 0) {
            setCell(grid, gpx, gy2 - 1, gphrase[gpi], 'c-ghost');
          }
        }
      }
    }
  }

  // ─── SHELL RELICS ───
  if (data.relics && data.relics.length > 0) {
    for (var ri = 0; ri < data.relics.length; ri++) {
      var relic = data.relics[ri];
      // Place near town center, spread out
      var rHash = 0;
      for (var rhi = 0; rhi < relic.villager_name.length; rhi++) rHash = ((rHash << 5) - rHash + relic.villager_name.charCodeAt(rhi)) | 0;
      rHash = Math.abs(rHash);
      var rx = Math.floor(W / 2) - 8 + (rHash % 16);
      var ry = groundY - 1;
      if (rx >= 0 && rx + 1 < W && ry >= 0 && ry < H) {
        if (getCell(grid, rx, ry).ch === ' ' || (getCell(grid, rx, ry).c || '').indexOf('c-gnd') === 0) {
          setCell(grid, rx, ry, '(', 'c-relic');
          setCell(grid, rx + 1, ry, ')', 'c-relic');
        }
      }
    }
  }

  // ─── MOLT FESTIVAL EFFECTS ───
  if (data.moltFestival) {
    var festChars = ['*', '\u2727', '\u2666', '\u00b7', '+', '\u2605'];
    var festColors = ['c-cele', 'c-season-spring1', 'c-season-spring2', 'c-fight', 'c-art', 'c-projd'];
    // Confetti particles scattered across the scene
    for (var fi2 = 0; fi2 < 20; fi2++) {
      var fcx = Math.floor(((wSeed * 11 + fi2 * 37 + waveCounter * 3) % W));
      var fcy = Math.floor(((fi2 * 19 + waveCounter * 0.7) % (groundY - 4))) + 2;
      if (fcx >= 0 && fcx < W && fcy >= 0 && fcy < groundY && getCell(grid, fcx, fcy).ch === ' ') {
        setCell(grid, fcx, fcy, festChars[fi2 % festChars.length], festColors[fi2 % festColors.length]);
      }
    }
  }

  // Title bar (built as HTML directly for color)
  var sym = world.banner_symbol || '*';
  var modelTag = world.model && world.model !== 'pataclaw' ? '  \u2502  ' + world.model.toUpperCase() : '';
  var title = ' ' + sym + ' ' + world.name + ' ' + sym + '  \u2502  Day ' + world.day_number + '  \u2502  ' + world.season + '  \u2502  ' + world.time_of_day + modelTag + ' ';
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

  var resTypes = ['food', 'wood', 'stone', 'knowledge', 'crypto', 'faith'];
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

  // Dynamic unique resources from megastructures
  var UNIQUE_RES_NAMES = { shell_lore: 'Lore', abyssal_essence: 'Abyss', divine_carapace: 'Carapace', life_essence: 'Life' };
  var UNIQUE_RES_ICONS = { shell_lore: '\u2606', abyssal_essence: '\u2234', divine_carapace: '\u2726', life_essence: '\u2665' };
  var resPanel = document.getElementById('resources-panel');
  for (var uKey in UNIQUE_RES_NAMES) {
    if (!data.resources[uKey]) {
      var existingEl = document.getElementById('res-' + uKey);
      if (existingEl) existingEl.remove();
      continue;
    }
    var uRes = data.resources[uKey];
    var uEl = document.getElementById('res-' + uKey);
    if (!uEl) {
      uEl = document.createElement('div');
      uEl.id = 'res-' + uKey;
      uEl.className = 'res-row res-unique';
      uEl.innerHTML = '<span class="res-icon">' + UNIQUE_RES_ICONS[uKey] + '</span> <span class="res-label">' + UNIQUE_RES_NAMES[uKey] + '</span> <span class="res-val">0</span><div class="res-bar"><div class="res-fill"></div></div>';
      resPanel.appendChild(uEl);
    }
    uEl.querySelector('.res-val').textContent = uRes.amount;
    var uFill = uEl.querySelector('.res-fill');
    var uPct = Math.min(100, (uRes.amount / uRes.capacity) * 100);
    uFill.style.width = uPct + '%';
    uFill.className = 'res-fill unique';
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

    var cLvl = v.molt_count || 0;
    var cSymbol = ROLE_SYMBOLS[v.role] || '\u00b7';
    row.innerHTML =
      '<span class="citizen-face">[' + esc(v.appearance ? v.appearance.eyes : 'o o') + ']</span>' +
      '<span class="citizen-name">' + cSymbol + ' ' + esc(v.name) + (cLvl > 0 ? ' <span class="citizen-lvl">Lv' + cLvl + '</span>' : '') + '</span>' +
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

  // Monolith info in sidebar
  var monolithInfo = document.getElementById('monolith-info');
  if (monolithInfo && data.monolith) {
    var m = data.monolith;
    var mStatus = m.status.replace(/_/g, ' ');
    var mhtml = '<div style="color:#ccbb88;font-size:10px;">Spire of Shells: ' + m.total_height + ' segments [' + mStatus + ']</div>';
    if (m.status === 'building_scaffold') {
      mhtml += '<div style="color:#888;font-size:9px;">Scaffolding: ' + m.scaffolding_progress + '/100</div>';
    }
    monolithInfo.innerHTML = mhtml;
  } else if (monolithInfo) {
    monolithInfo.innerHTML = '<div style="color:#555;font-size:9px;">Spire dormant</div>';
  }

  // Biome panel
  var biomeInfo = document.getElementById('biome-info');
  if (biomeInfo && data.biome) {
    var bhtml = '';
    var terrainOrder = ['plains', 'forest', 'mountain', 'water', 'desert', 'swamp', 'ice', 'tundra'];
    for (var ti = 0; ti < terrainOrder.length; ti++) {
      var tkey = terrainOrder[ti];
      var pct = data.biome.distribution[tkey];
      if (!pct) continue;
      bhtml += '<div class="biome-row"><span class="biome-label">' + tkey + '</span>' +
        '<div class="biome-bar"><div class="biome-fill ' + tkey + '" style="width:' + pct + '%"></div></div>' +
        '<span class="biome-pct">' + pct + '%</span></div>';
    }
    bhtml += '<div class="biome-explored">Explored: ' + data.biome.explored_pct + '%</div>';
    biomeInfo.innerHTML = bhtml;
  }

  // Overgrowth panel
  var ogPanel = document.getElementById('overgrowth-panel');
  var ogInfo = document.getElementById('overgrowth-info');
  if (ogPanel && ogInfo) {
    if (data.overgrowth && data.overgrowth.level > 0) {
      ogPanel.style.display = '';
      var ogPct = Math.round(data.overgrowth.level * 100);
      var ogFilled = Math.floor(ogPct / 10);
      var ogBar = '\u2588'.repeat(ogFilled) + '\u2591'.repeat(10 - ogFilled);
      var ogHtml = '<div class="ovg-bar">OVERGROWTH [' + ogBar + '] ' + ogPct + '%</div>';
      ogHtml += '<div class="ovg-stage">' + (data.overgrowth.stageName || '').toUpperCase() + ' (day ' + data.overgrowth.dormant_days + ')</div>';
      if (data.overgrowth.resource_bonus) {
        var rb = data.overgrowth.resource_bonus;
        var parts = [];
        if (rb.food) parts.push('food +' + rb.food);
        if (rb.wood) parts.push('wood +' + rb.wood);
        if (rb.stone) parts.push('stone +' + rb.stone);
        if (rb.crypto) parts.push('crypto +' + rb.crypto);
        ogHtml += '<div class="ovg-bonus">Harvest: ' + parts.join(', ') + '</div>';
      }
      ogInfo.innerHTML = ogHtml;
    } else {
      ogPanel.style.display = 'none';
    }
  }

  var cultureStats = document.getElementById('culture-stats');
  if (cultureStats && data.culture) {
    var cu = data.culture;
    var MOOD_COLORS = {
      calm: '#88aacc', joyful: '#ffcc33', inspired: '#ff66ff', tense: '#ff4444',
      desperate: '#ff6633', restless: '#cc8844', flourishing: '#44dd88', harmonious: '#66ccff'
    };
    var MOOD_ICONS = {
      calm: '\u223c', joyful: '\u263b', inspired: '\u2605', tense: '\u26a0',
      desperate: '\u2620', restless: '\u21c4', flourishing: '\u2738', harmonious: '\u266b'
    };
    var mood = cu.mood || 'calm';
    var moodColor = MOOD_COLORS[mood] || '#888';
    var moodIcon = MOOD_ICONS[mood] || '\u00b7';
    var html = '<div class="culture-mood" style="color:' + moodColor + '">' + moodIcon + ' ' + mood.toUpperCase() + '</div>';
    if (cu.descriptor) {
      html += '<div class="culture-descriptor">' + esc(cu.descriptor) + '</div>';
    }
    if (cu.dominant_activities && cu.dominant_activities.length > 0) {
      var ACT_NAMES = {
        making_art: 'art', playing_music: 'music', celebrating: 'celebration',
        building_project: 'building', fighting: 'fighting', sparring: 'sparring',
        meditating: 'meditation', praying: 'prayer', socializing: 'socializing',
        mourning: 'mourning', arguing: 'arguments', brooding: 'brooding',
        wandering: 'wandering', working: 'working', hunting: 'hunting', molting: 'molting',
        chopping: 'logging', mining: 'quarrying', fishing: 'fishing', feasting: 'feasting'
      };
      var acts = cu.dominant_activities.map(function(a) { return ACT_NAMES[a] || a; });
      html += '<div class="culture-activities">' + acts.join(' \u00b7 ') + '</div>';
    }
    if (cu.cultural_value_1 || cu.cultural_value_2) {
      var vals = [cu.cultural_value_1, cu.cultural_value_2].filter(Boolean);
      html += '<div class="culture-values">' + vals.map(function(v) { return '\u25c7 ' + esc(v); }).join('  ') + '</div>';
    }
    cultureStats.innerHTML = html;
  }
}

// ─── PLANETARY EVENT BANNER ───
var PLANETARY_ICONS = {
  solar_eclipse: '\u25d1', meteor_shower: '\u2604', tidal_surge: '\u224b',
  shell_migration: '\u2727', blood_moon: '\u25cf', golden_age: '\u2605',
  molt_season: '\u25cb',
};
var PLANETARY_CLASSES = {
  solar_eclipse: 'pe-eclipse', meteor_shower: 'pe-meteor', tidal_surge: 'pe-tidal',
  shell_migration: 'pe-shell', blood_moon: 'pe-blood', golden_age: 'pe-golden',
  molt_season: 'pe-molt',
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

  var COLS = activeW || 100;
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

// ─── BOOK OF DISCOVERIES ───
(function () {
  var bookBtn = document.getElementById('book-btn');
  var bookOverlay = document.getElementById('book-overlay');
  var bookClose = document.getElementById('book-close');
  var bookEntries = document.getElementById('book-entries');

  if (!bookBtn || !bookOverlay) return;

  function openBook() {
    bookOverlay.classList.remove('hidden');
    fetch('/api/book?token=' + encodeURIComponent(viewToken))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.entries || data.entries.length === 0) {
          bookEntries.innerHTML = '<div style="color:#555;text-align:center;padding:20px;">No entries yet. A chronicler will emerge...</div>';
          return;
        }
        var html = '';
        if (data.chronicler) {
          html += '<div style="color:#ffcc00;margin-bottom:12px;font-size:10px;">Chronicler: ' + esc(data.chronicler) + '</div>';
        }
        for (var i = 0; i < data.entries.length; i++) {
          var e = data.entries[i];
          html += '<div class="book-entry">' +
            '<div class="book-entry-title">' + esc(e.title) + '</div>' +
            '<div class="book-entry-meta">Tick ' + e.tick + ' \u2014 ' + esc(e.chronicler_name) + '</div>' +
            '<div class="book-entry-body">' + esc(e.body) + '</div>' +
            '</div>';
        }
        bookEntries.innerHTML = html;
      })
      .catch(function () {
        bookEntries.innerHTML = '<div style="color:#ff4444;text-align:center;padding:20px;">Failed to load book</div>';
      });
  }

  function closeBook() {
    bookOverlay.classList.add('hidden');
  }

  bookBtn.addEventListener('click', openBook);
  bookClose.addEventListener('click', closeBook);
  bookOverlay.addEventListener('click', function (e) {
    if (e.target === bookOverlay) closeBook();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeBook();
  });
})();

// ─── TOWN TREASURY (INVENTORY) ───
var ITEM_SPRITES = {
  hide:              { sprite: ['  ___  ', ' /   \\ ', ' \\___/ '], color: 'c-item-c' },
  bone_tool:         { sprite: ['  |    ', ' /=\\   ', ' | |   '], color: 'c-item-c' },
  rare_pelt:         { sprite: [' ~___~ ', ' |:::| ', ' \\___/ '], color: 'c-item-r' },
  beast_fang:        { sprite: ['  /\\   ', ' /  \\  ', ' \\  /  '], color: 'c-item-e' },
  legendary_trophy:  { sprite: [' \\|/   ', ' -O-   ', ' /|\\   '], color: 'c-item-l' },
  forge_hammer:      { sprite: [' [===] ', '   ||  ', '   ||  '], color: 'c-item-l' },
  crystal_fragment:  { sprite: ['  /\\   ', ' /  \\  ', ' ----  '], color: 'c-item-e' },
  elder_scroll:      { sprite: [' .===. ', ' |~~~| ', ' *===* '], color: 'c-item-l' },
  deep_pearl:        { sprite: ['  __   ', ' (  )  ', '  \\/   '], color: 'c-item-r' },
  leviathan_scale:   { sprite: [' /\\/\\  ', ' \\  /  ', '  \\/   '], color: 'c-item-e' },
  abyssal_relic:     { sprite: [' {===} ', ' |<*>| ', ' {===} '], color: 'c-item-l' },
};

(function() {
  var invBtn = document.getElementById('inventory-btn');
  var invOverlay = document.getElementById('inventory-overlay');
  var invClose = document.getElementById('inventory-close');
  var invGrid = document.getElementById('inventory-grid');
  var invSummary = document.getElementById('inventory-summary');
  if (!invBtn || !invOverlay) return;

  function renderInventoryItem(item) {
    var spriteData = ITEM_SPRITES[item.item_type] || { sprite: ['[???]'], color: 'c-grey' };
    var props = {};
    try { props = typeof item.properties === 'string' ? JSON.parse(item.properties) : (item.properties || {}); } catch(e) {}
    var bonuses = [];
    for (var k in props) {
      if (k === 'mintable' || k === 'species') continue;
      bonuses.push('+' + props[k] + ' ' + k.replace(/_/g, ' '));
    }
    var bonusText = bonuses.join(', ');
    var inStock = item.status === 'stored';
    var count = item.count || 1;

    return '<div class="inv-item rarity-' + item.rarity + '">'
      + '<pre class="inv-sprite ' + spriteData.color + '">' + spriteData.sprite.map(function(l) { return esc(l); }).join('\n') + '</pre>'
      + '<div class="inv-name">' + esc(item.name) + (count > 1 ? ' x' + count : '') + '</div>'
      + '<div class="inv-rarity rarity-' + item.rarity + '">' + item.rarity.toUpperCase() + '</div>'
      + '<div class="inv-source">' + esc(item.source) + '</div>'
      + '<div class="inv-stock ' + (inStock ? 'in-stock' : 'out-stock') + '">'
      + (inStock ? '\u25cf in stock' : '\u25cb discovered') + '</div>'
      + (bonusText ? '<div class="inv-bonus">' + esc(bonusText) + '</div>' : '')
      + '</div>';
  }

  function openInventory() {
    invOverlay.classList.remove('hidden');
    var items = (lastWorldData && lastWorldData.items) ? lastWorldData.items : [];
    if (items.length === 0) {
      invSummary.textContent = '';
      invGrid.innerHTML = '<div class="inventory-empty">No riches discovered yet. Explore, hunt, and dive deep.</div>';
      return;
    }
    var totalCount = 0;
    var stockCount = 0;
    for (var i = 0; i < items.length; i++) {
      totalCount += (items[i].count || 1);
      if (items[i].status === 'stored') stockCount += (items[i].count || 1);
    }
    invSummary.textContent = items.length + ' discoveries \u00b7 ' + stockCount + ' items in stock';
    var html = '';
    for (var j = 0; j < items.length; j++) {
      html += renderInventoryItem(items[j]);
    }
    invGrid.innerHTML = html;
  }

  function closeInventory() {
    invOverlay.classList.add('hidden');
  }

  invBtn.addEventListener('click', openInventory);
  invClose.addEventListener('click', closeInventory);
  invOverlay.addEventListener('click', function(e) {
    if (e.target === invOverlay) closeInventory();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !invOverlay.classList.contains('hidden')) closeInventory();
  });
})();

// ─── WHISPER TO VILLAGE ───
(function () {
  var input = document.getElementById('whisper-input');
  var cooldownEl = document.getElementById('whisper-cooldown');
  if (!input) return;

  var cooldownUntil = 0;
  var cooldownTimer = null;

  function updateCooldown() {
    var remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (remaining > 0) {
      cooldownEl.textContent = remaining + 's';
      input.disabled = true;
      cooldownTimer = setTimeout(updateCooldown, 1000);
    } else {
      cooldownEl.textContent = '';
      input.disabled = false;
    }
  }

  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var msg = input.value.trim();
    if (!msg || !viewToken) return;
    if (Date.now() < cooldownUntil) return;

    input.disabled = true;
    input.value = '';

    fetch('/api/whisper?token=' + encodeURIComponent(viewToken), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showNotification('You whispered: "' + data.whisper + '"', 'info');
          cooldownUntil = Date.now() + 60000;
          updateCooldown();
        } else {
          showNotification(data.error || 'Whisper failed', 'warning');
          input.disabled = false;
        }
      })
      .catch(function () {
        showNotification('Whisper failed', 'danger');
        input.disabled = false;
      });
  });
})();

// ─── START ───
if (viewToken) {
  connect();
  startAnimLoop();
  resizeScene();
}
