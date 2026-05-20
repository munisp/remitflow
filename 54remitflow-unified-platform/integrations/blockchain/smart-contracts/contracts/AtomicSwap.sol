// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AtomicSwap
 * @dev Hashed Timelock Contract (HTLC) for atomic swaps between different chains/assets
 * @notice Enables trustless cross-chain exchanges using hash time-locked contracts
 */
contract AtomicSwap {
    
    struct Swap {
        address payable initiator;
        address payable participant;
        uint256 amount;
        bytes32 secretHash;
        uint256 lockTime;
        bool initiated;
        bool redeemed;
        bool refunded;
    }
    
    mapping(bytes32 => Swap) public swaps;
    
    event SwapInitiated(
        bytes32 indexed swapId,
        address indexed initiator,
        address indexed participant,
        uint256 amount,
        bytes32 secretHash,
        uint256 lockTime
    );
    
    event SwapRedeemed(
        bytes32 indexed swapId,
        address indexed redeemer,
        bytes32 secret
    );
    
    event SwapRefunded(
        bytes32 indexed swapId,
        address indexed refunder
    );
    
    /**
     * @dev Initiate an atomic swap
     * @param _participant Address of the swap participant
     * @param _secretHash Hash of the secret (keccak256 of the secret)
     * @param _lockTime Unix timestamp when the swap can be refunded
     */
    function initiateSwap(
        address payable _participant,
        bytes32 _secretHash,
        uint256 _lockTime
    ) external payable returns (bytes32) {
        require(msg.value > 0, "Amount must be greater than 0");
        require(_participant != address(0), "Invalid participant address");
        require(_participant != msg.sender, "Cannot swap with yourself");
        require(_secretHash != bytes32(0), "Invalid secret hash");
        require(_lockTime > block.timestamp, "Lock time must be in the future");
        require(_lockTime <= block.timestamp + 48 hours, "Lock time too far in future");
        
        bytes32 swapId = keccak256(
            abi.encodePacked(
                msg.sender,
                _participant,
                msg.value,
                _secretHash,
                block.timestamp
            )
        );
        
        require(!swaps[swapId].initiated, "Swap already exists");
        
        swaps[swapId] = Swap({
            initiator: payable(msg.sender),
            participant: _participant,
            amount: msg.value,
            secretHash: _secretHash,
            lockTime: _lockTime,
            initiated: true,
            redeemed: false,
            refunded: false
        });
        
        emit SwapInitiated(
            swapId,
            msg.sender,
            _participant,
            msg.value,
            _secretHash,
            _lockTime
        );
        
        return swapId;
    }
    
    /**
     * @dev Redeem the swap by revealing the secret
     * @param _swapId ID of the swap
     * @param _secret The secret that matches the hash
     */
    function redeemSwap(bytes32 _swapId, bytes memory _secret) external {
        Swap storage swap = swaps[_swapId];
        
        require(swap.initiated, "Swap does not exist");
        require(!swap.redeemed, "Already redeemed");
        require(!swap.refunded, "Already refunded");
        require(msg.sender == swap.participant, "Only participant can redeem");
        require(block.timestamp < swap.lockTime, "Lock time expired");
        require(keccak256(_secret) == swap.secretHash, "Invalid secret");
        
        swap.redeemed = true;
        
        (bool success, ) = swap.participant.call{value: swap.amount}("");
        require(success, "Transfer failed");
        
        emit SwapRedeemed(_swapId, msg.sender, keccak256(_secret));
    }
    
    /**
     * @dev Refund the swap after lock time expires
     * @param _swapId ID of the swap
     */
    function refundSwap(bytes32 _swapId) external {
        Swap storage swap = swaps[_swapId];
        
        require(swap.initiated, "Swap does not exist");
        require(!swap.redeemed, "Already redeemed");
        require(!swap.refunded, "Already refunded");
        require(msg.sender == swap.initiator, "Only initiator can refund");
        require(block.timestamp >= swap.lockTime, "Lock time not expired");
        
        swap.refunded = true;
        
        (bool success, ) = swap.initiator.call{value: swap.amount}("");
        require(success, "Refund failed");
        
        emit SwapRefunded(_swapId, msg.sender);
    }
    
    /**
     * @dev Get swap details
     * @param _swapId ID of the swap
     */
    function getSwap(bytes32 _swapId) external view returns (
        address initiator,
        address participant,
        uint256 amount,
        bytes32 secretHash,
        uint256 lockTime,
        bool initiated,
        bool redeemed,
        bool refunded
    ) {
        Swap memory swap = swaps[_swapId];
        return (
            swap.initiator,
            swap.participant,
            swap.amount,
            swap.secretHash,
            swap.lockTime,
            swap.initiated,
            swap.redeemed,
            swap.refunded
        );
    }
    
    /**
     * @dev Check if swap is redeemable
     * @param _swapId ID of the swap
     */
    function isRedeemable(bytes32 _swapId) external view returns (bool) {
        Swap memory swap = swaps[_swapId];
        return swap.initiated && 
               !swap.redeemed && 
               !swap.refunded && 
               block.timestamp < swap.lockTime;
    }
    
    /**
     * @dev Check if swap is refundable
     * @param _swapId ID of the swap
     */
    function isRefundable(bytes32 _swapId) external view returns (bool) {
        Swap memory swap = swaps[_swapId];
        return swap.initiated && 
               !swap.redeemed && 
               !swap.refunded && 
               block.timestamp >= swap.lockTime;
    }
}
