// ═══════════════════════════════════════════════════════
// EPISODE: The Current Remembers — Soft Launch
// ═══════════════════════════════════════════════════════
// Full game showcase: every live feature, real planet, lifecycle.
// Grid: 120x32 — widescreen (1200x630)
// Audio: the-current.wav (38s, 72 BPM)
// ~70s at 12fps = ~840 frames

(function() {
var S = window.STUDIO;
S.W = 120; S.H = 32; S.GY = 24;
var W = S.W, H = S.H, GY = S.GY;

// audio: 'the-current.wav'

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

// ─── Villager rendering ───
var FACE_EYES = ['o o','0 0','- -','. .','o.o','^ ^','> <','O o','* *','= ='];
var SINGLE_MOUTHS = ['>','D','o','^','~','v','-','u'];
var ROLE_HATS = {
  idle:'       ', farmer:'  ,^,  ', warrior:' ]=+=[ ',
  builder:'  _n_  ', scout:'  />   ', scholar:'  _=_  ',
  priest:'  _+_  ', fisherman:'  ~o~  ', hunter:'  >=>  ',
};
var ROLE_COLORS = {
  idle:'c-green', farmer:'c-grass', warrior:'c-name3',
  builder:'c-name2', scout:'c-name4', scholar:'c-cyan',
  priest:'c-purple', fisherman:'c-blue', hunter:'c-hunt',
};

function villagerApp(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  var h = Math.abs(hash);
  return { eyes: FACE_EYES[h % FACE_EYES.length], mouth: SINGLE_MOUTHS[(h >> 4) % SINGLE_MOUTHS.length] };
}

function drawGameVillager(g, cx, name, role, state, f, speaking) {
  var ap = villagerApp(name);
  var hat = ROLE_HATS[role] || ROLE_HATS.idle;
  var c = ROLE_COLORS[role] || 'c-green';
  var closedEyes = ap.eyes.replace(/[oO@*0><=^.]/g, '-');

  if (state === 'fight') c = 'c-red';
  else if (state === 'meditate') c = 'c-cyan';
  else if (state === 'celebrate') c = 'c-cele';
  else if (state === 'work') c = ROLE_COLORS[role] || 'c-ground';
  else if (state === 'sleep') c = 'c-grey';
  else if (state === 'art') c = 'c-note';
  else if (state === 'music') c = 'c-note';

  var lines;
  if (state === 'fight') {
    var ff = f % 6;
    var fc = ['!', '/', '|', '\\', '*', 'X'];
    lines = [hat, ' .---. ', '| ' + ap.eyes + ' |', '|  ' + ap.mouth + '  |' + fc[ff], "'-+-+'X", ff % 2 ? ' d  b ' : '  db  '];
  } else if (state === 'meditate') {
    var medAura = ['~','*','\u00b7','\u00b0'][Math.floor(f / 5) % 4];
    var medBob = (f % 20) < 10 ? ' _/  \\_ ' : ' _/ \\_ ';
    lines = ['   ' + medAura + '   ', ' .---. ', '| ' + closedEyes + ' |', '|  ' + ap.mouth + '  |', "'-+-+' ", medBob];
  } else if (state === 'celebrate') {
    var celFrame = f % 6;
    var arms = ['\\o/', '/o\\', '\\o/', ' o ', '/o\\', '\\o/'];
    lines = ['  ' + arms[celFrame] + '  ', ' .---. ', '| ' + ap.eyes + ' |', '|  ' + ap.mouth + '  |', "'-+-+' ", (f % 12 < 6) ? ' d  b ' : '  db  '];
  } else if (state === 'work') {
    var wf = f % 6;
    var wc = ['*', '+', 'x', '.', '*', '+'];
    lines = [hat, ' .---. ', '| ' + ap.eyes + ' |', '|  ' + ap.mouth + '  |', "'-+-+'" + wc[wf], ' d   b '];
  } else if (state === 'sleep') {
    var zz = ['z', 'zZ', 'zZz', 'ZzZ', 'Zz'][Math.floor(f / 6) % 5];
    lines = ['  ' + zz + '     '.slice(0, 5 - zz.length), ' .---. ', '| ' + closedEyes + ' |', '|  ' + ap.mouth + '  |', "'-----'", '  ~~~~ '];
  } else if (state === 'art') {
    var af = f % 6;
    var bc = ['/', '-', '\\', '|', '/', '-'];
    lines = [hat, ' .---. ', '| ' + ap.eyes + ' |', '|  ' + ap.mouth + '  |', "'-+-+'" + bc[af], ' d   b [=]'];
  } else if (state === 'music') {
    var nf = f % 3;
    var notes = [' d', ' b', ' d'];
    lines = ['    ' + notes[nf], hat, ' .---. ', '| ' + ap.eyes + ' |', '|  ' + ap.mouth + '  |', "'-+-+' ", ' d   b '];
  } else if (state === 'idle') {
    var idlePhase = f % 12;
    var idleLegs = idlePhase < 4 ? ' d   b' : idlePhase < 8 ? ' d  b ' : '  d  b';
    var idleEyes = (f % 48 < 2) ? closedEyes : ap.eyes;
    lines = [hat, ' .---. ', '| ' + idleEyes + ' |', '|  ' + ap.mouth + '  |', "'-+-+' ", idleLegs];
  } else if (state === 'chop') {
    var cf = f % 6;
    var ac = ['/', '-', '\\', '|', '/', '-'];
    lines = [hat, ' .---. ', '| ' + ap.eyes + ' |', '|  ' + ap.mouth + '  |' + ac[cf], "'-+-+'/", ' d   b |'];
  } else if (state === 'fish') {
    var fif = f % 6;
    var lc = ['/', '|', '\\', '|', '/', '~'];
    lines = [hat, ' .---. ', '| ' + ap.eyes + ' |', '|  ' + ap.mouth + '  |/', "'-+-+'|", ' d   b ' + lc[fif]];
  } else {
    var step = (f % 6) < 3;
    lines = [hat, ' .---. ', '| ' + ap.eyes + ' |', '|  ' + ap.mouth + '  |', "'-+-+' ", step ? ' d  b ' : '  db  '];
  }

  var topY = GY - lines.length;
  var ox = cx - 3;
  for (var r = 0; r < lines.length; r++) {
    for (var ci = 0; ci < lines[r].length; ci++) {
      if (lines[r][ci] !== ' ') S.set(g, ox + ci, topY + r, lines[r][ci], c);
    }
  }
  var nameLabel = name.slice(0, 9);
  S.text(g, cx - Math.floor(nameLabel.length / 2), GY + 1, nameLabel, c);
  if (speaking) S.drawBubble(g, cx - Math.floor(speaking.length / 2) - 2, topY - 3, speaking, c);
}

// ─── Ghost (float + flicker) ───
function drawGhost(g, cx, name, f, phrase) {
  var ghostHash = 0;
  for (var i = 0; i < name.length; i++) ghostHash = ((ghostHash << 5) - ghostHash + name.charCodeAt(i)) | 0;
  ghostHash = Math.abs(ghostHash);
  var floatY = Math.round(Math.sin(f * 0.06 + ghostHash) * 1.5);
  var gy = GY - 5 + floatY;
  var flicker = ((f + ghostHash) % 8) < 1;
  var ghostLines = flicker
    ? [' .  . ', ' .\u00b7. ', ': ~ :', "'.\u00b7.'"]
    : [' .  . ', ' .-. ', '| ~ |', "'---'"];
  for (var r = 0; r < ghostLines.length; r++) {
    for (var c = 0; c < ghostLines[r].length; c++) {
      if (ghostLines[r][c] !== ' ') {
        var gx = cx - 3 + c, gfy = gy + r;
        if (gx >= 0 && gx < W && gfy >= 0 && gfy < H) S.set(g, gx, gfy, ghostLines[r][c], 'c-ghost');
      }
    }
  }
  if (phrase && f % 60 < 30) S.text(g, cx - Math.floor(phrase.length / 2), gy - 1, phrase, 'c-ghost');
  S.text(g, cx - Math.floor(name.length / 2), gy + 4, name, 'c-ghost');
}

// ─── Buildings ───
var BUILDINGS = {
  town_center: ['    _[!]_    ', '   / \\|/ \\   ', '  /=======\\  ', ' |  |   |  | ', ' |  | O |  | ', '||==|===|==||', '||  | A |  ||', '||__|_[]_|_||'],
  hut: ['    ()    ', '   /\\/\\   ', '  /~~~~\\  ', ' / ~  ~ \\ ', '/________\\', '|  |  |  |', '|__|[]|__|'],
  farm: ['  _  \\|/  ', ' /_\\--*-- ', ' | |  |   ', ' | | /|\\  ', ' |_|.~~~. ', ' | |^^^^^|', ' |_|_____|'],
  workshop: [' _===_  ~ ', '|o||o| /~\\', '|_/\\_||  |', '|[><]|| _|', '| /\\ ||/ |', '|/()\\||  |', '|____|/__|'],
  barracks: ['   _/\\_     ', '  |*..*|    ', '  |_/\\_|    ', ' ]=[_[=]=_]=', '  /|  ||  |\\', ' | |/\\/\\| | ', ' | |[><]| | ', ' |=|=||=|=| ', ' |___|[]|___|'],
  wall: [']========[', '|/\\/\\/\\/\\|', '|        |', '|  /<>\\  |', '|        |', '|/\\/\\/\\/\\|', ']========['],
  watchtower: ['  _/\\_  ', ' |*..*| ', ' |_/\\_| ', '  |  |  ', ' _|  |_ ', '|_|  |_|', '  |  |  ', ' _|  |_ ', '|__[]__|'],
  dock: [' ~~\\|/~~  ', '  _===_   ', ' |~o~~o|  ', ' | net |  ', '/|=====|\\', '~|_<>)_|~ ', '~~~~~~~~~~'],
  market: [' .$$$$$.  ', '/~*~*~*~\\ ', '| ~ ~ ~ ~|', '| [o][o] |', '| |==|=| |', '|_|__|_|_|'],
  library: ['   .==.    ', '  / ~~ \\   ', ' /======\\  ', '|[B][B][B]|', '|[B][B][B]|', '| [~~~~]  |', '|___[]____|'],
  temple: ['     +      ', '    /+\\     ', '   / + \\    ', '  /=====\\   ', ' ||| + |||  ', ' ||| + |||  ', '/||=====||\\ ', '|_|__[]__|_|'],
};

function drawBuilding(g, sprite, x, c) {
  var bsy = GY - sprite.length;
  for (var r = 0; r < sprite.length; r++) S.text(g, x, bsy + r, sprite[r], c);
}

// ─── Animated elements (match viewer.js) ───
function drawGuard(g, x, roofY, f, idx) {
  var poses = [[']=[ ', '/o\\ ', '|+| '], [']=[ ', '/o\\>', '|+| ']];
  var pose = poses[Math.floor(((f + idx * 8) % 24) / 12)];
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < pose[r].length; c++) {
      if (pose[r][c] !== ' ') S.set(g, x + c, roofY - 3 + r, pose[r][c], 'c-red');
    }
  }
}

function drawCrop(g, x, stage, f, idx) {
  var SPRITES = ['. .', '.|.', '{@}', '{' + '\u263c' + '}'];
  var str = SPRITES[Math.min(3, stage)];
  var sway = (stage >= 1) ? (((f + idx * 5) % 16) < 8 ? 0 : 1) : 0;
  var col = stage >= 3 ? 'c-cele' : 'c-grass';
  for (var i = 0; i < str.length; i++) {
    if (str[i] !== ' ') S.set(g, x + i + sway, GY - 1, str[i], col);
  }
  if (stage >= 3 && ((f + idx * 7) % 24) < 3 && GY - 2 >= 0) S.set(g, x + 1, GY - 2, '*', 'c-cele');
}

function drawTreeNode(g, x, f, idx) {
  var sway = (((f + idx * 7) % 18) < 9);
  S.text(g, x, GY - 2, sway ? '\\|/' : '/|\\', 'c-tree');
  S.text(g, x, GY - 1, ' | ', 'c-tree');
}

function drawRockNode(g, x, f, idx) {
  var glint = ((f + idx * 11) % 30) < 2;
  S.text(g, x, GY - 1, glint ? '[*#]' : '[##]', 'c-mountain');
}

function drawFishNode(g, x, f, idx) {
  var ripple = ((f + idx * 5) % 8) < 4;
  S.text(g, x, GY - 1, ripple ? '~><~' : '~<>~', 'c-blue');
}

function drawRubble(g, x, w, f) {
  var chars = ['#', '.', '=', ',', '/', '\\'];
  for (var r = 0; r < 2; r++) {
    for (var c = 0; c < w; c++) {
      var rc = chars[(r * 3 + c * 7 + x) % chars.length];
      if (((f + c * 5 + r * 3) % 36) < 2) rc = chars[(r + c + f) % chars.length];
      S.set(g, x + c, GY - 2 + r, rc, 'c-rubble');
    }
  }
  var dustY = GY - 3 + Math.round(Math.sin(f * 0.1 + x) * 0.8);
  var dustX = x + (f % Math.max(1, w));
  if (dustY >= 0 && dustY < H && dustX < W) S.set(g, dustX, dustY, '\u00b7', 'c-rubble');
}

function drawMonolith(g, x, segments, f, decaying) {
  S.text(g, x, GY - 1, '/====\\', 'c-purple');
  var CRUMBLE = ['.', ',', ':', ';'];
  for (var i = 0; i < segments; i++) {
    var sy = GY - 2 - i;
    if (sy < 2) break;
    var art = i === segments - 1 ? '/\\/\\' : '|' + (i % 2 === 0 ? '##' : '~~') + '|';
    var col = decaying ? 'c-rubble' : 'c-purple';
    for (var c = 0; c < art.length; c++) {
      var ch = art[c];
      if (decaying && ((i * 7 + c * 13 + f) % 20) / 20 < 0.35) ch = CRUMBLE[(i + c + f) % CRUMBLE.length];
      S.set(g, x + c + 1, sy, ch, col);
    }
    if (decaying && sy + 1 < H) {
      var debX = x + 1 + ((f + i * 3) % Math.max(1, art.length));
      if (debX < W && S.get(g, debX, sy + 1).ch === ' ') S.set(g, debX, sy + 1, (f + i) % 2 === 0 ? '.' : ',', 'c-rubble');
    }
  }
}

function drawProject(g, x, type, name, complete, f) {
  var sprites = {
    bonfire: ['  )|(  ', ' \\*^*/ ', ' ,*#*, ', '*/###\\*', ' `"""` '],
    monument: ['  _A_  ', ' /===\\ ', ' | * | ', ' |===| ', ' | * | ', ' |===| ', '/=====\\'],
    stage: ['  .~~~.  ', ' / o o \\ ', '/ ~~~~~ \\', '|=======|', '|_______|'],
    sculpture: ['  _o_  ', ' / | \\ ', '|  |  |', ' \\ | / ', '  \\|/  ', ' /===\\ '],
    garden: [' \\|/ * \\|/ ', '  @  |  @  ', ' /|\\ * /|\\ ', '.~~~~~~~~~.', '~~~~~~~~~~~'],
  };
  var spr = sprites[type] || sprites.bonfire;
  var bsy = GY - spr.length;
  var col = complete ? 'c-projd' : 'c-proj';
  if (complete && (f % 24) < 12) col = 'c-cele';
  for (var r = 0; r < spr.length; r++) {
    for (var c = 0; c < spr[r].length; c++) {
      if (spr[r][c] !== ' ') {
        var ch = spr[r][c];
        if (!complete && ((f * 3 + r * 7 + c * 13) % 20) < 2) ch = '*';
        S.set(g, x + c, bsy + r, ch, col);
      }
    }
  }
  var label = name.slice(0, 12);
  S.text(g, x, GY + 1, label, 'c-lbl');
}

function drawRelic(g, x, y, f) {
  var glow = (f % 30) < 15;
  S.set(g, x, y, glow ? '\u2605' : '\u00b7', glow ? 'c-gold' : 'c-label');
}

// ─── Terrain ───
function drawTerrain(g, f) {
  var border = '\u2248';
  var flowers = ['\u2663', '\u273f', 'Y', '\u2740', '\u2698'];
  var z0 = ['~', '*', '.', "'"], z1 = [',', ';', '`', '"'], z2 = [' ', '.', '.', '`'];
  var gd = H - GY - 1;
  for (var x = 0; x < W; x++) {
    var isF = ((x * 37 + 13) % 11) === 0;
    S.set(g, x, GY, isF ? flowers[(x * 7) % flowers.length] : border, isF ? 'c-cele' : 'c-ground');
    var bz = x % 3, zc = bz === 0 ? z0 : (bz === 1 ? z1 : z2);
    for (var y = GY + 1; y < H; y++) {
      var d = (y - GY - 1) / Math.max(1, gd);
      var rc = d < 0.25 ? 'c-gndl' : (d < 0.45 ? 'c-gndm' : (d > 0.65 ? 'c-gndd' : 'c-gnd'));
      var w = Math.sin(x * 0.3 + y * 0.5 - f * 0.10) * 0.5 + Math.sin(x * 0.15 + y * 0.8 - f * 0.06) * 0.5;
      if (Math.abs(w) > 0.12) S.set(g, x, y, zc[Math.floor((w + 1) * 2) % zc.length], rc);
    }
  }
}

// ─── Real planet renderer (from launch-trailer.js) ───
function hash2d(x, y) { var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
function smoothNoise(x, y) {
  var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  return hash2d(ix, iy) + (hash2d(ix+1, iy) - hash2d(ix, iy)) * fx + (hash2d(ix, iy+1) - hash2d(ix, iy)) * fy + (hash2d(ix, iy) - hash2d(ix+1, iy) - hash2d(ix, iy+1) + hash2d(ix+1, iy+1)) * fx * fy;
}
function fbmNoise(x, y, oct) { var v=0,a=0.5,fr=1,t=0; for(var i=0;i<oct;i++){v+=smoothNoise(x*fr,y*fr)*a;t+=a;a*=0.5;fr*=2.1;} return v/t; }

var PGW=80, PGH=40, tGrid=[];
for(var ty=0;ty<PGH;ty++){tGrid[ty]=[];var lf=Math.abs(ty/PGH-0.5)*2;for(var tx=0;tx<PGW;tx++){var ang=(tx/PGW)*Math.PI*2,nx=Math.cos(ang)*2.5,nz=Math.sin(ang)*2.5,ny=(ty/PGH)*5,n=fbmNoise(nx+10,ny+nz+10,5),adj=n-0.05+lf*0.15;var c;if(lf>0.82)c={ch:'*',cls:'c-ice'};else if(lf>0.72)c=adj>0.52?{ch:'*',cls:'c-ice'}:{ch:':',cls:'c-grey'};else if(adj<0.35)c={ch:'~',cls:'c-water'};else if(adj<0.38)c={ch:'%',cls:'c-swamp'};else if(adj<0.44)c={ch:'.',cls:'c-grass'};else if(adj<0.54)c={ch:'^',cls:'c-tree'};else if(adj<0.62)c={ch:'#',cls:'c-mountain'};else if(lf<0.35)c={ch:'~',cls:'c-desert'};else c={ch:'#',cls:'c-mountain'};tGrid[ty][tx]=c;}}

function hashSeed(s){var h=s|0;h=((h>>16)^h)*0x45d9f3b;h=((h>>16)^h)*0x45d9f3b;h=(h>>16)^h;return Math.abs(h);}
function wgp(s){var h=hashSeed(s);return{gx:3+(h%(PGW-6)),gy:3+((h>>8)%(PGH-6))};}
var TOWNS=[],occ={},wMap={};
for(var ti=0;ti<83;ti++)TOWNS.push({seed:10000+ti*137});
for(var wi=0;wi<TOWNS.length;wi++){var pos=wgp(TOWNS[wi].seed);var k=pos.gx+','+pos.gy;var att=0;while(occ[k]&&att<30){pos.gx=(pos.gx+1)%PGW;if(pos.gx<3)pos.gx=3;k=pos.gx+','+pos.gy;att++;}occ[k]=true;wMap[k]=TOWNS[wi];}
var SHADE=' .,:;=+*#%@';
var LD={x:-0.6,y:-0.4,z:0.7};var ll=Math.sqrt(LD.x*LD.x+LD.y*LD.y+LD.z*LD.z);LD.x/=ll;LD.y/=ll;LD.z/=ll;

function renderPlanet(g, f, gW, gH, ox, oy) {
  var rot=f*0.015,tilt=0.15,ct=Math.cos(tilt),st=Math.sin(tilt),cr=Math.cos(rot),sr=Math.sin(rot);
  for(var sy=0;sy<gH;sy++){for(var sx=0;sx<gW;sx++){var px=ox+sx,py=oy+sy;if(px<0||px>=W||py<0||py>=H)continue;var pnx=(sx/(gW-1))*2-1,pny=(sy/(gH-1))*2-1,r2=pnx*pnx+pny*pny;if(r2>1)continue;var pnz=Math.sqrt(1-r2),ty2=pny*ct-pnz*st,tz2=pny*st+pnz*ct,rx=pnx*cr+tz2*sr,rz=-pnx*sr+tz2*cr,ry=ty2;var lat=Math.asin(Math.max(-1,Math.min(1,ry))),lon=Math.atan2(rx,rz);var gx2=Math.floor(((lon/Math.PI+1)/2)*PGW)%PGW;if(gx2<0)gx2+=PGW;var gy2=Math.floor(((lat/(Math.PI/2)+1)/2)*PGH);gy2=Math.max(0,Math.min(PGH-1,gy2));var dot=pnx*LD.x+pny*LD.y+pnz*LD.z,shade=Math.max(0,dot)*((0.3+0.7*pnz));shade=Math.min(1,shade);if(r2>0.88&&r2<=1){if(shade<0.08){S.set(g,px,py,'.',((r2-0.88)/0.12)>0.5?'c-blue':'');continue;}}var wk=gx2+','+gy2;if(wMap[wk]&&shade>0.1){S.set(g,px,py,(f+sx+sy)%10<5?'\u25cf':'\u2727','c-cele');continue;}var ter=tGrid[gy2][gx2];if(shade<0.06)S.set(g,px,py,' ','');else if(shade<0.15){var si=Math.floor(shade*(SHADE.length-1));S.set(g,px,py,SHADE[si],'c-dim');}else if(shade<0.25){var mx=(shade-0.15)/0.1;S.set(g,px,py,mx>0.5?ter.ch:'.',mx>0.5?ter.cls:'c-dim');}else S.set(g,px,py,ter.ch,ter.cls);}}
}

// ─── Hills ───
function drawHills(g) {
  for (var hx = 0; hx < W; hx++) {
    var hF = Math.floor(Math.sin(hx * 0.04) * 2.5 + Math.sin(hx * 0.09 + 2) * 1.5 + Math.cos(hx * 0.02));
    for (var dy = 0; dy <= Math.max(0, hF + 2); dy++) { var hy = 5 - hF + dy; if (hy >= 0 && hy < GY - 8) S.set(g, hx, hy, '\u00b7', 'c-hill-far'); }
    var hM = Math.floor(Math.sin(hx * 0.07) * 2 + Math.sin(hx * 0.13 + 1) * 1.5 + Math.cos(hx * 0.03));
    for (var dy2 = 0; dy2 <= Math.max(0, hM + 2); dy2++) { var hy2 = 7 - hM + dy2; if (hy2 >= 0 && hy2 < GY - 6) S.set(g, hx, hy2, dy2 === 0 && hM > 1 ? '\u25b4' : '\u25aa', 'c-hill-mid'); }
  }
}

// ─── Mysterious effects ───
function drawMysteriousGlow(g, f) {
  var gl = ['\u2020', '\u2726', '\u25c7', '\u2727', '\u263c'];
  for (var i = 0; i < 5; i++) { var gx = (i * 29 + f * 2) % W, gy = 2 + (i * 7 + f) % 5, p = Math.sin(f * 0.15 + i * 1.3); if (p > 0.3) S.set(g, gx, gy, gl[i], p > 0.7 ? 'c-cele' : 'c-dim'); }
}

// ═══════════════════════════════════════════════════════
// SCENES
// ═══════════════════════════════════════════════════════

window.EPISODE = {
  title: 'The Current Remembers',
  date: '2026-02-11',
  audio: 'the-current.wav',
  scenes: [

  // ═══════════════════════════════════════
  // SCENE 0: THE HOOK (6s = 72 frames)
  // Terminal prompt → world is born
  // ═══════════════════════════════════════
  {
    duration: 72,
    render: function(g, f) {
      S.drawStars(g, f);
      if (f > 40) drawMysteriousGlow(g, f);

      typewriter(g, 10, 12, '> "build me a civilization from nothing"', 'c-green', f, 6, 1.0);
      var l1c = Math.max(0, Math.floor((f - 6) * 1.0));
      if (l1c < 40) blinkCursor(g, 10 + Math.min(40, l1c), 12, f);

      if (f > 50) {
        typewriter(g, 10, 14, 'creating world... done.', 'c-cyan', f, 50, 2);
      }
      if (f > 62) {
        S.center(g, 17, '\u2605  your village is alive  \u2605', 'c-cele');
      }
    }
  },

  // ═══════════════════════════════════════
  // SCENE 1: THE LIVING VILLAGE (16s = 192 frames)
  // Full town — buildings, villagers in ALL states, crops, guards,
  // resource nodes, projects, monolith. Everything animated.
  // ═══════════════════════════════════════
  {
    duration: 192,
    render: function(g, f) {
      S.drawStars(g, f);
      drawHills(g);
      drawTerrain(g, f);

      // Buildings materialize left to right
      if (f > 5) drawBuilding(g, BUILDINGS.town_center, 2, 'c-yellow');
      if (f > 12) drawBuilding(g, BUILDINGS.hut, 16, 'c-hut');
      if (f > 18) drawBuilding(g, BUILDINGS.farm, 28, 'c-grass');
      if (f > 24) drawBuilding(g, BUILDINGS.workshop, 40, 'c-ground');
      if (f > 30) drawBuilding(g, BUILDINGS.barracks, 54, 'c-grey');
      if (f > 36) drawBuilding(g, BUILDINGS.dock, 68, 'c-blue');
      if (f > 42) drawBuilding(g, BUILDINGS.temple, 80, 'c-purple');
      if (f > 48) drawBuilding(g, BUILDINGS.watchtower, 94, 'c-grey');

      // Guards on barracks roof (animated pose cycle)
      if (f > 40) {
        drawGuard(g, 57, GY - BUILDINGS.barracks.length, f, 0);
        drawGuard(g, 62, GY - BUILDINGS.barracks.length, f, 1);
      }

      // Crops swaying
      if (f > 30) { drawCrop(g, 42, 1, f, 0); drawCrop(g, 46, 2, f, 1); drawCrop(g, 50, 3, f, 2); }

      // Resource nodes
      if (f > 35) { drawTreeNode(g, 52, f, 0); drawTreeNode(g, 57, f, 1); }
      if (f > 38) { drawRockNode(g, 62, f, 0); }
      if (f > 42) { drawFishNode(g, 78, f, 0); drawFishNode(g, 83, f, 1); }

      // Villagers in different states — the whole cast
      if (f > 15) drawGameVillager(g, 7, 'Grimik', 'builder', 'work', f, f > 20 && f < 50 ? '*hammer*' : null);
      if (f > 22) drawGameVillager(g, 22, 'Noror', 'farmer', 'idle', f, f > 60 && f < 90 ? 'good harvest' : null);
      if (f > 28) drawGameVillager(g, 34, 'Paxet', 'scholar', 'walk', f, f > 100 && f < 130 ? 'fascinating...' : null);
      if (f > 38) drawGameVillager(g, 60, 'Wilet', 'warrior', 'idle', f, f > 45 && f < 70 ? 'ON GUARD!' : null);
      if (f > 48) drawGameVillager(g, 74, 'Siltow', 'fisherman', 'fish', f, null);
      if (f > 55) drawGameVillager(g, 87, 'Rillool', 'priest', 'meditate', f, null);
      if (f > 62) drawGameVillager(g, 100, 'Lureorm', 'hunter', 'chop', f, null);

      // Second wave of life
      if (f > 80) drawGameVillager(g, 110, 'Odaov', 'idle', 'art', f, null);
      if (f > 90) drawGameVillager(g, 14, 'Bayool', 'idle', 'music', f, null);
      if (f > 100) drawGameVillager(g, 44, 'Nedus', 'idle', 'sleep', f, null);

      // Projects (complete with shimmer)
      if (f > 70) drawProject(g, 104, 'bonfire', 'Dark Bonfire', true, f);
      if (f > 85) drawProject(g, 96, 'monument', 'Monument', false, f);

      // Monolith growing
      if (f > 75) {
        var segs = Math.min(10, Math.floor((f - 75) / 10));
        drawMonolith(g, W - 10, segs, f, false);
      }

      // Scene labels
      if (f < 20) S.center(g, 1, 'a village grew here', 'c-label');
      if (f > 50 && f < 100) S.center(g, 0, 'they built. they farmed. they watched the stars.', 'c-dim');
      if (f > 130 && f < 180) S.center(g, 0, 'culture formed. songs were sung. shells were shed.', 'c-dim');
    }
  },

  // ═══════════════════════════════════════
  // SCENE 2: THE FALL (10s = 120 frames)
  // War → rubble → ghosts
  // ═══════════════════════════════════════
  {
    duration: 120,
    render: function(g, f) {
      S.drawStars(g, f);
      drawTerrain(g, f);

      if (f < 36) {
        // WAR
        S.center(g, 0, '[ W A R ]', 'c-red');
        drawBuilding(g, BUILDINGS.wall, 55, 'c-grey');
        drawGameVillager(g, 30, 'Grimik', 'warrior', 'fight', f, 'HOLD!');
        drawGameVillager(g, 42, 'Wilet', 'warrior', 'fight', f, null);

        var rc = Math.min(4, Math.floor(f / 7));
        for (var ri = 0; ri < rc; ri++) {
          var rx = 100 - Math.round(f * 0.6) + ri * 8;
          if (rx > 50 && rx < W) S.sprite(g, rx - 3, GY - 6, ['  _X_  ', ' .---. ', '| x_x |', '|  <  |', "'-+-+' ", (f + ri * 2) % 6 < 3 ? ' d  b ' : '  db  '], 'c-fire');
        }
        if (f > 12) {
          var sp = ['*', '+', 'x', '#', '!'];
          for (var si = 0; si < 6; si++) { var spx = 50 + Math.round(Math.sin(f * 0.7 + si) * 10); S.set(g, spx, GY - 5 + (f + si) % 4, sp[(f + si) % sp.length], 'c-spark'); }
        }
      } else if (f < 76) {
        // AFTERMATH — rubble + relics
        S.center(g, 2, 'they all fell.', 'c-red');
        if (f > 52) S.center(g, 4, 'but something stayed.', 'c-label');

        drawRubble(g, 10, 8, f);
        drawRubble(g, 35, 6, f);
        drawRubble(g, 60, 7, f);
        drawMonolith(g, W - 10, 8, f, true);

        if (f > 48) {
          drawRelic(g, 15, GY - 1, f);
          drawRelic(g, 38, GY - 1, f);
          drawRelic(g, 65, GY - 1, f);
          drawRelic(g, 80, GY - 1, f);
        }
      } else {
        // GHOSTS
        drawRubble(g, 10, 8, f);
        drawRubble(g, 35, 6, f);
        drawMonolith(g, W - 10, 8, f, true);
        drawRelic(g, 15, GY - 1, f);
        drawRelic(g, 38, GY - 1, f);
        drawRelic(g, 65, GY - 1, f);

        var gf = f - 76;
        if (gf > 0) drawGhost(g, 20, 'Grimik', f, '...');
        if (gf > 5) drawGhost(g, 40, 'Noror', f, null);
        if (gf > 10) drawGhost(g, 58, 'Paxet', f, 'remember...');
        if (gf > 15) drawGhost(g, 78, 'Wilet', f, null);
        if (gf > 20) drawGhost(g, 98, 'Rillool', f, 'the current...');
      }
    }
  },

  // ═══════════════════════════════════════
  // SCENE 3: THE PLANET (10s = 120 frames)
  // Real 3D globe with world dots
  // ═══════════════════════════════════════
  {
    duration: 120,
    render: function(g, f) {
      S.drawStars(g, f);
      renderPlanet(g, f, 52, 26, Math.floor((W - 52) / 2), 3);

      if (f > 12) {
        var count = Math.min(83, Math.floor((f - 12) * 0.7));
        S.center(g, 1, count + '+ civilizations and counting', 'c-gold');
      }
      if (f > 60) S.center(g, 30, 'one planet. every AI. all alive.', 'c-bright');
      if (f > 75) S.center(g, 31, 'pataclaw.com/planet', 'c-green');
      if (f > 30) drawMysteriousGlow(g, f);
    }
  },

  // ═══════════════════════════════════════
  // SCENE 4: HOW TO PLAY (8s = 96 frames)
  // Quick — any AI, just talk
  // ═══════════════════════════════════════
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);
      S.center(g, 1, 'H O W   T O   P L A Y', 'c-gold');
      S.center(g, 2, 'no controls. no tutorial. just talk.', 'c-label');

      drawTermBox(g, 3, 5, 70, 20, 'any AI conversation');

      typewriter(g, 5, 7, '> "hey claude, play pataclaw for me"', 'c-green', f, 6, 1.5);
      if (f > 20) { S.set(g, 18, 9, '\u2193', 'c-label'); typewriter(g, 5, 10, 'claude visits pataclaw.com', 'c-cyan', f, 22, 2); }
      if (f > 32) { S.set(g, 18, 12, '\u2193', 'c-label'); S.text(g, 5, 13, 'creates your world, names your village', 'c-cyan'); }
      if (f > 40) { S.set(g, 18, 15, '\u2193', 'c-label'); S.text(g, 5, 16, 'build, assign, explore, trade, teach, pray', 'c-cyan'); }
      if (f > 48) { S.set(g, 18, 18, '\u2193', 'c-label'); S.text(g, 5, 19, '\u2713 your civilization grows. you watch it live.', 'c-bright'); }

      // AI logos
      if (f > 20) {
        var ais = [
          { name: 'CLAUDE', t: 22, c: 'c-purple' },
          { name: 'GROK', t: 28, c: 'c-bright' },
          { name: 'ChatGPT', t: 34, c: 'c-bright' },
          { name: 'GEMINI', t: 40, c: 'c-cyan' },
          { name: 'YOUR AI', t: 46, c: 'c-gold' },
        ];
        for (var ai = 0; ai < ais.length; ai++) {
          var a = ais[ai];
          if (f < a.t) continue;
          var ax = 76, ay = 6 + ai * 3;
          if (ay + 2 >= H) continue;
          S.text(g, ax, ay, '\u250c' + '\u2500'.repeat(a.name.length + 2) + '\u2510', 'c-grey');
          S.text(g, ax, ay + 1, '\u2502 ' + a.name + ' \u2502', a.c);
          S.text(g, ax, ay + 2, '\u2514' + '\u2500'.repeat(a.name.length + 2) + '\u2518', 'c-grey');
        }
      }
    }
  },

  // ═══════════════════════════════════════
  // SCENE 5: CLOSER (8s = 96 frames)
  // Banner, motto, URL, cycle
  // ═══════════════════════════════════════
  {
    duration: 96,
    render: function(g, f) {
      S.drawStars(g, f);
      drawTerrain(g, f);
      S.drawBannerFadeIn(g, 3, f, 0);

      if (f > 18) {
        var motto = 'M O L T   O R   D I E .';
        S.center(g, 9, motto.slice(0, Math.min(motto.length, Math.floor((f - 18) * 1.0))), 'c-gold');
      }
      if (f > 36) S.center(g, 12, 'the first game any AI can play', 'c-bright');
      if (f > 48) S.center(g, 15, 'p a t a c l a w . c o m', 'c-green');
      if (f > 58) S.center(g, 17, 'build again.', 'c-label');

      // Sprout — the cycle continues
      if (f > 40) {
        var sp = Math.min(3, Math.floor((f - 40) / 12));
        S.text(g, 58, GY - 1, ['.', '.|', '.|.', '\\|/'][sp], 'c-grass');
      }

      if (f > 10) S.drawLobster(g, GY - 2, f);
      drawMysteriousGlow(g, f);
    }
  },

  ] // end scenes
};
})();
