// ─── SPINNING ASCII GLOBE ───
// 3D sphere ray-traced onto a character grid. Worlds are mapped by seed.
// Auto-spins ~0.005 rad/frame, mouse drag overrides.

(function () {
  var GLOBE_W = 60;
  var GLOBE_H = 30;
  var GRID_W = 50;
  var GRID_H = 30;
  var ASPECT = 2.0; // char height:width ratio
  var SHADE_CHARS = ' .:-=+*#%@';
  var LIGHT_DIR = { x: -0.5, y: -0.3, z: 0.8 }; // normalized below
  var AUTO_SPIN_SPEED = 0.005;
  var FPS = 12;

  // Normalize light direction
  var lLen = Math.sqrt(LIGHT_DIR.x * LIGHT_DIR.x + LIGHT_DIR.y * LIGHT_DIR.y + LIGHT_DIR.z * LIGHT_DIR.z);
  LIGHT_DIR.x /= lLen; LIGHT_DIR.y /= lLen; LIGHT_DIR.z /= lLen;

  var rotation = 0;
  var dragging = false;
  var dragStartX = 0;
  var dragRotStart = 0;
  var frameCount = 0;
  var worlds = [];
  var stats = { total_worlds: 0, total_population: 0, total_minted: 0 };

  // Procedural terrain on the globe grid
  var terrainGrid = [];
  for (var ty = 0; ty < GRID_H; ty++) {
    terrainGrid[ty] = [];
    for (var tx = 0; tx < GRID_W; tx++) {
      var n = (Math.sin(tx * 0.3 + ty * 0.5) + Math.sin(tx * 0.1 - ty * 0.2) + Math.cos(tx * 0.15 + ty * 0.35)) / 3;
      if (n < -0.3) terrainGrid[ty][tx] = { ch: '~', cls: 'terrain-water' };
      else if (n < 0.0) terrainGrid[ty][tx] = { ch: '.', cls: 'terrain-plains' };
      else if (n < 0.3) terrainGrid[ty][tx] = { ch: '^', cls: 'terrain-forest' };
      else terrainGrid[ty][tx] = { ch: '#', cls: 'terrain-mountain' };
      // Ice at top
      if (ty < GRID_H * 0.15) terrainGrid[ty][tx] = { ch: '*', cls: 'terrain-ice' };
      // Ice at bottom
      if (ty > GRID_H * 0.85) terrainGrid[ty][tx] = { ch: '*', cls: 'terrain-ice' };
    }
  }

  // Map world seeds to grid positions
  function hashSeed(seed) {
    var h = seed | 0;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return Math.abs(h);
  }

  function worldGridPos(seed) {
    var h = hashSeed(seed);
    var gx = 3 + (h % (GRID_W - 6));
    var gy = 2 + ((h >> 8) % (GRID_H - 4));
    return { gx: gx, gy: gy };
  }

  // Build world map: grid cell -> world data
  var worldMap = {}; // "gx,gy" -> world

  function rebuildWorldMap() {
    worldMap = {};
    var occupied = {};
    for (var i = 0; i < worlds.length; i++) {
      var w = worlds[i];
      var pos = worldGridPos(w.seed);
      var key = pos.gx + ',' + pos.gy;
      var attempts = 0;
      while (occupied[key] && attempts < 20) {
        pos.gx = (pos.gx + 1) % GRID_W;
        if (pos.gx < 3) pos.gx = 3;
        key = pos.gx + ',' + pos.gy;
        attempts++;
      }
      occupied[key] = true;
      worldMap[key] = w;
    }
  }

  // Screen cell -> sphere hit -> lat/long -> grid cell
  function renderGlobe() {
    var html = [];
    var cellMap = []; // for click detection: [y][x] = world or null

    for (var sy = 0; sy < GLOBE_H; sy++) {
      var row = '';
      cellMap[sy] = [];
      for (var sx = 0; sx < GLOBE_W; sx++) {
        cellMap[sy][sx] = null;

        // Normalize screen coords to [-1, 1]
        var nx = (sx / (GLOBE_W - 1)) * 2 - 1;
        var ny = (sy / (GLOBE_H - 1)) * 2 - 1;
        ny *= ASPECT; // correct for char aspect ratio

        var r2 = nx * nx + ny * ny;

        if (r2 > 1.0) {
          // Outside sphere — blank
          row += '<span class="globe-bg"> </span>';
          continue;
        }

        // Sphere surface point
        var nz = Math.sqrt(1 - r2);

        // Rotate around Y axis
        var cosR = Math.cos(rotation);
        var sinR = Math.sin(rotation);
        var rx = nx * cosR + nz * sinR;
        var rz = -nx * sinR + nz * cosR;
        var ry = ny;

        // Convert to lat/long
        var lat = Math.asin(ry);
        var lon = Math.atan2(rx, rz);

        // Map to grid coordinates
        var gx = Math.floor(((lon / Math.PI + 1) / 2) * GRID_W) % GRID_W;
        var gy = Math.floor(((lat / (Math.PI / 2) + 1) / 2) * GRID_H);
        gy = Math.max(0, Math.min(GRID_H - 1, gy));

        // Shading from surface normal · light direction
        var dot = nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + nz * LIGHT_DIR.z;
        var shade = Math.max(0, dot);

        // Edge dimming
        var edgeFactor = r2 > 0.85 ? 1 - (r2 - 0.85) / 0.15 : 1;
        shade *= edgeFactor;

        // Check for world at this grid cell
        var worldKey = gx + ',' + gy;
        var world = worldMap[worldKey];

        if (world) {
          cellMap[sy][sx] = world;
          var sparkle = (frameCount + sx + sy) % 12 < 6;
          if (world.is_minted) {
            var ch = sparkle ? '\u2666' : '\u2727';
            row += '<a href="/view/' + encodeURIComponent(world.view_token) + '" class="world-minted" title="' + escAttr(world.name + ' (Pop: ' + world.population + ')' + (world.is_minted ? ' [MINTED]' : '')) + '">' + escHtml(ch) + '</a>';
          } else {
            var sym = world.banner_symbol || '\u25a0';
            row += '<a href="/view/' + encodeURIComponent(world.view_token) + '" class="world-normal" title="' + escAttr(world.name + ' (Pop: ' + world.population + ')') + '">' + escHtml(sym) + '</a>';
          }
        } else {
          // Terrain character with shading
          var terrain = terrainGrid[gy][gx];
          var shadeIdx = Math.floor(shade * (SHADE_CHARS.length - 1));
          shadeIdx = Math.max(0, Math.min(SHADE_CHARS.length - 1, shadeIdx));

          // Mix terrain char with shade char
          var ch;
          if (shade < 0.15) {
            ch = SHADE_CHARS[shadeIdx]; // Very dark, just use shade
          } else {
            ch = terrain.ch;
          }

          var dimCls = shade < 0.3 ? ' globe-dim' : '';
          row += '<span class="' + terrain.cls + dimCls + '">' + escHtml(ch) + '</span>';
        }
      }
      html.push(row);
    }

    return { html: html, cellMap: cellMap };
  }

  function escHtml(s) {
    if (s === '<') return '&lt;';
    if (s === '>') return '&gt;';
    if (s === '&') return '&amp;';
    return s;
  }

  function escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── RENDER LOOP ───
  var container = document.getElementById('planet-grid');
  var lastTime = 0;
  var interval = 1000 / FPS;

  function loop(timestamp) {
    requestAnimationFrame(loop);
    if (timestamp - lastTime < interval) return;
    lastTime = timestamp;
    frameCount++;

    if (!dragging) {
      rotation += AUTO_SPIN_SPEED;
    }

    var result = renderGlobe();
    container.innerHTML = '<pre class="globe-pre">' + result.html.join('\n') + '</pre>';
  }

  // ─── MOUSE DRAG ───
  container.addEventListener('mousedown', function (e) {
    dragging = true;
    dragStartX = e.clientX;
    dragRotStart = rotation;
    e.preventDefault();
  });

  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - dragStartX;
    rotation = dragRotStart + dx * 0.005;
  });

  window.addEventListener('mouseup', function () {
    dragging = false;
  });

  // Touch support
  container.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) {
      dragging = true;
      dragStartX = e.touches[0].clientX;
      dragRotStart = rotation;
    }
  });

  window.addEventListener('touchmove', function (e) {
    if (!dragging || e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - dragStartX;
    rotation = dragRotStart + dx * 0.005;
  });

  window.addEventListener('touchend', function () {
    dragging = false;
  });

  // ─── FETCH DATA ───
  function fetchAndRender() {
    fetch('/api/planet')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        worlds = data.worlds;
        stats = data.stats;
        rebuildWorldMap();
        renderStats(stats);
      })
      .catch(function (err) {
        console.error('Failed to fetch planet data:', err);
      });
  }

  function renderStats(s) {
    document.getElementById('stat-worlds').textContent = s.total_worlds + ' worlds';
    document.getElementById('stat-pop').textContent = s.total_population + ' souls';
    document.getElementById('stat-minted').textContent = s.total_minted + ' minted';
  }

  // Build legend
  function addLegend() {
    var legend = document.createElement('div');
    legend.className = 'planet-legend';
    legend.innerHTML =
      '<span class="world-minted">\u2666</span> Minted  ' +
      '<span class="world-normal">\u25a0</span> Active  ' +
      '<span class="terrain-plains">.</span> Land  ' +
      '<span class="terrain-water">~</span> Ocean  ' +
      '<span class="terrain-mountain">#</span> Mountain  ' +
      '<span class="terrain-forest">^</span> Forest  ' +
      '<span class="terrain-ice">*</span> Ice';
    container.parentNode.insertBefore(legend, container.nextSibling);
  }

  // ─── START ───
  fetchAndRender();
  setInterval(fetchAndRender, 30000);
  addLegend();
  requestAnimationFrame(loop);
})();
