// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Settlement
 * @dev Settlement contract for recording and finalizing remittance transactions
 * @notice Provides immutable record of settlements with batch processing capabilities
 */
contract Settlement {
    
    struct SettlementRecord {
        bytes32 transactionId;
        address sender;
        address recipient;
        uint256 amount;
        string currency;
        uint256 timestamp;
        bytes32 batchId;
        bool finalized;
    }
    
    struct Batch {
        bytes32 batchId;
        uint256 totalAmount;
        uint256 transactionCount;
        uint256 createdAt;
        uint256 finalizedAt;
        bool finalized;
    }
    
    mapping(bytes32 => SettlementRecord) public settlements;
    mapping(bytes32 => Batch) public batches;
    mapping(bytes32 => bytes32[]) public batchSettlements;
    
    bytes32[] public allSettlements;
    bytes32[] public allBatches;
    
    address public admin;
    mapping(address => bool) public operators;
    
    event SettlementRecorded(
        bytes32 indexed transactionId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        string currency,
        bytes32 batchId
    );
    
    event SettlementFinalized(
        bytes32 indexed transactionId,
        uint256 timestamp
    );
    
    event BatchCreated(
        bytes32 indexed batchId,
        uint256 timestamp
    );
    
    event BatchFinalized(
        bytes32 indexed batchId,
        uint256 totalAmount,
        uint256 transactionCount,
        uint256 timestamp
    );
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    modifier onlyOperator() {
        require(operators[msg.sender] || msg.sender == admin, "Only operator");
        _;
    }
    
    constructor() {
        admin = msg.sender;
        operators[msg.sender] = true;
    }
    
    /**
     * @dev Add an operator
     * @param _operator Address of the operator
     */
    function addOperator(address _operator) external onlyAdmin {
        operators[_operator] = true;
    }
    
    /**
     * @dev Remove an operator
     * @param _operator Address of the operator
     */
    function removeOperator(address _operator) external onlyAdmin {
        operators[_operator] = false;
    }
    
    /**
     * @dev Create a new settlement batch
     */
    function createBatch() external onlyOperator returns (bytes32) {
        bytes32 batchId = keccak256(
            abi.encodePacked(
                block.timestamp,
                allBatches.length
            )
        );
        
        batches[batchId] = Batch({
            batchId: batchId,
            totalAmount: 0,
            transactionCount: 0,
            createdAt: block.timestamp,
            finalizedAt: 0,
            finalized: false
        });
        
        allBatches.push(batchId);
        
        emit BatchCreated(batchId, block.timestamp);
        
        return batchId;
    }
    
    /**
     * @dev Record a settlement
     * @param _transactionId External transaction ID
     * @param _sender Address of sender
     * @param _recipient Address of recipient
     * @param _amount Amount settled
     * @param _currency Currency code
     * @param _batchId Batch ID to include this settlement in
     */
    function recordSettlement(
        bytes32 _transactionId,
        address _sender,
        address _recipient,
        uint256 _amount,
        string memory _currency,
        bytes32 _batchId
    ) external onlyOperator {
        require(settlements[_transactionId].timestamp == 0, "Settlement already recorded");
        require(batches[_batchId].createdAt > 0, "Batch does not exist");
        require(!batches[_batchId].finalized, "Batch already finalized");
        
        settlements[_transactionId] = SettlementRecord({
            transactionId: _transactionId,
            sender: _sender,
            recipient: _recipient,
            amount: _amount,
            currency: _currency,
            timestamp: block.timestamp,
            batchId: _batchId,
            finalized: false
        });
        
        allSettlements.push(_transactionId);
        batchSettlements[_batchId].push(_transactionId);
        
        batches[_batchId].totalAmount += _amount;
        batches[_batchId].transactionCount++;
        
        emit SettlementRecorded(
            _transactionId,
            _sender,
            _recipient,
            _amount,
            _currency,
            _batchId
        );
    }
    
    /**
     * @dev Finalize a settlement
     * @param _transactionId Transaction ID to finalize
     */
    function finalizeSettlement(bytes32 _transactionId) external onlyOperator {
        require(settlements[_transactionId].timestamp > 0, "Settlement does not exist");
        require(!settlements[_transactionId].finalized, "Already finalized");
        
        settlements[_transactionId].finalized = true;
        
        emit SettlementFinalized(_transactionId, block.timestamp);
    }
    
    /**
     * @dev Finalize a batch
     * @param _batchId Batch ID to finalize
     */
    function finalizeBatch(bytes32 _batchId) external onlyOperator {
        require(batches[_batchId].createdAt > 0, "Batch does not exist");
        require(!batches[_batchId].finalized, "Already finalized");
        
        // Finalize all settlements in the batch
        bytes32[] memory batchTxs = batchSettlements[_batchId];
        for (uint256 i = 0; i < batchTxs.length; i++) {
            if (!settlements[batchTxs[i]].finalized) {
                settlements[batchTxs[i]].finalized = true;
                emit SettlementFinalized(batchTxs[i], block.timestamp);
            }
        }
        
        batches[_batchId].finalized = true;
        batches[_batchId].finalizedAt = block.timestamp;
        
        emit BatchFinalized(
            _batchId,
            batches[_batchId].totalAmount,
            batches[_batchId].transactionCount,
            block.timestamp
        );
    }
    
    /**
     * @dev Get settlement details
     * @param _transactionId Transaction ID
     */
    function getSettlement(bytes32 _transactionId) external view returns (
        bytes32 transactionId,
        address sender,
        address recipient,
        uint256 amount,
        string memory currency,
        uint256 timestamp,
        bytes32 batchId,
        bool finalized
    ) {
        SettlementRecord memory settlement = settlements[_transactionId];
        return (
            settlement.transactionId,
            settlement.sender,
            settlement.recipient,
            settlement.amount,
            settlement.currency,
            settlement.timestamp,
            settlement.batchId,
            settlement.finalized
        );
    }
    
    /**
     * @dev Get batch details
     * @param _batchId Batch ID
     */
    function getBatch(bytes32 _batchId) external view returns (
        bytes32 batchId,
        uint256 totalAmount,
        uint256 transactionCount,
        uint256 createdAt,
        uint256 finalizedAt,
        bool finalized
    ) {
        Batch memory batch = batches[_batchId];
        return (
            batch.batchId,
            batch.totalAmount,
            batch.transactionCount,
            batch.createdAt,
            batch.finalizedAt,
            batch.finalized
        );
    }
    
    /**
     * @dev Get all settlements in a batch
     * @param _batchId Batch ID
     */
    function getBatchSettlements(bytes32 _batchId) external view returns (bytes32[] memory) {
        return batchSettlements[_batchId];
    }
    
    /**
     * @dev Get total number of settlements
     */
    function getTotalSettlements() external view returns (uint256) {
        return allSettlements.length;
    }
    
    /**
     * @dev Get total number of batches
     */
    function getTotalBatches() external view returns (uint256) {
        return allBatches.length;
    }
}
