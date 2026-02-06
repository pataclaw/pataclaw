const { ethers } = require('ethers');
const config = require('../config');

const ABI = [
  'function mint(address to, uint256 tokenId) external payable',
  'function mintPrice() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function mintsRemaining() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function withdraw() external',
];

function getContract() {
  const provider = new ethers.JsonRpcProvider(config.nft.baseRpc);
  const signer = new ethers.Wallet(config.nft.serverPrivateKey, provider);
  return new ethers.Contract(config.nft.contractAddress, ABI, signer);
}

async function mintWorld(toAddress, tokenId) {
  const contract = getContract();
  // Read mint price from contract
  const price = await contract.mintPrice();
  const tx = await contract.mint(toAddress, tokenId, { value: price });
  const receipt = await tx.wait();
  return { txHash: receipt.hash, tokenId, mintPrice: ethers.formatEther(price) };
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

async function getSupplyInfo() {
  const contract = getContract();
  const [total, minted, remaining] = await Promise.all([
    contract.maxSupply(),
    contract.totalMinted(),
    contract.mintsRemaining(),
  ]);
  return {
    maxSupply: Number(total),
    totalMinted: Number(minted),
    remaining: Number(remaining),
  };
}

module.exports = { mintWorld, isAlreadyMinted, worldIdToTokenId, getSupplyInfo };
