#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// PATACLAW STUDIO — Recording Script
// ═══════════════════════════════════════════════════════
// Usage: node studio/record.js <episode-name> [output-name]
//
// Examples:
//   node studio/record.js wildlife-update
//   node studio/record.js wildlife-update my-trailer
//
// Output: ~/Desktop/pataclaw-<output-name>.mp4

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const EPISODE = process.argv[2];
if (!EPISODE) {
  console.error('Usage: node studio/record.js <episode-name> [output-name]');
  console.error('Episodes:', fs.readdirSync(path.join(__dirname, 'episodes')).map(f => f.replace('.js', '')).join(', '));
  process.exit(1);
}

const OUTPUT_NAME = process.argv[3] || EPISODE;
const EPISODE_PATH = path.join(__dirname, 'episodes', EPISODE + '.js');
if (!fs.existsSync(EPISODE_PATH)) {
  console.error(`Episode not found: ${EPISODE_PATH}`);
  process.exit(1);
}

const FRAME_DIR = '/tmp/pataclaw-studio-frames';
const OUTPUT = path.join(process.env.HOME, 'Desktop', `pataclaw-${OUTPUT_NAME}.mp4`);
const FPS = 12;
const SIZE = 1080;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  // Clean frame dir
  if (fs.existsSync(FRAME_DIR)) fs.rmSync(FRAME_DIR, { recursive: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  // Build the HTML with episode injected
  const engineHTML = fs.readFileSync(path.join(__dirname, 'engine.html'), 'utf8');
  const episodeJS = fs.readFileSync(EPISODE_PATH, 'utf8');
  const fullHTML = engineHTML.replace(
    '<!-- Episode script goes here -->',
    `<script>\n${episodeJS}\n</script>`
  );
  const tempHTML = path.join(FRAME_DIR, 'render.html');
  fs.writeFileSync(tempHTML, fullHTML);

  console.log(`Recording episode: ${EPISODE}`);
  console.log(`Output: ${OUTPUT}`);
  console.log('');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
    defaultViewport: { width: SIZE, height: SIZE },
  });

  const page = await browser.newPage();
  await page.goto('file://' + tempHTML, { waitUntil: 'domcontentloaded' });
  await sleep(200);

  // Capture frames until animation signals DONE
  let frame = 0;
  let maxFrames = 3000; // safety limit (~4 min)

  console.log('Capturing frames...');
  while (frame < maxFrames) {
    const title = await page.title();
    if (title === 'DONE') break;

    const num = String(frame).padStart(5, '0');
    await page.screenshot({
      path: path.join(FRAME_DIR, `f_${num}.png`),
      type: 'png',
    });
    frame++;

    // Wait for next frame (match the animation's setTimeout interval)
    await sleep(1000 / FPS);

    if (frame % 60 === 0) process.stdout.write(`  ${frame} frames (${Math.round(frame / FPS)}s)...\n`);
  }

  console.log(`Captured ${frame} frames (${Math.round(frame / FPS)}s)`);
  await browser.close();

  // Stitch with ffmpeg
  console.log('Encoding video...');
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${FRAME_DIR}/f_%05d.png" ` +
    `-c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 "${OUTPUT}"`,
    { stdio: 'inherit' }
  );

  const duration = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${OUTPUT}"`
  ).toString().trim();

  const size = fs.statSync(OUTPUT).size;
  console.log(`\nDone! ${OUTPUT}`);
  console.log(`Duration: ${Math.round(parseFloat(duration))}s | Size: ${(size / 1024 / 1024).toFixed(1)}MB`);
})();
