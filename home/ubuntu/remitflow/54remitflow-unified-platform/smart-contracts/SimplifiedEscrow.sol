// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SimplifiedEscrow
 * @dev Escrow contract for Nigerian Remittance Platform on Base Network
 * @notice Enables gas-free claims for recipients via email
 * 
 * Features:
 * - Send to email (recipient doesn't need wallet)
 * - Gas-free claims (admin pays gas)
 * - Multi-currency support (ETH, USDC, USDT, etc.)
 * - Automatic refunds after expiry
 * - Email-based recipient identification
 */
contract SimplifiedEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Escrow states
    enum EscrowState {
        PENDING,    // Funds deposited, waiting for claim
        CLAIMED,    // Recipient claimed funds
        REFUNDED,   // Sender got refund
        CANCELLED   // Cancelled by sender
    }

    // Escrow structure
    struct Escrow {
        address sender;           // Who sent the funds
        string recipientEmail;    // Recipient's email (hashed)
        address recipientWallet;  // Recipient's wallet (set on claim)
        address token;            // Token address (0x0 for ETH)
        uint256 amount;           // Amount in escrow
        uint256 createdAt;        // Creation timestamp
        uint256 expiresAt;        // Expiration timestamp
        EscrowState state;        // Current state
        string message;           // Optional message to recipient
    }

    // State variables
    mapping(bytes32 => Escrow) public escrows;
    mapping(string => bytes32[]) public emailToEscrows;
    
    uint256 public escrowCount;
    uint256 public constant ESCROW_DURATION = 30 days;
    uint256 public constant MIN_AMOUNT = 0.0001 ether;
    
    // Admin wallet for gas sponsorship
    address public adminWallet;
    
    // Supported tokens
    mapping(address => bool) public supportedTokens;

    // Events
    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed sender,
        string recipientEmail,
        address token,
        uint256 amount,
        uint256 expiresAt
    );
    
    event EscrowClaimed(
        bytes32 indexed escrowId,
        address indexed recipient,
        uint256 amount
    );
    
    event EscrowRefunded(
        bytes32 indexed escrowId,
        address indexed sender,
        uint256 amount
    );
    
    event EscrowCancelled(
        bytes32 indexed escrowId,
        address indexed sender,
        uint256 amount
    );
    
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event AdminWalletUpdated(address indexed newAdmin);

    // Modifiers
    modifier onlyAdmin() {
        require(msg.sender == adminWallet, "Only admin can call this");
        _;
    }

    modifier validAmount(uint256 amount) {
        require(amount >= MIN_AMOUNT, "Amount too small");
        _;
    }

    /**
     * @dev Constructor
     * @param _adminWallet Admin wallet for gas sponsorship
     */
    constructor(address _adminWallet) {
        require(_adminWallet != address(0), "Invalid admin wallet");
        adminWallet = _adminWallet;
        
        // Add ETH as supported token (address(0))
        supportedTokens[address(0)] = true;
    }

    /**
     * @dev Create escrow with ETH
     * @param recipientEmail Recipient's email
     * @param message Optional message
     * @return escrowId Unique escrow identifier
     */
    function createEscrowETH(
        string memory recipientEmail,
        string memory message
    ) external payable validAmount(msg.value) nonReentrant returns (bytes32) {
        require(bytes(recipientEmail).length > 0, "Email required");
        
        bytes32 escrowId = keccak256(
            abi.encodePacked(
                msg.sender,
                recipientEmail,
                block.timestamp,
                escrowCount++
            )
        );
        
        uint256 expiresAt = block.timestamp + ESCROW_DURATION;
        
        escrows[escrowId] = Escrow({
            sender: msg.sender,
            recipientEmail: recipientEmail,
            recipientWallet: address(0),
            token: address(0),
            amount: msg.value,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            state: EscrowState.PENDING,
            message: message
        });
        
        emailToEscrows[recipientEmail].push(escrowId);
        
        emit EscrowCreated(
            escrowId,
            msg.sender,
            recipientEmail,
            address(0),
            msg.value,
            expiresAt
        );
        
        return escrowId;
    }

    /**
     * @dev Create escrow with ERC20 token
     * @param recipientEmail Recipient's email
     * @param token Token address
     * @param amount Token amount
     * @param message Optional message
     * @return escrowId Unique escrow identifier
     */
    function createEscrowToken(
        string memory recipientEmail,
        address token,
        uint256 amount,
        string memory message
    ) external validAmount(amount) nonReentrant returns (bytes32) {
        require(bytes(recipientEmail).length > 0, "Email required");
        require(supportedTokens[token], "Token not supported");
        require(token != address(0), "Use createEscrowETH for ETH");
        
        bytes32 escrowId = keccak256(
            abi.encodePacked(
                msg.sender,
                recipientEmail,
                token,
                block.timestamp,
                escrowCount++
            )
        );
        
        uint256 expiresAt = block.timestamp + ESCROW_DURATION;
        
        escrows[escrowId] = Escrow({
            sender: msg.sender,
            recipientEmail: recipientEmail,
            recipientWallet: address(0),
            token: token,
            amount: amount,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            state: EscrowState.PENDING,
            message: message
        });
        
        emailToEscrows[recipientEmail].push(escrowId);
        
        // Transfer tokens to contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        emit EscrowCreated(
            escrowId,
            msg.sender,
            recipientEmail,
            token,
            amount,
            expiresAt
        );
        
        return escrowId;
    }

    /**
     * @dev Claim escrow (gas-free for recipient)
     * @param escrowId Escrow identifier
     * @param recipientWallet Recipient's wallet address
     * @notice This is called by admin wallet to enable gas-free claims
     */
    function claimEscrow(
        bytes32 escrowId,
        address recipientWallet
    ) external onlyAdmin nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        
        require(escrow.state == EscrowState.PENDING, "Escrow not pending");
        require(block.timestamp < escrow.expiresAt, "Escrow expired");
        require(recipientWallet != address(0), "Invalid recipient");
        
        escrow.state = EscrowState.CLAIMED;
        escrow.recipientWallet = recipientWallet;
        
        // Transfer funds to recipient
        if (escrow.token == address(0)) {
            // ETH transfer
            (bool success, ) = recipientWallet.call{value: escrow.amount}("");
            require(success, "ETH transfer failed");
        } else {
            // ERC20 transfer
            IERC20(escrow.token).safeTransfer(recipientWallet, escrow.amount);
        }
        
        emit EscrowClaimed(escrowId, recipientWallet, escrow.amount);
    }

    /**
     * @dev Refund escrow after expiry
     * @param escrowId Escrow identifier
     */
    function refundEscrow(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        
        require(escrow.sender == msg.sender, "Only sender can refund");
        require(escrow.state == EscrowState.PENDING, "Escrow not pending");
        require(block.timestamp >= escrow.expiresAt, "Not expired yet");
        
        escrow.state = EscrowState.REFUNDED;
        
        // Refund to sender
        if (escrow.token == address(0)) {
            // ETH refund
            (bool success, ) = msg.sender.call{value: escrow.amount}("");
            require(success, "ETH refund failed");
        } else {
            // ERC20 refund
            IERC20(escrow.token).safeTransfer(msg.sender, escrow.amount);
        }
        
        emit EscrowRefunded(escrowId, msg.sender, escrow.amount);
    }

    /**
     * @dev Cancel escrow before claim
     * @param escrowId Escrow identifier
     */
    function cancelEscrow(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        
        require(escrow.sender == msg.sender, "Only sender can cancel");
        require(escrow.state == EscrowState.PENDING, "Escrow not pending");
        
        escrow.state = EscrowState.CANCELLED;
        
        // Refund to sender
        if (escrow.token == address(0)) {
            // ETH refund
            (bool success, ) = msg.sender.call{value: escrow.amount}("");
            require(success, "ETH refund failed");
        } else {
            // ERC20 refund
            IERC20(escrow.token).safeTransfer(msg.sender, escrow.amount);
        }
        
        emit EscrowCancelled(escrowId, msg.sender, escrow.amount);
    }

    /**
     * @dev Get escrows for email
     * @param email Recipient email
     * @return Array of escrow IDs
     */
    function getEscrowsForEmail(string memory email) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return emailToEscrows[email];
    }

    /**
     * @dev Get escrow details
     * @param escrowId Escrow identifier
     * @return Escrow struct
     */
    function getEscrow(bytes32 escrowId) 
        external 
        view 
        returns (Escrow memory) 
    {
        return escrows[escrowId];
    }

    /**
     * @dev Add supported token
     * @param token Token address
     */
    function addSupportedToken(address token) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(!supportedTokens[token], "Already supported");
        
        supportedTokens[token] = true;
        emit TokenAdded(token);
    }

    /**
     * @dev Remove supported token
     * @param token Token address
     */
    function removeSupportedToken(address token) external onlyOwner {
        require(token != address(0), "Cannot remove ETH");
        require(supportedTokens[token], "Not supported");
        
        supportedTokens[token] = false;
        emit TokenRemoved(token);
    }

    /**
     * @dev Update admin wallet
     * @param newAdmin New admin wallet
     */
    function updateAdminWallet(address newAdmin) external onlyOwner {
        require(newAdmin != address(0), "Invalid admin");
        adminWallet = newAdmin;
        emit AdminWalletUpdated(newAdmin);
    }

    /**
     * @dev Check if token is supported
     * @param token Token address
     * @return bool
     */
    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    /**
     * @dev Receive ETH
     */
    receive() external payable {}
}
