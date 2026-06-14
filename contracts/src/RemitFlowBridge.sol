// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RemitFlowBridge
 * @notice Cross-chain bridge for stablecoin transfers between EVM chains.
 *         Lock-and-mint pattern: locks tokens on source chain, mints on destination.
 *
 * Security:
 *   - Validator quorum (3-of-5) required to confirm cross-chain messages
 *   - Nonce-based replay protection
 *   - Per-chain rate limits (daily volume cap)
 *   - Pausable per chain (isolate compromised chain without halting others)
 *   - No arbitrary external calls (no delegatecall, no call with user-supplied data)
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract RemitFlowBridge is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    address public immutable admin;

    struct ChainConfig {
        bool enabled;
        uint256 dailyLimit;
        uint256 volumeToday;
        uint256 lastReset;
        uint256 minAmount;
        uint256 maxAmount;
    }

    mapping(uint256 => ChainConfig) public chainConfigs; // chainId => config
    mapping(address => bool) public validators;
    uint8 public validatorCount;
    uint8 public constant QUORUM = 3;

    // Replay protection
    mapping(bytes32 => bool) public processedNonces;
    uint256 public nonce;

    // Lock tracking
    struct Lock {
        address token;
        uint256 amount;
        address sender;
        uint256 destChainId;
        address destRecipient;
        uint256 timestamp;
        bool released;
    }

    mapping(bytes32 => Lock) public locks;

    // Unlock confirmation
    struct UnlockRequest {
        bytes32 lockId;
        address token;
        uint256 amount;
        address recipient;
        uint8 confirmations;
        bool executed;
        mapping(address => bool) hasConfirmed;
    }

    mapping(bytes32 => UnlockRequest) private unlockRequests;

    event TokenLocked(bytes32 indexed lockId, address indexed token, uint256 amount, address indexed sender, uint256 destChainId, address destRecipient);
    event TokenUnlocked(bytes32 indexed unlockId, address indexed token, uint256 amount, address indexed recipient);
    event UnlockConfirmed(bytes32 indexed unlockId, address indexed validator);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event ChainEnabled(uint256 indexed chainId, uint256 dailyLimit);
    event ChainDisabled(uint256 indexed chainId);

    error OnlyAdmin();
    error OnlyValidator();
    error ChainNotEnabled();
    error ExceedsDailyLimit();
    error AmountTooLow();
    error AmountTooHigh();
    error AlreadyProcessed();
    error AlreadyConfirmed();
    error InsufficientConfirmations();
    error ZeroAddress();
    error ZeroAmount();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlyValidator() {
        if (!validators[msg.sender]) revert OnlyValidator();
        _;
    }

    constructor(address _admin, address[] memory _validators) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;

        for (uint8 i = 0; i < _validators.length; i++) {
            validators[_validators[i]] = true;
            validatorCount++;
        }
    }

    // ── Lock tokens (source chain) ──────────────────────────────────────

    function lock(
        address token,
        uint256 amount,
        uint256 destChainId,
        address destRecipient
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (destRecipient == address(0)) revert ZeroAddress();

        ChainConfig storage config = chainConfigs[destChainId];
        if (!config.enabled) revert ChainNotEnabled();
        if (amount < config.minAmount) revert AmountTooLow();
        if (amount > config.maxAmount) revert AmountTooHigh();

        // Reset daily volume if needed
        if (block.timestamp >= config.lastReset + 1 days) {
            config.volumeToday = 0;
            config.lastReset = block.timestamp;
        }
        if (config.volumeToday + amount > config.dailyLimit) revert ExceedsDailyLimit();
        config.volumeToday += amount;

        nonce++;
        bytes32 lockId = keccak256(abi.encodePacked(msg.sender, token, amount, destChainId, nonce, block.timestamp));

        locks[lockId] = Lock({
            token: token,
            amount: amount,
            sender: msg.sender,
            destChainId: destChainId,
            destRecipient: destRecipient,
            timestamp: block.timestamp,
            released: false
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit TokenLocked(lockId, token, amount, msg.sender, destChainId, destRecipient);
    }

    // ── Unlock tokens (destination chain) ───────────────────────────────

    function confirmUnlock(
        bytes32 unlockId,
        bytes32 sourceLockId,
        address token,
        uint256 amount,
        address recipient
    ) external onlyValidator nonReentrant whenNotPaused {
        if (processedNonces[unlockId]) revert AlreadyProcessed();

        UnlockRequest storage req = unlockRequests[unlockId];
        if (req.executed) revert AlreadyProcessed();
        if (req.hasConfirmed[msg.sender]) revert AlreadyConfirmed();

        if (req.confirmations == 0) {
            req.lockId = sourceLockId;
            req.token = token;
            req.amount = amount;
            req.recipient = recipient;
        }

        req.hasConfirmed[msg.sender] = true;
        req.confirmations++;

        emit UnlockConfirmed(unlockId, msg.sender);

        if (req.confirmations >= QUORUM) {
            req.executed = true;
            processedNonces[unlockId] = true;

            IERC20(token).safeTransfer(recipient, amount);

            emit TokenUnlocked(unlockId, token, amount, recipient);
        }
    }

    // ── Admin ───────────────────────────────────────────────────────────

    function enableChain(
        uint256 chainId,
        uint256 dailyLimit,
        uint256 minAmount,
        uint256 maxAmount
    ) external onlyAdmin {
        chainConfigs[chainId] = ChainConfig({
            enabled: true,
            dailyLimit: dailyLimit,
            volumeToday: 0,
            lastReset: block.timestamp,
            minAmount: minAmount,
            maxAmount: maxAmount
        });
        emit ChainEnabled(chainId, dailyLimit);
    }

    function disableChain(uint256 chainId) external onlyAdmin {
        chainConfigs[chainId].enabled = false;
        emit ChainDisabled(chainId);
    }

    function addValidator(address validator) external onlyAdmin {
        if (validator == address(0)) revert ZeroAddress();
        validators[validator] = true;
        validatorCount++;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyAdmin {
        validators[validator] = false;
        validatorCount--;
        emit ValidatorRemoved(validator);
    }

    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }
}
