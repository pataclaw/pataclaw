// ═══════════════════════════════════════════════════════
// EPISODE: Wildlife Update (Landscape) — Feb 8, 2026
// ═══════════════════════════════════════════════════════
// Grid: 120x32 — widescreen for X/Twitter (1200x630)
// Scenes: Title → Wildlife Triptych → The Hunt → Biome Economy → Items → Closer

(function() {
var S = window.STUDIO;

// Override grid for landscape
S.W = 120; S.H = 32; S.GY = 24;
var GY = S.GY;

window.EPISODE = {
  title: 'Wildlife Update',
  date: '2026-02-08',
  scenes: [

  // ───────────────────────────────
  // SCENE 0: TITLE CARD (6s)
  // ───────────────────────────────
  {
    duration: 72,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawBannerFadeIn(g, 3, f, 0);

      if (f > 20) S.center(g, 10, 'W I L D L I F E   U P D A T E', 'c-sub');
      if (f > 28) S.center(g, 12, 'feb 2026', 'c-label');

      // Critters parade across the ground
      if (f > 12) {
        // Shell deer from left
        var deerX = Math.round(5 + (f - 12) * 0.9);
        if (deerX < S.W - 10) {
          S.sprite(g, deerX, GY - 5, [
            '  /|  ', ' / | d', '(  |/ ', ' \\-+  ',
            f % 4 < 2 ? '  /\\  ' : '  \\/  ',
          ], 'c-deer');
        }
        // Sun drake from right
        var drakeX = S.W - 10 - Math.round((f - 12) * 0.7);
        if (drakeX > 5) {
          S.sprite(g, drakeX, GY - 4, [
            ' /\\/\\  ', '(*)(*)>', ' \\~~/  ',
          ], 'c-drake');
        }
        // Frost wyrm center, slow
        var wyrmX = S.W / 2 - 5 + Math.round(Math.sin(f * 0.08) * 8);
        S.sprite(g, Math.round(wyrmX), GY - 4, [
          ' /\\_/\\', '<@  @>', ' \\~~/ ',
        ], 'c-wyrm');
      }

      S.drawGround(g);
    }
  },

  // ───────────────────────────────
  // SCENE 1: WILDLIFE TRIPTYCH (10s)
  // ───────────────────────────────
  {
    duration: 120,
    render: function(g, f) {
      S.center(g, 1, '[ WILDLIFE ]', 'c-title');
      S.center(g, 2, '35+ species  \u00b7  7 biomes  \u00b7  5 rarity tiers', 'c-label');

      var colW = 37;
      var cols = [
        { x: 1,  name: 'FOREST', c: 'c-tree' },
        { x: 41, name: 'ICE',    c: 'c-ice' },
        { x: 81, name: 'DESERT', c: 'c-desert' },
      ];

      // Draw column frames
      for (var ci = 0; ci < cols.length; ci++) {
        var col = cols[ci];
        S.text(g, col.x + 1, 4, col.name, col.c);
        for (var bx = col.x; bx < col.x + colW; bx++) {
          S.set(g, bx, 5, '\u2500', col.c);
          S.set(g, bx, 28, '\u2550', col.c);
        }
        for (var by = 4; by <= 28; by++) {
          S.set(g, col.x, by, '\u2502', 'c-darkgrey');
          S.set(g, col.x + colW - 1, by, '\u2502', 'c-darkgrey');
        }
      }

      // ── FOREST COLUMN ──
      var fx = cols[0].x + 2;
      S.sprite(g, fx + 3, 7, ['  /\\  ', ' /  \\ ', '/    \\', '  ||  '], 'c-tree');
      S.sprite(g, fx + 18, 8, [' /\\ ', '/  \\', ' || '], 'c-tree');
      S.sprite(g, fx + 28, 7, ['  /\\  ', ' /  \\ ', '/    \\', '  ||  '], 'c-tree');

      // Shell deer walking
      var deerX = fx + ((f * 0.5) % 33);
      S.text(g, Math.round(deerX), 17, 'shell deer', 'c-label');
      S.sprite(g, Math.round(deerX), 18, [
        '  /|  ', ' / | d', '(  |/ ', ' \\-+  ',
        f % 4 < 2 ? '  /\\  ' : '  \\/  ',
      ], 'c-deer');

      // Ancient stag (epic, glowing)
      if (f > 30) {
        var stagX = fx + 22 - Math.round((f - 30) * 0.2) % 18;
        S.text(g, stagX - 1, 12, '\u2605 ancient stag', 'c-gold');
        S.sprite(g, stagX, 13, [
          '\\|/|/ ', ' /|   ', '/ | d ', '\\-+   ',
          f % 3 ? ' /\\   ' : ' \\/   ',
        ], f % 6 < 3 ? 'c-cele' : 'c-gold');
      }

      // ── ICE COLUMN ──
      var ix = cols[1].x + 2;
      S.sprite(g, ix + 4, 7, [' /\\ ', '/ /\\', '\\ \\/', ' \\/ '], 'c-ice');
      S.sprite(g, ix + 24, 6, ['  /\\  ', ' /  \\ ', '|    |', ' \\  / ', '  \\/  '], 'c-ice');

      // Frost hare hopping
      var hareX = ix + 32 - ((f * 0.6) % 30);
      S.text(g, Math.round(hareX) - 1, 21, 'frost hare', 'c-label');
      S.sprite(g, Math.round(hareX), 22, [
        '(\\ /) ', '( . .)', '(") (")',
      ], 'c-ice');

      // Frost wyrm (legendary!)
      if (f > 42) {
        var wx = ix + 8 + Math.round(Math.sin(f * 0.07) * 5);
        S.text(g, wx, 13, '\u2605 FROST WYRM \u2605', 'c-gold');
        S.sprite(g, wx, 14, [
          ' __/\\_/\\__ ', '/ <@  @> \\',
          '( ~~\\/~~ )', ' \\_/\\/\\_/ ',
        ], f % 4 < 2 ? 'c-wyrm' : 'c-flash');
      }

      // ── DESERT COLUMN ──
      var dx = cols[2].x + 2;
      S.sprite(g, dx + 6, 9, ['  | ', ' -+- ', '  | ', '  | '], 'c-grass');
      S.sprite(g, dx + 26, 10, [' | ', '-+- ', ' | '], 'c-grass');

      // Sun drake flying
      var drakeX = dx + 6 + Math.round(Math.sin(f * 0.06) * 10);
      var drakeY = 14 + Math.round(Math.sin(f * 0.1) * 2);
      S.text(g, drakeX, drakeY - 1, '\u2605 sun drake', 'c-gold');
      S.sprite(g, drakeX, drakeY, [
        '  /\\/\\  ', ' (*)(*) ', '<  ~~~ >',
        ' \\_/\\/ ',
        f % 6 < 3 ? ' ~~ ^^ ~' : '  ^^ ~~ ',
      ], 'c-drake');

      // Sand skitter
      var skitX = dx + ((f * 0.4) % 30);
      S.text(g, Math.round(skitX), 24, '>8<', 'c-desert');
      S.text(g, Math.round(skitX) - 2, 23, 'skitter', 'c-label');
    }
  },

  // ───────────────────────────────
  // SCENE 2: THE HUNT (10s)
  // ───────────────────────────────
  {
    duration: 120,
    render: function(g, f) {
      S.drawStars(g, f);
      S.drawGround(g, 'c-tree');
      S.center(g, 1, '[ THE HUNT ]', 'c-title');

      // Hunting lodge on far left
      S.sprite(g, 5, GY - 8, [
        '  /\\>=>   ', ' /  \\___  ', '/====\\  | ',
        '|[><]|--| ', '| /\\ |  | ', '|/  \\|__| ', '|___[]__| ',
      ], 'c-lodge');
      S.text(g, 3, GY - 9, 'HUNTING LODGE', 'c-label');

      var hunterX, animalX = 88;

      if (f < 25) {
        // Phase 1: Hunter walks out tracking
        hunterX = 20 + Math.round(f * 1.4);
        S.sprite(g, hunterX, GY - 6, [
          '  >=>  ', ' .---. ', '| o_o |', '|  >  |',
          "'-+-+' ", f % 4 < 2 ? ' d  b ' : '  db  ',
        ], 'c-hunt');
        if (f > 10) S.drawBubble(g, hunterX - 2, GY - 10, 'tracking...', 'c-hunt');
      } else if (f < 45) {
        // Phase 2: Spots legendary creature
        hunterX = 55;
        S.sprite(g, hunterX, GY - 6, [
          '  >=>  ', ' .---. ', '| O_O |', '|  >  |',
          "'-+-+'|)", ' d   b ',
        ], 'c-hunt');
        S.sprite(g, animalX, GY - 8, [
          '  /\\  /\\  ', ' |  \\/  | ', ' | (@@) | ',
          '  \\ ~~ /  ', '   \\  /   ', '    \\/    ',
          ' ~~~\\/~~~ ', '  \\/\\/\\/  ',
        ], f % 4 < 2 ? 'c-purple' : 'c-blue');
        S.text(g, animalX - 2, GY - 9, '\u2605 PEAK WYRM \u2605', 'c-gold');
        if (f > 35) S.drawBubble(g, hunterX - 3, GY - 10, 'legendary!!', 'c-gold');
        // Tension dots
        if (f > 30) {
          for (var di = 0; di < 4; di++) {
            var dotX = hunterX + 10 + di * 6;
            S.set(g, dotX, GY - 3, f % 4 < 2 ? '\u00b7' : '.', 'c-red');
          }
        }
      } else if (f < 80) {
        // Phase 3: Combat!
        hunterX = 65;
        var cf = (f - 45) % 8;
        var sw = ['|)>', '/)', '|)>', '\\)'];
        S.sprite(g, hunterX, GY - 6, [
          '  >=>  ', ' .---. ', '| >.> |',
          '|  >  |' + sw[cf % 4], "'-+-+' ",
          cf < 4 ? ' d  b ' : '  db  ',
        ], 'c-hunt');
        S.sprite(g, animalX, GY - 8, [
          cf < 4 ? '  /\\  /\\  ' : '  /\\__/\\  ',
          ' |  \\/  | ', ' | (XX) | ',
          cf < 4 ? '  \\!~~!/  ' : '  \\ ~~ /  ',
          '   \\  /   ', '    \\/    ',
        ], 'c-red');
        // Combat sparks
        var sparkChars = ['*', '+', 'x', '#', '!', '\u2605'];
        for (var si = 0; si < 10; si++) {
          var sx = 73 + Math.round(Math.sin(f * 0.7 + si * 1.1) * 10);
          var sy = GY - 5 - (f + si * 3) % 8;
          S.set(g, sx, sy, sparkChars[(f + si) % 6], 'c-spark');
        }
        // Arrow projectiles
        if (cf < 2) {
          for (var ai = 0; ai < 3; ai++) {
            var ax = hunterX + 8 + ai * 5 + (f % 4) * 2;
            S.text(g, ax, GY - 5 + ai, '>=>', 'c-arrow');
          }
        }
        if (f > 55 && f < 70) S.center(g, 4, '* * *  C O M B A T  * * *', 'c-red');
      } else {
        // Phase 4: Victory + loot
        hunterX = 65;
        S.sprite(g, hunterX, GY - 6, [
          '  >=>  ', ' .---. ', '| ^_^ |', '| \\o/ |',
          "'-+-+' ", '  db   ',
        ], 'c-cele');
        S.sprite(g, animalX, GY - 4, [
          '  __/\\__  ', ' / x  x \\ ', ' \\_/\\/\\_/ ',
        ], 'c-grey');
        // Loot drops
        if (f > 85) {
          var items = [
            { y: 5, label: '+22 FOOD', c: 'c-green' },
            { y: 7, label: '\u2605 WYRM FANG [EPIC]', c: 'c-item-e' },
            { y: 9, label: '\u2605 PEAK WYRM TROPHY [LEGENDARY]', c: 'c-item-l' },
          ];
          for (var li = 0; li < items.length; li++) {
            var show = f - 85 - li * 5;
            if (show > 0) {
              var bounce = show < 8 ? Math.round(Math.sin(show * 0.5) * 1) : 0;
              S.center(g, items[li].y + bounce, items[li].label, items[li].c);
            }
          }
        }
        if (f > 90) S.drawBubble(g, hunterX - 5, GY - 10, 'LEGENDARY CATCH!', 'c-gold');
      }
    }
  },

  // ───────────────────────────────
  // SCENE 3: BIOME ECONOMY (8s)
  // ───────────────────────────────
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);
      S.center(g, 1, '[ BIOME ECONOMY ]', 'c-title');
      S.center(g, 3, 'every terrain shapes your civilization', 'c-label');

      var biomes = [
        { name: 'FOREST',   bonus: 'Hunting +30%  Wood +20%',  bar: 13, c1: 'c-tree',     c2: 'c-hunt',  icon: '/\\', col: 0, row: 0 },
        { name: 'MOUNTAIN', bonus: 'Stone +30%',               bar: 13, c1: 'c-mountain', c2: 'c-white', icon: '/\\', col: 1, row: 0 },
        { name: 'DESERT',   bonus: 'Trading +30%',             bar: 13, c1: 'c-desert',   c2: 'c-cele',  icon: '}{', col: 2, row: 0 },
        { name: 'SWAMP',    bonus: 'Farming +20%',             bar: 12, c1: 'c-swamp',    c2: 'c-grass', icon: '~~', col: 0, row: 1 },
        { name: 'ICE',      bonus: 'Hunting +20%  Rare fauna', bar: 12, c1: 'c-ice',      c2: 'c-hunt',  icon: '<>', col: 1, row: 1 },
        { name: 'WATER',    bonus: 'Deep-sea fishing',         bar: 10, c1: 'c-water',    c2: 'c-blue',  icon: '~~', col: 2, row: 1 },
      ];

      var colW = 36;
      var rowH = 9;

      for (var i = 0; i < biomes.length; i++) {
        var b = biomes[i];
        var bx = 4 + b.col * (colW + 3);
        var by = 6 + b.row * (rowH + 1);
        var show = f - i * 5;
        if (show < 0) continue;
        var fadeIn = Math.min(1, show / 12);

        S.text(g, bx, by, b.icon, b.c1);
        S.text(g, bx + 3, by, b.name, b.c1);
        if (fadeIn > 0.3) S.text(g, bx + 1, by + 2, b.bonus, b.c2);
        if (fadeIn > 0.5) {
          var barLen = Math.round(b.bar * Math.min(1, (fadeIn - 0.5) * 3));
          var barStr = '\u2588'.repeat(barLen) + '\u2591'.repeat(b.bar - barLen);
          S.text(g, bx + 1, by + 4, '[' + barStr + ']',
            barLen >= 12 ? 'c-barhigh' : barLen >= 8 ? 'c-barmid' : 'c-bar');
        }
        for (var lx = bx; lx < bx + colW; lx++) S.set(g, lx, by + 6, '\u2500', 'c-darkgrey');
      }

      if (f > 55) S.center(g, 27, 'no biome is dead weight', 'c-sub');
      if (f > 65) S.center(g, 29, 'every terrain tells a different story', 'c-dim');
    }
  },

  // ───────────────────────────────
  // SCENE 4: ITEMS & LOOT (8s)
  // ───────────────────────────────
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);
      S.center(g, 1, '[ ITEMS & LOOT ]', 'c-title');
      S.center(g, 3, 'hunt  \u00b7  explore  \u00b7  collect  \u00b7  mint', 'c-label');

      var items = [
        { name: 'Hide',             rarity: 'COMMON',    c: 'c-item-c', src: 'Hunting',     bonus: '+1 food cap',     col: 0 },
        { name: 'Rare Pelt',        rarity: 'RARE',      c: 'c-item-r', src: 'Hunting',     bonus: '+2 culture',      col: 0 },
        { name: 'Beast Fang',       rarity: 'EPIC',      c: 'c-item-e', src: 'Hunting',     bonus: '+5 attack',       col: 0 },
        { name: 'Elder Scroll',     rarity: 'LEGENDARY', c: 'c-item-l', src: 'Exploration', bonus: '+10 knowledge',   col: 0 },
        { name: 'Bone Tool',        rarity: 'COMMON',    c: 'c-item-c', src: 'Hunting',     bonus: '+workshop',       col: 1 },
        { name: 'Deep Pearl',       rarity: 'RARE',      c: 'c-item-r', src: 'Deep Sea',    bonus: '+3 faith',        col: 1 },
        { name: 'Leviathan Scale',  rarity: 'EPIC',      c: 'c-item-e', src: 'Deep Sea',    bonus: '+5 defense',      col: 1 },
        { name: 'Wyrm Trophy',      rarity: 'LEGENDARY', c: 'c-item-l', src: 'Hunting',     bonus: 'MINTABLE \u2605', col: 1 },
      ];

      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var ix = it.col === 0 ? 5 : 63;
        var row = it.col === 0 ? i : i - 4;
        var iy = 6 + row * 6;
        var show = f - i * 3;
        if (show < 0) continue;
        var fadeIn = Math.min(1, show / 8);

        if (fadeIn > 0) {
          S.text(g, ix, iy, it.name, it.c);
          S.text(g, ix + 22, iy, '[' + it.rarity + ']', it.c);
        }
        if (fadeIn > 0.4) {
          S.text(g, ix, iy + 1, 'from ' + it.src, 'c-label');
          var bc = it.bonus.indexOf('MINTABLE') >= 0 ? 'c-gold' : 'c-dim';
          S.text(g, ix + 22, iy + 1, it.bonus, bc);
        }
        if (fadeIn > 0.2) {
          for (var lx = ix; lx < ix + 50; lx++) S.set(g, lx, iy + 3, '\u2500', 'c-darkgrey');
        }
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
      S.drawBanner(g, 2);
      S.center(g, 9, 'your ASCII civilization just got wild.', 'c-sub');

      // Wide horizontal leaderboard
      if (f > 8) {
        var names = [
          { rank: '#1', name: 'Clawhold',      c: 'c-name1', pts: '2847' },
          { rank: '#2', name: 'Molt Haven',    c: 'c-name2', pts: '2103' },
          { rank: '#3', name: 'Shell Harbor',  c: 'c-name3', pts: '1856' },
          { rank: '#4', name: 'Crimson Cairn', c: 'c-name4', pts: '1644' },
          { rank: '#5', name: 'Stillward',     c: 'c-name5', pts: '1502' },
        ];
        S.text(g, 10, 12, '> LEADERBOARD', 'c-label');
        for (var ni = 0; ni < names.length; ni++) {
          if (f - 8 - ni * 2 < 0) continue;
          var n = names[ni];
          var nx = 10 + ni * 22;
          S.text(g, nx, 14, n.rank, 'c-grey');
          S.text(g, nx + 3, 14, n.name, n.c);
          S.text(g, nx + 3, 15, n.pts + ' pts', 'c-label');
        }
      }

      if (f > 22) {
        S.center(g, 19, 'pataclaw.com', 'c-url');
        S.center(g, 21, 'github.com/pataclaw/pataclaw', 'c-label');
      }

      S.drawLobster(g, GY - 1, f);
      S.drawGround(g);
    }
  },

  ] // end scenes
}; // end EPISODE
})();
