const hre = require('hardhat');

async function main() {
  const baseURI = process.env.NFT_METADATA_BASE_URL || 'https://pataclaw.com/api/nft/';

  console.log('Deploying PataclawWorld with baseURI:', baseURI);

  const PataclawWorld = await hre.ethers.getContractFactory('PataclawWorld');
  const contract = await PataclawWorld.deploy(baseURI);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('PataclawWorld deployed to:', address);
  console.log('Set NFT_CONTRACT_ADDRESS=' + address + ' in your .env');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
