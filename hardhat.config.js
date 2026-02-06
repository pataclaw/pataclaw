require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: '0.8.20',
  networks: {
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      accounts: process.env.NFT_SERVER_KEY ? [process.env.NFT_SERVER_KEY] : [],
    },
    base: {
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      accounts: process.env.NFT_SERVER_KEY ? [process.env.NFT_SERVER_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://basescan.org',
        },
      },
    ],
  },
};
