// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RemittanceEscrow
 * @dev Secure escrow contract for cross-border remittances with time-locks and conditional release
 * @notice This contract holds funds in escrow until conditions are met or timeout occurs
 */
contract RemittanceEscrow {
    
    struct Remittance {
        address sender;
        address payable recipient;
        uint256 amount;
        uint256 createdAt;
        uint256 releaseTime;
        bytes32 secretHash;  // For atomic swap functionality
        bool released;
        bool refunded;
        string currency;
        string transactionId;
    }
    
    mapping(bytes32 => Remittance) public remittances;
    mapping(address => bytes32[]) public senderRemittances;
    mapping(address => bytes32[]) public recipientRemittances;
    
    uint256 public constant MIN_LOCK_TIME = 1 hours;
    uint256 public constant MAX_LOCK_TIME = 30 days;
    uint256 public totalRemittances;
    
    event RemittanceCreated(
        bytes32 indexed remittanceId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 releaseTime,
        string transactionId
    );
    
    event RemittanceReleased(
        bytes32 indexed remittanceId,
        address indexed recipient,
        uint256 amount
    );
    
    event RemittanceRefunded(
        bytes32 indexed remittanceId,
        address indexed sender,
        uint256 amount
    );
    
    /**
     * @dev Create a new remittance escrow
     * @param _recipient Address of the recipient
     * @param _releaseTime Unix timestamp when funds can be released
     * @param _secretHash Hash of secret for atomic swap (optional, use 0x0 if not needed)
     * @param _currency Currency code (e.g., "NGN", "USD")
     * @param _transactionId External transaction reference ID
     */
    function createRemittance(
        address payable _recipient,
        uint256 _releaseTime,
        bytes32 _secretHash,
        string memory _currency,
        string memory _transactionId
    ) external payable returns (bytes32) {
        require(msg.value > 0, "Amount must be greater than 0");
        require(_recipient != address(0), "Invalid recipient address");
        require(_recipient != msg.sender, "Cannot send to yourself");
        require(
            _releaseTime >= block.timestamp + MIN_LOCK_TIME,
            "Release time too soon"
        );
        require(
            _releaseTime <= block.timestamp + MAX_LOCK_TIME,
            "Release time too far in future"
        );
        
        bytes32 remittanceId = keccak256(
            abi.encodePacked(
                msg.sender,
                _recipient,
                msg.value,
                block.timestamp,
                totalRemittances
            )
        );
        
        require(remittances[remittanceId].sender == address(0), "Remittance already exists");
        
        remittances[remittanceId] = Remittance({
            sender: msg.sender,
            recipient: _recipient,
            amount: msg.value,
            createdAt: block.timestamp,
            releaseTime: _releaseTime,
            secretHash: _secretHash,
            released: false,
            refunded: false,
            currency: _currency,
            transactionId: _transactionId
        });
        
        senderRemittances[msg.sender].push(remittanceId);
        recipientRemittances[_recipient].push(remittanceId);
        totalRemittances++;
        
        emit RemittanceCreated(
            remittanceId,
            msg.sender,
            _recipient,
            msg.value,
            _releaseTime,
            _transactionId
        );
        
        return remittanceId;
    }
    
    /**
     * @dev Release funds to recipient
     * @param _remittanceId ID of the remittance
     * @param _secret Secret for atomic swap (use empty bytes if not needed)
     */
    function releaseRemittance(bytes32 _remittanceId, bytes memory _secret) external {
        Remittance storage remittance = remittances[_remittanceId];
        
        require(remittance.sender != address(0), "Remittance does not exist");
        require(!remittance.released, "Already released");
        require(!remittance.refunded, "Already refunded");
        require(block.timestamp >= remittance.releaseTime, "Release time not reached");
        
        // If secret hash is set, verify the secret
        if (remittance.secretHash != bytes32(0)) {
            require(
                keccak256(_secret) == remittance.secretHash,
                "Invalid secret"
            );
        }
        
        remittance.released = true;
        
        (bool success, ) = remittance.recipient.call{value: remittance.amount}("");
        require(success, "Transfer failed");
        
        emit RemittanceReleased(_remittanceId, remittance.recipient, remittance.amount);
    }
    
    /**
     * @dev Refund to sender if release time has passed and not yet released
     * @param _remittanceId ID of the remittance
     */
    function refundRemittance(bytes32 _remittanceId) external {
        Remittance storage remittance = remittances[_remittanceId];
        
        require(remittance.sender != address(0), "Remittance does not exist");
        require(!remittance.released, "Already released");
        require(!remittance.refunded, "Already refunded");
        require(msg.sender == remittance.sender, "Only sender can refund");
        require(
            block.timestamp >= remittance.releaseTime + 7 days,
            "Refund period not reached"
        );
        
        remittance.refunded = true;
        
        (bool success, ) = payable(remittance.sender).call{value: remittance.amount}("");
        require(success, "Refund failed");
        
        emit RemittanceRefunded(_remittanceId, remittance.sender, remittance.amount);
    }
    
    /**
     * @dev Get remittance details
     * @param _remittanceId ID of the remittance
     */
    function getRemittance(bytes32 _remittanceId) external view returns (
        address sender,
        address recipient,
        uint256 amount,
        uint256 createdAt,
        uint256 releaseTime,
        bool released,
        bool refunded,
        string memory currency,
        string memory transactionId
    ) {
        Remittance memory remittance = remittances[_remittanceId];
        return (
            remittance.sender,
            remittance.recipient,
            remittance.amount,
            remittance.createdAt,
            remittance.releaseTime,
            remittance.released,
            remittance.refunded,
            remittance.currency,
            remittance.transactionId
        );
    }
    
    /**
     * @dev Get all remittances for a sender
     * @param _sender Address of the sender
     */
    function getSenderRemittances(address _sender) external view returns (bytes32[] memory) {
        return senderRemittances[_sender];
    }
    
    /**
     * @dev Get all remittances for a recipient
     * @param _recipient Address of the recipient
     */
    function getRecipientRemittances(address _recipient) external view returns (bytes32[] memory) {
        return recipientRemittances[_recipient];
    }
}
