// Generate a self-contained HTML page for OpenSea's animation_url
// Connects to SSE stream, renders simplified ASCII scene on a black terminal canvas

function generateNftAnimation(worldName, viewToken, config) {
  const baseUrl = config.nft.baseUrl || `http://localhost:${config.port}`;
  const streamUrl = `${baseUrl.replace('/api/nft', '')}/api/stream?token=${encodeURIComponent(viewToken)}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
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
  line-height: 1.15;
  color: #00ff41;
  white-space: pre;
  text-shadow: 0 0 4px rgba(0, 255, 65, 0.15);
  padding: 8px;
}
.title { color: #ffcc00; }
.bld { color: #aa8855; }
.vlg { color: #00ff41; }
.sky { color: #aabbdd; }
.gnd { color: #336622; }
.weather { color: #5588cc; }
.status { color: #666; font-size: 9px; text-align: center; margin-top: 4px; }
</style>
</head>
<body>
<div>
  <pre id="scene">Connecting to ${esc(worldName)}...</pre>
  <div id="status" class="status"></div>
</div>
<script>
(function() {
  var scene = document.getElementById('scene');
  var status = document.getElementById('status');
  var streamUrl = ${JSON.stringify(streamUrl)};
  var worldName = ${JSON.stringify(worldName)};
  var lastData = null;
  var frame = 0;
  var connected = false;

  function connect() {
    var es = new EventSource(streamUrl);
    es.addEventListener('frame', function(e) {
      connected = true;
      status.textContent = '';
      try { lastData = JSON.parse(e.data); } catch(err) {}
    });
    es.onerror = function() {
      connected = false;
      status.textContent = 'reconnecting...';
      es.close();
      setTimeout(connect, 5000);
    };
  }

  function render() {
    frame++;
    if (!lastData) {
      if (!connected) {
        var dots = '.'.repeat((frame % 3) + 1);
        scene.innerHTML = '<span class="title">Connecting to ' + esc(worldName) + dots + '</span>';
      }
      requestAnimationFrame(render);
      return;
    }

    var d = lastData;
    var w = d.world || {};
    var W = 60;
    var H = 25;
    var lines = [];

    // Title
    var title = ' * ' + (w.name || worldName) + ' * Day ' + (w.day_number || '?') + ' | ' + (w.season || '?') + ' | ' + (w.weather || '?');
    lines.push('<span class="title">' + esc(title.slice(0, W)) + '</span>');
    lines.push('<span class="title">' + '='.repeat(W) + '</span>');

    // Sky
    for (var sy = 0; sy < 4; sy++) {
      var skyLine = '';
      for (var sx = 0; sx < W; sx++) {
        if (w.weather === 'rain' && Math.random() < 0.05) skyLine += '.';
        else if (w.weather === 'snow' && Math.random() < 0.04) skyLine += '*';
        else if (w.weather === 'storm' && Math.random() < 0.08) skyLine += '/';
        else skyLine += ' ';
      }
      lines.push('<span class="sky">' + esc(skyLine) + '</span>');
    }

    // Buildings
    var buildings = d.buildings || [];
    var bLine1 = '';
    var bLine2 = '';
    var bLine3 = '';
    var bx = 2;
    for (var bi = 0; bi < buildings.length && bx < W - 8; bi++) {
      var b = buildings[bi];
      var t = b.type || 'hut';
      if (t === 'town_center') { bLine1 += '  /\\\\  '; bLine2 += ' |  | '; bLine3 += ' |__|_'; }
      else if (t === 'hut')    { bLine1 += '  /\\  '; bLine2 += ' |  | '; bLine3 += ' |__| '; }
      else if (t === 'farm')   { bLine1 += ' =-=- '; bLine2 += ' |##| '; bLine3 += ' |##| '; }
      else if (t === 'dock')   { bLine1 += ' ~~~~ '; bLine2 += ' |--| '; bLine3 += ' ~~~~ '; }
      else                     { bLine1 += '  []  '; bLine2 += ' |  | '; bLine3 += ' |__| '; }
      bLine1 += '  '; bLine2 += '  '; bLine3 += '  ';
      bx += 8;
    }
    lines.push('<span class="bld">' + esc(bLine1.padEnd(W).slice(0, W)) + '</span>');
    lines.push('<span class="bld">' + esc(bLine2.padEnd(W).slice(0, W)) + '</span>');
    lines.push('<span class="bld">' + esc(bLine3.padEnd(W).slice(0, W)) + '</span>');

    // Villagers
    var villagers = d.villagers || [];
    var vLine = '';
    for (var vi = 0; vi < Math.min(villagers.length, 8); vi++) {
      var v = villagers[vi];
      var name = (v.name || '?').slice(0, 5);
      var bob = (frame + vi * 3) % 12 < 6;
      vLine += (bob ? ' o ' : ' o ') + ' ';
    }
    lines.push('<span class="vlg">' + esc(vLine.padEnd(W).slice(0, W)) + '</span>');
    var nLine = '';
    for (var ni = 0; ni < Math.min(villagers.length, 8); ni++) {
      nLine += (villagers[ni].name || '?').slice(0, 3).padEnd(4);
    }
    lines.push('<span class="vlg">' + esc(nLine.padEnd(W).slice(0, W)) + '</span>');

    // Ground
    var groundChars = [',', "'", '.', '~', '*', '.', ',', "'"];
    for (var gy = 0; gy < 5; gy++) {
      var gLine = '';
      for (var gx = 0; gx < W; gx++) {
        var wi = Math.floor((Math.sin(gx * 0.3 + gy * 0.5 + frame * 0.08) + 1) * 4) % groundChars.length;
        gLine += groundChars[wi];
      }
      lines.push('<span class="gnd">' + esc(gLine) + '</span>');
    }

    // Resource bar
    var res = d.resources || {};
    var resLine = ' Food:' + ((res.food || {}).amount || 0) +
                  ' Wood:' + ((res.wood || {}).amount || 0) +
                  ' Pop:' + ((d.population || {}).alive || 0);
    lines.push('<span class="title">' + esc(resLine.slice(0, W)) + '</span>');

    // Fill remaining lines
    while (lines.length < H) lines.push('');

    scene.innerHTML = lines.join('\\n');
    requestAnimationFrame(render);
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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
