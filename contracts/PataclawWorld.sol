// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PataclawWorld is ERC721, Ownable {
    string private _baseTokenURI;

    constructor(string memory baseURI)
        ERC721("Pataclaw World", "PCLAW")
        Ownable(msg.sender)
    {
        _baseTokenURI = baseURI;
    }

    function mint(address to, uint256 tokenId) external onlyOwner {
        _mint(to, tokenId);
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
