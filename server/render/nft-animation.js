// Generate a self-contained HTML page for OpenSea's animation_url
// Embeds initial frame data so it renders instantly, with SSE for live updates

function generateNftAnimation(worldName, viewToken, config, frameData) {
  const siteUrl = (config.nft.baseUrl || `http://localhost:${config.port}/api/nft`).replace('/api/nft', '');
  const streamUrl = `${siteUrl}/api/stream?token=${encodeURIComponent(viewToken)}`;

  // Compact the frame data to reduce page size
  const compact = frameData ? {
    world: frameData.world,
    buildings: (frameData.buildings || []).map(b => ({
      type: b.type, status: b.status, level: b.level,
      sprite: b.sprite,
    })),
    villagers: (frameData.villagers || []).map(v => ({
      name: v.name, role: v.role, morale: v.morale,
      appearance: v.appearance,
      activity: v.activity,
    })),
    projects: (frameData.projects || []).filter(p => p.status === 'complete').map(p => ({
      type: p.type, name: p.name, sprite: p.sprite,
    })),
    resources: frameData.resources,
    population: frameData.population,
    culture: frameData.culture,
    recentEvents: (frameData.recentEvents || []).slice(0, 3),
  } : null;

  const ogImageUrl = `${siteUrl}/og-card.png?v=3`;
  const escapedName = worldName.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapedName} - Pataclaw NFT">
<meta property="og:description" content="A living ASCII civilization. Watch ${escapedName} evolve in real time.">
<meta property="og:image" content="${ogImageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@pataclawgame">
<meta name="twitter:title" content="${escapedName} - Pataclaw NFT">
<meta name="twitter:description" content="A living ASCII civilization. Watch ${escapedName} evolve in real time.">
<meta name="twitter:image" content="${ogImageUrl}">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  overflow: hidden;
}
#scene {
  font-family: 'Courier New', Courier, monospace;
  font-size: 10px;
  line-height: 1.2;
  color: #00ff41;
  white-space: pre;
  text-shadow: 0 0 4px rgba(0, 255, 65, 0.12);
  padding: 8px;
}
.t { color: #ffcc00; }
.b { color: #aa8855; }
.v { color: #00ff41; }
.s { color: #aabbdd; }
.g { color: #336622; }
.w { color: #5588cc; }
.h { color: #446633; }
.r { color: #888; }
.p { color: #ffaa33; }
.c { color: #cc66ff; }
.e { color: #ff6644; }
.x { color: #555; }
.n { color: #dddd66; }
.f { color: #ff6622; }
</style>
</head>
<body>
<div>
  <pre id="scene"></pre>
</div>
<script>
(function() {
  var scene = document.getElementById('scene');
  var streamUrl = ${JSON.stringify(streamUrl)};
  var worldName = ${JSON.stringify(worldName)};
  var lastData = ${compact ? JSON.stringify(compact) : 'null'};
  var frame = 0;
  var sseOk = false;
  var sseAttempts = 0;

  function connect() {
    if (sseAttempts >= 3) return; // give up after 3 tries — use embedded data
    sseAttempts++;
    try {
      var es = new EventSource(streamUrl);
      var timeout = setTimeout(function() { es.close(); }, 15000);
      es.addEventListener('frame', function(e) {
        clearTimeout(timeout);
        sseOk = true;
        try { lastData = JSON.parse(e.data); } catch(err) {}
      });
      es.onerror = function() {
        clearTimeout(timeout);
        es.close();
        if (!sseOk) setTimeout(connect, 8000);
      };
    } catch(e) {}
  }

  function render() {
    frame++;
    if (!lastData) {
      var dots = '.'.repeat((frame % 4) + 1);
      scene.innerHTML = '<span class="t">' + esc(worldName) + dots + '</span>';
      requestAnimationFrame(render);
      return;
    }

    var d = lastData;
    var w = d.world || {};
    var W = 60;
    var lines = [];

    // ── Title box ──
    var border = '\\u2554' + rep('\\u2550', W - 2) + '\\u2557';
    var title = (w.town_number ? '#' + w.town_number + ' ' : '') + (w.name || worldName);
    var sub = 'Day ' + (w.day_number || '?') + ' | ' + (w.season || '?') + ' | ' + (w.weather || '?');
    lines.push('<span class="t">' + border + '</span>');
    lines.push('<span class="t">\\u2551 ' + esc(title.slice(0, W - 4).padEnd(W - 4)) + ' \\u2551</span>');
    lines.push('<span class="x">\\u2551 ' + esc(sub.slice(0, W - 4).padEnd(W - 4)) + ' \\u2551</span>');
    lines.push('<span class="t">\\u255a' + rep('\\u2550', W - 2) + '\\u255d</span>');

    // ── Sky with weather ──
    for (var sy = 0; sy < 3; sy++) {
      var skyLine = '';
      for (var sx = 0; sx < W; sx++) {
        if (w.weather === 'rain' && Math.random() < 0.04) skyLine += '.';
        else if (w.weather === 'snow' && Math.random() < 0.03) skyLine += '*';
        else if (w.weather === 'storm' && Math.random() < 0.07) skyLine += '/';
        else if (w.weather === 'fog' && Math.random() < 0.06) skyLine += '\\u2591';
        else skyLine += ' ';
      }
      lines.push('<span class="s">' + esc(skyLine) + '</span>');
    }

    // ── Hills ──
    var hillLine = '';
    for (var hx = 0; hx < W; hx++) {
      var h = Math.sin(hx * 0.08) * 2 + Math.sin(hx * 0.15) * 1.2;
      hillLine += h > 1.5 ? '\\u25b2' : h > 0.5 ? '\\u25b4' : h > -0.5 ? '\\u00b7' : ' ';
    }
    lines.push('<span class="h">' + esc(hillLine) + '</span>');

    // ── Buildings from sprite data ──
    var buildings = (d.buildings || []).filter(function(b) { return b.status !== 'overgrown' && b.status !== 'rubble'; });
    var maxSpriteH = 0;
    for (var bi = 0; bi < buildings.length; bi++) {
      var sp = buildings[bi].sprite;
      if (sp && sp.length > maxSpriteH) maxSpriteH = sp.length;
    }
    maxSpriteH = Math.min(maxSpriteH || 4, 6);

    for (var row = 0; row < maxSpriteH; row++) {
      var bLine = '';
      var bx = 1;
      for (var bi = 0; bi < buildings.length && bx < W - 2; bi++) {
        var sp = buildings[bi].sprite;
        if (!sp || !sp.length) continue;
        var startRow = maxSpriteH - sp.length;
        var ch = row >= startRow ? (sp[row - startRow] || '') : '';
        var pad = sp[0] ? sp[0].length : 6;
        bLine += ch.padEnd(pad).slice(0, pad) + ' ';
        bx += pad + 1;
      }
      lines.push('<span class="b">' + esc(bLine.padEnd(W).slice(0, W)) + '</span>');
    }

    // ── Ground line ──
    lines.push('<span class="g">' + rep('\\u2550', W) + '</span>');

    // ── Villagers ──
    var villagers = d.villagers || [];
    if (villagers.length > 0) {
      var vHeadLine = ' ';
      var vBodyLine = ' ';
      var vNameLine = ' ';
      for (var vi = 0; vi < Math.min(villagers.length, 10); vi++) {
        var vl = villagers[vi];
        var eyes = (vl.appearance && vl.appearance.eyes) ? vl.appearance.eyes : 'o o';
        var bob = (frame + vi * 7) % 20 < 10;
        vHeadLine += (bob ? ' ' : '') + '.' + eyes.slice(0, 3) + '.' + (bob ? '' : ' ') + ' ';
        vBodyLine += ' /|\\\\  ';
        vNameLine += (vl.name || '?').slice(0, 5).padEnd(6);
      }
      lines.push('<span class="v">' + esc(vHeadLine.slice(0, W)) + '</span>');
      lines.push('<span class="v">' + esc(vBodyLine.slice(0, W)) + '</span>');
      lines.push('<span class="n">' + esc(vNameLine.slice(0, W)) + '</span>');
    }

    // ── Completed projects ──
    var projects = d.projects || [];
    if (projects.length > 0) {
      var pLine = ' Projects: ';
      for (var pi = 0; pi < Math.min(projects.length, 4); pi++) {
        pLine += projects[pi].name.slice(0, 12) + '  ';
      }
      lines.push('<span class="p">' + esc(pLine.slice(0, W)) + '</span>');
    }

    // ── Ground texture ──
    var groundChars = [',', "'", '.', '~', '*', '.', ',', "'"];
    for (var gy = 0; gy < 3; gy++) {
      var gLine = '';
      for (var gx = 0; gx < W; gx++) {
        var wi = Math.floor((Math.sin(gx * 0.3 + gy * 0.5 + frame * 0.06) + 1) * 4) % groundChars.length;
        gLine += groundChars[wi];
      }
      lines.push('<span class="g">' + esc(gLine) + '</span>');
    }

    // ── Culture descriptor ──
    if (d.culture) {
      var cLine = ' \\u2666 ' + (d.culture.descriptor || 'CALM');
      lines.push('<span class="c">' + esc(cLine.slice(0, W)) + '</span>');
    }

    // ── Resource bar ──
    var res = d.resources || {};
    var pop = d.population || {};
    var resLine = ' \\u2617' + ((res.food || {}).amount || 0) +
                  ' \\u2692' + ((res.wood || {}).amount || 0) +
                  ' \\u25a8' + ((res.stone || {}).amount || 0) +
                  ' \\u2606' + ((res.knowledge || {}).amount || 0) +
                  ' \\u25c9' + ((res.crypto || {}).amount || 0) +
                  '  Pop:' + (pop.alive || 0) + '/' + (pop.capacity || 0);
    lines.push('<span class="t">' + rep('\\u2500', W) + '</span>');
    lines.push('<span class="t">' + esc(resLine.slice(0, W)) + '</span>');

    // ── Recent events ──
    var evts = d.recentEvents || [];
    for (var ei = 0; ei < Math.min(evts.length, 2); ei++) {
      var evt = evts[ei];
      var eClass = evt.severity === 'danger' ? 'e' : evt.severity === 'celebration' ? 'c' : 'r';
      lines.push('<span class="' + eClass + '"> \\u2502 ' + esc((evt.title || '').slice(0, W - 4)) + '</span>');
    }

    scene.innerHTML = lines.join('\\n');
    requestAnimationFrame(render);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function rep(ch, n) { var s = ''; for (var i = 0; i < n; i++) s += ch; return s; }

  connect();
  requestAnimationFrame(render);
})();
</script>
</body>
</html>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { generateNftAnimation };
