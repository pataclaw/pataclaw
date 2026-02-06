const db = require('../db/connection');
const { TERRAIN_CHARS, FEATURE_CHARS, BUILDING_SPRITES, VILLAGER_SPRITES, WEATHER_OVERLAYS } = require('./sprites');
const { MAP_SIZE } = require('../world/map');

// Build a map view frame (zoomed out, full map)
function renderMapView(worldId) {
  const world = db.prepare('SELECT map_size FROM worlds WHERE id = ?').get(worldId);
  const mapSize = (world && world.map_size) || MAP_SIZE;
  const tiles = db.prepare('SELECT x, y, terrain, explored, feature FROM tiles WHERE world_id = ?').all(worldId);
  const buildings = db.prepare('SELECT x, y, type FROM buildings WHERE world_id = ? AND status != ?').all(worldId, 'destroyed');
  const villagers = db.prepare('SELECT x, y FROM villagers WHERE world_id = ? AND status = ?').all(worldId, 'alive');

  const grid = [];
  for (let y = 0; y < mapSize; y++) {
    grid[y] = new Array(mapSize).fill(' ');
  }

  // Terrain layer
  for (const t of tiles) {
    if (t.y >= mapSize || t.x >= mapSize) continue;
    if (!t.explored) {
      grid[t.y][t.x] = TERRAIN_CHARS.fog;
    } else if (t.feature && FEATURE_CHARS[t.feature]) {
      grid[t.y][t.x] = FEATURE_CHARS[t.feature];
    } else {
      grid[t.y][t.x] = TERRAIN_CHARS[t.terrain] || '.';
    }
  }

  // Building markers
  for (const b of buildings) {
    if (b.y >= 0 && b.y < mapSize && b.x >= 0 && b.x < mapSize) {
      grid[b.y][b.x] = b.type === 'town_center' ? '\u2588' : '\u25a0';
    }
  }

  // Villager markers
  for (const v of villagers) {
    if (v.y >= 0 && v.y < mapSize && v.x >= 0 && v.x < mapSize) {
      grid[v.y][v.x] = '\u263a';
    }
  }

  return grid.map((row) => row.join('')).join('\n');
}

// Stamp a sprite onto a frame at position (px, py)
function stamp(frame, sprite, px, py, WIDTH, HEIGHT) {
  for (let row = 0; row < sprite.length; row++) {
    for (let col = 0; col < sprite[row].length; col++) {
      const fx = px + col;
      const fy = py + row;
      if (fx >= 0 && fx < WIDTH && fy >= 0 && fy < HEIGHT) {
        if (sprite[row][col] !== ' ') {
          frame[fy][fx] = sprite[row][col];
        }
      }
    }
  }
}

// Build a town view frame (zoomed in, detailed ASCII art)
function renderTownView(worldId) {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  if (!world) return '';

  const WIDTH = 100;
  const HEIGHT = 42;
  const frame = [];
  for (let y = 0; y < HEIGHT; y++) {
    frame[y] = new Array(WIDTH).fill(' ');
  }

  const groundY = 33;

  // Ground with texture
  for (let x = 0; x < WIDTH; x++) {
    frame[groundY][x] = '\u2550'; // double horizontal line
    // Grass texture below
    for (let gy = groundY + 1; gy < HEIGHT; gy++) {
      const r = Math.random();
      if (r < 0.1) frame[gy][x] = ',';
      else if (r < 0.15) frame[gy][x] = "'";
      else if (r < 0.2) frame[gy][x] = '`';
      else if (r < 0.22) frame[gy][x] = '"';
    }
  }

  // Decorative horizon hills in background
  const hillY = 8;
  for (let x = 0; x < WIDTH; x++) {
    const h = Math.floor(Math.sin(x * 0.08) * 2 + Math.sin(x * 0.15) * 1.5);
    for (let dy = 0; dy <= Math.abs(h); dy++) {
      const hy = hillY - h + dy;
      if (hy >= 0 && hy < groundY && frame[hy][x] === ' ') {
        frame[hy][x] = '\u00b7'; // subtle dots for hills
      }
    }
  }

  // Get buildings
  const buildings = db.prepare(
    'SELECT * FROM buildings WHERE world_id = ? AND status != ? ORDER BY x'
  ).all(worldId, 'destroyed');

  // Place buildings on the frame
  let bx = 3;
  for (const b of buildings) {
    const sprite = BUILDING_SPRITES[b.type];
    if (!sprite) continue;

    const spriteH = sprite.length;
    const spriteW = sprite[0] ? sprite[0].length : 0;
    const startY = groundY - spriteH;

    stamp(frame, sprite, bx, startY, WIDTH, HEIGHT);

    // Building label below ground
    const labelY = groundY + 1;
    const label = b.type.toUpperCase();
    const shortLabel = label.length > spriteW ? label.slice(0, spriteW) : label;
    const labelX = bx + Math.floor((spriteW - shortLabel.length) / 2);
    for (let i = 0; i < shortLabel.length && labelX + i < WIDTH; i++) {
      frame[labelY][labelX + i] = shortLabel[i];
    }

    // Construction progress
    if (b.status === 'constructing') {
      const pct = Math.max(0, 100 - (b.construction_ticks_remaining * 10));
      const bar = `[\u2591${'\u2588'.repeat(Math.floor(pct / 20))}${'\u2591'.repeat(5 - Math.floor(pct / 20))}] ${pct}%`;
      const barY = groundY + 2;
      for (let i = 0; i < bar.length && bx + i < WIDTH; i++) {
        frame[barY][bx + i] = bar[i];
      }
    }

    bx += spriteW + 2;
    if (bx > WIDTH - 14) break;
  }

  // Place villagers along the bottom area
  const villagers = db.prepare(
    'SELECT * FROM villagers WHERE world_id = ? AND status = ?'
  ).all(worldId, 'alive');

  // Find clear spots for villagers (after buildings)
  let vx = Math.max(bx + 2, 5);
  // If too far right, wrap villagers to start from left below buildings
  if (vx > WIDTH - 20) vx = 5;

  for (const v of villagers) {
    const sprite = VILLAGER_SPRITES[v.role] || VILLAGER_SPRITES.idle;
    const spriteH = sprite.length;
    const spriteW = sprite[0] ? sprite[0].length : 0;
    const startY = groundY - spriteH;

    // Check if space is clear
    let clear = true;
    for (let row = 0; row < spriteH && clear; row++) {
      for (let col = 0; col < spriteW && clear; col++) {
        const fx = vx + col;
        const fy = startY + row;
        if (fx < WIDTH && fy >= 0 && fy < HEIGHT) {
          if (frame[fy][fx] !== ' ' && frame[fy][fx] !== '\u00b7' && sprite[row][col] !== ' ') {
            clear = false;
          }
        }
      }
    }

    if (!clear) {
      vx += 2;
      // Skip ahead to find space
      if (vx > WIDTH - spriteW - 2) break;
      continue;
    }

    stamp(frame, sprite, vx, startY, WIDTH, HEIGHT);

    // Name label
    const nameY = groundY + 1;
    const name = v.name.slice(0, 7);
    const nameX = vx + Math.floor((spriteW - name.length) / 2);
    for (let i = 0; i < name.length && nameX + i < WIDTH; i++) {
      if (frame[nameY][nameX + i] === ' ' || frame[nameY][nameX + i] === ',' || frame[nameY][nameX + i] === "'") {
        frame[nameY][nameX + i] = name[i];
      }
    }

    // Trait indicator
    const traitIcon = {
      brave: '\u2666', clever: '\u2605', strong: '\u25b2', kind: '\u2665',
      curious: '?', stubborn: '!', timid: '\u00b7', lazy: 'z',
    };
    if (v.trait && traitIcon[v.trait]) {
      const iconY = startY - 1;
      const iconX = vx + Math.floor(spriteW / 2);
      if (iconY >= 0 && iconX < WIDTH) {
        frame[iconY][iconX] = traitIcon[v.trait];
      }
    }

    vx += spriteW + 2;
    if (vx > WIDTH - spriteW - 2) break;
  }

  // Weather overlay
  const weatherChar = WEATHER_OVERLAYS[world.weather];
  if (weatherChar) {
    for (let y = 0; y < groundY - 2; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (frame[y][x] === ' ' && Math.random() < 0.025) {
          frame[y][x] = weatherChar;
        }
      }
    }
  }

  // Stars at night
  if (world.time_of_day === 'night') {
    for (let y = 0; y < hillY; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (frame[y][x] === ' ' && Math.random() < 0.01) {
          frame[y][x] = Math.random() < 0.3 ? '\u2726' : '\u00b7';
        }
      }
    }
  }

  // Title bar - box-drawing style
  const title = ` ${world.name}  \u2502  Day ${world.day_number}  \u2502  ${world.season}  \u2502  ${world.time_of_day}  \u2502  ${world.weather} `;
  const topBorder = '\u2554' + '\u2550'.repeat(WIDTH - 2) + '\u2557';
  const titlePadded = '\u2551' + title.padStart(Math.floor((WIDTH - 2 + title.length) / 2)).padEnd(WIDTH - 2) + '\u2551';
  const botBorder = '\u255a' + '\u2550'.repeat(WIDTH - 2) + '\u255d';

  const composed = frame.map((row) => row.join('')).join('\n');
  return topBorder + '\n' + titlePadded + '\n' + botBorder + '\n' + composed;
}

// Build status bar string
function renderStatusBar(worldId) {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
  const resources = db.prepare('SELECT type, amount FROM resources WHERE world_id = ?').all(worldId);
  const popAlive = db.prepare('SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = ?').get(worldId, 'alive');
  const buildingCap = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'hut' THEN level * 3 WHEN type = 'town_center' THEN 5 ELSE 0 END), 5) as cap FROM buildings WHERE world_id = ? AND status = 'active'").get(worldId);

  if (!world) return '';

  const resMap = {};
  for (const r of resources) resMap[r.type] = Math.floor(r.amount);

  return `\u2502 Day ${world.day_number} \u2502 ${world.season} \u2502 ${world.weather} \u2502 ` +
    `Pop: ${popAlive.c}/${buildingCap.cap} \u2502 ` +
    `\u2617 ${resMap.food || 0}  \u2692 ${resMap.wood || 0}  \u25a8 ${resMap.stone || 0}  ` +
    `\u2606 ${resMap.knowledge || 0}  \u25c9 ${resMap.gold || 0}  \u271e ${resMap.faith || 0} \u2502`;
}

module.exports = { renderMapView, renderTownView, renderStatusBar };
