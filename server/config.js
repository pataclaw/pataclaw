require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || './data/pataclaw.db',
  tickRateMs: parseInt(process.env.TICK_RATE_MS, 10) || 10000,
  maxCatchupTicks: 360,
  moltbook: {
    apiUrl: process.env.MOLTBOOK_API_URL || 'https://www.moltbook.com/api/v1',
    submoltId: process.env.MOLTBOOK_SUBMOLT_ID || '',
  },
  nft: {
    enabled: !!process.env.NFT_CONTRACT_ADDRESS,
    baseRpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    contractAddress: process.env.NFT_CONTRACT_ADDRESS || '',
    serverPrivateKey: process.env.NFT_SERVER_KEY || '',
    baseUrl: process.env.NFT_METADATA_BASE_URL || 'https://pataclaw.com/api/nft',
  },
};
