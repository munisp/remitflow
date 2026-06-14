// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RemitFlowEscrow
 * @notice Time-locked escrow for LP settlements.
 *         Holds stablecoins during settlement window, releases to recipient
 *         after confirmation, or refunds to sender after expiry.
 *
 * Security:
 *   - ReentrancyGuard on all fund movements
 *   - Immutable escrow terms after creation (no rug-pull via param change)
 *   - Dispute resolution via admin arbitration
 *   - Automatic refund after expiry (no locked funds forever)
 *   - SafeERC20 for all token operations
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RemitFlowEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum EscrowState { Created, Funded, Released, Refunded, Disputed }

    struct Escrow {
        bytes32 escrowId;
        address token;
        uint256 amount;
        address sender;
        address recipient;
        address arbiter;
        EscrowState state;
        uint256 createdAt;
        uint256 expiresAt;
        string settlementRef;    // Off-chain settlement reference
    }

    address public immutable admin;
    mapping(bytes32 => Escrow) public escrows;
    uint256 public escrowCount;

    event EscrowCreated(bytes32 indexed escrowId, address indexed sender, address indexed recipient, address token, uint256 amount, uint256 expiresAt);
    event EscrowFunded(bytes32 indexed escrowId, uint256 amount);
    event EscrowReleased(bytes32 indexed escrowId, address indexed recipient, uint256 amount);
    event EscrowRefunded(bytes32 indexed escrowId, address indexed sender, uint256 amount);
    event EscrowDisputed(bytes32 indexed escrowId, address indexed disputedBy);
    event DisputeResolved(bytes32 indexed escrowId, address indexed winner, uint256 amount);

    error OnlyAdmin();
    error OnlySender();
    error OnlyArbiter();
    error InvalidState();
    error EscrowExpired();
    error EscrowNotExpired();
    error ZeroAmount();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
    }

    function createEscrow(
        bytes32 escrowId,
        address token,
        uint256 amount,
        address recipient,
        address arbiter,
        uint256 duration,
        string calldata settlementRef
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (escrows[escrowId].createdAt != 0) revert InvalidState();

        escrows[escrowId] = Escrow({
            escrowId: escrowId,
            token: token,
            amount: amount,
            sender: msg.sender,
            recipient: recipient,
            arbiter: arbiter,
            state: EscrowState.Created,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            settlementRef: settlementRef
        });

        // Pull funds from sender
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        escrows[escrowId].state = EscrowState.Funded;
        escrowCount++;

        emit EscrowCreated(escrowId, msg.sender, recipient, token, amount, block.timestamp + duration);
        emit EscrowFunded(escrowId, amount);
    }

    function release(bytes32 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != EscrowState.Funded) revert InvalidState();
        if (msg.sender != e.sender && msg.sender != e.arbiter && msg.sender != admin) revert OnlySender();

        e.state = EscrowState.Released;
        IERC20(e.token).safeTransfer(e.recipient, e.amount);

        emit EscrowReleased(escrowId, e.recipient, e.amount);
    }

    function refund(bytes32 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != EscrowState.Funded) revert InvalidState();
        if (block.timestamp < e.expiresAt) revert EscrowNotExpired();

        e.state = EscrowState.Refunded;
        IERC20(e.token).safeTransfer(e.sender, e.amount);

        emit EscrowRefunded(escrowId, e.sender, e.amount);
    }

    function dispute(bytes32 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != EscrowState.Funded) revert InvalidState();
        if (msg.sender != e.sender && msg.sender != e.recipient) revert InvalidState();

        e.state = EscrowState.Disputed;
        emit EscrowDisputed(escrowId, msg.sender);
    }

    function resolveDispute(bytes32 escrowId, address winner) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != EscrowState.Disputed) revert InvalidState();
        if (msg.sender != e.arbiter && msg.sender != admin) revert OnlyArbiter();
        if (winner != e.sender && winner != e.recipient) revert ZeroAddress();

        e.state = EscrowState.Released;
        IERC20(e.token).safeTransfer(winner, e.amount);

        emit DisputeResolved(escrowId, winner, e.amount);
    }

    function getEscrow(bytes32 escrowId) external view returns (
        address token, uint256 amount, address sender, address recipient,
        uint8 state, uint256 createdAt, uint256 expiresAt
    ) {
        Escrow storage e = escrows[escrowId];
        return (e.token, e.amount, e.sender, e.recipient, uint8(e.state), e.createdAt, e.expiresAt);
    }
}
