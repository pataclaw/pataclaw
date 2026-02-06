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
};
