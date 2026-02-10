// ═══════════════════════════════════════════════════════
// EPISODE: Living World Update (Feb 10, 2026)
// ═══════════════════════════════════════════════════════
// Grid: 120x32 — widescreen for X/Twitter (1200x630)
// Scenes: Title → Resource Gathering → Social Births → Nomad Choice → Combat HP → Closer

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

function drawVillager(g, x, y, hat, eyes, body, color) {
  S.text(g, x, y,     hat, color);
  S.text(g, x, y + 1, '.---.', color);
  S.text(g, x, y + 2, '|' + eyes + '|', color);
  S.text(g, x, y + 3, '| _ |', color);
  S.text(g, x, y + 4, "'" + body + "'", color);
  S.text(g, x, y + 5, ' d b ', color);
}

function drawTree(g, x, y, depleted) {
  if (depleted) {
    S.text(g, x, y + 2, '_.', 'c-grey');
  } else {
    S.text(g, x, y,     '\\|/', 'c-tree');
    S.text(g, x, y + 1, '/|\\', 'c-tree');
    S.text(g, x + 1, y + 2, '|', 'c-ground');
  }
}

function drawRock(g, x, y, depleted) {
  if (depleted) {
    S.text(g, x, y, '[..]', 'c-grey');
  } else {
    S.text(g, x, y, '[##]', 'c-mountain');
  }
}

function drawFishSpot(g, x, y, depleted) {
  if (depleted) {
    S.text(g, x, y, '~~~~', 'c-grey');
  } else {
    S.text(g, x, y, '~><~', 'c-water');
  }
}

window.EPISODE = {
  title: 'Living World Update',
  date: '2026-02-10',
  audio: 'soundtrack.wav',
  scenes: [

  // ───────────────────────────────
  // SCENE 0: TITLE (6s)
  // ───────────────────────────────
  {
    duration: 72,
    render: function(g, f) {
      S.drawStars(g, f);

      S.drawBannerFadeIn(g, 2, f, 0);

      if (f > 16) S.center(g, 9, 'T H E   L I V I N G   W O R L D   U P D A T E', 'c-gold');
      if (f > 24) S.center(g, 11, 'resource nodes \u2022 social births \u2022 nomad encounters \u2022 combat hp', 'c-sub');
      if (f > 32) S.center(g, 13, 'feb 2026', 'c-label');

      if (f > 10) S.drawLobster(g, GY - 2, f);

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 1: RESOURCE GATHERING (10s)
  // ───────────────────────────────
  {
    duration: 120,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g);

      // Title
      S.center(g, 1, 'VISIBLE RESOURCE GATHERING', 'c-gold');
      S.center(g, 2, 'trees to chop \u2022 rocks to mine \u2022 fish to catch', 'c-label');

      // Workshop section (left)
      S.text(g, 5, 5, 'WORKSHOP', 'c-hut');
      S.sprite(g, 5, 6, ['/====\\', '|WORK|', '|    |', '|____|'], 'c-hut');

      // Trees near workshop
      var tree1Dep = f > 60;
      var tree2Dep = f > 80;
      var tree3Dep = f > 100;
      drawTree(g, 15, 7, tree1Dep);
      drawTree(g, 20, 6, tree2Dep);
      drawTree(g, 25, 7, tree3Dep);

      // Rocks near workshop
      var rock1Dep = f > 70;
      var rock2Dep = f > 90;
      drawRock(g, 16, 10, rock1Dep);
      drawRock(g, 22, 10, rock2Dep);

      // Builder chopping
      if (f > 20 && !tree1Dep) {
        var chopFrame = f % 6;
        var chopChars = ['/', '\u2014', '\\', '|', '/', '\u2014'];
        S.text(g, 12, 7, chopChars[chopFrame], 'c-fire');
        drawVillager(g, 11, 8, ' [B] ', 'o o', '===', 'c-hut');
        S.text(g, 10, 14, 'builder', 'c-hut');
        if (f > 30 && f % 18 < 10) S.drawBubble(g, 10, 4, '*CHOP*', 'c-fire');
      } else if (tree1Dep && f < 85) {
        drawVillager(g, 11, 8, ' [B] ', 'o o', '===', 'c-hut');
        S.text(g, 10, 14, 'builder', 'c-hut');
      }

      // Dock section (right)
      S.text(g, 65, 5, 'DOCK', 'c-water');
      S.sprite(g, 63, 6, [' .====.', ' | oo |', '~|____|~', '~~~~~~~~'], 'c-water');

      // Fish spots near dock
      var fish1Dep = f > 65;
      var fish2Dep = f > 85;
      var fish3Dep = f > 105;
      drawFishSpot(g, 75, 9, fish1Dep);
      drawFishSpot(g, 81, 9, fish2Dep);
      drawFishSpot(g, 87, 9, fish3Dep);

      // Fisherman
      if (f > 25 && !fish1Dep) {
        var fishFrame = f % 6;
        var rodChars = ['/', '|', '\\', '|', '/', '~'];
        S.text(g, 77, 7, rodChars[fishFrame], 'c-water');
        drawVillager(g, 75, 8, ' [F] ', '> <', '===', 'c-blue');
        S.text(g, 74, 14, 'fisher', 'c-blue');
        if (f > 35 && f % 20 < 10) S.drawBubble(g, 74, 4, 'big catch!', 'c-cyan');
      }

      // Labels
      if (f > 40) {
        S.text(g, 4, 16, 'nodes deplete as workers gather', 'c-dim');
        S.text(g, 4, 17, 'depleted nodes respawn over time', 'c-dim');
        S.text(g, 4, 18, 'no nodes = no production', 'c-dim');
      }

      // Respawn indicator
      if (tree1Dep && f > 100) {
        S.text(g, 15, 6, '\u21bb', 'c-bright');
        S.text(g, 14, 5, 'respawn!', 'c-bright');
      }

      // Counter
      if (f > 50) {
        var activeT = 3 - (tree1Dep ? 1 : 0) - (tree2Dep ? 1 : 0) - (tree3Dep ? 1 : 0);
        var activeR = 2 - (rock1Dep ? 1 : 0) - (rock2Dep ? 1 : 0);
        var activeF = 3 - (fish1Dep ? 1 : 0) - (fish2Dep ? 1 : 0) - (fish3Dep ? 1 : 0);
        S.text(g, 38, 16, 'trees: ' + activeT + '/3', activeT > 0 ? 'c-tree' : 'c-red');
        S.text(g, 38, 17, 'rocks: ' + activeR + '/2', activeR > 0 ? 'c-mountain' : 'c-red');
        S.text(g, 38, 18, 'fish:  ' + activeF + '/3', activeF > 0 ? 'c-water' : 'c-red');
      }
    }
  },

  // ───────────────────────────────
  // SCENE 2: SOCIAL BIRTHS (9s)
  // ───────────────────────────────
  {
    duration: 108,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g);

      S.center(g, 1, 'SOCIAL BIRTHS', 'c-gold');
      S.center(g, 2, 'new life from community, not randomness', 'c-label');

      // Before: random births (crossed out)
      if (f > 8) {
        S.text(g, 5, 5, 'BEFORE:', 'c-red');
        S.text(g, 5, 7, '  2% random chance per tick', 'c-grey');
        S.text(g, 5, 8, '  births happen for no reason', 'c-grey');
        S.text(g, 5, 9, '  no social context', 'c-grey');
        // Strike through
        if (f > 20) {
          for (var sx = 5; sx < 38; sx++) {
            S.set(g, sx, 7, '\u2500', 'c-red');
            S.set(g, sx, 8, '\u2500', 'c-red');
            S.set(g, sx, 9, '\u2500', 'c-red');
          }
        }
      }

      // After: social births
      if (f > 28) {
        S.text(g, 5, 12, 'NOW:', 'c-bright');
        typewriter(g, 5, 14, 'villagers must celebrate, feast, or socialize', 'c-green', f, 32, 1.5);
        typewriter(g, 5, 15, '2+ gathering = 5% \u2022 3+ = 10% \u2022 5+ = 15%', 'c-yellow', f, 44, 1.2);
        typewriter(g, 5, 16, 'molt festivals = massive bonus', 'c-cele', f, 55, 1.2);
      }

      // Animated celebration scene (right side)
      if (f > 35) {
        // Campfire
        var fireFrame = f % 4;
        var fireCh = ['^', '*', '#', '^'];
        S.text(g, 80, GY - 2, '(' + fireCh[fireFrame] + ')', 'c-fire');
        S.text(g, 79, GY - 1, '((' + fireCh[(fireFrame + 1) % 4] + '))', 'c-fire');

        // Celebrating villagers
        drawVillager(g, 68, GY - 8, '  ^  ', '^ ^', '===', 'c-cele');
        drawVillager(g, 76, GY - 8, ' \\o/ ', 'o o', '===', 'c-cele');
        drawVillager(g, 84, GY - 8, '  v  ', '> <', '===', 'c-cele');

        if (f % 24 < 12) S.drawBubble(g, 67, GY - 12, 'to us!', 'c-cele');
        else S.drawBubble(g, 82, GY - 12, 'feast!', 'c-cele');

        // New villager appears
        if (f > 75) {
          var newY = GY - 8 + Math.max(0, 5 - Math.floor((f - 75) / 3));
          if (newY <= GY - 8) {
            drawVillager(g, 92, GY - 8, ' NEW ', 'O O', '===', 'c-bright');
            S.text(g, 91, GY - 2, 'Krikkit', 'c-bright');
            if (f > 85) S.drawBubble(g, 90, GY - 12, 'i am born!', 'c-bright');
          } else {
            S.text(g, 93, newY, '?', 'c-bright');
          }
        }
      }

      // Feasting subtitle
      if (f > 60) {
        S.text(g, 5, 19, 'feasting = new activity!', 'c-fire');
        S.text(g, 5, 20, 'high food + social villagers = feast', 'c-dim');
      }
    }
  },

  // ───────────────────────────────
  // SCENE 3: NOMAD ENCOUNTERS (8s)
  // ───────────────────────────────
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g);

      S.center(g, 1, 'NOMAD ENCOUNTERS', 'c-gold');
      S.center(g, 2, 'your world, your rules', 'c-label');

      // Nomad camp scene
      if (f > 8) {
        // Campfire
        var fireFrame = f % 4;
        var fireCh = ['^', '*', '#', '+'];
        S.text(g, 35, GY - 3, '(' + fireCh[fireFrame] + ')', 'c-fire');
        S.text(g, 34, GY - 2, '((' + fireCh[(fireFrame + 1) % 4] + '))', 'c-fire');

        // Nomads
        drawVillager(g, 24, GY - 8, ' ~~~ ', '? ?', '---', 'c-desert');
        drawVillager(g, 32, GY - 8, ' ~~~ ', '> <', '---', 'c-desert');
        drawVillager(g, 40, GY - 8, ' ~~~ ', 'o o', '---', 'c-desert');

        S.text(g, 24, GY - 1, 'nomads camp while you\'re away', 'c-dim');
      }

      // Choice
      if (f > 40) {
        // Kill option (left)
        S.text(g, 8, 5, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-red');
        S.text(g, 8, 6, '\u2502  nomad kill           \u2502', 'c-red');
        S.text(g, 8, 7, '\u2502                        \u2502', 'c-red');
        S.text(g, 8, 8, '\u2502  slay and seize loot   \u2502', 'c-grey');
        S.text(g, 8, 9, '\u2502  +food +wood +stone    \u2502', 'c-bright');
        S.text(g, 8, 10, '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-red');

        // Evict option (right)
        S.text(g, 70, 5, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-cyan');
        S.text(g, 70, 6, '\u2502  nomad evict           \u2502', 'c-cyan');
        S.text(g, 70, 7, '\u2502                        \u2502', 'c-cyan');
        S.text(g, 70, 8, '\u2502  peacefully send away  \u2502', 'c-grey');
        S.text(g, 70, 9, '\u2502  mercy has its merits  \u2502', 'c-dim');
        S.text(g, 70, 10, '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-cyan');

        S.center(g, 12, 'OR', 'c-white');
      }

      // Flashing selection
      if (f > 70) {
        var sel = f % 24 < 12;
        if (sel) {
          S.text(g, 8, 5, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-flash');
          S.text(g, 8, 10, '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-flash');
        } else {
          S.text(g, 70, 5, '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510', 'c-flash');
          S.text(g, 70, 10, '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', 'c-flash');
        }
      }
    }
  },

  // ───────────────────────────────
  // SCENE 4: COMBAT HP BARS (7s)
  // ───────────────────────────────
  {
    duration: 84,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g);

      S.center(g, 1, 'COMBAT HP BARS', 'c-gold');
      S.center(g, 2, 'see the fight as it happens', 'c-label');

      // Two villagers fighting
      if (f > 8) {
        // Attacker
        var atkHp = Math.max(0.2, 1 - f * 0.005);
        drawBar(g, 32, GY - 10, 7, atkHp, atkHp > 0.6 ? 'c-bar' : atkHp > 0.3 ? 'c-barmid' : 'c-barhigh', 'c-grey');
        var atkFrame = f % 6;
        var atkSwing = ['!', '/', '|', '\\', '*', 'X'];
        S.text(g, 33, GY - 9, ' [W] ', 'c-red');
        S.text(g, 33, GY - 8, '.---.', 'c-red');
        S.text(g, 33, GY - 7, '|> <|', 'c-red');
        S.text(g, 33, GY - 6, '| ^ |' + atkSwing[atkFrame], 'c-red');
        S.text(g, 33, GY - 5, "'==='" + 'X', 'c-red');
        S.text(g, 33, GY - 4, atkFrame % 2 ? ' d  b ' : '  db  ', 'c-red');
        S.text(g, 33, GY - 3, 'Krusty', 'c-name1');

        // Defender
        var defHp = Math.max(0.1, 1 - f * 0.008);
        drawBar(g, 50, GY - 10, 7, defHp, defHp > 0.6 ? 'c-bar' : defHp > 0.3 ? 'c-barmid' : 'c-barhigh', 'c-grey');
        S.text(g, 51, GY - 9, ' [W] ', 'c-fire');
        S.text(g, 51, GY - 8, '.---.', 'c-fire');
        S.text(g, 51, GY - 7, '|o o|', 'c-fire');
        S.text(g, 51, GY - 6, '| _ |', 'c-fire');
        S.text(g, 51, GY - 5, "'==='", 'c-fire');
        S.text(g, 51, GY - 4, atkFrame % 2 ? '  db  ' : ' d  b ', 'c-fire');
        S.text(g, 51, GY - 3, 'Clawby', 'c-name3');

        // Fight effects
        if (f % 8 < 3) {
          var sparkX = 44 + (f % 3) - 1;
          var sparkY = GY - 7 + (f % 2);
          S.set(g, sparkX, sparkY, '*', 'c-flash');
          S.set(g, sparkX + 1, sparkY - 1, '+', 'c-flash');
        }
      }

      // Labels
      if (f > 30) {
        S.text(g, 70, GY - 9, 'HP bars visible during:', 'c-dim');
        S.text(g, 72, GY - 7, '\u2022 fighting', 'c-red');
        S.text(g, 72, GY - 6, '\u2022 sparring', 'c-fire');
        S.text(g, 70, GY - 4, 'color changes with health:', 'c-dim');
        drawBar(g, 72, GY - 3, 5, 0.9, 'c-bar', 'c-grey');
        S.text(g, 80, GY - 3, 'high', 'c-bar');
        drawBar(g, 72, GY - 2, 5, 0.5, 'c-barmid', 'c-grey');
        S.text(g, 80, GY - 2, 'mid', 'c-barmid');
        drawBar(g, 72, GY - 1, 5, 0.2, 'c-barhigh', 'c-grey');
        S.text(g, 80, GY - 1, 'low', 'c-barhigh');
      }
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

      if (f > 16) S.center(g, 10, 'the world breathes', 'c-gold');
      if (f > 24) S.center(g, 12, 'gather \u2022 celebrate \u2022 fight \u2022 grow', 'c-sub');

      if (f > 36) {
        S.center(g, 16, 'trees grow back \u2022 fish return \u2022 babies are born from joy', 'c-dim');
        S.center(g, 17, 'nomads camp in your absence \u2022 combat shows the stakes', 'c-dim');
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
