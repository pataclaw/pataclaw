// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PataclawWorld is ERC721, ERC2981, Ownable {
    string private _baseTokenURI;
    uint256 public mintPrice;
    uint256 public maxSupply;
    uint256 public totalMinted;

    constructor(string memory baseURI, uint256 _mintPrice, uint96 royaltyBps, uint256 _maxSupply)
        ERC721("Pataclaw World", "PCLAW")
        Ownable(msg.sender)
    {
        _baseTokenURI = baseURI;
        mintPrice = _mintPrice;
        maxSupply = _maxSupply;
        _setDefaultRoyalty(msg.sender, royaltyBps);
    }

    function mint(address to, uint256 tokenId) external payable onlyOwner {
        require(msg.value >= mintPrice, "Insufficient payment");
        require(totalMinted < maxSupply, "Max supply reached");
        _mint(to, tokenId);
        totalMinted++;
    }

    function setMintPrice(uint256 _mintPrice) external onlyOwner {
        mintPrice = _mintPrice;
    }

    function mintsRemaining() external view returns (uint256) {
        return maxSupply - totalMinted;
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        _setDefaultRoyalty(receiver, bps);
    }

    function withdraw() external onlyOwner {
        (bool ok, ) = payable(owner()).call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC2981) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
