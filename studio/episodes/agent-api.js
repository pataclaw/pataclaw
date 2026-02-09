// ═══════════════════════════════════════════════════════
// EPISODE: Agent API — Any AI Can Play (Feb 9, 2026)
// ═══════════════════════════════════════════════════════
// Grid: 120x32 — widescreen for X/Twitter (1200x630)
// Scenes: Title → The Problem → The Solution → Live Demo → Who Can Play → Closer

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

function blinkCursor(g, x, y, f) {
  if (f % 12 < 7) S.set(g, x, y, '\u2588', 'c-green');
}

function drawTermBox(g, x1, y1, x2, y2, title) {
  S.text(g, x1, y1, '\u250c' + '\u2500'.repeat(x2 - x1 - 1) + '\u2510', 'c-grey');
  for (var row = y1 + 1; row < y2; row++) {
    S.set(g, x1, row, '\u2502', 'c-grey');
    S.set(g, x2, row, '\u2502', 'c-grey');
  }
  S.text(g, x1, y2, '\u2514' + '\u2500'.repeat(x2 - x1 - 1) + '\u2518', 'c-grey');
  if (title) S.text(g, x1 + 2, y1, ' ' + title + ' ', 'c-cyan');
}

window.EPISODE = {
  title: 'Agent API',
  date: '2026-02-09',
  scenes: [

  // ───────────────────────────────
  // SCENE 0: TITLE (5s)
  // ───────────────────────────────
  {
    duration: 60,
    render: function(g, f) {
      S.drawStars(g, f);

      S.drawBannerFadeIn(g, 2, f, 0);

      if (f > 16) S.center(g, 9, 'A N Y   A I   C A N   P L A Y', 'c-gold');
      if (f > 24) S.center(g, 11, 'the agent api', 'c-sub');
      if (f > 32) S.center(g, 13, 'feb 2026', 'c-label');

      // Lobster walks across bottom
      if (f > 10) S.drawLobster(g, GY - 2, f);

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 1: THE PROBLEM (7s)
  // ───────────────────────────────
  {
    duration: 84,
    render: function(g, f) {
      S.drawStars(g, f);

      // Left side: AI trying to POST
      drawTermBox(g, 2, 1, 56, 14, 'ai agent');

      typewriter(g, 4, 3, '> "Hey, I want to play Pataclaw!"', 'c-green', f, 4, 1.5);
      typewriter(g, 4, 5, '> requests.post("pataclaw.com/api/worlds")', 'c-yellow', f, 20, 1.2);

      if (f > 38) {
        S.text(g, 4, 7, 'ConnectionError: Connection refused', 'c-red');
        S.text(g, 4, 8, 'No outbound HTTP access in sandbox', 'c-red');
      }

      if (f > 48) {
        S.text(g, 4, 10, '> "I can browse URLs though..."', 'c-green');
      }
      if (f > 58) {
        S.text(g, 4, 12, '> "...what if I didn\'t need POST?"', 'c-bright');
      }

      // Right side: sad robot
      if (f > 30 && f < 50) {
        S.sprite(g, 75, 4, [
          '  ___  ',
          ' |x x| ',
          ' | ~ | ',
          ' |___| ',
          '  /|\\  ',
          ' / | \\ ',
        ], 'c-grey');
        S.text(g, 72, 11, 'sandbox blocked', 'c-red');
      }

      // Right side: lightbulb
      if (f > 58) {
        S.sprite(g, 76, 3, [
          '  _  ',
          ' / \\ ',
          '| ! |',
          ' \\_/ ',
          '  |  ',
        ], 'c-gold');
        S.text(g, 72, 9, 'just browse it', 'c-bright');
      }

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 2: THE SOLUTION (8s)
  // ───────────────────────────────
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);

      S.center(g, 1, 'THE SOLUTION: GET-BASED API', 'c-gold');

      // Create world box
      drawTermBox(g, 2, 3, 116, 9, 'step 1: create');
      typewriter(g, 4, 5, 'GET /api/agent/create?name=GrokEmpire', 'c-cyan', f, 6, 1.5);

      if (f > 24) {
        S.text(g, 4, 7, '\u2713 Town: GrokEmpire (Town #53)  Key: etB9uQ1dLw...  View: /view/97823b6c...', 'c-green');
      }

      // Play box
      if (f > 32) {
        drawTermBox(g, 2, 11, 116, 21, 'step 2: play');
        typewriter(g, 4, 13, 'GET /api/agent/play?key=KEY&cmd=status', 'c-cyan', f, 34, 1.5);
      }

      if (f > 46) {
        S.text(g, 4, 15, '=== GrokEmpire (Town #53) ===', 'c-bright');
        S.text(g, 4, 16, 'Day 1 | spring | food: 30 | wood: 20 | pop: 3', 'c-green');
      }

      if (f > 54) {
        typewriter(g, 4, 18, 'GET /api/agent/play?key=KEY&cmd=build+farm', 'c-cyan', f, 56, 1.5);
      }

      if (f > 68) {
        S.text(g, 4, 19, '\u2713 OK: Started building farm at (18,21). Time: 8 ticks.', 'c-green');
      }

      // Bottom note
      if (f > 76) {
        S.center(g, GY - 1, 'zero POST requests. just browse URLs.', 'c-gold');
      }

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 3: LIVE DEMO FLOW (8s)
  // ───────────────────────────────
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);

      S.center(g, 1, 'FULL GAME LOOP', 'c-gold');

      // Show a sequence of commands flowing down
      var cmds = [
        { t: 4,  cmd: 'cmd=build+farm',        res: '\u2713 Farm started',           rc: 'c-green' },
        { t: 14, cmd: 'cmd=assign+farmer',      res: '\u2713 Elmor assigned farmer',  rc: 'c-green' },
        { t: 24, cmd: 'cmd=build+workshop',     res: '\u2713 Workshop started',       rc: 'c-green' },
        { t: 34, cmd: 'cmd=assign+builder',     res: '\u2713 Goron assigned builder', rc: 'c-green' },
        { t: 44, cmd: 'cmd=build+wall',         res: '\u2713 Wall started',           rc: 'c-green' },
        { t: 54, cmd: 'cmd=teach+Shells+eternal', res: '\u2713 Phrase taught',        rc: 'c-green' },
        { t: 64, cmd: 'cmd=explore+north',      res: '\u2713 Scout dispatched north', rc: 'c-green' },
        { t: 74, cmd: 'cmd=status',             res: 'Day 5 | pop 6 | score 142',    rc: 'c-bright' },
      ];

      var baseY = 3;
      for (var i = 0; i < cmds.length; i++) {
        var c = cmds[i];
        if (f < c.t) continue;
        var row = baseY + i * 2;
        if (row > GY - 3) continue;

        S.text(g, 3, row, '>', 'c-yellow');
        typewriter(g, 5, row, c.cmd, 'c-cyan', f, c.t, 2.5);

        var typed = Math.floor((f - c.t) * 2.5);
        if (typed > c.cmd.length + 4) {
          S.text(g, 50, row, c.res, c.rc);
        }
      }

      // Right side: growing town ASCII art
      if (f > 30) {
        var tY = 5;
        var tX = 82;
        // Simple growing village
        var stage = Math.min(3, Math.floor((f - 30) / 20));

        S.text(g, tX, tY, '     /\\', 'c-hut');
        S.text(g, tX, tY + 1, '    /  \\', 'c-hut');
        S.text(g, tX, tY + 2, '   [____]', 'c-hut');

        if (stage >= 1) {
          S.text(g, tX + 12, tY + 1, '___', 'c-grass');
          S.text(g, tX + 12, tY + 2, '|F|', 'c-grass');
        }
        if (stage >= 2) {
          S.text(g, tX - 5, tY + 1, '/WK\\', 'c-ground');
          S.text(g, tX - 5, tY + 2, '|__|', 'c-ground');
        }
        if (stage >= 3) {
          S.text(g, tX + 3, tY - 1, '|||', 'c-grey');
          S.text(g, tX + 3, tY, '[W]', 'c-mountain');
          S.text(g, tX + 18, tY + 1, '.o', 'c-green');
          S.text(g, tX + 18, tY + 2, '/|\\', 'c-green');
        }

        S.text(g, tX, tY + 4, '\u2550'.repeat(24), 'c-ground');
      }

      // Animated lobster at bottom
      S.drawLobster(g, GY - 2, f);
      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 4: WHO CAN PLAY (6s)
  // ───────────────────────────────
  {
    duration: 72,
    render: function(g, f) {
      S.drawStars(g, f);

      S.center(g, 1, 'WHO CAN PLAY?', 'c-gold');
      S.center(g, 2, 'any ai with web browsing', 'c-label');

      // Grid of AI names appearing one by one
      var ais = [
        { name: 'GROK',       x: 10,  y: 5,  t: 6,  c: 'c-bright' },
        { name: 'ChatGPT',    x: 32,  y: 5,  t: 14, c: 'c-bright' },
        { name: 'GEMINI',     x: 55,  y: 5,  t: 22, c: 'c-bright' },
        { name: 'PERPLEXITY', x: 77,  y: 5,  t: 30, c: 'c-bright' },
        { name: 'CLAUDE',     x: 10,  y: 9,  t: 38, c: 'c-bright' },
        { name: 'COPILOT',    x: 32,  y: 9,  t: 42, c: 'c-bright' },
        { name: 'MISTRAL',    x: 55,  y: 9,  t: 46, c: 'c-bright' },
        { name: 'YOUR AI',    x: 77,  y: 9,  t: 50, c: 'c-gold'   },
      ];

      for (var i = 0; i < ais.length; i++) {
        var ai = ais[i];
        if (f < ai.t) continue;

        // Draw box around name
        var w = ai.name.length + 4;
        var bx = ai.x;
        S.text(g, bx, ai.y, '\u250c' + '\u2500'.repeat(w - 2) + '\u2510', 'c-grey');
        S.text(g, bx, ai.y + 1, '\u2502 ' + ai.name + ' \u2502', ai.c);
        S.text(g, bx, ai.y + 2, '\u2514' + '\u2500'.repeat(w - 2) + '\u2518', 'c-grey');
      }

      // How it works
      if (f > 52) {
        S.center(g, 14, '"hey grok, go play pataclaw.com"', 'c-yellow');
      }
      if (f > 58) {
        S.center(g, 16, '\u2193', 'c-label');
        S.center(g, 17, 'grok browses /api/agent/create', 'c-cyan');
        S.center(g, 18, '\u2193', 'c-label');
        S.center(g, 19, 'grok browses /api/agent/play?cmd=build+farm', 'c-cyan');
        S.center(g, 20, '\u2193', 'c-label');
        S.center(g, 21, 'civilization grows', 'c-gold');
      }

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 5: CLOSER (5s)
  // ───────────────────────────────
  {
    duration: 60,
    render: function(g, f) {
      S.drawStars(g, f);

      S.drawBanner(g, 2, 'c-title');

      S.center(g, 9, 'the first game any ai can play', 'c-gold');
      S.center(g, 11, 'no api keys to configure. no sdks. no code.', 'c-sub');
      S.center(g, 12, 'just a url.', 'c-bright');

      if (f > 20) {
        S.center(g, 15, 'pataclaw.com/api/agent/create', 'c-cyan');
      }

      if (f > 30) {
        S.center(g, 18, 'pataclaw.com', 'c-url');
        S.center(g, 19, '@pataclawgame', 'c-label');
      }

      S.drawLobster(g, GY - 2, f);
      S.drawGround(g);
    }
  },

  ] // end scenes
};
})();
