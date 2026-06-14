// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RemitFlowTimelock
 * @notice 48-hour timelock controller for governance actions on RemitFlowVault.
 *         All admin operations must be queued, wait the delay, then executed.
 *         Prevents instant malicious admin actions (compromised key protection).
 *
 * Queueable operations:
 *   - addToken / removeToken
 *   - addOperator / removeOperator
 *   - addGuardian
 *   - emergencyWithdraw (even emergency has delay — guardians can pause instantly)
 *   - unpause
 *
 * NOT timelocked (immediate):
 *   - pause() — guardians can pause instantly for emergency
 */

contract RemitFlowTimelock {
    uint256 public constant MIN_DELAY = 48 hours;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant GRACE_PERIOD = 14 days;

    address public immutable admin;
    mapping(address => bool) public proposers;
    mapping(address => bool) public executors;

    struct TimelockTx {
        address target;
        uint256 value;
        bytes data;
        uint256 eta; // earliest time of execution
        bool executed;
        bool cancelled;
    }

    mapping(bytes32 => TimelockTx) public queuedTransactions;

    event TransactionQueued(bytes32 indexed txHash, address indexed target, uint256 value, bytes data, uint256 eta);
    event TransactionExecuted(bytes32 indexed txHash, address indexed target, uint256 value, bytes data);
    event TransactionCancelled(bytes32 indexed txHash);
    event ProposerAdded(address indexed proposer);
    event ExecutorAdded(address indexed executor);

    error OnlyAdmin();
    error OnlyProposer();
    error OnlyExecutor();
    error InvalidDelay();
    error TxNotQueued();
    error TxAlreadyExecuted();
    error TxCancelled();
    error TxNotReady();
    error TxExpired();
    error TxAlreadyQueued();
    error ExecutionFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlyProposer() {
        if (!proposers[msg.sender] && msg.sender != admin) revert OnlyProposer();
        _;
    }

    modifier onlyExecutor() {
        if (!executors[msg.sender] && msg.sender != admin) revert OnlyExecutor();
        _;
    }

    constructor(address _admin, address[] memory _proposers, address[] memory _executors) {
        admin = _admin;
        for (uint256 i = 0; i < _proposers.length; i++) {
            proposers[_proposers[i]] = true;
        }
        for (uint256 i = 0; i < _executors.length; i++) {
            executors[_executors[i]] = true;
        }
    }

    function queueTransaction(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 delay
    ) external onlyProposer returns (bytes32) {
        if (delay < MIN_DELAY || delay > MAX_DELAY) revert InvalidDelay();

        uint256 eta = block.timestamp + delay;
        bytes32 txHash = keccak256(abi.encode(target, value, data, eta));

        if (queuedTransactions[txHash].eta != 0) revert TxAlreadyQueued();

        queuedTransactions[txHash] = TimelockTx({
            target: target,
            value: value,
            data: data,
            eta: eta,
            executed: false,
            cancelled: false
        });

        emit TransactionQueued(txHash, target, value, data, eta);
        return txHash;
    }

    function executeTransaction(bytes32 txHash) external onlyExecutor returns (bytes memory) {
        TimelockTx storage txn = queuedTransactions[txHash];
        if (txn.eta == 0) revert TxNotQueued();
        if (txn.executed) revert TxAlreadyExecuted();
        if (txn.cancelled) revert TxCancelled();
        if (block.timestamp < txn.eta) revert TxNotReady();
        if (block.timestamp > txn.eta + GRACE_PERIOD) revert TxExpired();

        txn.executed = true;

        (bool success, bytes memory result) = txn.target.call{value: txn.value}(txn.data);
        if (!success) revert ExecutionFailed();

        emit TransactionExecuted(txHash, txn.target, txn.value, txn.data);
        return result;
    }

    function cancelTransaction(bytes32 txHash) external onlyProposer {
        TimelockTx storage txn = queuedTransactions[txHash];
        if (txn.eta == 0) revert TxNotQueued();
        if (txn.executed) revert TxAlreadyExecuted();

        txn.cancelled = true;
        emit TransactionCancelled(txHash);
    }

    function addProposer(address proposer) external onlyAdmin {
        proposers[proposer] = true;
        emit ProposerAdded(proposer);
    }

    function addExecutor(address executor) external onlyAdmin {
        executors[executor] = true;
        emit ExecutorAdded(executor);
    }

    function getTransactionHash(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 eta
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data, eta));
    }

    receive() external payable {}
}
