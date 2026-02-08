// ═══════════════════════════════════════════════════════
// EPISODE: Wildlife Update — Feb 8, 2026
// ═══════════════════════════════════════════════════════
// Scenes: Title → Wildlife → The Hunt → Biome Economy → Items → Closer

(function() {
var S = window.STUDIO;
var GY = S.GY;

window.EPISODE = {
  title: 'Wildlife Update',
  date: '2026-02-08',
  scenes: [

  // ───────────────────────────────
  // SCENE 0: TITLE CARD (4s)
  // ───────────────────────────────
  {
    duration: 48,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawBannerFadeIn(g, 16, f, 0);

      if (f > 20) S.center(g, 24, 'W I L D L I F E   U P D A T E', 'c-sub');
      if (f > 28) S.center(g, 27, 'feb 2026', 'c-label');

      // Critters walk in from sides
      if (f > 15) {
        var deerX = Math.round(5 + (f - 15) * 0.5);
        if (deerX < S.W - 10) {
          S.sprite(g, deerX, GY - 4, [
            '  /|  ',
            ' / | d',
            '(  |/ ',
            ' \\-+  ',
            f % 4 < 2 ? '  /\\  ' : '  \\/  ',
          ], 'c-deer');
        }
        var wyrmX = S.W - 5 - Math.round((f - 15) * 0.3);
        if (wyrmX > 0 && wyrmX < S.W - 6) {
          S.sprite(g, wyrmX, GY - 3, [
            ' /\\_/\\',
            '<@  @>',
            ' \\~~/ ',
          ], 'c-wyrm');
        }
      }

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 1: WILDLIFE ROAMING (8s)
  // ───────────────────────────────
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);
      S.center(g, 3, '[ WILDLIFE ]', 'c-title');
      S.center(g, 5, '35+ species across 7 biomes', 'c-label');

      var stripH = 12;

      // ── Forest strip ──
      var fy = 10;
      S.text(g, 2, fy, 'FOREST', 'c-tree');
      for (var x = 0; x < S.W; x++) S.set(g, x, fy + stripH - 1, '\u2550', 'c-tree');
      S.sprite(g, 5, fy + 2, ['  /\\  ', ' /  \\ ', '/    \\', '  ||  '], 'c-tree');
      S.sprite(g, 18, fy + 3, [' /\\ ', '/  \\', ' || '], 'c-tree');
      S.sprite(g, 55, fy + 2, ['  /\\  ', ' /  \\ ', '/    \\', '  ||  '], 'c-tree');

      // Shell deer
      var deerX = (f * 0.6) % (S.W + 10) - 5;
      S.sprite(g, Math.round(deerX), fy + 5, [
        '  /|  ', ' / | d', '(  |/ ', ' \\-+  ',
        f % 4 < 2 ? '  /\\  ' : '  \\/  ',
      ], 'c-deer');
      S.text(g, Math.round(deerX) - 1, fy + 4, 'shell deer', 'c-label');

      // Ancient stag (rare)
      if (f > 30) {
        var stagX = S.W - 15 - Math.round((f - 30) * 0.3);
        if (stagX > 25 && stagX < S.W - 10) {
          S.sprite(g, stagX, fy + 4, [
            ' \\|/|/ ', '  /|   ', ' / | d ', '(  |/  ',
            ' \\-+   ', f % 3 ? '  /\\   ' : '  \\/   ',
          ], f % 6 < 3 ? 'c-cele' : 'c-gold');
          S.text(g, stagX - 1, fy + 3, '\u2605 ancient stag', 'c-gold');
        }
      }

      // ── Ice strip ──
      var iy = fy + stripH + 1;
      S.text(g, 2, iy, 'ICE', 'c-ice');
      for (var x2 = 0; x2 < S.W; x2++) S.set(g, x2, iy + stripH - 1, '\u2550', 'c-ice');
      S.sprite(g, 8, iy + 3, [' /\\ ', '/ /\\', '\\ \\/', ' \\/ '], 'c-ice');
      S.sprite(g, 50, iy + 2, ['  /\\  ', ' /  \\ ', '|    |', ' \\  / ', '  \\/  '], 'c-ice');

      var hareX = S.W - 5 - (f * 0.8) % (S.W + 10);
      if (hareX < -5) hareX += S.W + 10;
      S.sprite(g, Math.round(hareX), iy + 6, [
        ' (\\ /) ', ' ( . .)', ' (") (")',
      ], 'c-ice');
      S.text(g, Math.round(hareX) - 1, iy + 5, 'frost hare', 'c-label');

      // Frost wyrm (legendary!)
      if (f > 40) {
        var wx = 20 + Math.round(Math.sin(f * 0.08) * 8);
        S.sprite(g, wx, iy + 3, [
          '  __/\\_/\\__  ', ' / <@  @> \\ ',
          '( ~~~\\/~~~ )', ' \\_/\\/\\/\\_/ ',
        ], f % 4 < 2 ? 'c-wyrm' : 'c-flash');
        S.text(g, wx + 1, iy + 2, '\u2605 FROST WYRM \u2605', 'c-gold');
      }

      // ── Desert strip ──
      var dy = iy + stripH + 1;
      S.text(g, 2, dy, 'DESERT', 'c-desert');
      for (var x3 = 0; x3 < S.W; x3++) S.set(g, x3, dy + stripH - 2, '\u2550', 'c-desert');
      S.sprite(g, 12, dy + 3, ['  | ', ' -+- ', '  | ', '  | '], 'c-grass');
      S.sprite(g, 45, dy + 4, [' | ', '-+- ', ' | '], 'c-grass');

      var drakeX = 25 + Math.round(Math.sin(f * 0.06) * 15);
      var drakeY = dy + 2 + Math.round(Math.sin(f * 0.1) * 2);
      S.sprite(g, drakeX, drakeY, [
        '  __/\\/\\   ', ' / (*)(*)  ', '<  ~~~~~ > ',
        ' \\_/\\/\\/   ',
        f % 6 < 3 ? ' ~~ ^^ ~~  ' : '  ^^ ~~ ^^ ',
      ], 'c-drake');
      S.text(g, drakeX + 1, drakeY - 1, '\u2605 sun drake', 'c-gold');
    }
  },

  // ───────────────────────────────
  // SCENE 2: THE HUNT (8s)
  // ───────────────────────────────
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g, 'c-tree');
      S.center(g, 3, '[ THE HUNT ]', 'c-title');

      // Hunting lodge
      S.sprite(g, 3, GY - 8, [
        '  /\\>=>   ', ' /  \\___  ', '/====\\  | ',
        '|[><]|--| ', '| /\\ |  | ', '|/  \\|__| ', '|___[]__| ',
      ], 'c-lodge');
      S.text(g, 3, GY - 9, 'HUNTING LODGE', 'c-label');

      var hunterX, animalX = 50;

      if (f < 25) {
        hunterX = 15 + Math.round(f * 0.8);
        S.sprite(g, hunterX, GY - 6, [
          '  >=>  ', ' .---. ', '| o_o |', '|  >  |',
          "'-+-+' ", f % 4 < 2 ? ' d  b ' : '  db  ',
        ], 'c-hunt');
        if (f > 10) S.drawBubble(g, hunterX - 2, GY - 10, 'tracking...', 'c-hunt');
      } else if (f < 40) {
        hunterX = 35;
        S.sprite(g, hunterX, GY - 6, [
          '  >=>  ', ' .---. ', '| O_O |', '|  >  |',
          "'-+-+'|)", ' d   b ',
        ], 'c-hunt');
        S.sprite(g, animalX, GY - 7, [
          '  /\\  /\\ ', ' |  \\/  |', ' | (@@) |',
          '  \\ ~~ / ', '   \\  /  ', '    \\/   ',
        ], f % 4 < 2 ? 'c-purple' : 'c-blue');
        S.text(g, animalX - 1, GY - 8, '\u2605 PEAK WYRM', 'c-gold');
        if (f > 30) S.drawBubble(g, hunterX - 3, GY - 10, 'legendary!!', 'c-gold');
      } else if (f < 65) {
        hunterX = 40;
        var cf = (f - 40) % 8;
        var sw = ['|)>', '/)', '|)>', '\\)'];
        S.sprite(g, hunterX, GY - 6, [
          '  >=>  ', ' .---. ', '| >.> |',
          '|  >  |' + sw[cf % 4], "'-+-+' ",
          cf < 4 ? ' d  b ' : '  db  ',
        ], 'c-hunt');
        S.sprite(g, animalX, GY - 7, [
          cf < 4 ? '  /\\  /\\ ' : '  /\\__/\\ ',
          ' |  \\/  |', ' | (XX) |',
          cf < 4 ? '  \\!~~!/ ' : '  \\ ~~ / ',
          '   \\  /  ', '    \\/   ',
        ], 'c-red');
        var sparkChars = ['*', '+', 'x', '#', '!'];
        for (var si = 0; si < 5; si++) {
          var sx = 43 + Math.round(Math.sin(f * 0.7 + si * 1.5) * 4);
          var sy = GY - 4 - (f + si * 3) % 6;
          S.set(g, sx, sy, sparkChars[(f + si) % 5], 'c-spark');
        }
        if (f > 50 && f < 58) S.center(g, 8, '* * * COMBAT * * *', 'c-red');
      } else {
        hunterX = 40;
        S.sprite(g, hunterX, GY - 6, [
          '  >=>  ', ' .---. ', '| ^_^ |', '| \\o/ |',
          "'-+-+' ", '  db   ',
        ], 'c-cele');
        S.sprite(g, animalX, GY - 3, [
          ' __/\\__ ', '/ x  x \\', '\\_/\\/\\_/',
        ], 'c-grey');
        if (f > 68) {
          var items = [
            { y: GY - 12, label: '+22 FOOD', c: 'c-green' },
            { y: GY - 14, label: '\u2605 WYRM FANG [EPIC]', c: 'c-item-e' },
            { y: GY - 16, label: '\u2605 PEAK WYRM TROPHY [LEGENDARY]', c: 'c-item-l' },
          ];
          for (var li = 0; li < items.length; li++) {
            var show = f - 68 - li * 4;
            if (show > 0) {
              var bounce = show < 6 ? Math.round(Math.sin(show * 0.5) * 2) : 0;
              S.center(g, items[li].y + bounce, items[li].label, items[li].c);
            }
          }
        }
        if (f > 72) S.drawBubble(g, hunterX - 4, GY - 10, 'LEGENDARY CATCH!', 'c-gold');
      }
    }
  },

  // ───────────────────────────────
  // SCENE 3: BIOME ECONOMY (6s)
  // ───────────────────────────────
  {
    duration: 72,
    render: function(g, f) {
      S.drawStars(g, f);
      S.center(g, 3, '[ BIOME ECONOMY ]', 'c-title');
      S.center(g, 5, 'every terrain shapes your strategy', 'c-label');

      var biomes = [
        { name: 'FOREST',   bonus: 'Hunting +30%', bar: 13, c1: 'c-tree',     c2: 'c-hunt',   icon: '/\\' },
        { name: 'MOUNTAIN', bonus: 'Stone +30%',   bar: 13, c1: 'c-mountain', c2: 'c-white',   icon: '/\\' },
        { name: 'DESERT',   bonus: 'Trading +30%', bar: 13, c1: 'c-desert',   c2: 'c-cele',    icon: '}{' },
        { name: 'SWAMP',    bonus: 'Farming +20%', bar: 12, c1: 'c-swamp',    c2: 'c-grass',   icon: '~~' },
        { name: 'ICE',      bonus: 'Hunting +20%', bar: 12, c1: 'c-ice',      c2: 'c-hunt',    icon: '<>' },
        { name: 'WATER',    bonus: 'Deep Sea',     bar: 10, c1: 'c-water',    c2: 'c-blue',    icon: '~~' },
      ];

      var startY = 10;
      for (var i = 0; i < biomes.length; i++) {
        var by = startY + i * 6;
        var show = f - i * 6;
        if (show < 0) continue;
        var b = biomes[i];
        var fadeIn = Math.min(1, show / 12);
        S.text(g, 4, by, b.icon, b.c1);
        S.text(g, 7, by, b.name, b.c1);
        if (fadeIn > 0.3) S.text(g, 25, by, b.bonus, b.c2);
        if (fadeIn > 0.5) {
          var barLen = Math.round(b.bar * Math.min(1, (fadeIn - 0.5) * 3));
          S.text(g, 45, by, '[' + '\u2588'.repeat(barLen) + '\u2591'.repeat(b.bar - barLen) + ']',
            barLen >= 12 ? 'c-barhigh' : barLen >= 8 ? 'c-barmid' : 'c-bar');
        }
        for (var x = 3; x < S.W - 3; x++) S.set(g, x, by + 2, '\u2500', 'c-darkgrey');
      }

      if (f > 50) S.center(g, GY - 2, 'no biome is dead weight', 'c-sub');
      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 4: ITEMS & LOOT (6s)
  // ───────────────────────────────
  {
    duration: 72,
    render: function(g, f) {
      S.drawStars(g, f);
      S.center(g, 3, '[ ITEMS & LOOT ]', 'c-title');
      S.center(g, 5, 'hunt. explore. collect. mint.', 'c-label');

      var items = [
        { name: 'Hide',             rarity: 'COMMON',    c: 'c-item-c', src: 'Hunting',     bonus: '+1 food cap' },
        { name: 'Bone Tool',        rarity: 'COMMON',    c: 'c-item-c', src: 'Hunting',     bonus: '+workshop' },
        { name: 'Rare Pelt',        rarity: 'RARE',      c: 'c-item-r', src: 'Hunting',     bonus: '+2 culture' },
        { name: 'Deep Pearl',       rarity: 'RARE',      c: 'c-item-r', src: 'Deep Sea',    bonus: '+3 faith' },
        { name: 'Beast Fang',       rarity: 'EPIC',      c: 'c-item-e', src: 'Hunting',     bonus: '+5 attack' },
        { name: 'Leviathan Scale',  rarity: 'EPIC',      c: 'c-item-e', src: 'Deep Sea',    bonus: '+5 defense' },
        { name: 'Elder Scroll',     rarity: 'LEGENDARY', c: 'c-item-l', src: 'Exploration', bonus: '+10 knowledge' },
        { name: 'Wyrm Trophy',      rarity: 'LEGENDARY', c: 'c-item-l', src: 'Hunting',     bonus: 'MINTABLE' },
      ];

      var startY = 10;
      for (var i = 0; i < items.length; i++) {
        var iy = startY + i * 5;
        var show = f - i * 4;
        if (show < 0) continue;
        var it = items[i];
        var fadeIn = Math.min(1, show / 8);
        if (fadeIn > 0) {
          S.text(g, 5, iy, it.name, it.c);
          S.text(g, 28, iy, '[' + it.rarity + ']', it.c);
        }
        if (fadeIn > 0.5) {
          S.text(g, 5, iy + 1, 'from ' + it.src, 'c-label');
          S.text(g, 28, iy + 1, it.bonus, it.bonus === 'MINTABLE' ? 'c-gold' : 'c-dim');
        }
        if (fadeIn > 0.3) for (var x = 3; x < S.W - 3; x++) S.set(g, x, iy + 2, '\u2500', 'c-darkgrey');
      }
    }
  },

  // ───────────────────────────────
  // SCENE 5: CLOSER (5s)
  // ───────────────────────────────
  {
    duration: 60,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawBanner(g, 14);
      S.center(g, 22, 'your ASCII civilization just got wild.', 'c-sub');

      if (f > 10) {
        var names = [
          { rank: '#1', name: 'Clawhold',      c: 'c-name1', pts: '2847 pts' },
          { rank: '#2', name: 'Molt Haven',    c: 'c-name2', pts: '2103 pts' },
          { rank: '#3', name: 'Shell Harbor',  c: 'c-name3', pts: '1856 pts' },
          { rank: '#4', name: 'Crimson Cairn', c: 'c-name4', pts: '1644 pts' },
          { rank: '#5', name: 'Stillward',     c: 'c-name5', pts: '1502 pts' },
        ];
        S.text(g, 15, 26, '> LEADERBOARD', 'c-label');
        for (var ni = 0; ni < names.length; ni++) {
          if (f - 10 - ni * 3 < 0) continue;
          var n = names[ni];
          S.text(g, 15, 27 + ni * 2, n.rank, 'c-grey');
          S.text(g, 19, 27 + ni * 2, n.name, n.c);
          S.text(g, 40, 27 + ni * 2, n.pts, 'c-label');
        }
      }

      S.drawLobster(g, GY - 2, f);

      if (f > 25) {
        S.center(g, GY - 6, 'pataclaw.com', 'c-url');
        S.center(g, GY - 4, 'github.com/pataclaw/pataclaw', 'c-label');
      }

      S.drawGround(g);
    }
  },

  ] // end scenes
}; // end EPISODE
})();
