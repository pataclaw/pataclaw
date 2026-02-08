const { BUILDING_SPRITES, PROJECT_SPRITES, VILLAGER_SPRITES, FEATURE_CHARS } = require('./sprites');

// ── Constants (match nft-image.js) ──
const BG_COLOR = '#0a0a0a';
const CHAR_WIDTH = 7.2;
const CHAR_HEIGHT = 14;
const FONT_SIZE = 12;
const PADDING = 12;
const W = 140; // wider than NFT (80) for 1200px OG cards

// ── Colors ──
const YELLOW    = '#ffcc00';
const GREEN     = '#00ff41';
const BROWN     = '#aa8855';
const DIM       = '#555555';
const CULTURE   = '#cc66ff';
const RED       = '#ff4444';
const CYAN      = '#66ccff';
const WHITE     = '#dddddd';
const ORANGE    = '#ffaa33';

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Badge labels by event type ──
const TYPE_BADGES = {
  legendary_discovery: '\u2605 LEGENDARY DISCOVERY',
  miracle:             '\u2605 MIRACLE',
  ancient_forge:       '\u2605 ANCIENT FORGE',
  crystal_spire:       '\u2605 CRYSTAL SPIRE',
  shadow_keep:         '\u2605 SHADOW KEEP',
  sunken_temple:       '\u2605 SUNKEN TEMPLE',
  elder_library:       '\u2605 ELDER LIBRARY',
  monolith:            '\u2666 SPIRE OF SHELLS',
  deep_sea:            '\u2666 DEEP SEA EXPEDITION',
  war_monument:        '\u2666 WAR MONUMENT',
  project_complete:    '\u2666 PROJECT COMPLETE',
  festival:            '\u2666 FESTIVAL',
  prophet:             '\u2666 PROPHET DISCOVERED',
  chronicle:           '\u2666 CHRONICLE',
  celebration:         '\u2666 CELEBRATION',
  raid:                '\u2694 RAID',
  death:               '\u271e DEATH',
  fight:               '\u2694 FIGHT',
  omen:                '\u2600 OMEN',
  birth:               '\u2605 BIRTH',
  construction:        '\u2692 CONSTRUCTION',
  expansion:           '\u2690 EXPANSION',
  discovery:           '\u2605 DISCOVERY',
  trade:               '\u2617 TRADE',
  molt:                '\u21bb MOLT',
  harvest:             '\u2740 HARVEST',
};

// Badge color by severity
const SEVERITY_COLORS = {
  celebration: YELLOW,
  danger:      RED,
  warning:     ORANGE,
  info:        CYAN,
};

// ── Scene sprites by event type ──
function getScene(event) {
  const lines = [];
  const type = event.type;

  if (type === 'raid') {
    // Battle scene
    lines.push('                    \\o/    o     o/   \\o       ');
    lines.push('     ]=====>  /|\\   /|\\   /|)    /|\\  <=====[ ');
    lines.push('              / \\   / \\   / \\    / \\          ');
    lines.push('   x x x   .  . .  . .  .  . .  . .   x x x  ');
  } else if (type === 'death') {
    lines.push('                      ___                       ');
    lines.push('                     | R |                      ');
    lines.push('                     | I |                      ');
    lines.push('                     | P |                      ');
    lines.push('                   __|___|__                    ');
    lines.push('                  ,~~~~~~~~~.                   ');
  } else if (type === 'miracle' || type === 'legendary_discovery') {
    lines.push('                  *  . * .  *                   ');
    lines.push('               .  * \\|/ *  .                   ');
    lines.push('                *  --*--  *                     ');
    lines.push('               .  * /|\\ *  .                   ');
    lines.push('                  *  . * .  *                   ');
  } else if (type === 'monolith') {
    lines.push('                     /\\                         ');
    lines.push('                    /  \\                        ');
    lines.push('                   / .. \\                       ');
    lines.push('                  / .||. \\                      ');
    lines.push('                 / .||||. \\                     ');
    lines.push('                /_________ \\                    ');
  } else if (type === 'project_complete' || type === 'construction') {
    lines.push('                    _A_                         ');
    lines.push('                   /===\\                        ');
    lines.push('                   | * |     \\o/                ');
    lines.push('                   |===|     /|\\                ');
    lines.push('                   | * |     / \\                ');
    lines.push('                  /=====\\                       ');
  } else if (type === 'festival' || type === 'celebration') {
    lines.push('               *   \\o/   d~b   \\o/   *         ');
    lines.push('              /|\\  /|\\  ( o|o )  /|\\  /|\\      ');
    lines.push('              / \\  / \\   \\===/   / \\  / \\      ');
    lines.push('           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
  } else if (type === 'birth') {
    lines.push('                     .---.                      ');
    lines.push('                    ( o o )                     ');
    lines.push('                     \\___/    \\o/               ');
    lines.push('                      /|\\     /|\\               ');
    lines.push('                      / \\     / \\               ');
  } else if (type === 'prophet') {
    lines.push('                      _+_                       ');
    lines.push('                     (o o)                      ');
    lines.push('                      \\+/      *                ');
    lines.push('                      /|\\    * | *              ');
    lines.push('                      / \\     \\|/               ');
  } else if (type === 'deep_sea') {
    lines.push('           ~~~~~~~~~~~~~~~~~~~~~~~~~~           ');
    lines.push('         ~~ ~~~~~ ~~~~ ~~~~~ ~~~~ ~~~           ');
    lines.push('              \\O/                               ');
    lines.push('               |      <\\)))><                   ');
    lines.push('              / \\                               ');
    lines.push('           ,,,,,,,,,,,,,,,,,,,,,,,,,,           ');
  } else if (type === 'expansion' || type === 'discovery') {
    lines.push('              />                                ');
    lines.push('             /|/   *                            ');
    lines.push('             / \\  /|\\   ?                       ');
    lines.push('                  / \\  . .  . .  . .            ');
    lines.push('           ,,,,,,,,,,,,,,,,,,,,,,,,,,,          ');
  } else if (type === 'fight') {
    lines.push('                 \\o    o/                       ');
    lines.push('                  |)  (|                        ');
    lines.push('                 / \\  / \\                       ');
    lines.push('              x   x  x   x                     ');
  } else if (type === 'trade') {
    lines.push('              \\o/      \\o/                      ');
    lines.push('               |\\  []  /|                       ');
    lines.push('              / \\      / \\                      ');
  } else {
    // Generic scene
    lines.push('                      *                         ');
    lines.push('                     /|\\                        ');
    lines.push('                    / | \\                       ');
    lines.push('                   /  |  \\                      ');
  }

  return lines;
}

/**
 * Generate an SVG highlight card for an event
 * @param {Object} event - event row with world context (from getHighlightById)
 * @param {Object} [culture] - optional culture data { descriptor }
 * @returns {string} SVG string
 */
function generateHighlightCard(event, culture) {
  if (!event) return null;

  const lines = [];
  const colors = [];

  const badge = TYPE_BADGES[event.type] || ('\u2666 ' + (event.type || 'EVENT').toUpperCase());
  const badgeColor = SEVERITY_COLORS[event.severity] || CYAN;
  const townLabel = (event.town_number ? '#' + event.town_number + ' ' : '') + (event.world_name || 'Unknown');

  // ── Top border ──
  const topBorder = '\u2554' + '\u2550'.repeat(W - 2) + '\u2557';
  lines.push(topBorder); colors.push(badgeColor);

  // ── Badge line ──
  const badgeLine = '\u2551  ' + badge.padEnd(W - 5).slice(0, W - 5) + ' \u2551';
  lines.push(badgeLine); colors.push(badgeColor);

  // ── Title (wrap if needed) ──
  const titleText = '"' + (event.title || 'Unknown Event') + '"';
  const titleLine = '\u2551  ' + titleText.padEnd(W - 5).slice(0, W - 5) + ' \u2551';
  lines.push(titleLine); colors.push(WHITE);

  // ── Separator ──
  const sep = '\u2560' + '\u2550'.repeat(W - 2) + '\u2563';
  lines.push(sep); colors.push(DIM);

  // ── Scene area ──
  const sceneLines = getScene(event);
  // pad scene to 6 rows minimum
  while (sceneLines.length < 6) sceneLines.push('');

  for (const sl of sceneLines) {
    const sceneLine = '\u2551 ' + sl.padEnd(W - 4).slice(0, W - 4) + ' \u2551';
    lines.push(sceneLine); colors.push(GREEN);
  }

  // ── Description ──
  const desc = event.description || '';
  if (desc) {
    lines.push(sep); colors.push(DIM);
    // Word-wrap description to fit card width
    const maxChars = W - 6;
    const words = desc.split(' ');
    let current = '';
    const descLines = [];
    for (const word of words) {
      if ((current + ' ' + word).trim().length > maxChars) {
        descLines.push(current.trim());
        current = word;
      } else {
        current = current ? current + ' ' + word : word;
      }
    }
    if (current.trim()) descLines.push(current.trim());

    for (const dl of descLines.slice(0, 3)) { // max 3 lines of description
      const dLine = '\u2551  ' + dl.padEnd(W - 5).slice(0, W - 5) + ' \u2551';
      lines.push(dLine); colors.push(DIM);
    }
  }

  // ── Context separator ──
  lines.push(sep); colors.push(DIM);

  // ── World context line ──
  const pop = event.population != null ? event.population : '?';
  const dayLabel = 'Day ' + (event.day_number || '?');
  const contextStr = townLabel + ' \u2502 ' + dayLabel + ' \u2502 Pop ' + pop;
  const contextLine = '\u2551  ' + contextStr.padEnd(W - 5).slice(0, W - 5) + ' \u2551';
  lines.push(contextLine); colors.push(YELLOW);

  // ── Culture line ──
  if (culture && culture.descriptor) {
    const cultLine = '\u2551  ' + culture.descriptor.padEnd(W - 5).slice(0, W - 5) + ' \u2551';
    lines.push(cultLine); colors.push(CULTURE);
  }

  // ── Branding separator ──
  lines.push(sep); colors.push(DIM);

  // ── Branding line ──
  const brandLine = '\u2551  >< pataclaw.com' + ' '.repeat(W - 21) + ' \u2551';
  lines.push(brandLine); colors.push(BROWN);

  // ── Bottom border ──
  const botBorder = '\u255a' + '\u2550'.repeat(W - 2) + '\u255d';
  lines.push(botBorder); colors.push(badgeColor);

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

module.exports = { generateHighlightCard };
