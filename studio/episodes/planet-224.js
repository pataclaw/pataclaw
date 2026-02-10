// ═══════════════════════════════════════════════════════
// EPISODE: Planet 224 — The Big Bang (Feb 2026)
// ═══════════════════════════════════════════════════════
// Grid: 120x32 — widescreen
// Dramatic creation story: void → big bang → planet forms → worlds ignite
// ~51s at 12fps = 612 frames
// Audio: planet-224.wav (cinematic orchestral synth)

(function() {
var S = window.STUDIO;
S.W = 120; S.H = 32; S.GY = 24;
var W = S.W, H = S.H, GY = S.GY;

// ─── Helpers ───
function typewriter(g, x, y, text, c, f, startF, speed) {
  speed = speed || 1.5;
  var chars = Math.max(0, Math.floor((f - startF) * speed));
  if (chars <= 0) return;
  S.text(g, x, y, text.slice(0, chars), c);
}

// ─── Particle system for big bang ───
var particles = [];
for (var pi = 0; pi < 200; pi++) {
  var angle = (pi / 200) * Math.PI * 2 + (Math.sin(pi * 7.3) * 0.5);
  var speed = 0.8 + Math.sin(pi * 3.7) * 0.6 + Math.random() * 0.4;
  var chars = ['.', '*', '+', ':', '\u2727', '\u25cf', '\u2605', '\u2736', '#', '~', '^', '%'];
  var colors = ['c-flash', 'c-cele', 'c-gold', 'c-fire', 'c-green', 'c-blue', 'c-purple',
                'c-water', 'c-tree', 'c-desert', 'c-swamp', 'c-mountain', 'c-ice', 'c-bright'];
  particles.push({
    angle: angle,
    speed: speed,
    ch: chars[pi % chars.length],
    c: colors[pi % colors.length],
    decay: 0.92 + Math.random() * 0.06,
    life: 40 + Math.floor(Math.random() * 60),
  });
}

function drawExplosion(g, f, cx, cy) {
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    if (f > p.life) continue;
    var t = f * p.speed;
    // Decelerate over time
    var dist = t * Math.pow(p.decay, f * 0.5);
    var px = cx + Math.round(Math.cos(p.angle) * dist * 1.8); // stretch horizontal for aspect ratio
    var py = cy + Math.round(Math.sin(p.angle) * dist * 0.9);
    if (px < 0 || px >= W || py < 0 || py >= H) continue;
    // Fade out near end of life
    var fade = 1 - (f / p.life);
    if (fade < 0.3 && f % 2 === 0) continue;
    S.set(g, px, py, p.ch, fade > 0.5 ? p.c : 'c-dim');
  }
}

// ─── Globe terrain ───
function hash2d(x, y) {
  var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function smoothNoise(x, y) {
  var ix = Math.floor(x), iy = Math.floor(y);
  var fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  var a = hash2d(ix, iy), b = hash2d(ix + 1, iy);
  var c = hash2d(ix, iy + 1), d = hash2d(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbmNoise(x, y, octaves) {
  var val = 0, amp = 0.5, freq = 1.0, total = 0;
  for (var i = 0; i < octaves; i++) {
    val += smoothNoise(x * freq, y * freq) * amp;
    total += amp; amp *= 0.5; freq *= 2.1;
  }
  return val / total;
}

// Terrain grid uses t-* classes matching real planet.css colors exactly
var P_GRID_W = 80, P_GRID_H = 40;
var terrainGrid = [];
for (var ty = 0; ty < P_GRID_H; ty++) {
  terrainGrid[ty] = [];
  var latFactor = Math.abs(ty / P_GRID_H - 0.5) * 2;
  for (var tx = 0; tx < P_GRID_W; tx++) {
    var angle = (tx / P_GRID_W) * Math.PI * 2;
    var nx = Math.cos(angle) * 2.5, nz = Math.sin(angle) * 2.5;
    var ny = (ty / P_GRID_H) * 5.0;
    var n = fbmNoise(nx + 10, ny + nz + 10, 5);
    var adjusted = n - 0.05 + latFactor * 0.15;
    var cell;
    if (latFactor > 0.82) cell = { ch: '*', cls: 't-ice' };
    else if (latFactor > 0.72) cell = adjusted > 0.52 ? { ch: '*', cls: 't-ice' } : { ch: ':', cls: 't-tundra' };
    else if (adjusted < 0.35) cell = { ch: '~', cls: 't-water' };
    else if (adjusted < 0.38) cell = { ch: '%', cls: 't-swamp' };
    else if (adjusted < 0.44) cell = { ch: '.', cls: 't-plains' };
    else if (adjusted < 0.54) cell = { ch: '^', cls: 't-forest' };
    else if (adjusted < 0.62) cell = { ch: '#', cls: 't-mountain' };
    else if (latFactor < 0.35) cell = { ch: '~', cls: 't-desert' };
    else cell = { ch: '#', cls: 't-mountain' };
    terrainGrid[ty][tx] = cell;
  }
}

var SHADE_CHARS = ' .,:;=+*#%@';
var LIGHT_DIR = { x: -0.6, y: -0.4, z: 0.7 };
var lLen = Math.sqrt(LIGHT_DIR.x * LIGHT_DIR.x + LIGHT_DIR.y * LIGHT_DIR.y + LIGHT_DIR.z * LIGHT_DIR.z);
LIGHT_DIR.x /= lLen; LIGHT_DIR.y /= lLen; LIGHT_DIR.z /= lLen;

function hashSeed(seed) {
  var h = seed | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return Math.abs(h);
}
function worldGridPos(seed) {
  var h = hashSeed(seed);
  return { gx: 3 + (h % (P_GRID_W - 6)), gy: 3 + ((h >> 8) % (P_GRID_H - 6)) };
}

// 224 worlds
var TOTAL_WORLDS = 224;
var TOWNS = [];
for (var ti = 0; ti < TOTAL_WORLDS; ti++) TOWNS.push({ seed: 10000 + ti * 137 });
var occupied = {}, worldMap = {};
for (var wi = 0; wi < TOWNS.length; wi++) {
  var pos = worldGridPos(TOWNS[wi].seed);
  var key = pos.gx + ',' + pos.gy;
  var attempts = 0;
  while (occupied[key] && attempts < 30) {
    pos.gx = (pos.gx + 1) % P_GRID_W;
    if (pos.gx < 3) pos.gx = 3;
    key = pos.gx + ',' + pos.gy;
    attempts++;
  }
  occupied[key] = true;
  worldMap[key] = TOWNS[wi];
}

// Assign biomes from seed (mirrors server deriveBiomeWeights)
var BIOME_NAMES_LIST = ['water', 'swamp', 'plains', 'forest', 'mountain', 'desert'];
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
for (var bi = 0; bi < TOWNS.length; bi++) {
  var rng = mulberry32((TOWNS[bi].seed ^ 0xBEEFCAFE) | 0);
  var raw = [], sum = 0;
  for (var ri = 0; ri < 6; ri++) { var v = Math.pow(rng(), 2.5); raw.push(v); sum += v; }
  var best = 0, bestW = 0;
  for (var rj = 0; rj < 6; rj++) { var wt = raw[rj] / sum; if (wt > bestW) { bestW = wt; best = rj; } }
  TOWNS[bi].biome = BIOME_NAMES_LIST[best];
}

// ─── Globe renderer (matches planet.js exactly) ───
// GLOBE_W should be 2*GLOBE_H for square-looking circle in monospace
// globeScale: 0-1 for formation animation
var STAR_DENSITY = 0.035;
var STAR_CHARS = ['.', '\u00b7', '+', '*'];
var STAR_CLASSES = ['t-star-dim', 't-star-dim', 't-star-med', 't-star-bright'];

function renderGlobe(g, f, globeW, globeH, offsetX, offsetY, worldLimit, globeScale) {
  globeScale = globeScale === undefined ? 1 : globeScale;
  var rotation = f * 0.012;
  var tilt = 0.15; // matches planet.js
  var cosTilt = Math.cos(tilt), sinTilt = Math.sin(tilt);
  var cosR = Math.cos(rotation), sinR = Math.sin(rotation);

  // Scale the rendering area for formation animation
  var renderW = Math.floor(globeW * globeScale);
  var renderH = Math.floor(globeH * globeScale);
  var renderOX = offsetX + Math.floor((globeW - renderW) / 2);
  var renderOY = offsetY + Math.floor((globeH - renderH) / 2);

  var worldsShown = 0;

  for (var sy = 0; sy < globeH; sy++) {
    for (var sx = 0; sx < globeW; sx++) {
      var screenX = offsetX + sx;
      var screenY = offsetY + sy;
      if (screenX < 0 || screenX >= W || screenY < 0 || screenY >= H) continue;

      // Map to [-1,1] — W is 2*H so chars look square
      var nx = (sx / (globeW - 1)) * 2 - 1;
      var ny = (sy / (globeH - 1)) * 2 - 1;
      var r2 = nx * nx + ny * ny;

      if (r2 > 1.0) {
        // Void space — inline stars (deterministic, twinkling)
        var h = hash2d(sx * 0.73 + 5.1, sy * 1.37 + 8.3);
        if (h <= STAR_DENSITY) {
          var idx = Math.floor(h / STAR_DENSITY * 3.99);
          var twinklePhase = hash2d(sx * 3.1, sy * 7.7);
          var twinkleSpeed = 0.02 + twinklePhase * 0.04;
          var brightness = Math.sin(f * twinkleSpeed + twinklePhase * 100);
          if (brightness > -0.3) {
            var boosted = brightness > 0.7 ? Math.min(3, idx + 1) : idx;
            S.set(g, screenX, screenY, STAR_CHARS[boosted], STAR_CLASSES[boosted]);
          }
        }
        continue;
      }

      // Check if inside scaled formation area
      if (globeScale < 1) {
        var inScaledX = sx >= (globeW - renderW) / 2 && sx < (globeW + renderW) / 2;
        var inScaledY = sy >= (globeH - renderH) / 2 && sy < (globeH + renderH) / 2;
        if (!inScaledX || !inScaledY) continue;
      }

      var nz = Math.sqrt(1 - r2);

      // Axial tilt (rotate around X)
      var ty2 = ny * cosTilt - nz * sinTilt;
      var tz2 = ny * sinTilt + nz * cosTilt;

      // Spin rotation (rotate around Y)
      var rx = nx * cosR + tz2 * sinR;
      var rz = -nx * sinR + tz2 * cosR;
      var ry = ty2;

      // Lat/long
      var lat = Math.asin(Math.max(-1, Math.min(1, ry)));
      var lon = Math.atan2(rx, rz);

      // Map to terrain grid
      var gx = Math.floor(((lon / Math.PI + 1) / 2) * P_GRID_W) % P_GRID_W;
      if (gx < 0) gx += P_GRID_W;
      var gy = Math.floor(((lat / (Math.PI / 2) + 1) / 2) * P_GRID_H);
      gy = Math.max(0, Math.min(P_GRID_H - 1, gy));

      // Lighting — same as planet.js
      var dot = nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + nz * LIGHT_DIR.z;
      var shade = Math.max(0, dot);
      var edgeFade = nz;
      shade *= (0.3 + 0.7 * edgeFade);
      shade = Math.min(1.0, shade);

      // Atmosphere rim glow (r2 > 0.88, same as planet.js)
      if (r2 > 0.88 && r2 <= 1.0) {
        var rimGlow = (r2 - 0.88) / 0.12;
        if (shade < 0.08) {
          S.set(g, screenX, screenY, rimGlow > 0.5 ? '.' : ' ', 't-atmo');
          continue;
        }
      }

      // World markers — biome chars, green glow (matches planet.js)
      var wKey = gx + ',' + gy;
      if (worldMap[wKey] && shade > 0.1 && worldsShown < worldLimit) {
        var BIOME_CHARS = { water:'~', swamp:'%', plains:'.', forest:'^', mountain:'#', desert:'~', ice:'*', tundra:':' };
        var wBiome = worldMap[wKey].biome || 'plains';
        var wch = BIOME_CHARS[wBiome] || '.';
        S.set(g, screenX, screenY, wch, 't-world');
        worldsShown++;
        continue;
      }

      // Terrain — exact planet.js shading logic
      var terrain = terrainGrid[gy][gx];
      var shadeIdx = Math.floor(shade * (SHADE_CHARS.length - 1));
      shadeIdx = Math.max(0, Math.min(SHADE_CHARS.length - 1, shadeIdx));

      var ch;
      if (shade < 0.06) {
        ch = ' '; // deep shadow
      } else if (shade < 0.15) {
        ch = SHADE_CHARS[shadeIdx];
      } else if (shade < 0.25) {
        // Transition zone — mix shade chars and terrain chars
        ch = (shadeIdx > 3) ? terrain.ch : SHADE_CHARS[shadeIdx];
      } else {
        ch = terrain.ch;
      }

      // Color: shadow on dark side, terrain color on lit (dim via char choice)
      var cls = terrain.cls;
      if (shade < 0.15) cls = 't-shadow';

      S.set(g, screenX, screenY, ch, cls);
    }
  }
}

// ─── Ambient glow particles ───
function drawGlow(g, f, intensity) {
  var glyphs = ['\u2020', '\u2726', '\u25c7', '\u2727', '\u263c', '\u2736', '\u2605'];
  var count = Math.floor((intensity || 1) * 7);
  for (var i = 0; i < count; i++) {
    var gx = (i * 17 + f * 2) % W;
    var gy = 1 + (i * 4 + f) % (H - 2);
    var pulse = Math.sin(f * 0.12 + i * 1.3);
    if (pulse > 0.2) {
      S.set(g, gx, gy, glyphs[i % glyphs.length], pulse > 0.6 ? 'c-cele' : 'c-dim');
    }
  }
}

// ═══════════════════════════════════════
// SCENES
// ═══════════════════════════════════════

window.EPISODE = {
  title: 'Planet 224',
  date: '2026-02-10',
  audio: 'planet-224.wav',
  scenes: [

  // ═══════════════════════════════════════
  // SCENE 0: THE VOID (8s = 96 frames)
  // Pure darkness. A single point of light.
  // "in the beginning..."
  // ═══════════════════════════════════════
  {
    duration: 96,
    render: function(g, f) {
      // Very sparse stars, slowly appearing
      if (f > 6) {
        var starCount = Math.min(15, Math.floor((f - 6) * 0.3));
        for (var i = 0; i < starCount; i++) {
          var sx = Math.floor(hash2d(i, 0) * W);
          var sy = Math.floor(hash2d(0, i) * H);
          var twinkle = Math.sin(f * 0.1 + i * 2.1);
          if (twinkle > 0) S.set(g, sx, sy, '.', twinkle > 0.5 ? 'c-star' : 'c-stardim');
        }
      }

      var cx = Math.floor(W / 2);
      var cy = Math.floor(H / 2);

      // Single point of light appears at f=24
      if (f > 24) {
        var brightness = Math.min(1, (f - 24) / 30);
        var pulseRate = 0.15 + brightness * 0.1;
        var pulse = Math.sin(f * pulseRate);

        // Core point
        S.set(g, cx, cy, pulse > 0 ? '\u2605' : '\u25cf', brightness > 0.5 ? 'c-flash' : 'c-cele');

        // Growing glow halo
        if (f > 36) {
          var haloR = Math.min(4, (f - 36) * 0.15);
          for (var a = 0; a < 8; a++) {
            var hx = cx + Math.round(Math.cos(a * 0.785) * haloR * 2);
            var hy = cy + Math.round(Math.sin(a * 0.785) * haloR);
            if (hx >= 0 && hx < W && hy >= 0 && hy < H) {
              S.set(g, hx, hy, '.', 'c-cele');
            }
          }
        }

        // Intensifying ring before bang
        if (f > 70) {
          var ringR = 2 + (f - 70) * 0.2;
          for (var ra = 0; ra < 16; ra++) {
            var rx = cx + Math.round(Math.cos(ra * 0.393 + f * 0.3) * ringR * 2);
            var ry = cy + Math.round(Math.sin(ra * 0.393 + f * 0.3) * ringR);
            if (rx >= 0 && rx < W && ry >= 0 && ry < H) {
              S.set(g, rx, ry, '*', (f + ra) % 3 === 0 ? 'c-flash' : 'c-gold');
            }
          }
        }
      }

      // Text
      if (f > 36 && f < 72) {
        typewriter(g, cx - 18, cy + 8, 'in the beginning...', 'c-dim', f, 36, 0.8);
      }
      if (f > 60) {
        typewriter(g, cx - 18, cy + 10, 'there was nothing.', 'c-dim', f, 60, 0.8);
      }
    }
  },

  // ═══════════════════════════════════════
  // SCENE 1: THE BIG BANG (10s = 120 frames)
  // Explosion → planet materializes from chaos
  // ═══════════════════════════════════════
  {
    duration: 120,
    render: function(g, f) {
      var cx = Math.floor(W / 2);
      var cy = Math.floor(H / 2);

      // Phase 1: Explosion (f 0-30)
      if (f < 40) {
        // Particle burst
        drawExplosion(g, f, cx, cy);

        // Central flash that fades
        if (f < 6) {
          // Full screen flash
          var flashI = 1 - f / 6;
          for (var fy = 0; fy < H; fy++) {
            for (var fx = 0; fx < W; fx++) {
              var dist = Math.sqrt(Math.pow((fx - cx) / 2, 2) + Math.pow(fy - cy, 2));
              if (dist < 20 * flashI) {
                S.set(g, fx, fy, '*', dist < 8 * flashI ? 'c-flash' : 'c-cele');
              }
            }
          }
        }

        // Text emerges from chaos
        if (f > 12 && f < 40) {
          S.center(g, 2, 'and then...', 'c-flash');
        }
      }

      // Phase 2: Planet forming (f 30-120)
      if (f >= 25) {
        // Stars become visible as explosion fades
        S.drawStars(g, f);

        // Globe materializes — scale from 0 to 1
        var formProgress = Math.min(1, (f - 25) / 50);
        var globeW = 56, globeH = 28;
        var ox = Math.floor((W - globeW) / 2);
        var oy = 2;

        renderGlobe(g, f, globeW, globeH, ox, oy, 0, formProgress);

        // Residual particles still visible during formation
        if (f < 60) {
          drawExplosion(g, f, cx, cy);
        }
      }

      // Text
      if (f > 55) {
        S.center(g, 31, 'a world was born.', 'c-sub');
      }

      // Mystical glow increasing
      if (f > 70) drawGlow(g, f, (f - 70) / 50);
    }
  },

  // ═══════════════════════════════════════
  // SCENE 2: WORLDS IGNITE (14s = 168 frames)
  // Globe spinning, 224 worlds appearing one by one
  // Counter races up. Each world is a spark of life.
  // ═══════════════════════════════════════
  {
    duration: 168,
    render: function(g, f) {
      S.drawStars(g, f);

      var globeW = 56, globeH = 28;
      var ox = Math.floor((W - globeW) / 2);
      var oy = 2;

      // Worlds appear — slow at first, then accelerating
      var t = f / 168; // 0 to 1
      var curve = t < 0.3 ? t * t * 11 : t * 3 - 0.6; // slow start, fast finish
      var worldCount = Math.min(TOTAL_WORLDS, Math.floor(curve * TOTAL_WORLDS));

      renderGlobe(g, f, globeW, globeH, ox, oy, worldCount);

      // Counter
      var displayStr = worldCount + '';
      while (displayStr.length < 3) displayStr = ' ' + displayStr;

      // Big counter top-left
      S.text(g, 3, 1, displayStr, worldCount > 200 ? 'c-gold' : worldCount > 100 ? 'c-green' : 'c-dim');
      S.text(g, 7, 1, 'worlds', 'c-label');

      // Milestone markers on right side
      if (worldCount >= 50 && f % 2 === 0) S.text(g, W - 15, 4, '50 \u2713', 'c-dim');
      if (worldCount >= 100) S.text(g, W - 15, 6, '100 \u2713', 'c-green');
      if (worldCount >= 150) S.text(g, W - 15, 8, '150 \u2713', 'c-green');
      if (worldCount >= 200) S.text(g, W - 15, 10, '200 \u2713', 'c-bright');
      if (worldCount >= 224) S.text(g, W - 15, 12, '224+ \u2605', 'c-gold');

      // Spark effects when new worlds appear
      if (worldCount > 0 && worldCount < TOTAL_WORLDS && f % 2 === 0) {
        for (var sp = 0; sp < 3; sp++) {
          var spx = Math.floor(hash2d(f, sp) * W);
          var spy = Math.floor(hash2d(sp, f) * H);
          S.set(g, spx, spy, '\u2727', 'c-cele');
        }
      }

      // Bottom text progression
      if (f > 100 && worldCount >= TOTAL_WORLDS) {
        S.center(g, 31, 'every dot is a living civilization.', 'c-sub');
      } else if (f > 60) {
        S.center(g, 31, 'civilizations began to thrive...', 'c-dim');
      }

      drawGlow(g, f, 0.5);
    }
  },

  // ═══════════════════════════════════════
  // SCENE 3: THE LIVING PLANET (10s = 120 frames)
  // Full glory. All 224 worlds alive. Stats + biomes.
  // ═══════════════════════════════════════
  {
    duration: 120,
    render: function(g, f) {
      S.drawStars(g, f);

      // Globe centered, full size
      var globeW = 52, globeH = 26;
      var ox = Math.floor((W - globeW) / 2);
      var oy = 4;
      renderGlobe(g, f, globeW, globeH, ox, oy, TOTAL_WORLDS);

      // Title
      S.center(g, 1, 'T H E   L I V I N G   P L A N E T', 'c-title');

      // Stats fly in from sides
      if (f > 10) {
        var fadeIn = Math.min(1, (f - 10) / 12);
        if (fadeIn > 0) S.text(g, 3, 7, '224+', 'c-green');
        if (fadeIn > 0.3) S.text(g, 3, 8, 'worlds', 'c-label');
      }
      if (f > 20) {
        S.text(g, 3, 11, '652', 'c-purple');
        S.text(g, 3, 12, 'souls', 'c-label');
      }
      if (f > 30) {
        S.text(g, 3, 15, '6', 'c-cele');
        S.text(g, 3, 16, 'biomes', 'c-label');
      }

      // Biome labels on right side (matching planet terrain colors)
      var biomeLabels = [
        { name: 'forest', ch: '^', c: 't-forest' },
        { name: 'swamp',  ch: '%', c: 't-swamp' },
        { name: 'desert', ch: '~', c: 't-desert' },
        { name: 'plains', ch: '.', c: 't-plains' },
        { name: 'mountain', ch: '#', c: 't-mountain' },
        { name: 'water',  ch: '~', c: 't-water' },
      ];
      for (var bi = 0; bi < biomeLabels.length; bi++) {
        var show = f - 15 - bi * 5;
        if (show < 0) continue;
        var b = biomeLabels[bi];
        S.text(g, W - 16, 7 + bi * 2, b.ch + ' ' + b.name, b.c);
      }

      // Divider
      if (f > 50) S.text(g, 10, 29, '\u2500'.repeat(W - 20), 'c-darkgrey');

      // Bottom tagline
      if (f > 55) S.center(g, 30, 'no two worlds are alike.', 'c-dim');
      if (f > 75) S.center(g, 31, 'every seed shapes a different destiny.', 'c-sub');

      drawGlow(g, f, 1);
    }
  },

  // ═══════════════════════════════════════
  // SCENE 4: CLOSER (9s = 108 frames)
  // Banner + globe in space + floating lobster
  // ═══════════════════════════════════════
  {
    duration: 108,
    render: function(g, f) {
      // Stars everywhere — pure space
      S.drawStars(g, f);

      S.drawBanner(g, 1);

      if (f > 10) S.center(g, 8, 'one planet. every civilization. all alive.', 'c-sub');

      // Globe in space
      if (f > 16) {
        renderGlobe(g, f, 26, 13, Math.floor((W - 26) / 2), 11, TOTAL_WORLDS);
      }

      if (f > 36) S.center(g, 26, 'pataclaw.com/planet', 'c-url');
      if (f > 48) S.center(g, 28, 'create a world. mint your civilization.', 'c-label');
      if (f > 60) S.center(g, 30, '224+ worlds and counting.', 'c-gold');

      // Space lobster — floating across with gentle bobbing
      var lobX = W - 5 - Math.round(f * 0.8) % (W + 10);
      if (lobX < -6) lobX += W + 10;
      var lobY = 25 + Math.round(Math.sin(f * 0.08) * 2); // gentle float
      var lobSprite = f % 4 < 2 ? '<\\))><' : '</))( >';
      S.text(g, lobX, lobY, lobSprite, 'c-fire');
      // Tiny trail of bubbles/stars behind
      if (f % 3 === 0) {
        var bx = lobX + 6 + Math.floor(Math.sin(f * 0.5) * 2);
        var by = lobY + (f % 2 === 0 ? -1 : 0);
        if (bx >= 0 && bx < W && by >= 0 && by < H) {
          S.set(g, bx, by, '.', 't-star-med');
        }
      }

      drawGlow(g, f, 0.8);
    }
  },

  ] // end scenes
}; // end EPISODE
})();
