// Planet map: fetch all worlds and render them on a grid
(function () {
  var GRID_W = 50;
  var GRID_H = 30;
  var SEASON_ICONS = { spring: '*', summer: 'O', autumn: '^', winter: '#' };
  var WEATHER_ICONS = { clear: '.', rain: '~', storm: '/', snow: '*', fog: '=', heat: '^' };

  // Terrain generated from a global seed for empty tiles
  var TERRAIN_CHARS = ['.', '~', '#', '^', ',', '.', '.', '~'];
  var TERRAIN_COLORS = ['terrain-plains', 'terrain-water', 'terrain-mountain', 'terrain-forest', 'terrain-plains', 'terrain-plains', 'terrain-plains', 'terrain-water'];

  function hashSeed(seed) {
    var h = seed | 0;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return Math.abs(h);
  }

  function worldPosition(seed, gridW, gridH) {
    var h = hashSeed(seed);
    // Place in inner region (avoid edges)
    var x = 3 + (h % (gridW - 6));
    var y = 2 + ((h >> 8) % (gridH - 4));
    return { x: x, y: y };
  }

  function fetchAndRender() {
    fetch('/api/planet')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        renderStats(data.stats);
        renderGrid(data.worlds);
      })
      .catch(function (err) {
        console.error('Failed to fetch planet data:', err);
        document.getElementById('planet-grid').textContent = 'Failed to connect to Pata...';
      });
  }

  function renderStats(stats) {
    document.getElementById('stat-worlds').textContent = stats.total_worlds + ' worlds';
    document.getElementById('stat-pop').textContent = stats.total_population + ' souls';
    document.getElementById('stat-minted').textContent = stats.total_minted + ' minted';
  }

  function renderGrid(worlds) {
    // Build empty grid
    var grid = [];
    for (var y = 0; y < GRID_H; y++) {
      grid[y] = [];
      for (var x = 0; x < GRID_W; x++) {
        var tIdx = (x * 7 + y * 13 + x * y) % TERRAIN_CHARS.length;
        grid[y][x] = { ch: TERRAIN_CHARS[tIdx], cls: TERRAIN_COLORS[tIdx], world: null };
      }
    }

    // Place worlds on grid (handle collisions by shifting)
    var occupied = {};
    for (var i = 0; i < worlds.length; i++) {
      var w = worlds[i];
      var pos = worldPosition(w.seed, GRID_W, GRID_H);
      var key = pos.x + ',' + pos.y;

      // Collision resolution: shift right/down
      var attempts = 0;
      while (occupied[key] && attempts < 20) {
        pos.x = (pos.x + 1) % GRID_W;
        if (pos.x < 3) pos.x = 3;
        key = pos.x + ',' + pos.y;
        attempts++;
      }
      if (attempts >= 20) {
        // Last resort: find any empty spot
        for (var fy = 2; fy < GRID_H - 2; fy++) {
          for (var fx = 3; fx < GRID_W - 3; fx++) {
            if (!occupied[fx + ',' + fy]) {
              pos = { x: fx, y: fy };
              key = pos.x + ',' + pos.y;
              fy = GRID_H; // break outer
              break;
            }
          }
        }
      }

      occupied[key] = true;
      grid[pos.y][pos.x] = {
        ch: w.is_minted ? '\u2666' : '\u25a0',
        cls: w.is_minted ? 'world-minted' : 'world-normal',
        world: w,
      };
    }

    // Render as HTML
    var container = document.getElementById('planet-grid');
    var lines = [];
    for (var y = 0; y < GRID_H; y++) {
      var html = '';
      for (var x = 0; x < GRID_W; x++) {
        var cell = grid[y][x];
        if (cell.world) {
          var w = cell.world;
          var title = w.name + ' (Pop: ' + w.population + ', Day ' + w.day_number + ', ' + w.season + ')' + (w.is_minted ? ' [MINTED]' : '');
          html += '<a href="/view/' + encodeURIComponent(w.view_token) + '" class="' + cell.cls + '" title="' + escAttr(title) + '">' + escHtml(cell.ch) + '</a>';
        } else {
          html += '<span class="' + cell.cls + '">' + escHtml(cell.ch) + '</span>';
        }
      }
      lines.push(html);
    }

    container.innerHTML = '<pre>' + lines.join('\n') + '</pre>';

    // Build legend below grid
    var legend = document.createElement('div');
    legend.className = 'planet-legend';
    legend.innerHTML =
      '<span class="world-minted">\u2666</span> Minted NFT World  ' +
      '<span class="world-normal">\u25a0</span> Active World  ' +
      '<span class="terrain-plains">.</span> Plains  ' +
      '<span class="terrain-water">~</span> Ocean  ' +
      '<span class="terrain-mountain">#</span> Mountains  ' +
      '<span class="terrain-forest">^</span> Forest';
    container.appendChild(legend);
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

  // Fetch on load, refresh every 30s
  fetchAndRender();
  setInterval(fetchAndRender, 30000);
})();
