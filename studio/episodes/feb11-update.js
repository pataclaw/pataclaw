// ═══════════════════════════════════════════════════════
// EPISODE: Feb 11 Update — Tiers, Fog & Coastlines
// ═══════════════════════════════════════════════════════
// Grid: 120x32 — widescreen for X/Twitter (1200x630)
// Scenes: Title → Building Tiers → Fog of War → Coastline Discovery → Closer

(function() {
var S = window.STUDIO;
S.W = 120; S.H = 32; S.GY = 24;
var GY = S.GY;

// ─── Helpers ───
function typewriter(g, x, y, text, c, f, startF, speed) {
  speed = speed || 2;
  var chars = Math.max(0, Math.floor((f - startF) * speed));
  if (chars <= 0) return;
  S.text(g, x, y, text.slice(0, chars), c);
}

function drawBar(g, x, y, w, pct, fullC, emptyC) {
  S.set(g, x, y, '[', 'c-grey');
  var filled = Math.round(pct * w);
  for (var i = 0; i < w; i++) {
    S.set(g, x + 1 + i, y, i < filled ? '\u2588' : '\u2591', i < filled ? fullC : emptyC);
  }
  S.set(g, x + w + 1, y, ']', 'c-grey');
}

function drawHut(g, x, y) {
  S.text(g, x, y,     '  /\\  ', 'c-hut');
  S.text(g, x, y + 1, ' /  \\ ', 'c-hut');
  S.text(g, x, y + 2, '|    |', 'c-hut');
  S.text(g, x, y + 3, '|____|', 'c-hut');
}

function drawHouse(g, x, y) {
  S.text(g, x, y,     '  /==\\  ', 'c-lodge');
  S.text(g, x, y + 1, ' / == \\ ', 'c-lodge');
  S.text(g, x, y + 2, '|[  ][]|', 'c-lodge');
  S.text(g, x, y + 3, '|[  ]__|', 'c-lodge');
  S.text(g, x, y + 4, '|______|', 'c-lodge');
}

function drawLodge(g, x, y) {
  S.text(g, x, y,     '  /====\\  ', 'c-fire');
  S.text(g, x, y + 1, ' /======\\ ', 'c-fire');
  S.text(g, x, y + 2, '|[][  ][]|', 'c-fire');
  S.text(g, x, y + 3, '|[]    []|', 'c-fire');
  S.text(g, x, y + 4, '|[][__][]|', 'c-fire');
  S.text(g, x, y + 5, '|________|', 'c-fire');
}

function drawTowerBlock(g, x, y, f) {
  S.text(g, x, y,     '  .-==-.  ', 'c-gold');
  S.text(g, x, y + 1, ' /|    |\\ ', 'c-gold');
  S.text(g, x, y + 2, '|[|    |]|', 'c-gold');
  S.text(g, x, y + 3, '|[| == |]|', 'c-gold');
  S.text(g, x, y + 4, '|[|    |]|', 'c-gold');
  S.text(g, x, y + 5, '|[| == |]|', 'c-gold');
  S.text(g, x, y + 6, '|[|____|]|', 'c-gold');
  S.text(g, x, y + 7, '|________|', 'c-gold');
  // Roof guard
  var guardFrame = f % 12;
  if (guardFrame < 6) {
    S.text(g, x + 3, y - 1, 'd_b', 'c-red');
  } else {
    S.text(g, x + 5, y - 1, 'd_b', 'c-red');
  }
}

function drawScout(g, x, y, f) {
  var legFrame = f % 4;
  S.text(g, x, y,     ' [S] ', 'c-cyan');
  S.text(g, x, y + 1, '.---.', 'c-cyan');
  S.text(g, x, y + 2, '|> <|', 'c-cyan');
  S.text(g, x, y + 3, '| o |', 'c-cyan');
  S.text(g, x, y + 4, "'==='", 'c-cyan');
  S.text(g, x, y + 5, legFrame < 2 ? ' d  b' : '  db ', 'c-cyan');
}

function drawDock(g, x, y) {
  S.text(g, x, y,     ' .====. ', 'c-hut');
  S.text(g, x, y + 1, ' | oo | ', 'c-hut');
  S.text(g, x, y + 2, '~|____|~', 'c-water');
  S.text(g, x, y + 3, '~~~~~~~~', 'c-water');
}

function drawWater(g, x, y, w, f) {
  for (var i = 0; i < w; i++) {
    var wave = (f + i * 3) % 8;
    var ch = wave < 2 ? '~' : wave < 4 ? '\u2248' : wave < 6 ? '~' : '\u223c';
    S.set(g, x + i, y, ch, 'c-water');
  }
}

function drawFog(g, x, y, w, h, f) {
  for (var fy = y; fy < y + h && fy < S.H; fy++) {
    for (var fx = x; fx < x + w && fx < S.W; fx++) {
      var noise = ((fx * 31 + fy * 17 + f * 3) % 100);
      if (noise < 70) {
        S.set(g, fx, fy, '\u2591', 'c-darkgrey');
      } else {
        S.set(g, fx, fy, '\u2592', 'c-grey');
      }
    }
  }
}

window.EPISODE = {
  title: 'Feb 11 Update',
  date: '2026-02-11',
  scenes: [

  // ───────────────────────────────
  // SCENE 0: TITLE (6s)
  // ───────────────────────────────
  {
    duration: 72,
    render: function(g, f) {
      S.drawStars(g, f);

      S.drawBannerFadeIn(g, 2, f, 0);

      if (f > 16) S.center(g, 9, 'F E B   1 1   U P D A T E', 'c-gold');
      if (f > 24) S.center(g, 11, 'building tiers \u2022 fog of war \u2022 coastline discovery', 'c-sub');
      if (f > 32) S.center(g, 13, '22 commits \u2022 one day', 'c-label');

      if (f > 10) S.drawLobster(g, GY - 2, f);

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 1: BUILDING TIERS (10s)
  // ───────────────────────────────
  {
    duration: 120,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g);

      S.center(g, 1, 'BUILDING TIERS', 'c-gold');
      S.center(g, 2, 'huts evolve as your village grows', 'c-label');

      // Phase 1: show hut
      if (f > 8 && f < 40) {
        drawHut(g, 12, GY - 6);
        S.text(g, 12, GY - 7, 'L1: HUT', 'c-hut');
        S.text(g, 12, GY - 1, 'cap: 3', 'c-dim');
      }

      // Phase 2: upgrade arrow + house
      if (f >= 40 && f < 65) {
        drawHut(g, 8, GY - 6);
        S.text(g, 8, GY - 7, 'L1: HUT', 'c-hut');
        S.text(g, 16, GY - 4, '\u2500\u2500\u25b6', 'c-bright');
        drawHouse(g, 21, GY - 7);
        S.text(g, 21, GY - 8, 'L2: HOUSE', 'c-lodge');
        S.text(g, 21, GY - 1, 'cap: 6', 'c-dim');
      }

      // Phase 3: full chain
      if (f >= 65) {
        // Hut
        drawHut(g, 4, GY - 6);
        S.text(g, 4, GY - 7, 'L1', 'c-hut');
        S.text(g, 4, GY - 1, '3 pop', 'c-dim');

        S.text(g, 11, GY - 4, '\u25b6', 'c-bright');

        // House
        drawHouse(g, 15, GY - 7);
        S.text(g, 15, GY - 8, 'L2', 'c-lodge');
        S.text(g, 15, GY - 1, '6 pop', 'c-dim');

        S.text(g, 25, GY - 4, '\u25b6', 'c-bright');

        // Lodge
        drawLodge(g, 29, GY - 8);
        S.text(g, 29, GY - 9, 'L3', 'c-fire');
        S.text(g, 29, GY - 1, '10 pop', 'c-dim');

        S.text(g, 41, GY - 4, '\u25b6', 'c-bright');

        // Tower block
        drawTowerBlock(g, 45, GY - 10, f);
        S.text(g, 45, GY - 12, 'L4', 'c-gold');
        S.text(g, 45, GY - 1, '16 pop', 'c-dim');
      }

      // Labels (right side)
      if (f > 50) {
        S.text(g, 65, 5, 'MAX 3 BUILDINGS', 'c-bright');
        typewriter(g, 65, 7, 'upgrade replaces hut cap:', 'c-dim', f, 55, 1.5);
        typewriter(g, 65, 9, 'hut \u2192 house \u2192 lodge \u2192 tower block', 'c-green', f, 60, 1.2);
      }

      if (f > 75) {
        S.text(g, 65, 12, 'ROOF GUARDS', 'c-red');
        typewriter(g, 65, 13, 'warriors patrol tower rooftops', 'c-dim', f, 80, 1.5);
        typewriter(g, 65, 14, 'visible in the viewer', 'c-dim', f, 88, 1.5);
      }

      if (f > 95) {
        S.text(g, 65, 17, 'GOVERNOR AUTO-UPGRADES', 'c-cele');
        typewriter(g, 65, 18, 'towns grow smarter on their own', 'c-dim', f, 100, 1.5);
      }
    }
  },

  // ───────────────────────────────
  // SCENE 2: FOG OF WAR (9s)
  // ───────────────────────────────
  {
    duration: 108,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g);

      S.center(g, 1, 'FOG OF WAR', 'c-gold');
      S.center(g, 2, 'pannable viewport \u2022 only see what scouts explore', 'c-label');

      // Draw a mini map with fog
      var mapX = 10, mapY = 5, mapW = 40, mapH = 16;

      // "Explored" terrain (revealed area expands with f)
      var revealRadius = Math.min(18, Math.floor(f / 4));
      var cx = mapX + 12, cy = mapY + 8;

      for (var my = mapY; my < mapY + mapH; my++) {
        for (var mx = mapX; mx < mapX + mapW; mx++) {
          var dx = mx - cx, dy = my - cy;
          var dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < revealRadius) {
            // Explored terrain
            var noise = ((mx * 47 + my * 31) % 100);
            if (noise < 20) {
              S.set(g, mx, my, '~', 'c-water');
            } else if (noise < 40) {
              S.set(g, mx, my, '\u2663', 'c-tree');
            } else if (noise < 55) {
              S.set(g, mx, my, '.', 'c-grass');
            } else if (noise < 65) {
              S.set(g, mx, my, '^', 'c-mountain');
            } else {
              S.set(g, mx, my, ',', 'c-grass');
            }
          } else {
            // Fog
            var fogN = ((mx * 31 + my * 17 + f * 2) % 100);
            S.set(g, mx, my, fogN < 60 ? '\u2591' : '\u2592', 'c-darkgrey');
          }
        }
      }

      // Town center in explored area
      S.text(g, cx - 1, cy - 1, '[TC]', 'c-cele');

      // Scout at fog edge
      if (f > 20) {
        var scoutAngle = (f * 0.08);
        var sx = Math.round(cx + Math.cos(scoutAngle) * (revealRadius - 1));
        var sy = Math.round(cy + Math.sin(scoutAngle) * (revealRadius - 1) * 0.6);
        if (sx > mapX && sx < mapX + mapW - 2 && sy > mapY && sy < mapY + mapH) {
          S.set(g, sx, sy, 'S', 'c-cyan');
          // Revealing particles
          if (f % 3 === 0) S.set(g, sx + 1, sy, '*', 'c-bright');
        }
      }

      // Map border
      for (var bx = mapX - 1; bx <= mapX + mapW; bx++) {
        S.set(g, bx, mapY - 1, '\u2500', 'c-grey');
        S.set(g, bx, mapY + mapH, '\u2500', 'c-grey');
      }
      for (var by = mapY; by < mapY + mapH; by++) {
        S.set(g, mapX - 1, by, '\u2502', 'c-grey');
        S.set(g, mapX + mapW, by, '\u2502', 'c-grey');
      }

      // Labels (right side)
      if (f > 15) {
        S.text(g, 58, 6, 'PANNABLE VIEWPORT', 'c-bright');
        typewriter(g, 58, 8, 'drag to scroll across the map', 'c-dim', f, 20, 1.5);
      }
      if (f > 35) {
        S.text(g, 58, 11, 'FOG OF WAR', 'c-bright');
        typewriter(g, 58, 13, 'unexplored tiles hidden in fog', 'c-dim', f, 40, 1.5);
        typewriter(g, 58, 14, 'scouts reveal the world', 'c-cyan', f, 48, 1.5);
      }
      if (f > 60) {
        S.text(g, 58, 17, 'WATCHTOWER BONUS', 'c-cele');
        typewriter(g, 58, 19, 'towers extend visible range', 'c-dim', f, 65, 1.5);
      }

      // Exploration % counter
      if (f > 10) {
        var pct = Math.min(100, Math.floor((revealRadius * revealRadius * 3.14) / (mapW * mapH) * 100));
        S.text(g, mapX, mapY + mapH + 1, 'explored: ' + pct + '%', pct > 50 ? 'c-bright' : 'c-dim');
      }
    }
  },

  // ───────────────────────────────
  // SCENE 3: COASTLINE DISCOVERY (9s)
  // ───────────────────────────────
  {
    duration: 108,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g);

      S.center(g, 1, 'COASTLINE DISCOVERY', 'c-gold');
      S.center(g, 2, 'scouts must find the sea before you build a dock', 'c-label');

      // Phase 1: Scout walking toward water (f < 50)
      // Land terrain
      for (var tx = 5; tx < 60; tx++) {
        for (var ty = 8; ty < GY; ty++) {
          var n = ((tx * 47 + ty * 31) % 100);
          if (n < 30) S.set(g, tx, ty, ',', 'c-grass');
          else if (n < 40) S.set(g, tx, ty, '.', 'c-grass');
        }
      }

      // Water (right side)
      for (var wy = 8; wy < GY; wy++) {
        for (var wx = 60; wx < 100; wx++) {
          var wv = (f + wx * 3 + wy * 7) % 8;
          var wch = wv < 2 ? '~' : wv < 4 ? '\u2248' : wv < 6 ? '~' : '\u223c';
          S.set(g, wx, wy, wch, 'c-water');
        }
      }

      // Shoreline
      for (var sy = 8; sy < GY; sy++) {
        var shore = 59 + ((sy * 7) % 3) - 1;
        S.set(g, shore, sy, '.', 'c-desert');
        S.set(g, shore + 1, sy, '.', 'c-desert');
      }

      // Scout walking toward shore
      var scoutX = Math.min(50, 10 + Math.floor(f * 0.8));
      if (f < 55) {
        drawScout(g, scoutX, GY - 8, f);
        if (f > 10 && f % 18 < 10) {
          S.drawBubble(g, scoutX - 2, GY - 12, 'exploring...', 'c-cyan');
        }
      }

      // Phase 2: Reaches shore — event fires! (f >= 55)
      if (f >= 55) {
        drawScout(g, 51, GY - 8, f);

        // Flash effect
        if (f >= 55 && f < 65) {
          var flashIntensity = 1 - (f - 55) / 10;
          if (flashIntensity > 0.5) {
            for (var fy = 0; fy < S.H; fy++) {
              for (var fx = 45; fx < 70; fx++) {
                if (Math.random() < flashIntensity * 0.3) {
                  S.set(g, fx, fy, '*', 'c-flash');
                }
              }
            }
          }
        }

        // Event notification
        if (f >= 60) {
          var boxX = 20, boxY = 5;
          S.text(g, boxX, boxY,     '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-cele');
          S.text(g, boxX, boxY + 1, '\u2502                                   \u2502', 'c-cele');
          S.text(g, boxX, boxY + 2, '\u2502  COASTLINE DISCOVERED!            \u2502', 'c-cele');
          S.text(g, boxX, boxY + 3, '\u2502                                   \u2502', 'c-cele');
          S.text(g, boxX, boxY + 4, '\u2502  a dock can now be built          \u2502', 'c-bright');
          S.text(g, boxX, boxY + 5, '\u2502  to harvest the sea               \u2502', 'c-dim');
          S.text(g, boxX, boxY + 6, '\u2502                                   \u2502', 'c-cele');
          S.text(g, boxX, boxY + 7, '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-cele');
        }

        // Dock appears near water
        if (f >= 80) {
          drawDock(g, 53, GY - 6);
          S.text(g, 53, GY - 7, 'DOCK', 'c-water');
        }
      }

      // Rules (right side)
      if (f > 20) {
        S.text(g, 75, 5, 'DOCK RULES:', 'c-bright');
      }
      if (f > 30) {
        typewriter(g, 75, 7, '\u2022 scouts must find water', 'c-cyan', f, 30, 1.5);
      }
      if (f > 45) {
        typewriter(g, 75, 9, '\u2022 desert/mountain worlds', 'c-dim', f, 45, 1.5);
        typewriter(g, 75, 10, '  can\'t build docks', 'c-red', f, 50, 1.5);
      }
      if (f > 70) {
        typewriter(g, 75, 12, '\u2022 docks placed near water', 'c-water', f, 70, 1.5);
        typewriter(g, 75, 13, '  not in town center', 'c-dim', f, 78, 1.5);
      }
      if (f > 85) {
        typewriter(g, 75, 15, '\u2022 landlocked docks decay', 'c-fire', f, 85, 1.5);
      }
    }
  },

  // ───────────────────────────────
  // SCENE 4: WAR TEASE (6s)
  // ───────────────────────────────
  {
    duration: 72,
    render: function(g, f) {
      // Pure black for drama
      S.drawStars(g, f);

      // Slow fade in from black — warriors emerge from darkness
      var fadeIn = Math.min(1, f / 24);

      if (fadeIn > 0.1) {
        // Left army (red)
        var leftX = 10;
        var armyY = GY - 8;

        // Warriors marching in from left
        var marchL = Math.min(0, -15 + Math.floor(f * 0.6));
        for (var i = 0; i < 5; i++) {
          var wx = leftX + marchL + i * 6;
          if (wx < 0 || wx > 50) continue;
          var legF = (f + i * 3) % 4;
          S.text(g, wx, armyY,     ' [W] ', 'c-red');
          S.text(g, wx, armyY + 1, '.---.', 'c-red');
          S.text(g, wx, armyY + 2, '|> <|', 'c-red');
          S.text(g, wx, armyY + 3, '|/=\\|', 'c-red');
          S.text(g, wx, armyY + 4, "'==='" , 'c-red');
          S.text(g, wx, armyY + 5, legF < 2 ? ' d  b' : '  db ', 'c-red');
        }

        // Right army (fire/orange) — mirrored
        for (var j = 0; j < 5; j++) {
          var rx = 105 - marchL - j * 6;
          if (rx > 119 || rx < 60) continue;
          var legR = (f + j * 3 + 2) % 4;
          S.text(g, rx, armyY,     ' [W] ', 'c-fire');
          S.text(g, rx, armyY + 1, '.---.', 'c-fire');
          S.text(g, rx, armyY + 2, '|< >|', 'c-fire');
          S.text(g, rx, armyY + 3, '|\\=/|', 'c-fire');
          S.text(g, rx, armyY + 4, "'===' ", 'c-fire');
          S.text(g, rx, armyY + 5, legR < 2 ? 'd  b ' : ' db  ', 'c-fire');
        }
      }

      // VS in the center — dramatic pulse
      if (f > 24) {
        var pulse = Math.sin(f * 0.3) * 0.5 + 0.5;
        var vsC = pulse > 0.5 ? 'c-flash' : 'c-red';
        S.center(g, 10, 'V S', vsC);
      }

      // Clash sparks when armies close
      if (f > 40) {
        var sparkChars = ['*', '+', 'X', '#', '!'];
        for (var si = 0; si < 4; si++) {
          var spX = 57 + ((f * 7 + si * 13) % 7) - 3;
          var spY = armyY + ((f * 3 + si * 11) % 5);
          if (f % 3 !== si % 3) continue;
          S.set(g, spX, spY, sparkChars[(f + si) % sparkChars.length], 'c-flash');
        }
      }

      // "WAR IS COMING" text — typewriter
      if (f > 30) {
        var warText = 'W A R   I S   C O M I N G';
        var chars = Math.max(0, Math.floor((f - 30) * 1.5));
        var shown = warText.slice(0, chars);
        S.center(g, 5, shown, 'c-red');
      }

      if (f > 50) {
        S.center(g, 7, 'towns will fight \u2022 warriors will fall', 'c-dim');
      }

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 5: CLOSER (7s)
  // ───────────────────────────────
  {
    duration: 84,
    render: function(g, f) {
      S.drawStars(g, f);

      S.drawBannerFadeIn(g, 3, f, 0);

      if (f > 16) S.center(g, 10, 'towns grow up \u2022 worlds open up', 'c-gold');
      if (f > 24) S.center(g, 12, 'upgrade \u2022 explore \u2022 discover \u2022 fight', 'c-sub');

      if (f > 36) {
        S.center(g, 16, 'huts become towers \u2022 fog hides the unknown', 'c-dim');
        S.center(g, 17, 'scouts find the coast \u2022 war is on the horizon', 'c-dim');
      }

      if (f > 48) {
        S.center(g, 20, 'p a t a c l a w . c o m', 'c-bright');
        S.center(g, 22, 'play free \u2022 mint your world as nft', 'c-label');
      }

      if (f > 10) S.drawLobster(g, GY - 2, f);
      S.drawGround(g);
    }
  },

  ],
};
})();
