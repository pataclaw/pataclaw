// ─── SPINNING ASCII GLOBE ───
// 3D sphere ray-traced onto a character grid. Multi-octave noise terrain.
// Auto-spins, mouse/touch drag to rotate.

(function () {
  var GLOBE_W = 100;
  var GLOBE_H = 50;
  var GRID_W = 80;
  var GRID_H = 40;
  var SHADE_CHARS = ' .,:;=+*#%@';
  var LIGHT_DIR = { x: -0.6, y: -0.4, z: 0.7 };
  var AUTO_SPIN_SPEED = 0.004;
  var FPS = 14;

  // Normalize light
  var lLen = Math.sqrt(LIGHT_DIR.x * LIGHT_DIR.x + LIGHT_DIR.y * LIGHT_DIR.y + LIGHT_DIR.z * LIGHT_DIR.z);
  LIGHT_DIR.x /= lLen; LIGHT_DIR.y /= lLen; LIGHT_DIR.z /= lLen;

  var rotation = 0;
  var tilt = 0.15; // slight axial tilt for visual interest
  var dragging = false;
  var dragStartX = 0;
  var dragStartY = 0;
  var dragRotStart = 0;
  var dragTiltStart = 0;
  var frameCount = 0;
  var worlds = [];
  var stats = { total_worlds: 0, total_population: 0, total_minted: 0 };

  // ─── STARFIELD ───
  var STAR_DENSITY = 0.035; // ~3.5% of void pixels
  var STAR_CHARS = ['.', '\u00b7', '+', '*'];
  var STAR_CLASSES = ['star-dim', 'star-dim', 'star-med', 'star-bright'];

  // Deterministic star placement — seeded by screen position
  function starAt(sx, sy) {
    var h = hash2d(sx * 0.73 + 5.1, sy * 1.37 + 8.3);
    if (h > STAR_DENSITY) return null;
    var idx = Math.floor(h / STAR_DENSITY * 3.99);
    // Twinkling: phase based on position, modulated by frameCount
    var twinklePhase = hash2d(sx * 3.1, sy * 7.7);
    var twinkleSpeed = 0.02 + twinklePhase * 0.04; // different speeds per star
    var brightness = Math.sin(frameCount * twinkleSpeed + twinklePhase * 100);
    if (brightness < -0.3) return null; // star dims out periodically
    var boosted = brightness > 0.7 ? Math.min(3, idx + 1) : idx;
    return { ch: STAR_CHARS[boosted], cls: STAR_CLASSES[boosted] };
  }

  // ─── METEORS ───
  var meteors = [];
  var METEOR_SPAWN_RATE = 0.008; // chance per frame of spawning
  var METEOR_MAX = 3;
  var METEOR_TRAIL = ['*', '-', '.', '\u00b7'];
  var METEOR_CLASSES = ['meteor-head', 'meteor-trail1', 'meteor-trail2', 'meteor-trail3'];

  function spawnMeteor() {
    // Random entry from top or sides
    var side = Math.random();
    var sx, sy, dx, dy;
    if (side < 0.6) {
      // From top
      sx = Math.floor(Math.random() * GLOBE_W);
      sy = 0;
      dx = (Math.random() - 0.5) * 1.5;
      dy = 1.2 + Math.random() * 0.8;
    } else if (side < 0.8) {
      // From left
      sx = 0;
      sy = Math.floor(Math.random() * GLOBE_H * 0.5);
      dx = 1.5 + Math.random() * 0.5;
      dy = 0.5 + Math.random() * 0.8;
    } else {
      // From right
      sx = GLOBE_W - 1;
      sy = Math.floor(Math.random() * GLOBE_H * 0.5);
      dx = -(1.5 + Math.random() * 0.5);
      dy = 0.5 + Math.random() * 0.8;
    }
    return { x: sx, y: sy, dx: dx, dy: dy, life: 12 + Math.floor(Math.random() * 10), age: 0 };
  }

  function updateMeteors() {
    // Spawn
    if (meteors.length < METEOR_MAX && Math.random() < METEOR_SPAWN_RATE) {
      meteors.push(spawnMeteor());
    }
    // Advance
    for (var i = meteors.length - 1; i >= 0; i--) {
      var m = meteors[i];
      m.x += m.dx;
      m.y += m.dy;
      m.age++;
      if (m.age > m.life || m.x < -5 || m.x > GLOBE_W + 5 || m.y < -5 || m.y > GLOBE_H + 5) {
        meteors.splice(i, 1);
      }
    }
  }

  // Build sparse lookup of meteor pixels for current frame
  function buildMeteorMap() {
    var map = {};
    for (var i = 0; i < meteors.length; i++) {
      var m = meteors[i];
      for (var t = 0; t < METEOR_TRAIL.length; t++) {
        var px = Math.round(m.x - m.dx * t * 0.5);
        var py = Math.round(m.y - m.dy * t * 0.5);
        if (px >= 0 && px < GLOBE_W && py >= 0 && py < GLOBE_H) {
          var key = px + ',' + py;
          if (!map[key]) {
            map[key] = { ch: METEOR_TRAIL[t], cls: METEOR_CLASSES[t] };
          }
        }
      }
    }
    return map;
  }

  // ─── SIMPLEX-LIKE NOISE (hash-based, no dependencies) ───
  function hash2d(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function smoothNoise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    // Smoothstep
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    var a = hash2d(ix, iy);
    var b = hash2d(ix + 1, iy);
    var c = hash2d(ix, iy + 1);
    var d = hash2d(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  function fbmNoise(x, y, octaves) {
    var val = 0, amp = 0.5, freq = 1.0, total = 0;
    for (var i = 0; i < octaves; i++) {
      val += smoothNoise(x * freq, y * freq) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return val / total;
  }

  // ─── TERRAIN GRID (multi-octave noise → continents) ───
  var terrainGrid = [];
  for (var ty = 0; ty < GRID_H; ty++) {
    terrainGrid[ty] = [];
    var latFactor = Math.abs(ty / GRID_H - 0.5) * 2; // 0 at equator, 1 at poles
    for (var tx = 0; tx < GRID_W; tx++) {
      // Wrap-friendly noise (use torus mapping for seamless longitude)
      var angle = (tx / GRID_W) * Math.PI * 2;
      var nx = Math.cos(angle) * 2.5;
      var nz = Math.sin(angle) * 2.5;
      var ny = (ty / GRID_H) * 5.0;
      var n = fbmNoise(nx + 10, ny + nz + 10, 5);

      // Latitude bias: more water at equator edges, ice at poles
      var adjusted = n - 0.05 + latFactor * 0.15;

      var cell;
      if (latFactor > 0.82) {
        cell = { ch: '*', cls: 'terrain-ice' };
      } else if (latFactor > 0.72) {
        cell = adjusted > 0.52 ? { ch: '*', cls: 'terrain-ice' } : { ch: '.', cls: 'terrain-plains' };
      } else if (adjusted < 0.35) {
        cell = { ch: '~', cls: 'terrain-water' };
      } else if (adjusted < 0.42) {
        cell = { ch: '.', cls: 'terrain-plains' };
      } else if (adjusted < 0.52) {
        cell = { ch: '^', cls: 'terrain-forest' };
      } else {
        cell = { ch: '#', cls: 'terrain-mountain' };
      }
      terrainGrid[ty][tx] = cell;
    }
  }

  // ─── WORLD PLACEMENT ───
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
    var gy = 3 + ((h >> 8) % (GRID_H - 6));
    return { gx: gx, gy: gy };
  }

  var worldMap = {};

  function rebuildWorldMap() {
    worldMap = {};
    var occupied = {};
    for (var i = 0; i < worlds.length; i++) {
      var w = worlds[i];
      var pos = worldGridPos(w.seed);
      var key = pos.gx + ',' + pos.gy;
      var attempts = 0;
      while (occupied[key] && attempts < 30) {
        pos.gx = (pos.gx + 1) % GRID_W;
        if (pos.gx < 3) pos.gx = 3;
        key = pos.gx + ',' + pos.gy;
        attempts++;
      }
      occupied[key] = true;
      worldMap[key] = w;
    }
  }

  // ─── GLOBE RENDERER ───
  function renderGlobe() {
    var html = [];
    var cosTilt = Math.cos(tilt);
    var sinTilt = Math.sin(tilt);
    var cosR = Math.cos(rotation);
    var sinR = Math.sin(rotation);
    var meteorMap = buildMeteorMap();

    for (var sy = 0; sy < GLOBE_H; sy++) {
      var row = '';
      for (var sx = 0; sx < GLOBE_W; sx++) {
        // Map to [-1, 1] — W is 2*H so chars are already ~square on screen
        var nx = (sx / (GLOBE_W - 1)) * 2 - 1;
        var ny = (sy / (GLOBE_H - 1)) * 2 - 1;

        var r2 = nx * nx + ny * ny;

        if (r2 > 1.0) {
          // Void space — check meteor first, then stars
          var mKey = sx + ',' + sy;
          var meteor = meteorMap[mKey];
          if (meteor) {
            row += '<span class="' + meteor.cls + '">' + escHtml(meteor.ch) + '</span>';
          } else {
            var star = starAt(sx, sy);
            if (star) {
              row += '<span class="' + star.cls + '">' + escHtml(star.ch) + '</span>';
            } else {
              row += ' ';
            }
          }
          continue;
        }

        // Sphere surface normal
        var nz = Math.sqrt(1 - r2);

        // Apply axial tilt (rotate around X)
        var ty2 = ny * cosTilt - nz * sinTilt;
        var tz2 = ny * sinTilt + nz * cosTilt;

        // Rotate around Y axis (spin)
        var rx = nx * cosR + tz2 * sinR;
        var rz = -nx * sinR + tz2 * cosR;
        var ry = ty2;

        // Convert to lat/long
        var lat = Math.asin(Math.max(-1, Math.min(1, ry)));
        var lon = Math.atan2(rx, rz);

        // Map to grid
        var gx = Math.floor(((lon / Math.PI + 1) / 2) * GRID_W) % GRID_W;
        if (gx < 0) gx += GRID_W;
        var gy = Math.floor(((lat / (Math.PI / 2) + 1) / 2) * GRID_H);
        gy = Math.max(0, Math.min(GRID_H - 1, gy));

        // Lighting: use original screen-space normal for consistent shading
        var dot = nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + nz * LIGHT_DIR.z;
        var shade = Math.max(0, dot);

        // Fresnel-like edge darkening
        var edgeFade = nz; // 0 at edge, 1 at center
        shade *= (0.3 + 0.7 * edgeFade);

        // Atmosphere glow at rim
        if (r2 > 0.88 && r2 <= 1.0) {
          var rimGlow = (r2 - 0.88) / 0.12;
          if (shade < 0.08) {
            // Dark side rim — subtle blue atmosphere
            row += '<span class="globe-atmo">' + (rimGlow > 0.5 ? '.' : ' ') + '</span>';
            continue;
          }
        }

        // Check for world marker
        var worldKey = gx + ',' + gy;
        var world = worldMap[worldKey];

        if (world && shade > 0.1) {
          var sparkle = (frameCount + sx + sy) % 10 < 5;
          if (world.is_minted) {
            var ch = sparkle ? '\u2666' : '\u2727';
            row += '<a href="/view/' + encodeURIComponent(world.view_token) + '" class="world-minted" title="' + escAttr(world.name + ' (Pop: ' + world.population + ') [MINTED]') + '">' + escHtml(ch) + '</a>';
          } else {
            var sym = world.banner_symbol || '\u25cf';
            row += '<a href="/view/' + encodeURIComponent(world.view_token) + '" class="world-normal" title="' + escAttr(world.name + ' (Pop: ' + world.population + ')') + '">' + escHtml(sym) + '</a>';
          }
        } else {
          var terrain = terrainGrid[gy][gx];
          var shadeIdx = Math.floor(shade * (SHADE_CHARS.length - 1));
          shadeIdx = Math.max(0, Math.min(SHADE_CHARS.length - 1, shadeIdx));

          var ch;
          if (shade < 0.06) {
            ch = ' '; // deep shadow
          } else if (shade < 0.15) {
            ch = SHADE_CHARS[shadeIdx];
          } else if (shade < 0.25) {
            // Transition zone — mix shade and terrain
            ch = (shadeIdx > 3) ? terrain.ch : SHADE_CHARS[shadeIdx];
          } else {
            ch = terrain.ch;
          }

          // Color class: terrain color on lit side, dim on dark side
          var cls = terrain.cls;
          if (shade < 0.15) cls = 'globe-shadow';
          else if (shade < 0.3) cls += ' globe-dim';

          row += '<span class="' + cls + '">' + escHtml(ch) + '</span>';
        }
      }
      html.push(row);
    }

    return html;
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

    updateMeteors();
    var html = renderGlobe();
    container.innerHTML = '<pre class="globe-pre">' + html.join('\n') + '</pre>';
  }

  // ─── MOUSE DRAG ───
  container.addEventListener('mousedown', function (e) {
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragRotStart = rotation;
    dragTiltStart = tilt;
    e.preventDefault();
  });

  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - dragStartX;
    var dy = e.clientY - dragStartY;
    rotation = dragRotStart + dx * 0.005;
    tilt = Math.max(-0.6, Math.min(0.6, dragTiltStart + dy * 0.003));
  });

  window.addEventListener('mouseup', function () {
    dragging = false;
  });

  // Touch support
  container.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) {
      dragging = true;
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
      dragRotStart = rotation;
      dragTiltStart = tilt;
    }
  });

  window.addEventListener('touchmove', function (e) {
    if (!dragging || e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - dragStartX;
    var dy = e.touches[0].clientY - dragStartY;
    rotation = dragRotStart + dx * 0.005;
    tilt = Math.max(-0.6, Math.min(0.6, dragTiltStart + dy * 0.003));
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

  function addLegend() {
    var legend = document.createElement('div');
    legend.className = 'planet-legend';
    legend.innerHTML =
      '<span class="world-minted">\u2666</span> Minted  ' +
      '<span class="world-normal">\u25cf</span> Active  ' +
      '<span class="terrain-plains">.</span> Land  ' +
      '<span class="terrain-water">~</span> Sea  ' +
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
