const { buildFrame } = require('./ascii');

const BG_COLOR = '#0a0a0a';
const CHAR_WIDTH = 7.2;
const CHAR_HEIGHT = 14;
const FONT_SIZE = 12;
const PADDING = 8;
const W = 80; // columns

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateSvg(worldId) {
  const data = buildFrame(worldId, 'town');
  if (!data || !data.world) return null;

  const w = data.world;
  const lines = [];
  const colors = []; // parallel array of fill colors per line

  const YELLOW = '#ffcc00';
  const GREEN = '#00ff41';
  const BROWN = '#aa8855';
  const DARK_GREEN = '#336622';
  const HILL_GREEN = '#446633';
  const SKY_BLUE = '#aabbdd';
  const DIM = '#555555';
  const PROJECT = '#ffaa33';
  const NAME = '#dddd66';
  const CULTURE = '#cc66ff';

  // ── Title box ──
  const border = '\u2554' + '\u2550'.repeat(W - 2) + '\u2557';
  const title = (w.town_number ? '#' + w.town_number + ' ' : '') + (w.name || 'Unknown');
  const sub = 'Day ' + w.day_number + ' | ' + w.season + ' | ' + w.time_of_day + ' | ' + w.weather;
  const botBorder = '\u255a' + '\u2550'.repeat(W - 2) + '\u255d';
  lines.push(border);                                                colors.push(YELLOW);
  lines.push('\u2551 ' + title.padEnd(W - 4).slice(0, W - 4) + ' \u2551'); colors.push(YELLOW);
  lines.push('\u2551 ' + sub.padEnd(W - 4).slice(0, W - 4) + ' \u2551');   colors.push(DIM);
  lines.push(botBorder);                                             colors.push(YELLOW);

  // ── Sky ──
  let skyLine = '';
  for (let x = 0; x < W; x++) {
    if (w.weather === 'rain' && Math.random() < 0.04) skyLine += '.';
    else if (w.weather === 'snow' && Math.random() < 0.03) skyLine += '*';
    else if (w.weather === 'storm' && Math.random() < 0.06) skyLine += '/';
    else skyLine += ' ';
  }
  for (let i = 0; i < 3; i++) {
    lines.push(skyLine); colors.push(SKY_BLUE);
  }

  // ── Hills ──
  let hillLine = '';
  for (let hx = 0; hx < W; hx++) {
    const h = Math.sin(hx * 0.06) * 2.5 + Math.sin(hx * 0.12) * 1.5;
    hillLine += h > 2 ? '\u25b2' : h > 1 ? '\u25b4' : h > 0 ? '\u00b7' : ' ';
  }
  lines.push(hillLine); colors.push(HILL_GREEN);

  // ── Buildings from sprite data ──
  const buildings = (data.buildings || []).filter(b => b.status !== 'overgrown' && b.status !== 'rubble');
  let maxH = 0;
  for (const b of buildings) {
    if (b.sprite && b.sprite.length > maxH) maxH = b.sprite.length;
  }
  maxH = Math.min(maxH || 4, 8);

  for (let row = 0; row < maxH; row++) {
    let bLine = ' ';
    let bx = 1;
    for (const b of buildings) {
      if (bx >= W - 2) break;
      const sp = b.sprite;
      if (!sp || !sp.length) continue;
      const startRow = maxH - sp.length;
      const ch = row >= startRow ? (sp[row - startRow] || '') : '';
      const pad = sp[0] ? sp[0].length : 6;
      bLine += ch.padEnd(pad).slice(0, pad) + ' ';
      bx += pad + 1;
    }
    lines.push(bLine.padEnd(W).slice(0, W)); colors.push(BROWN);
  }

  // ── Ground ──
  lines.push('\u2550'.repeat(W)); colors.push(DARK_GREEN);

  // ── Villagers ──
  const villagers = data.villagers || [];
  if (villagers.length > 0) {
    let vHead = ' ';
    let vBody = ' ';
    let vName = ' ';
    for (let i = 0; i < Math.min(villagers.length, 12); i++) {
      const v = villagers[i];
      const eyes = (v.appearance && v.appearance.eyes) ? v.appearance.eyes : 'o o';
      vHead += '.' + eyes.slice(0, 3) + '.  ';
      vBody += ' /|\\  ';
      vName += (v.name || '?').slice(0, 5).padEnd(6);
    }
    lines.push(vHead.slice(0, W)); colors.push(GREEN);
    lines.push(vBody.slice(0, W)); colors.push(GREEN);
    lines.push(vName.slice(0, W)); colors.push(NAME);
  }

  // ── Projects ──
  const projects = (data.projects || []).filter(p => p.status === 'complete');
  if (projects.length > 0) {
    let pLine = ' \u2666 ';
    for (let i = 0; i < Math.min(projects.length, 5); i++) {
      pLine += projects[i].name.slice(0, 14) + '  ';
    }
    lines.push(pLine.slice(0, W)); colors.push(PROJECT);
  }

  // ── Ground texture ──
  const groundChars = [',', "'", '.', '~', '*', '.', ',', "'"];
  for (let gy = 0; gy < 3; gy++) {
    let gLine = '';
    for (let gx = 0; gx < W; gx++) {
      const ci = Math.floor((Math.sin(gx * 0.3 + gy * 0.5) + 1) * 4) % groundChars.length;
      gLine += groundChars[ci];
    }
    lines.push(gLine); colors.push(DARK_GREEN);
  }

  // ── Culture ──
  if (data.culture) {
    lines.push(' \u2666 ' + (data.culture.descriptor || 'CALM')); colors.push(CULTURE);
  }

  // ── Resource bar ──
  const res = data.resources || {};
  const pop = data.population || {};
  const resLine = ' \u2617' + ((res.food || {}).amount || 0) +
    ' \u2692' + ((res.wood || {}).amount || 0) +
    ' \u25a8' + ((res.stone || {}).amount || 0) +
    ' \u2606' + ((res.knowledge || {}).amount || 0) +
    ' \u25c9' + ((res.crypto || {}).amount || 0) +
    ' \u271e' + ((res.faith || {}).amount || 0) +
    '  Pop:' + (pop.alive || 0) + '/' + (pop.capacity || 0);
  lines.push('\u2500'.repeat(W)); colors.push(YELLOW);
  lines.push(resLine.slice(0, W)); colors.push(YELLOW);

  // ── Build SVG ──
  const totalRows = lines.length;
  const width = Math.ceil(W * CHAR_WIDTH + PADDING * 2);
  const height = Math.ceil(totalRows * CHAR_HEIGHT + PADDING * 2);

  let textElements = '';
  for (let row = 0; row < totalRows; row++) {
    const line = lines[row];
    if (!line) continue;
    const y = PADDING + (row + 1) * CHAR_HEIGHT;
    const fill = colors[row] || GREEN;
    textElements += `<text x="${PADDING}" y="${y}" fill="${fill}">${escapeXml(line)}</text>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${BG_COLOR}"/>
  <style>text { font-family: 'Courier New', monospace; font-size: ${FONT_SIZE}px; white-space: pre; }</style>
  ${textElements}
</svg>`;
}

module.exports = { generateSvg };
