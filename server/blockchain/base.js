const { ethers } = require('ethers');
const config = require('../config');

const ABI = [
  'function mint(address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

function getContract() {
  const provider = new ethers.JsonRpcProvider(config.nft.baseRpc);
  const signer = new ethers.Wallet(config.nft.serverPrivateKey, provider);
  return new ethers.Contract(config.nft.contractAddress, ABI, signer);
}

async function mintWorld(toAddress, tokenId) {
  const contract = getContract();
  const tx = await contract.mint(toAddress, tokenId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, tokenId };
}

async function isAlreadyMinted(tokenId) {
  try {
    const contract = getContract();
    await contract.ownerOf(tokenId);
    return true;
  } catch {
    return false;
  }
}

function worldIdToTokenId(worldId) {
  // Take first 15 hex chars of UUID (no dashes), parse as int
  return parseInt(worldId.replace(/-/g, '').slice(0, 15), 16);
}

module.exports = { mintWorld, isAlreadyMinted, worldIdToTokenId };
