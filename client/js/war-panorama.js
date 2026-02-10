// ─── PATACLAW WAR VIEWER ───
// 80×45 ASCII battlefield matching the main viewer's scale + rendering.
// Warriors clash center-stage, buildings burn at the flanks, spires crumble.
// Full animation: smooth movement, sparks, fire, blood, screen shake, clouds.

(function() {
  'use strict';

  // ─── GRID ───
  var W = 80, H = 45, GY = 34, FPS = 12;

  // ─── STATE ───
  var warId, es, frame, prev, tick = 0, grid = [];
  var agents = {};       // warrior agents (smooth animation)
  var fx = [];           // active particle effects
  var starField = null;
  var clouds = [], cloudW = null;
  var narrT, shakeT, lastRound = -1;

  // ─── GRID HELPERS ───
  function initG() {
    grid = [];
    for (var y = 0; y < H; y++) {
      grid[y] = [];
      for (var x = 0; x < W; x++) grid[y][x] = { ch: ' ', c: '' };
    }
  }
  function sc(x, y, ch, c) { if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = { ch: ch, c: c || '' }; }
  function ws(x, y, s, c) { for (var i = 0; i < s.length; i++) sc(x + i, y, s[i], c); }
  function ec(ch) { return ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch; }

  function compose() {
    var lines = [];
    for (var y = 0; y < H; y++) {
      var h = '', r = '', rc = '';
      for (var x = 0; x < W; x++) {
        var cell = grid[y][x], ch = cell.ch, cc = cell.c || '';
        if (cc === rc) { r += ec(ch); }
        else { if (r) h += rc ? '<span class="' + rc + '">' + r + '</span>' : r; r = ec(ch); rc = cc; }
      }
      if (r) h += rc ? '<span class="' + rc + '">' + r + '</span>' : r;
      lines.push(h);
    }
    return lines.join('\n');
  }

  // ─── WARRIOR SPRITES (7 wide × 6 tall) ───
  var SP = {
    pincer: {
      fight: [' )=(=( ',' .---. ',' |o^o| ',' |><|  '," 'XX'  ",'  d  b '],
      charge:[' )=(=( ',' .---. ',' |o>o| ',' |>>|  '," 'XX'  ",'  d  b '],
      fall:  ['       ','  ___  ',' /x_x\\ ',' |__|  ',' .:::. ','.......'],
      dead:  ['       ','       ','   +   ','  .:.  ',' .:::. ','.......'],
    },
    carapace: {
      fight: [' [=#=] ',' .---. ',' |o_o| ',' |##|  '," '#=#' ",'  d  b '],
      charge:[' [=#=] ',' .---. ',' |o_o| ',' |##|  '," '#=#' ",'  d  b '],
      fall:  ['       ','  ___  ',' /x_x\\ ',' |##|  ',' .###. ','.......'],
      dead:  ['       ','       ','   +   ','  .#.  ',' .###. ','.......'],
    },
    spitter: {
      fight: [' >>->> ',' .---. ',' |o.o| ',' |--|  '," '  >' ",'  d  b '],
      charge:[' >>->> ',' .---. ',' |o.o|>',' |-->  '," '  >' ",'  d  b '],
      fall:  ['       ','  ___  ',' /x.x\\ ',' |__|  ',' ..>>. ','.......'],
      dead:  ['       ','       ','   +   ','  .>.  ',' ..>>. ','.......'],
    },
    tidecaller: {
      fight: [' ~*+*~ ',' .---. ',' |o~o| ',' |~~|  '," '~~'  ",'  d  b '],
      charge:[' ~*+*~ ',' .---. ',' |o~o| ',' |~~|~ '," '~~'  ",'  d  b '],
      fall:  ['       ','  ___  ',' /x~x\\ ',' |__|  ',' .~~~. ','.......'],
      dead:  ['       ','       ','   +   ','  .~.  ',' .~~~. ','.......'],
    },
  };

  // Mirror sprites for defender side
  function mirS(s) {
    var o = '';
    for (var i = s.length - 1; i >= 0; i--) {
      var c = s[i];
      o += c==='('?')':c===')'?'(':c==='['?']':c===']'?'[':c==='<'?'>':c==='>'?'<':c==='/'?'\\':c==='\\'?'/':c==='d'?'b':c==='b'?'d':c;
    }
    return o;
  }
  var SPR = {};
  for (var t in SP) { SPR[t] = {}; for (var s in SP[t]) SPR[t][s] = SP[t][s].map(mirS); }

  // ─── BUILDING SPRITES (5 wide × 2-3 tall) ───
  var BLD = {
    farm:      [' ,^, ',' |#| ',' |_| '],
    workshop:  [' [W] ',' |_| '],
    hut:       ['  /\\ ',' |_| '],
    market:    [' $$$ ',' |_| '],
    library:   [' [B] ',' |=| ',' |_| '],
    wall:      [' ||| ',' ||| '],
    watchtower:[' /\\  ',' ||  ',' ||  '],
    temple:    ['  +  ',' /|\\ ',' |_| '],
    barracks:  [' [!] ',' |=| '],
    dock:      [' ~~~ ',' === '],
    storehouse:[' [S] ',' |_| '],
    molt_cathedral: ['  *  ',' /M\\ ',' |_| '],
    hunting_lodge: ['  ^  ',' |>| '],
  };
  var BLD_RUB = [' ... ',' .:. '];

  // ─── SPIRE ───
  var SPIRE_CAP = ['  /\\  ',' /  \\ ',' |**| '];
  var SPIRE_I = ' |##| ', SPIRE_C = ' |/\\| ', SPIRE_F = ' .... ';
  var SPIRE_BASE = ['_|  |_','|____|'];

  // ─── CLOUDS ───
  var CLD = {
    sm: ['  .--.  '],
    md: ['   .___   ',' /~~~~~\\ '],
    lg: ['    .______     ','  _/~~~~~~~~\\_  ',' /~~~~~~~~~~~~\\ '],
  };

  function genClouds(w) {
    var cfg = { clear:{n:[0,1],t:['sm'],sp:[0.015,0.03]}, rain:{n:[2,3],t:['md','lg'],sp:[0.04,0.08]},
      storm:{n:[3,4],t:['lg'],sp:[0.06,0.12]}, snow:{n:[1,2],t:['sm','md'],sp:[0.02,0.04]},
      fog:{n:[3,4],t:['lg'],sp:[0.005,0.015]}, heat:{n:[0,0],t:[],sp:[0,0]} };
    var c = cfg[w] || cfg.clear;
    var n = c.n[0] + Math.floor(Math.random() * (c.n[1] - c.n[0] + 1));
    var out = [];
    for (var i = 0; i < n; i++) {
      var tk = c.t[Math.floor(Math.random() * c.t.length)];
      if (!tk) continue;
      out.push({ x: Math.random() * W, y: 1 + Math.floor(Math.random() * 4),
        shape: CLD[tk], speed: c.sp[0] + Math.random() * (c.sp[1] - c.sp[0]) });
    }
    return out;
  }

  // ─── BIOME GROUND ───
  var BIOME = {
    plains:  {ch:['~','*','.',"'",','], cls:'c-gnd-v'},
    forest:  {ch:['~','*','.',';','`'], cls:'c-gnd-v'},
    mountain:{ch:['#','=','.',':','%'], cls:'c-gnd-s'},
    swamp:   {ch:['~','.',',','*','`'], cls:'c-gnd-m'},
    desert:  {ch:['~','.','\u00b0',','], cls:'c-gnd-d'},
    tundra:  {ch:['*','.','\u00b7',"'"], cls:'c-gnd-f'},
    volcanic:{ch:['^','~','.','*'], cls:'c-gnd-e'},
  };
  var WAR_GND = {
    clash:{ch:['#','.','#','.',','], cls:'c-war-gnd'},
    burn: {ch:['^','~','^','*','^'], cls:'c-war-fire'},
    spire:{ch:['.',',','.',':','.'], cls:'c-war-ash'},
  };

  // ─── BATTLE CRIES ───
  var CRIES = {
    pincer:    ['CRUSH!','CLAW!','SMASH!','REND!','DIE!','NO MERCY','HA!','ATTACK!'],
    carapace:  ['HOLD!','SHELL!','STAND!','BRACE!','WALL!','SHIELD!','FIRM!','GUARD!'],
    spitter:   ['FIRE!','AIM!','SPIT!','ACID!','RAIN!','VOLLEY!','HIT!','MARK!'],
    tidecaller:['HEAL!','TIDE!','RISE!','FLOW!','MEND!','SURGE!','CALM!','WAVES!'],
  };

  // ─── NARRATOR ───
  var NARR = {
    champion_duel:['A CHAMPION RISES','TWO WARRIORS ONE FATE','THE DUEL OF AGES'],
    blood_frenzy:['BLOOD FRENZY','BERSERK','NO MERCY'],
    wall_breach:['THE WALLS CRUMBLE','BREACH!','DEFENSES SHATTERED'],
    heroic_stand:['ONE AGAINST MANY','LEGENDARY DEFIANCE'],
    divine_intervention:['THE GODS SPEAK','DIVINE INTERVENTION'],
    flanking:['FLANKED!','AMBUSH MANEUVER'],
    morale_break:['SPIRIT BREAKS','FEAR TAKES HOLD'],
    ambush:['AMBUSH!','FROM THE SHADOWS'],
    shield_break:['SHIELDS DESTROYED','NO PROTECTION'],
    war_chant:['WAR CHANT ECHOES','DRUMS OF WAR'],
    skill_red:['DEVASTATION','WRATH UNLEASHED','RAW POWER'],
    skill_blue:['IMPENETRABLE','FORTRESS OF WILL'],
    skill_green:['NATURE STRIKES','THE TIDE TURNS'],
    skill_gold:['DIVINE FURY','ASCENDED POWER'],
    enter_burn:['BUILDINGS BURN','THE TOWN ABLAZE','FIRE CONSUMES ALL'],
    enter_spire:['THE SPIRE STANDS ALONE','LAST BASTION','ALL IS LOST'],
    mass_casualty:['MASSACRE','THE FALLEN PILE HIGH'],
    carapace_save:['THE SHELL HOLDS','UNBREAKABLE'],
  };
  function pickN(k) { var a = NARR[k]; return a ? a[Math.floor(Math.random() * a.length)] : null; }

  function narrate(text, cls) {
    var el = document.getElementById('narrator');
    if (!el || !text) return;
    el.textContent = text;
    el.className = 'narr-in ' + (cls || 'n-red');
    clearTimeout(narrT);
    narrT = setTimeout(function() { el.className = 'narr-out ' + (cls || 'n-red'); }, 2200);
  }

  function shake(big) {
    var el = document.getElementById('stage');
    if (!el) return;
    el.classList.remove('shake-sm', 'shake-lg');
    void el.offsetWidth; // reflow
    el.classList.add(big ? 'shake-lg' : 'shake-sm');
    clearTimeout(shakeT);
    shakeT = setTimeout(function() { el.classList.remove('shake-sm', 'shake-lg'); }, big ? 500 : 300);
  }

  function flash(color) {
    var el = document.getElementById('stage');
    if (!el) return;
    el.classList.remove('flash-red', 'flash-blue');
    void el.offsetWidth;
    el.classList.add('flash-' + color);
    setTimeout(function() { el.classList.remove('flash-' + color); }, 350);
  }

  // ─── EFFECTS SYSTEM ───
  function spawnSparks(cx, cy, n) {
    for (var i = 0; i < n; i++)
      fx.push({ x:cx+(Math.random()-0.5)*6, y:cy+(Math.random()-0.5)*4,
        ch:['*','+','x','!','#'][i%5], cls:'c-spark',
        dx:(Math.random()-0.5)*0.8, dy:-Math.random()*0.4, ttl:6+Math.floor(Math.random()*8) });
  }
  function spawnSlash(cx, cy) {
    var sc = ['/','\\','|','X','-'];
    for (var i = 0; i < 4; i++)
      fx.push({ x:cx+i-2, y:cy+(i%2?-1:0), ch:sc[i%5], cls:'c-slash', dx:0, dy:0, ttl:4+Math.floor(Math.random()*3) });
  }
  function spawnBlood(cx, cy) {
    for (var i = 0; i < 8; i++)
      fx.push({ x:cx+(Math.random()-0.5)*8, y:cy+(Math.random()-0.5)*4,
        ch:['.',',','*',"'"][i%4], cls:'c-blood',
        dx:(Math.random()-0.5)*0.5, dy:Math.random()*0.2, ttl:12+Math.floor(Math.random()*10) });
  }
  function spawnFire(cx, cy) {
    for (var i = 0; i < 3; i++)
      fx.push({ x:cx+(Math.random()-0.5)*3, y:cy,
        ch:['^','~','*'][i%3], cls:'c-fire-fx',
        dx:(Math.random()-0.5)*0.1, dy:-0.25-Math.random()*0.2, ttl:8+Math.floor(Math.random()*6) });
  }
  function spawnSmoke(cx, cy) {
    fx.push({ x:cx+(Math.random()-0.5)*2, y:cy,
      ch:['.', '\u00b7', '\u00b0'][Math.floor(Math.random()*3)], cls:'c-smoke',
      dx:(Math.random()-0.5)*0.05, dy:-0.15-Math.random()*0.1, ttl:15+Math.floor(Math.random()*10) });
  }
  function spawnHeal(cx, cy) {
    for (var i = 0; i < 4; i++)
      fx.push({ x:cx+(Math.random()-0.5)*5, y:cy-Math.random()*2,
        ch:'+', cls:'c-heal-fx',
        dx:(Math.random()-0.5)*0.1, dy:-0.15-Math.random()*0.1, ttl:10+Math.floor(Math.random()*6) });
  }

  function updateFx() {
    for (var i = fx.length - 1; i >= 0; i--) {
      var p = fx[i];
      p.x += p.dx; p.y += p.dy; p.ttl--;
      if (p.ttl <= 0) fx.splice(i, 1);
    }
  }
  function renderFx() {
    for (var i = 0; i < fx.length; i++) {
      var p = fx[i];
      sc(Math.round(p.x), Math.round(p.y), p.ch, p.cls);
    }
  }

  // ─── WARRIOR AGENTS ───
  function syncAgents() {
    if (!frame) return;
    var seen = {};

    var sides = [
      { data: frame.challenger.warriors || [], prefix: 'c_', side: 'left' },
      { data: frame.defender.warriors || [], prefix: 'd_', side: 'right' },
    ];

    for (var si = 0; si < sides.length; si++) {
      var sd = sides[si];
      for (var i = 0; i < sd.data.length; i++) {
        var w = sd.data[i], key = sd.prefix + i;
        seen[key] = true;

        if (!agents[key]) {
          var startX = sd.side === 'left' ? 10 + i * 6 : W - 17 - i * 6;
          agents[key] = {
            x: startX, tx: startX, state: 'idle', type: w.type || 'pincer',
            level: w.level || 1, name: w.name || '?', molted: w.molted,
            side: sd.side, af: 0, bf: Math.floor(Math.random() * 12),
            speech: '', st: 0, dead: false, df: 0,
          };
        }

        var a = agents[key];
        a.state = w.state; a.type = w.type || 'pincer';
        a.level = w.level || 1; a.name = w.name || '?'; a.molted = w.molted;
        a.dead = w.state === 'dead';

        // Target position
        if (!a.dead) {
          if (sd.side === 'left') {
            if (w.state === 'charging')    a.tx = 6 + i * 9;
            else if (w.state === 'fighting' || w.state === 'defending' || w.state === 'wounded')
                                           a.tx = 26 + i * 6;
            else if (w.state === 'fallen') a.tx = 28 + i * 5;
            else                           a.tx = 10 + i * 7;
          } else {
            if (w.state === 'charging')    a.tx = 74 - i * 9;
            else if (w.state === 'fighting' || w.state === 'defending' || w.state === 'wounded')
                                           a.tx = 54 - i * 6;
            else if (w.state === 'fallen') a.tx = 52 - i * 5;
            else                           a.tx = 70 - i * 7;
          }
        }
      }
    }

    for (var k in agents) {
      if (!seen[k] && !agents[k].dead) delete agents[k];
    }
  }

  function updateAgents() {
    for (var k in agents) {
      var a = agents[k];

      // Smooth move
      if (!a.dead) {
        var dx = a.tx - a.x;
        if (Math.abs(dx) > 0.3) {
          a.x += dx * 0.08;
          if (Math.abs(a.tx - a.x) < 0.3) a.x = a.tx;
        }
      }

      a.bf = (a.bf + 1) % 12;

      if (a.state === 'fighting' || a.state === 'defending' || a.state === 'wounded') {
        a.af = (a.af + 1) % 24;
        // Battle cries
        if (a.st <= 0 && Math.random() < 0.006) {
          var pool = CRIES[a.type] || CRIES.pincer;
          a.speech = pool[Math.floor(Math.random() * pool.length)];
          a.st = 20 + Math.floor(Math.random() * 12);
        }
      }

      if (a.dead) a.df = Math.min(a.df + 1, 36);
      if (a.st > 0) a.st--;
      if (a.st <= 0) a.speech = '';
    }
  }

  function renderAgents() {
    // Gather agents sorted by x so overlaps look right
    var list = [];
    for (var k in agents) list.push(agents[k]);
    list.sort(function(a, b) { return a.x - b.x; });

    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var isL = a.side === 'left';
      var sps = isL ? SP : SPR;
      var ts = sps[a.type] || sps.pincer;

      var sk;
      if (a.dead && a.df >= 24) sk = 'dead';
      else if (a.dead || a.state === 'fallen') sk = 'fall';
      else if (a.state === 'charging') sk = 'charge';
      else sk = 'fight';

      var lines = ts[sk] || ts.fight;

      // Attack jitter
      var jx = 0;
      if (sk === 'fight' && a.af < 12) jx = (a.af % 6 < 3) ? (isL ? 1 : -1) : 0;

      // Bob
      var by = (sk === 'fight') ? (a.bf < 6 ? 0 : -1) : 0;

      var wx = Math.round(a.x) + jx;
      wx = Math.max(0, Math.min(W - 7, wx));

      var cls = 'c-w-' + a.type;
      if (a.molted) cls = 'c-molt';
      if (sk === 'fall') cls = 'c-w-fall';
      if (sk === 'dead') cls = 'c-w-dead';

      for (var r = 0; r < lines.length; r++) {
        ws(wx, GY - lines.length + r + by, lines[r], cls);
      }

      // Label
      if (sk !== 'dead') {
        var lbl = a.type[0].toUpperCase() + a.level + ' ' + a.name.slice(0, 4);
        ws(wx, GY + 1, lbl.slice(0, 7), cls);
      }

      // Speech bubble
      if (a.speech && a.st > 0) {
        var scls = isL ? 'c-speech-c' : 'c-speech-d';
        ws(wx, GY - lines.length - 1 + by, a.speech.slice(0, 7), scls);
      }

      // Spawn clash sparks when opposing warriors overlap
      if (sk === 'fight' && tick % 8 === 0) {
        for (var j = 0; j < list.length; j++) {
          var b = list[j];
          if (b.side !== a.side && !b.dead && Math.abs(a.x - b.x) < 8) {
            var cx = Math.round((a.x + b.x) / 2) + 3;
            spawnSparks(cx, GY - 4, 3);
            if (tick % 16 === 0) spawnSlash(cx, GY - 3);
            break;
          }
        }
      }
    }
  }

  // ─── RENDER PIPELINE ───
  function render() {
    if (!frame) return;
    initG();

    renderSky();
    renderClouds();
    renderHills();
    renderBuildings(frame.challenger.buildings, 8, 28, false, frame.challenger.phase);
    renderBuildings(frame.defender.buildings, 52, 72, true, frame.defender.phase);
    renderSpire(0, frame.challenger.spire, 'c-spire-c');
    renderSpire(W - 7, frame.defender.spire, 'c-spire-d');
    renderGround();
    renderAgents();
    updateFx();
    renderFx();
    renderWeather();
    renderCenter();

    document.getElementById('grid').innerHTML = compose();
  }

  // ─── SKY ───
  function renderSky() {
    var tod = frame.time_of_day || 'day';

    // Stars
    if (tod === 'night' || tod === 'dusk') {
      if (!starField) {
        starField = [];
        for (var sy = 0; sy < 12; sy++)
          for (var sx = 0; sx < W; sx++)
            if (Math.random() < 0.07) starField.push({ x: sx, y: sy, ch: Math.random() < 0.3 ? '*' : '.' });
      }
      var vis = tod === 'night' ? 0.9 : 0.5;
      for (var i = 0; i < starField.length; i++) {
        if (Math.random() < vis) sc(starField[i].x, starField[i].y, starField[i].ch, 'c-star');
      }
    } else {
      starField = null;
    }

    // Sun
    if (tod === 'day' || tod === 'dawn') {
      var sy = tod === 'dawn' ? 4 : 2;
      sc(W - 12, sy, 'O', 'c-sun');
      var gl = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1]];
      for (var g = 0; g < gl.length; g++) {
        var gx = W - 12 + gl[g][0], gy = sy + gl[g][1];
        if (gx >= 0 && gx < W && gy >= 0 && gy < H && grid[gy][gx].ch === ' ')
          sc(gx, gy, '.', 'c-sunglow');
      }
    }

    // Moon
    if (tod === 'night' || tod === 'dusk') {
      sc(12, 2, 'C', 'c-moon');
      var mg = [[-1,0],[1,0],[0,-1],[0,1]];
      for (var m = 0; m < mg.length; m++) {
        var mx = 12 + mg[m][0], my = 2 + mg[m][1];
        if (grid[my] && grid[my][mx] && grid[my][mx].ch === ' ') sc(mx, my, '.', 'c-moon');
      }
    }
  }

  // ─── CLOUDS ───
  function renderClouds() {
    var w = frame.weather || 'clear';
    if (cloudW !== w) { cloudW = w; clouds = genClouds(w); }
    var cls = (w === 'storm') ? 'c-cloudd' : 'c-cloud';
    for (var ci = 0; ci < clouds.length; ci++) {
      var cl = clouds[ci];
      cl.x -= cl.speed;
      if (cl.x < -30) cl.x = W + Math.random() * 20;
      var cx = Math.round(cl.x);
      for (var r = 0; r < cl.shape.length; r++) {
        var row = cl.shape[r];
        for (var c = 0; c < row.length; c++) {
          var gx = cx + c, gy = cl.y + r;
          if (gx >= 0 && gx < W && gy >= 0 && gy < H && row[c] !== ' ')
            sc(gx, gy, row[c], cls);
        }
      }
    }
  }

  // ─── HILLS (3 layers) ───
  function renderHills() {
    for (var hx = 0; hx < W; hx++) {
      var hf = Math.floor(Math.sin(hx * 0.04) * 2.5 + Math.sin(hx * 0.09 + 2) * 1.5 + 2);
      for (var dy = 0; dy <= Math.max(0, hf); dy++) {
        var hy = 10 - hf + dy;
        if (hy >= 0 && hy < GY - 12) sc(hx, hy, '\u00b7', 'c-hill-far');
      }
    }
    for (var hx = 0; hx < W; hx++) {
      var hm = Math.floor(Math.sin(hx * 0.07) * 2 + Math.sin(hx * 0.13 + 1) * 1.5 + 1.5);
      for (var dy = 0; dy <= Math.max(0, hm); dy++) {
        var hy = 13 - hm + dy;
        if (hy >= 0 && hy < GY - 8) sc(hx, hy, dy === 0 ? '\u25aa' : '\u00b7', 'c-hill-mid');
      }
    }
    for (var hx = 0; hx < W; hx++) {
      var hn = Math.floor(Math.sin(hx * 0.11) * 1.5 + Math.sin(hx * 0.19 + 3) * 1 + 1);
      for (var dy = 0; dy <= Math.max(0, hn); dy++) {
        var hy = 16 - hn + dy;
        if (hy >= 0 && hy < GY - 5) sc(hx, hy, '#', 'c-hill-near');
      }
    }
  }

  // ─── BUILDINGS ───
  function renderBuildings(blds, sx, ex, mir, phase) {
    if (!blds) return;
    var maxS = Math.min(4, blds.length);
    var sp = Math.max(6, Math.floor((ex - sx) / (maxS + 1)));

    for (var i = 0; i < maxS; i++) {
      var b = blds[i];
      var bx = mir ? (ex - 3 - i * sp) : (sx + 1 + i * sp);

      var art, cls = 'c-sky-bld';
      if (b.visual_state === 'destroyed') {
        art = BLD_RUB; cls = 'c-sky-ruin';
      } else if (b.visual_state === 'burning') {
        art = BLD[b.type] || BLD.hut;
        cls = (tick % 6 < 3) ? 'c-sky-fire' : 'c-sky-fire2';
        // Fire + smoke particles
        if (tick % 3 === 0) spawnFire(bx + 2, GY - art.length);
        if (tick % 6 === 0) spawnSmoke(bx + 2, GY - art.length - 1);
      } else {
        art = BLD[b.type] || BLD.hut;
      }

      for (var r = 0; r < art.length; r++) {
        var y = GY - art.length + r;
        var line = mir ? mirS(art[r]) : art[r];
        ws(bx, y, line, cls);
      }
    }
  }

  // ─── SPIRE ───
  function renderSpire(x, spire, cls) {
    if (!spire || spire.segments_total === 0) return;
    var dy = GY - 1;

    // Base
    for (var bi = SPIRE_BASE.length - 1; bi >= 0; bi--) { ws(x, dy, SPIRE_BASE[bi], cls); dy--; }

    // Segments
    var tot = Math.min(spire.segments_total, 10);
    for (var s = 0; s < tot; s++) {
      var seg, scls = cls;
      if (spire.collapsed || s < spire.segments_fallen) { seg = SPIRE_F; scls = 'c-spire-fall'; }
      else if (s < spire.segments_fallen + spire.segments_cracked) { seg = SPIRE_C; scls = 'c-spire-crack'; }
      else seg = SPIRE_I;
      ws(x, dy, seg, scls); dy--;
    }

    // Cap
    if (!spire.collapsed && spire.segments_intact > 0) {
      for (var ci = SPIRE_CAP.length - 1; ci >= 0; ci--) { ws(x, dy, SPIRE_CAP[ci], cls); dy--; }
    }
  }

  // ─── GROUND ───
  function renderGround() {
    var cB = frame.challenger.biome || 'plains', dB = frame.defender.biome || 'plains';
    var cG = BIOME[cB] || BIOME.plains, dG = BIOME[dB] || BIOME.plains;

    var wp = 'clash';
    if (frame.challenger.phase === 'spire' || frame.defender.phase === 'spire') wp = 'spire';
    else if (frame.challenger.phase === 'burn' || frame.defender.phase === 'burn') wp = 'burn';
    var wG = WAR_GND[wp];

    // Ground line
    for (var x = 0; x < W; x++) {
      var isC = x >= 30 && x < 50;
      sc(x, GY, isC ? '=' : '_', isC ? 'c-war-line' : 'c-gnd-line');
    }

    // Sub-ground
    for (var dy = 1; dy <= 8; dy++) {
      var y = GY + dy;
      if (y >= H) break;
      for (var x = 0; x < W; x++) {
        var ch, cl;
        if (x >= 30 && x < 50) {
          ch = wG.ch[(x + dy * 3 + tick) % wG.ch.length]; cl = wG.cls;
        } else if (x < 40) {
          ch = cG.ch[(x + dy * 2) % cG.ch.length]; cl = cG.cls;
        } else {
          ch = dG.ch[(x + dy * 2) % dG.ch.length]; cl = dG.cls;
        }
        sc(x, y, ch, cl);
      }
    }

    // Graves of dead warriors
    var cDead = 0, dDead = 0;
    for (var k in agents) {
      var a = agents[k];
      if (a.dead && a.df >= 24) {
        var gx;
        if (a.side === 'left') { gx = 31 + cDead * 5; cDead++; }
        else { gx = 49 - dDead * 5; dDead++; }
        gx = Math.max(28, Math.min(52, gx));
        sc(gx + 2, GY, '+', 'c-grave');
        ws(gx + 1, GY + 1, '.:.', 'c-grave');
        if (cDead > 3 || dDead > 3) break;
      }
    }
  }

  // ─── WEATHER PARTICLES ───
  function renderWeather() {
    var w = frame.weather || 'clear';
    var chars, count;
    if (w === 'rain') { chars = ['|','/']; count = 18; }
    else if (w === 'storm') { chars = ['/','\\','|']; count = 30; }
    else if (w === 'snow') { chars = ['*','\u00b7']; count = 10; }
    else if (w === 'fog') { chars = ['.','\u00b7']; count = 8; }
    else return;

    var cls = (w === 'storm') ? 'c-wstorm' : 'c-weather';
    for (var i = 0; i < count; i++) {
      var px = ((tick * (i * 7 + 3) + i * 41) % W);
      var py = ((tick * (i * 3 + 1) + i * 19) % (GY - 2));
      sc(px, py, chars[i % chars.length], cls);
    }
  }

  // ─── BATTLE CENTER ───
  function renderCenter() {
    if (!frame) return;
    var cx = 37, cy = GY - 12;

    if (frame.status === 'active' && frame.round > 0) {
      // Animated crossing swords
      var swords = (tick % 10 < 5) ? ' \\\\// ' : ' //\\\\ ';
      ws(cx - 2, cy, swords, 'c-clash');

      // Round label
      ws(cx - 1, cy - 2, 'R' + frame.round, 'c-round-txt');

      // Damage numbers
      var lr = frame.latest_round;
      if (lr && lr.damage) {
        if (lr.damage.defender > 0) ws(cx - 6, cy + 1, '-' + lr.damage.defender, 'c-dmg-c');
        if (lr.damage.challenger > 0) ws(cx + 5, cy + 1, '-' + lr.damage.challenger, 'c-dmg-d');
      }

      // Tactical event
      if (lr && lr.tactical_event && lr.tactical_event.description) {
        var txt = lr.tactical_event.description.slice(0, 24);
        ws(Math.floor((W - txt.length) / 2), cy + 3, txt, 'c-event');
      }
    } else if (frame.status === 'countdown') {
      ws(cx - 6, cy, '  PREPARE FOR  ', 'c-countdown');
      ws(cx - 3, cy + 1, '  WAR  ', 'c-countdown');
    } else if (frame.status === 'pending') {
      ws(cx - 6, cy, '  CHALLENGE  ', 'c-round-txt');
      ws(cx - 4, cy + 1, '  ISSUED  ', 'c-round-txt');
    }

    // War banners
    if (frame.status === 'active' || frame.status === 'countdown') {
      // Challenger banner (left)
      var bf = (tick % 12 < 6) ? 0 : 1;
      ws(2, GY - 14, bf ? '|\\' : '|/', 'c-banner-c');
      ws(2, GY - 13, bf ? '|>' : '|\\', 'c-banner-c');
      ws(2, GY - 12, '|', 'c-banner-c');
      // Defender banner (right)
      ws(W - 4, GY - 14, bf ? '/|' : '\\|', 'c-banner-d');
      ws(W - 4, GY - 13, bf ? '<|' : '/|', 'c-banner-d');
      ws(W - 4, GY - 12, ' |', 'c-banner-d');
    }
  }

  // ─── NARRATOR TRIGGERS ───
  function checkNarr() {
    if (!frame || !frame.latest_round) return;
    if (frame.round === lastRound) return;
    lastRound = frame.round;

    var lr = frame.latest_round;
    var did = false;

    // Tactical event
    if (lr.tactical_event && lr.tactical_event.type) {
      var txt = pickN(lr.tactical_event.type);
      if (txt) { narrate(txt, 'n-red'); did = true; }
    }

    // Skill
    if (!did && lr.skill_used && lr.skill_used.color) {
      var stxt = pickN('skill_' + lr.skill_used.color);
      if (stxt) { narrate(stxt, 'n-' + lr.skill_used.color); did = true; }
    }

    // Phase transitions
    if (!did && prev) {
      if (frame.challenger.phase === 'burn' && prev.challenger.phase === 'clash') { narrate(pickN('enter_burn'), 'n-orange'); did = true; }
      else if (frame.defender.phase === 'burn' && prev.defender.phase === 'clash') { narrate(pickN('enter_burn'), 'n-orange'); did = true; }
      else if (frame.challenger.phase === 'spire' && prev.challenger.phase !== 'spire') { narrate(pickN('enter_spire'), 'n-red'); did = true; }
      else if (frame.defender.phase === 'spire' && prev.defender.phase !== 'spire') { narrate(pickN('enter_spire'), 'n-red'); did = true; }
    }

    // Spawn combat effects based on damage
    if (lr.damage) {
      var maxDmg = Math.max(lr.damage.challenger || 0, lr.damage.defender || 0);
      if (maxDmg >= 20) { shake(true); flash('red'); spawnBlood(40, GY - 4); }
      else if (maxDmg >= 10) { shake(false); spawnSparks(40, GY - 4, 6); }
      else if (maxDmg > 0) spawnSparks(40, GY - 4, 3);

      // Damage to specific side → flash that color
      if (lr.damage.challenger > 15) flash('blue');
      if (lr.damage.defender > 15) flash('red');
    }

    // Casualty check from narrative
    if (lr.narrative && lr.narrative.indexOf('lost') !== -1) {
      var commas = (lr.narrative.match(/,/g) || []).length;
      if (commas >= 2) {
        if (!did) narrate(pickN('mass_casualty'), 'n-red');
        spawnBlood(40, GY - 3);
        shake(true);
      }
    }

    // Tidecaller healing check
    if (lr.narrative && lr.narrative.indexOf('healed') !== -1) {
      spawnHeal(40, GY - 4);
    }
  }

  // ─── UI UPDATES ───
  function updateUI() {
    if (!frame) return;
    var c = frame.challenger, d = frame.defender;

    el('c-name', c.name || '???');
    el('d-name', d.name || '???');

    var cP = Math.max(0, (c.hp / c.max_hp) * 100);
    var dP = Math.max(0, (d.hp / d.max_hp) * 100);
    sty('c-fill', 'width', cP + '%');
    sty('d-fill', 'width', dP + '%');
    el('c-hp', c.hp + '/' + c.max_hp);
    el('d-hp', d.hp + '/' + d.max_hp);

    // Critical HP pulse
    var cf = document.getElementById('c-fill');
    var df = document.getElementById('d-fill');
    if (cf) cf.classList.toggle('critical', cP < 25);
    if (df) df.classList.toggle('critical', dP < 25);

    phase('c-phase', c.phase);
    phase('d-phase', d.phase);

    el('round', 'ROUND ' + frame.round + ' / ' + frame.max_rounds);
    el('weather-info', (frame.weather !== 'clear' ? frame.weather + ' \u00b7 ' : '') + (frame.time_of_day || ''));

    var cA = (c.warriors || []).filter(function(w) { return w.state !== 'dead'; }).length;
    var dA = (d.warriors || []).filter(function(w) { return w.state !== 'dead'; }).length;
    el('c-count', '\u2694 ' + cA);
    el('d-count', '\u2694 ' + dA);

    renderSkills('c-skills', c.skills);
    renderSkills('d-skills', d.skills);
    updateLog();
  }

  function el(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; }
  function sty(id, p, v) { var e = document.getElementById(id); if (e) e.style[p] = v; }
  function phase(id, ph) {
    var e = document.getElementById(id);
    if (!e) return;
    e.textContent = (ph || 'clash').toUpperCase();
    e.className = 'phase phase-' + (ph || 'clash');
  }

  function renderSkills(id, skills) {
    var e = document.getElementById(id);
    if (!e) return;
    if (!skills || !skills.length) { e.innerHTML = '<span class="sk-dim">no skills</span>'; return; }
    e.innerHTML = skills.map(function(s) {
      var u = s.used ? ' used' : '';
      return '<span class="sk ' + (s.color || '') + u + '">' + (s.used ? '\u2717' : '\u25cf') + ' ' + esc(s.name) + '</span>';
    }).join(' ');
  }

  function updateLog() {
    var e = document.getElementById('log');
    if (!e || !frame) return;
    e.innerHTML = (frame.battle_log || []).map(function(line) {
      var h = esc(line || '');
      h = h.replace(/\[SKILL\]\s*([^!]+)!/g, '<em class="log-sk">$1</em>');
      h = h.replace(/(\d+)\s*dmg/gi, '<b class="log-dmg">$1 dmg</b>');
      h = h.replace(/(BURN|SPIRE|CLASH)/g, '<b class="log-ph">$1</b>');
      h = h.replace(/lost\s+([^!]+)!/g, '<b class="log-cas">lost $1!</b>');
      return '<div class="log-line">' + h + '</div>';
    }).join('');
    e.scrollTop = e.scrollHeight;
  }

  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ─── RESOLVED ───
  function showResolved() {
    var e = document.getElementById('resolved');
    if (!e || !frame) return;
    e.classList.add('show');
    var c = frame.challenger, d = frame.defender;
    var cW = c.hp > d.hp, draw = c.hp === d.hp;
    var winner = cW ? c.name : d.name, loser = cW ? d.name : c.name;
    var h = draw
      ? '<div class="res-title">DRAW</div><div class="res-sub">Both civilizations survive... barely.</div>'
      : '<div class="res-title">VICTORY</div><div class="res-sub">' + esc(winner) + ' conquers ' + esc(loser) + '</div>' +
        '<div class="res-detail">Final HP: ' + Math.max(c.hp, d.hp) + '/' + c.max_hp + ' | Rounds: ' + frame.round + '</div>';
    h += '<div class="res-links"><a href="/arena">\u2190 ARENA</a> <a href="/">HOME</a></div>';
    e.innerHTML = h;
    narrate(draw ? 'BOTH STAND. NEITHER WINS.' : esc(winner) + ' IS VICTORIOUS', 'n-gold');
  }

  // ─── SSE + INIT ───
  function init() {
    var parts = window.location.pathname.split('/');
    warId = parts[parts.length - 1] || parts[parts.length - 2];
    if (!warId) { el('status', 'No war ID'); return; }

    initG();
    fetchFrame().then(function() { connectSSE(); startLoop(); });
  }

  function fetchFrame() {
    return fetch('/api/wars/' + warId + '/frame')
      .then(function(r) { if (!r.ok) { el('status', 'War not found'); return; } return r.json(); })
      .then(function(d) { if (d) applyFrame(d); })
      .catch(function(e) { el('status', 'Error: ' + e.message); });
  }

  function connectSSE() {
    if (es) es.close();
    es = new EventSource('/api/stream/war?war_id=' + warId);
    el('status', 'LIVE');
    es.addEventListener('war', function(e) {
      try { var d = JSON.parse(e.data); if (d.type === 'frame' || d.challenger) applyFrame(d); } catch(x) {}
    });
    es.addEventListener('error', function() { el('status', 'RECONNECTING...'); });
  }

  function applyFrame(data) {
    prev = frame;
    frame = data;
    syncAgents();
    updateUI();
    checkNarr();
    if (frame.status === 'resolved') showResolved();
  }

  function startLoop() {
    var last = 0, interval = 1000 / FPS;
    function loop(ts) {
      requestAnimationFrame(loop);
      if (ts - last < interval) return;
      last = ts;
      tick++;
      updateAgents();
      if (frame) render();
    }
    requestAnimationFrame(loop);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
