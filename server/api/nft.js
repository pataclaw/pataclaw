const { Router } = require('express');
const db = require('../db/connection');
const config = require('../config');
const { generateSvg } = require('../render/nft-image');

const router = Router();

// Helper: find world by tokenId
function findWorldByTokenId(tokenId) {
  return db.prepare('SELECT * FROM nft_mints WHERE token_id = ?').get(tokenId);
}

// GET /api/nft/:tokenId/metadata — public, no auth (OpenSea reads this)
router.get('/:tokenId/metadata', (req, res) => {
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

  res.json({
    name: world.name,
    description: `Day ${world.day_number} | ${popAlive} villagers | ${cultureDesc}`,
    image: `${baseUrl}/${tokenId}/image.svg`,
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
});

// GET /api/nft/:tokenId/image.svg — public, returns ASCII art as SVG
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

module.exports = router;
