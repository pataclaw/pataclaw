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
  var planetaryEvent = null; // active event from server

  // ─── PLANETARY EVENT CONFIG ───
  var PE_ICONS = {
    solar_eclipse: '\u25D1',
    meteor_shower: '\u2604',
    tidal_surge: '\u224B',
    shell_migration: '\u2727',
    blood_moon: '\u25CF',
    golden_age: '\u2605',
    molt_season: '\u25CB',
  };
  // Visual modifiers per event type
  var PE_EFFECTS = {
    solar_eclipse:   { shadeMul: 0.35, atmoCls: 'globe-atmo-eclipse', meteorBoost: 0 },
    meteor_shower:   { shadeMul: 1.0, atmoCls: null, meteorBoost: 5 },
    tidal_surge:     { shadeMul: 1.0, atmoCls: 'globe-atmo-tidal', meteorBoost: 0 },
    shell_migration: { shadeMul: 1.1, atmoCls: 'globe-atmo-shell', meteorBoost: 0 },
    blood_moon:      { shadeMul: 0.7, atmoCls: 'globe-atmo-blood', meteorBoost: 0 },
    golden_age:      { shadeMul: 1.2, atmoCls: 'globe-atmo-golden', meteorBoost: 0 },
    molt_season:     { shadeMul: 1.1, atmoCls: 'globe-atmo-golden', meteorBoost: 0 },
  };

  // ─── FULL-VIEWPORT STARFIELD (canvas) ───
  var starCanvas = document.getElementById('starfield');
  var starCtx = starCanvas ? starCanvas.getContext('2d') : null;
  var bgStars = [];
  var pulsars = [];    // bright rhythmic beacons
  var nebulae = [];    // subtle colored gas wisps
  var bgComets = [];   // distant shooting stars across viewport

  function initBgStarfield() {
    if (!starCanvas) return;
    starCanvas.width = window.innerWidth;
    starCanvas.height = window.innerHeight;
    var w = starCanvas.width, h = starCanvas.height;
    var area = w * h;

    // Stars
    bgStars = [];
    var count = Math.floor(area / 700);
    for (var i = 0; i < count; i++) {
      bgStars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() < 0.7 ? 1 : (Math.random() < 0.85 ? 1.5 : 2),
        brightness: 0.15 + Math.random() * 0.65,
        twinkleSpeed: 0.01 + Math.random() * 0.04,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }

    // Pulsars — 3-6 bright rhythmic beacons
    pulsars = [];
    var pulsarCount = 3 + Math.floor(Math.random() * 4);
    for (var i = 0; i < pulsarCount; i++) {
      pulsars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        pulseSpeed: 0.03 + Math.random() * 0.05,
        pulsePhase: Math.random() * Math.PI * 2,
        color: Math.random() < 0.5 ? [140, 180, 255] : (Math.random() < 0.5 ? [255, 200, 140] : [200, 140, 255]),
        maxRadius: 1.5 + Math.random() * 1.5,
      });
    }

    // Nebulae — 2-4 faint colored gas patches
    nebulae = [];
    var nebulaCount = 2 + Math.floor(Math.random() * 3);
    for (var i = 0; i < nebulaCount; i++) {
      var hue = Math.random();
      var nr, ng, nb;
      if (hue < 0.3) { nr = 60; ng = 40; nb = 120; }       // purple
      else if (hue < 0.5) { nr = 30; ng = 60; nb = 100; }   // blue
      else if (hue < 0.7) { nr = 80; ng = 40; nb = 50; }    // red/pink
      else { nr = 40; ng = 80; nb = 70; }                     // teal
      nebulae.push({
        x: w * 0.1 + Math.random() * w * 0.8,
        y: h * 0.1 + Math.random() * h * 0.8,
        radius: 60 + Math.random() * 120,
        r: nr, g: ng, b: nb,
        alpha: 0.015 + Math.random() * 0.025,
        driftX: (Math.random() - 0.5) * 0.05,
        driftY: (Math.random() - 0.5) * 0.03,
      });
    }
  }

  // ─── CANVAS COMETS (distant shooting stars) ───
  var BG_COMET_MAX = 3;
  var BG_COMET_SPAWN_RATE = 0.006;

  function spawnBgComet() {
    var w = starCanvas.width, h = starCanvas.height;
    var side = Math.random();
    var x, y, dx, dy, speed;
    speed = 2 + Math.random() * 4;
    if (side < 0.5) {
      // From top
      x = Math.random() * w;
      y = -10;
      dx = (Math.random() - 0.5) * speed * 0.6;
      dy = speed;
    } else if (side < 0.75) {
      // From left
      x = -10;
      y = Math.random() * h * 0.6;
      dx = speed;
      dy = speed * (0.3 + Math.random() * 0.5);
    } else {
      // From right
      x = w + 10;
      y = Math.random() * h * 0.6;
      dx = -speed;
      dy = speed * (0.3 + Math.random() * 0.5);
    }
    var warm = Math.random() < 0.3;
    return {
      x: x, y: y, dx: dx, dy: dy,
      life: 40 + Math.floor(Math.random() * 60), age: 0,
      tailLen: 8 + Math.floor(Math.random() * 15),
      r: warm ? 255 : 200, g: warm ? 220 : 210, b: warm ? 160 : 255,
      brightness: 0.4 + Math.random() * 0.4,
    };
  }

  function updateBgComets() {
    // Spawn
    var eff = planetaryEvent ? PE_EFFECTS[planetaryEvent.type] : null;
    var boost = eff && eff.meteorBoost > 0 ? 4 : 1;
    var maxC = BG_COMET_MAX * boost;
    if (bgComets.length < maxC && Math.random() < BG_COMET_SPAWN_RATE * boost) {
      bgComets.push(spawnBgComet());
    }
    // Advance
    for (var i = bgComets.length - 1; i >= 0; i--) {
      var c = bgComets[i];
      c.x += c.dx;
      c.y += c.dy;
      c.age++;
      if (c.age > c.life || c.x < -50 || c.x > starCanvas.width + 50 || c.y > starCanvas.height + 50) {
        bgComets.splice(i, 1);
      }
    }
  }

  function renderBgStarfield() {
    if (!starCtx || !starCanvas) return;
    var w = starCanvas.width, h = starCanvas.height;
    starCtx.clearRect(0, 0, w, h);

    // Nebulae — soft background glow
    for (var i = 0; i < nebulae.length; i++) {
      var n = nebulae[i];
      n.x += n.driftX;
      n.y += n.driftY;
      // Wrap around
      if (n.x < -n.radius) n.x = w + n.radius;
      if (n.x > w + n.radius) n.x = -n.radius;
      if (n.y < -n.radius) n.y = h + n.radius;
      if (n.y > h + n.radius) n.y = -n.radius;

      var grad = starCtx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.radius);
      grad.addColorStop(0, 'rgba(' + n.r + ',' + n.g + ',' + n.b + ',' + n.alpha + ')');
      grad.addColorStop(0.5, 'rgba(' + n.r + ',' + n.g + ',' + n.b + ',' + (n.alpha * 0.4) + ')');
      grad.addColorStop(1, 'rgba(' + n.r + ',' + n.g + ',' + n.b + ',0)');
      starCtx.fillStyle = grad;
      starCtx.fillRect(n.x - n.radius, n.y - n.radius, n.radius * 2, n.radius * 2);
    }

    // Stars
    for (var i = 0; i < bgStars.length; i++) {
      var s = bgStars[i];
      var twinkle = Math.sin(frameCount * s.twinkleSpeed + s.twinklePhase);
      var alpha = s.brightness * (0.5 + 0.5 * twinkle);
      if (alpha < 0.05) continue;
      var r = 180 + Math.floor(s.brightness * 75);
      var g = 190 + Math.floor(s.brightness * 65);
      var b = 210 + Math.floor(s.brightness * 45);
      starCtx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(2) + ')';
      starCtx.fillRect(s.x, s.y, s.size, s.size);

      // Bright stars get a soft glow
      if (s.size >= 2 && alpha > 0.5) {
        starCtx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha * 0.12).toFixed(2) + ')';
        starCtx.fillRect(s.x - 1, s.y - 1, s.size + 2, s.size + 2);
      }
    }

    // Pulsars — rhythmic bright beacons
    for (var i = 0; i < pulsars.length; i++) {
      var p = pulsars[i];
      var pulse = Math.sin(frameCount * p.pulseSpeed + p.pulsePhase);
      var intensity = 0.1 + 0.9 * Math.max(0, pulse);
      var radius = p.maxRadius * intensity;
      if (radius < 0.3) continue;
      // Core
      starCtx.fillStyle = 'rgba(' + p.color[0] + ',' + p.color[1] + ',' + p.color[2] + ',' + (intensity * 0.8).toFixed(2) + ')';
      starCtx.beginPath();
      starCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      starCtx.fill();
      // Glow halo
      if (intensity > 0.5) {
        var glow = starCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 4);
        glow.addColorStop(0, 'rgba(' + p.color[0] + ',' + p.color[1] + ',' + p.color[2] + ',' + (intensity * 0.15).toFixed(2) + ')');
        glow.addColorStop(1, 'rgba(' + p.color[0] + ',' + p.color[1] + ',' + p.color[2] + ',0)');
        starCtx.fillStyle = glow;
        starCtx.fillRect(p.x - radius * 4, p.y - radius * 4, radius * 8, radius * 8);
      }
    }

    // Comets — streaking trails across the viewport
    for (var i = 0; i < bgComets.length; i++) {
      var c = bgComets[i];
      var len = Math.sqrt(c.dx * c.dx + c.dy * c.dy);
      var ux = -c.dx / len, uy = -c.dy / len; // unit tail direction

      // Fade in/out at start and end of life
      var lifeFade = Math.min(1, c.age / 8, (c.life - c.age) / 10);

      // Head
      starCtx.fillStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (c.brightness * lifeFade).toFixed(2) + ')';
      starCtx.beginPath();
      starCtx.arc(c.x, c.y, 1.5, 0, Math.PI * 2);
      starCtx.fill();

      // Trail
      for (var t = 1; t <= c.tailLen; t++) {
        var tx = c.x + ux * t * 2.5;
        var ty = c.y + uy * t * 2.5;
        var ta = c.brightness * lifeFade * (1 - t / c.tailLen) * 0.6;
        if (ta < 0.02) break;
        var tr = 0.8 * (1 - t / c.tailLen);
        starCtx.fillStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + ta.toFixed(2) + ')';
        starCtx.beginPath();
        starCtx.arc(tx, ty, Math.max(0.3, tr), 0, Math.PI * 2);
        starCtx.fill();
      }
    }
  }

  initBgStarfield();
  window.addEventListener('resize', initBgStarfield);

  // ─── ATMOSPHERE OVERLAY ───
  var atmoOverlay = document.getElementById('atmo-overlay');

  function updateAtmoOverlay(evt) {
    if (!atmoOverlay) return;
    if (!evt) {
      atmoOverlay.className = 'atmo-overlay hidden';
      return;
    }
    atmoOverlay.className = 'atmo-overlay atmo-' + evt.type;
  }

  // ─── INLINE STARFIELD (around globe in the <pre>) ───
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
  var METEOR_SPAWN_RATE = 0.003; // reduced — most action is on canvas comets now
  var METEOR_MAX = 2;
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
    // Spawn — boosted during meteor_shower event
    var eff = planetaryEvent ? PE_EFFECTS[planetaryEvent.type] : null;
    var maxM = METEOR_MAX + (eff ? eff.meteorBoost : 0);
    var rate = METEOR_SPAWN_RATE * (eff && eff.meteorBoost > 0 ? 8 : 1);
    if (meteors.length < maxM && Math.random() < rate) {
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
        cell = adjusted > 0.52 ? { ch: '*', cls: 'terrain-ice' } : { ch: ':', cls: 'terrain-tundra' };
      } else if (adjusted < 0.35) {
        cell = { ch: '~', cls: 'terrain-water' };
      } else if (adjusted < 0.38) {
        cell = { ch: '%', cls: 'terrain-swamp' };
      } else if (adjusted < 0.44) {
        cell = { ch: '.', cls: 'terrain-plains' };
      } else if (adjusted < 0.54) {
        cell = { ch: '^', cls: 'terrain-forest' };
      } else if (adjusted < 0.62) {
        cell = { ch: '#', cls: 'terrain-mountain' };
      } else if (latFactor < 0.35) {
        cell = { ch: '~', cls: 'terrain-desert' };
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

      // Bias toward matching globe terrain if world has a dominant biome
      if (w.dominant_biome) {
        var targetCls = 'terrain-' + w.dominant_biome;
        var bestKey = key;
        var bestDist = 999;
        for (var dy = -5; dy <= 5; dy++) {
          for (var dx = -5; dx <= 5; dx++) {
            var tx = pos.gx + dx, ty = pos.gy + dy;
            if (tx < 3 || tx >= GRID_W - 3 || ty < 3 || ty >= GRID_H - 3) continue;
            var tk = tx + ',' + ty;
            if (occupied[tk]) continue;
            var cell = terrainGrid[ty] && terrainGrid[ty][tx];
            if (cell && cell.cls === targetCls) {
              var d = Math.abs(dx) + Math.abs(dy);
              if (d < bestDist) { bestDist = d; bestKey = tk; }
            }
          }
        }
        if (bestDist < 999) key = bestKey;
      }

      // Collision resolution
      var attempts = 0;
      while (occupied[key] && attempts < 30) {
        var parts = key.split(',');
        var kx = (parseInt(parts[0]) + 1) % GRID_W;
        if (kx < 3) kx = 3;
        key = kx + ',' + parts[1];
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
    var peEff = planetaryEvent ? PE_EFFECTS[planetaryEvent.type] : null;
    var shadeMul = peEff ? peEff.shadeMul : 1.0;
    var atmoOverride = peEff ? peEff.atmoCls : null;

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

        // Apply planetary event shade modifier
        shade *= shadeMul;
        shade = Math.min(1.0, shade);

        // Atmosphere glow at rim
        if (r2 > 0.88 && r2 <= 1.0) {
          var rimGlow = (r2 - 0.88) / 0.12;
          if (shade < 0.08) {
            var rimCls = atmoOverride || 'globe-atmo';
            row += '<span class="' + rimCls + '">' + (rimGlow > 0.5 ? '.' : ' ') + '</span>';
            continue;
          }
        }

        // Check for world marker
        var worldKey = gx + ',' + gy;
        var world = worldMap[worldKey];

        if (world && shade > 0.1) {
          // Use the biome's terrain character as the world marker
          var BIOME_CHARS = { water:'~', swamp:'%', plains:'.', forest:'^', mountain:'#', desert:'~', ice:'*', tundra:':' };
          var ch = BIOME_CHARS[world.dominant_biome] || '.';
          var cls = world.is_minted ? 'world-minted' : 'world-normal';
          var label = world.name + ' (Pop: ' + world.population + ')' + (world.is_minted ? ' [MINTED]' : '');
          row += '<a href="/view/' + encodeURIComponent(world.view_token) + '" class="' + cls + '" title="' + escAttr(label) + '">' + escHtml(ch) + '</a>';
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

    updateBgComets();
    renderBgStarfield();
    updateMeteors();
    if (!dragging) {
      var html = renderGlobe();
      container.innerHTML = '<pre class="globe-pre">' + html.join('\n') + '</pre>';
    }
  }

  // ─── MOUSE/TOUCH DRAG (with click-through for world links) ───
  // Render loop freezes while dragging so <a> elements survive for native clicks.
  var dragMoved = false;
  var DRAG_THRESHOLD = 5;

  container.addEventListener('mousedown', function (e) {
    dragging = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragRotStart = rotation;
    dragTiltStart = tilt;
  });

  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - dragStartX;
    var dy = e.clientY - dragStartY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      dragMoved = true;
    }
    if (dragMoved) {
      rotation = dragRotStart + dx * 0.005;
      tilt = Math.max(-0.6, Math.min(0.6, dragTiltStart + dy * 0.003));
      // Re-render manually during drag so globe follows the mouse
      var html = renderGlobe();
      container.innerHTML = '<pre class="globe-pre">' + html.join('\n') + '</pre>';
    }
  });

  window.addEventListener('mouseup', function () {
    dragging = false;
  });

  // Block clicks only if user dragged — let native <a> clicks through otherwise
  container.addEventListener('click', function (e) {
    if (dragMoved) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Touch support
  container.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) {
      dragging = true;
      dragMoved = false;
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
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      dragMoved = true;
    }
    if (dragMoved) {
      rotation = dragRotStart + dx * 0.005;
      tilt = Math.max(-0.6, Math.min(0.6, dragTiltStart + dy * 0.003));
      var html = renderGlobe();
      container.innerHTML = '<pre class="globe-pre">' + html.join('\n') + '</pre>';
    }
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
        planetaryEvent = data.planetaryEvent || null;
        rebuildWorldMap();
        renderStats(stats);
        renderEventBanner(planetaryEvent);
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

  function renderEventBanner(evt) {
    var el = document.getElementById('planet-event');
    if (!el) return;
    if (!evt) {
      el.classList.add('hidden');
      updateAtmoOverlay(null);
      return;
    }
    var icon = PE_ICONS[evt.type] || '\u2731';
    el.className = 'planet-event pe-' + evt.type;
    el.innerHTML = '<span class="pe-icon">' + icon + '</span> ' +
      escAttr(evt.title) +
      ' <span class="pe-desc">' + escAttr(evt.description || '') + '</span>';
    updateAtmoOverlay(evt);
  }

  function addLegend() {
    var legend = document.createElement('div');
    legend.className = 'planet-legend';
    legend.innerHTML =
      '<span class="world-minted">\u2666</span> Minted  ' +
      '<span class="world-normal">\u25cf</span> Active  ' +
      '<span class="terrain-plains">.</span> Plains  ' +
      '<span class="terrain-water">~</span> Sea  ' +
      '<span class="terrain-forest">^</span> Forest  ' +
      '<span class="terrain-mountain">#</span> Mountain  ' +
      '<span class="terrain-desert">~</span> Desert  ' +
      '<span class="terrain-swamp">%</span> Swamp  ' +
      '<span class="terrain-tundra">:</span> Tundra  ' +
      '<span class="terrain-ice">*</span> Ice';
    container.parentNode.insertBefore(legend, container.nextSibling);
  }

  // ─── START ───
  fetchAndRender();
  setInterval(fetchAndRender, 30000);
  addLegend();
  requestAnimationFrame(loop);
})();
