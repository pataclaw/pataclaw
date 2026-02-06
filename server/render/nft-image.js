const { renderTownView } = require('./compositor');

// Color class to hex mapping (matches viewer CSS classes)
const COLOR_MAP = {
  'c-grn': '#00ff41',
  'c-red': '#ff4444',
  'c-blu': '#4488ff',
  'c-ylw': '#ffdd00',
  'c-cyn': '#00ffff',
  'c-mag': '#ff44ff',
  'c-wht': '#ffffff',
  'c-gry': '#888888',
  'c-org': '#ff8800',
  'c-brn': '#aa6600',
};

const DEFAULT_COLOR = '#00ff41';
const BG_COLOR = '#0a0a0a';
const CHAR_WIDTH = 7.2;
const CHAR_HEIGHT = 14;
const FONT_SIZE = 12;
const PADDING = 8;

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateSvg(worldId) {
  const asciiText = renderTownView(worldId);
  if (!asciiText) return null;

  const lines = asciiText.split('\n');
  const maxCols = Math.max(...lines.map((l) => l.length));
  const rows = lines.length;

  const width = Math.ceil(maxCols * CHAR_WIDTH + PADDING * 2);
  const height = Math.ceil(rows * CHAR_HEIGHT + PADDING * 2);

  let textElements = '';
  for (let row = 0; row < rows; row++) {
    const line = lines[row];
    if (!line) continue;
    const y = PADDING + (row + 1) * CHAR_HEIGHT;
    // Render entire line as single text element for efficiency
    textElements += `<text x="${PADDING}" y="${y}" fill="${DEFAULT_COLOR}">${escapeXml(line)}</text>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${BG_COLOR}"/>
  <style>text { font-family: 'Courier New', monospace; font-size: ${FONT_SIZE}px; white-space: pre; }</style>
  ${textElements}
</svg>`;
}

module.exports = { generateSvg };
