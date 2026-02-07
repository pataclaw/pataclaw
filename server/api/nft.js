const { Router } = require('express');
const db = require('../db/connection');
const config = require('../config');
const { generateSvg } = require('../render/nft-image');

const router = Router();

// Seed: token #1 was minted directly on-chain (not via API), so backfill the DB record
const TOKEN1_WORLD_ID = '0f717bb7-14b8-4c0a-81ee-2c1113fe2386';
const TOKEN1_WALLET = '0xe923bC825A59410071a12DD67B22731aAab8435B';
const existing = db.prepare('SELECT * FROM nft_mints WHERE token_id = 1').get();
if (!existing) {
  const worldExists = db.prepare('SELECT id FROM worlds WHERE id = ?').get(TOKEN1_WORLD_ID);
  if (worldExists) {
    const { v4: uuid } = require('uuid');
    db.prepare('INSERT INTO nft_mints (id, world_id, token_id, wallet_address, tx_hash) VALUES (?, ?, 1, ?, ?)')
      .run(uuid(), TOKEN1_WORLD_ID, TOKEN1_WALLET, '0x_direct_mint_on_chain');
    console.log('[NFT] Backfilled token #1 mint record for Clawhold');
  }
}

// Helper: find world by tokenId
function findWorldByTokenId(tokenId) {
  return db.prepare('SELECT * FROM nft_mints WHERE token_id = ?').get(tokenId);
}

// Metadata handler — used by both /:tokenId and /:tokenId/metadata
function metadataHandler(req, res) {
  const tokenId = parseInt(req.params.tokenId, 10);
  if (isNaN(tokenId)) return res.status(400).json({ error: 'Invalid tokenId' });

  const mint = findWorldByTokenId(tokenId);
  if (!mint) return res.status(404).json({ error: 'Token not found' });

  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(mint.world_id);
  if (!world) return res.status(404).json({ error: 'World not found' });

  const popAlive = db.prepare("SELECT COUNT(*) as c FROM villagers WHERE world_id = ? AND status = 'alive'").get(mint.world_id).c;
  const buildingCount = db.prepare("SELECT COUNT(*) as c FROM buildings WHERE world_id = ? AND status != 'destroyed'").get(mint.world_id).c;
  const raidWins = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'raid' AND severity = 'celebration'").get(mint.world_id).c;

  const culture = db.prepare('SELECT village_mood FROM culture WHERE world_id = ?').get(mint.world_id);
  const cultureDesc = culture ? culture.village_mood.toUpperCase() : 'CALM';

  const achievements = db.prepare("SELECT COUNT(*) as c FROM events WHERE world_id = ? AND type = 'achievement'").get(mint.world_id).c;
  const totalAchievements = 20;

  const score = (world.day_number * 2) + (popAlive * 10) + (world.reputation * 5) + (buildingCount * 3);

  const baseUrl = config.nft.baseUrl || `http://localhost:${config.port}/api/nft`;

  const animationUrl = world.view_token ? `${baseUrl}/${tokenId}/live.html` : undefined;

  res.json({
    name: world.name,
    description: `Day ${world.day_number} | ${popAlive} villagers | ${cultureDesc}`,
    image: `${baseUrl}/${tokenId}/image.svg`,
    animation_url: animationUrl,
    external_url: world.view_token ? `${baseUrl.replace('/api/nft', '')}/view/${world.view_token}` : undefined,
    attributes: [
      { trait_type: 'Day', value: world.day_number, display_type: 'number' },
      { trait_type: 'Population', value: popAlive, display_type: 'number' },
      { trait_type: 'Score', value: score, display_type: 'number' },
      { trait_type: 'Season', value: world.season },
      { trait_type: 'Culture', value: cultureDesc },
      { trait_type: 'Raid Wins', value: raidWins, display_type: 'number' },
      { trait_type: 'Buildings', value: buildingCount, display_type: 'number' },
      { trait_type: 'Achievements', value: `${achievements}/${totalAchievements}` },
    ],
  });
}

// GET /api/nft/collection — OpenSea collection-level metadata (contractURI standard)
router.get('/collection', (_req, res) => {
  const baseUrl = config.nft.baseUrl || `http://localhost:${config.port}/api/nft`;
  const siteUrl = baseUrl.replace('/api/nft', '');

  const totalMints = db.prepare('SELECT COUNT(*) as c FROM nft_mints').get().c;
  const totalWorlds = db.prepare("SELECT COUNT(*) as c FROM worlds WHERE status = 'active'").get().c;

  res.json({
    name: 'Pataclaw World',
    description: 'Living ASCII civilizations on Base. Each NFT is a town — with villagers, culture, raids, and seasons — rendered as live SVG art that changes as the world evolves. Built by AI agents, played through API calls. 500 max supply.',
    image: `${siteUrl}/og-card.png`,
    banner_image: `${siteUrl}/og-card.png`,
    external_link: siteUrl,
    seller_fee_basis_points: 500,
    fee_recipient: '0xe923bC825A59410071a12DD67B22731aAab8435B',
    collaborators: ['@pataclawgame'],
  });
});

// GET /api/nft/:tokenId/metadata — explicit metadata path
router.get('/:tokenId/metadata', metadataHandler);

// GET /api/nft/:tokenId/image.svg — public, returns ASCII art as SVG
// MUST be before /:tokenId catch-all
router.get('/:tokenId/image.svg', (req, res) => {
  const tokenId = parseInt(req.params.tokenId, 10);
  if (isNaN(tokenId)) return res.status(400).send('Invalid tokenId');

  const mint = findWorldByTokenId(tokenId);
  if (!mint) return res.status(404).send('Token not found');

  const svg = generateSvg(mint.world_id);
  if (!svg) return res.status(500).send('Failed to generate image');

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.send(svg);
});

// GET /api/nft/:tokenId/live.html — live animated HTML for OpenSea animation_url
router.get('/:tokenId/live.html', (req, res) => {
  const tokenId = parseInt(req.params.tokenId, 10);
  if (isNaN(tokenId)) return res.status(400).send('Invalid tokenId');

  const mint = findWorldByTokenId(tokenId);
  if (!mint) return res.status(404).send('Token not found');

  const world = db.prepare('SELECT name, view_token, season, weather FROM worlds WHERE id = ?').get(mint.world_id);
  if (!world || !world.view_token) return res.status(404).send('World not found');

  const { generateNftAnimation } = require('../render/nft-animation');
  const html = generateNftAnimation(world.name, world.view_token, config);

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.send(html);
});

// GET /api/nft/:tokenId — tokenURI endpoint (what OpenSea actually calls from the contract)
router.get('/:tokenId', metadataHandler);

module.exports = router;
