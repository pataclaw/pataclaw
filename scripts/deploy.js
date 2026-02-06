const hre = require('hardhat');

async function main() {
  const baseURI = process.env.NFT_METADATA_BASE_URL || 'https://pataclaw.com/api/nft/';

  // Mint price: 0.01 ETH (~$25)
  const mintPrice = hre.ethers.parseEther('0.01');

  // Royalty: 5% on secondary sales (500 basis points)
  const royaltyBps = 500;

  // Max supply: 500 Shells
  const maxSupply = 500;

  console.log('Deploying PataclawWorld...');
  console.log('  baseURI:', baseURI);
  console.log('  mintPrice:', hre.ethers.formatEther(mintPrice), 'ETH');
  console.log('  royalty:', royaltyBps / 100, '%');
  console.log('  maxSupply:', maxSupply);

  const PataclawWorld = await hre.ethers.getContractFactory('PataclawWorld');
  const contract = await PataclawWorld.deploy(baseURI, mintPrice, royaltyBps, maxSupply);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('\nPataclawWorld deployed to:', address);
  console.log('Set NFT_CONTRACT_ADDRESS=' + address + ' in your .env');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
