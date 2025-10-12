// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PokerFHE is SepoliaConfig {
    struct EncryptedHand {
        uint256 id;
        euint32 encryptedCard1;
        euint32 encryptedCard2;
        euint32 encryptedPlayerId;
        uint256 timestamp;
    }
    
    struct DecryptedHand {
        string card1;
        string card2;
        string playerId;
        bool isRevealed;
    }

    uint256 public handCount;
    mapping(uint256 => EncryptedHand) public encryptedHands;
    mapping(uint256 => DecryptedHand) public decryptedHands;
    
    mapping(string => euint32) private encryptedPlayerHandCount;
    string[] private playerList;
    
    mapping(uint256 => uint256) private requestToHandId;
    
    event HandSubmitted(uint256 indexed id, uint256 timestamp);
    event ComparisonRequested(uint256 indexed id);
    event HandRevealed(uint256 indexed id);
    
    modifier onlyPlayer(uint256 handId) {
        _;
    }
    
    function submitEncryptedHand(
        euint32 encryptedCard1,
        euint32 encryptedCard2,
        euint32 encryptedPlayerId
    ) public {
        handCount += 1;
        uint256 newId = handCount;
        
        encryptedHands[newId] = EncryptedHand({
            id: newId,
            encryptedCard1: encryptedCard1,
            encryptedCard2: encryptedCard2,
            encryptedPlayerId: encryptedPlayerId,
            timestamp: block.timestamp
        });
        
        decryptedHands[newId] = DecryptedHand({
            card1: "",
            card2: "",
            playerId: "",
            isRevealed: false
        });
        
        emit HandSubmitted(newId, block.timestamp);
    }
    
    function requestHandComparison(uint256 handId) public onlyPlayer(handId) {
        EncryptedHand storage hand = encryptedHands[handId];
        require(!decryptedHands[handId].isRevealed, "Already revealed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(hand.encryptedCard1);
        ciphertexts[1] = FHE.toBytes32(hand.encryptedCard2);
        ciphertexts[2] = FHE.toBytes32(hand.encryptedPlayerId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.compareHands.selector);
        requestToHandId[reqId] = handId;
        
        emit ComparisonRequested(handId);
    }
    
    function compareHands(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 handId = requestToHandId[requestId];
        require(handId != 0, "Invalid request");
        
        EncryptedHand storage eHand = encryptedHands[handId];
        DecryptedHand storage dHand = decryptedHands[handId];
        require(!dHand.isRevealed, "Already revealed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory card1, string memory card2, string memory playerId) = 
            abi.decode(cleartexts, (string, string, string));
        
        dHand.card1 = card1;
        dHand.card2 = card2;
        dHand.playerId = playerId;
        dHand.isRevealed = true;
        
        if (FHE.isInitialized(encryptedPlayerHandCount[dHand.playerId]) == false) {
            encryptedPlayerHandCount[dHand.playerId] = FHE.asEuint32(0);
            playerList.push(dHand.playerId);
        }
        encryptedPlayerHandCount[dHand.playerId] = FHE.add(
            encryptedPlayerHandCount[dHand.playerId], 
            FHE.asEuint32(1)
        );
        
        emit HandRevealed(handId);
    }
    
    function getDecryptedHand(uint256 handId) public view returns (
        string memory card1,
        string memory card2,
        string memory playerId,
        bool isRevealed
    ) {
        DecryptedHand storage h = decryptedHands[handId];
        return (h.card1, h.card2, h.playerId, h.isRevealed);
    }
    
    function getEncryptedPlayerHandCount(string memory playerId) public view returns (euint32) {
        return encryptedPlayerHandCount[playerId];
    }
    
    function requestPlayerHandCountDecryption(string memory playerId) public {
        euint32 count = encryptedPlayerHandCount[playerId];
        require(FHE.isInitialized(count), "Player not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPlayerHandCount.selector);
        requestToHandId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(playerId)));
    }
    
    function decryptPlayerHandCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 playerHash = requestToHandId[requestId];
        string memory playerId = getPlayerFromHash(playerHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getPlayerFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < playerList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(playerList[i]))) == hash) {
                return playerList[i];
            }
        }
        revert("Player not found");
    }
    
    function determineWinner(
        uint256[] memory handIds,
        string[] memory communityCards
    ) public view returns (string memory winningPlayerId) {
        require(handIds.length > 0, "No hands provided");
        
        uint256 highestScore = 0;
        string memory currentWinner = "";
        
        for (uint256 i = 0; i < handIds.length; i++) {
            DecryptedHand storage hand = decryptedHands[handIds[i]];
            require(hand.isRevealed, "Hand not revealed");
            
            uint256 score = calculateHandScore(hand.card1, hand.card2, communityCards);
            if (score > highestScore) {
                highestScore = score;
                currentWinner = hand.playerId;
            }
        }
        
        return currentWinner;
    }
    
    function calculateHandScore(
        string memory card1,
        string memory card2,
        string[] memory communityCards
    ) private pure returns (uint256) {
        // Simplified hand scoring logic
        // In a real implementation, this would evaluate poker hand strength
        return uint256(keccak256(abi.encodePacked(card1, card2, communityCards)));
    }
}