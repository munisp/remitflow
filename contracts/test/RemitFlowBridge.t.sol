// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RemitFlowBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockBridgeToken is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 100_000_000 * 1e6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract RemitFlowBridgeTest is Test {
    RemitFlowBridge public bridge;
    MockBridgeToken public token;

    address public admin = address(1);
    address public user = address(2);
    address public destRecipient = address(3);
    address[] public validators;

    uint256 constant DAILY_LIMIT = 5_000_000 * 1e6;
    uint256 constant MIN_AMOUNT = 10 * 1e6;
    uint256 constant MAX_AMOUNT = 1_000_000 * 1e6;
    uint256 constant POLYGON_CHAIN_ID = 137;
    uint256 constant ARBITRUM_CHAIN_ID = 42161;

    function setUp() public {
        validators = new address[](5);
        validators[0] = address(10);
        validators[1] = address(11);
        validators[2] = address(12);
        validators[3] = address(13);
        validators[4] = address(14);

        vm.prank(admin);
        bridge = new RemitFlowBridge(admin, validators);

        token = new MockBridgeToken();
        token.mint(user, 10_000_000 * 1e6);
        token.mint(address(bridge), 10_000_000 * 1e6); // Pre-fund bridge for unlocks

        vm.prank(user);
        token.approve(address(bridge), type(uint256).max);

        // Enable chains
        vm.startPrank(admin);
        bridge.enableChain(POLYGON_CHAIN_ID, DAILY_LIMIT, MIN_AMOUNT, MAX_AMOUNT);
        bridge.enableChain(ARBITRUM_CHAIN_ID, DAILY_LIMIT, MIN_AMOUNT, MAX_AMOUNT);
        vm.stopPrank();
    }

    // ── Constructor Tests ───────────────────────────────────────────────

    function test_constructor() public view {
        assertEq(bridge.admin(), admin);
        assertEq(bridge.validatorCount(), 5);
        assertTrue(bridge.validators(validators[0]));
        assertTrue(bridge.validators(validators[4]));
    }

    function test_constructor_revertsZeroAdmin() public {
        vm.expectRevert(RemitFlowBridge.ZeroAddress.selector);
        new RemitFlowBridge(address(0), validators);
    }

    // ── Chain Config Tests ──────────────────────────────────────────────

    function test_enableChain() public view {
        (bool enabled, uint256 dailyLimit,,,uint256 minAmount, uint256 maxAmount) =
            bridge.chainConfigs(POLYGON_CHAIN_ID);
        assertTrue(enabled);
        assertEq(dailyLimit, DAILY_LIMIT);
        assertEq(minAmount, MIN_AMOUNT);
        assertEq(maxAmount, MAX_AMOUNT);
    }

    function test_disableChain() public {
        vm.prank(admin);
        bridge.disableChain(POLYGON_CHAIN_ID);

        (bool enabled,,,,,) = bridge.chainConfigs(POLYGON_CHAIN_ID);
        assertFalse(enabled);
    }

    // ── Lock Tests ──────────────────────────────────────────────────────

    function test_lock() public {
        uint256 amount = 10_000 * 1e6;
        uint256 userBalBefore = token.balanceOf(user);

        vm.prank(user);
        bridge.lock(address(token), amount, POLYGON_CHAIN_ID, destRecipient);

        assertEq(token.balanceOf(user), userBalBefore - amount);
        assertEq(bridge.nonce(), 1);
    }

    function test_lock_revertsDisabledChain() public {
        vm.prank(user);
        vm.expectRevert(RemitFlowBridge.ChainNotEnabled.selector);
        bridge.lock(address(token), 10_000 * 1e6, 999, destRecipient);
    }

    function test_lock_revertsAmountTooLow() public {
        vm.prank(user);
        vm.expectRevert(RemitFlowBridge.AmountTooLow.selector);
        bridge.lock(address(token), MIN_AMOUNT - 1, POLYGON_CHAIN_ID, destRecipient);
    }

    function test_lock_revertsAmountTooHigh() public {
        token.mint(user, MAX_AMOUNT * 2);

        vm.prank(user);
        vm.expectRevert(RemitFlowBridge.AmountTooHigh.selector);
        bridge.lock(address(token), MAX_AMOUNT + 1, POLYGON_CHAIN_ID, destRecipient);
    }

    function test_lock_revertsDailyLimit() public {
        token.mint(user, DAILY_LIMIT * 2);

        vm.startPrank(user);
        token.approve(address(bridge), type(uint256).max);

        // Fill daily limit with multiple transactions
        for (uint256 i = 0; i < 5; i++) {
            bridge.lock(address(token), MAX_AMOUNT, POLYGON_CHAIN_ID, destRecipient);
        }

        // Next should exceed daily limit
        vm.expectRevert(RemitFlowBridge.ExceedsDailyLimit.selector);
        bridge.lock(address(token), MAX_AMOUNT, POLYGON_CHAIN_ID, destRecipient);
        vm.stopPrank();
    }

    function test_lock_revertsZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(RemitFlowBridge.ZeroAmount.selector);
        bridge.lock(address(token), 0, POLYGON_CHAIN_ID, destRecipient);
    }

    function test_lock_revertsZeroRecipient() public {
        vm.prank(user);
        vm.expectRevert(RemitFlowBridge.ZeroAddress.selector);
        bridge.lock(address(token), 10_000 * 1e6, POLYGON_CHAIN_ID, address(0));
    }

    function test_lock_revertsWhenPaused() public {
        vm.prank(admin);
        bridge.pause();

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        bridge.lock(address(token), 10_000 * 1e6, POLYGON_CHAIN_ID, destRecipient);
    }

    function test_lock_dailyLimitResets() public {
        token.mint(user, DAILY_LIMIT * 3);

        vm.startPrank(user);
        token.approve(address(bridge), type(uint256).max);

        // Fill daily limit
        for (uint256 i = 0; i < 5; i++) {
            bridge.lock(address(token), MAX_AMOUNT, POLYGON_CHAIN_ID, destRecipient);
        }

        // Advance 1 day
        vm.warp(block.timestamp + 1 days + 1);

        // Should work again
        bridge.lock(address(token), MAX_AMOUNT, POLYGON_CHAIN_ID, destRecipient);
        vm.stopPrank();

        assertEq(bridge.nonce(), 6);
    }

    // ── Unlock (Validator Quorum) Tests ─────────────────────────────────

    function test_unlock_withQuorum() public {
        bytes32 unlockId = keccak256("unlock-1");
        bytes32 sourceLockId = keccak256("source-lock-1");
        uint256 amount = 10_000 * 1e6;

        // 3 validators confirm (quorum = 3)
        vm.prank(validators[0]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);

        vm.prank(validators[1]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);

        vm.prank(validators[2]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);

        // Funds released to recipient
        assertEq(token.balanceOf(destRecipient), amount);
    }

    function test_unlock_insufficientConfirmations() public {
        bytes32 unlockId = keccak256("unlock-partial");
        bytes32 sourceLockId = keccak256("source-partial");
        uint256 amount = 10_000 * 1e6;

        // Only 2 validators (below quorum of 3)
        vm.prank(validators[0]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);

        vm.prank(validators[1]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);

        // Funds NOT released
        assertEq(token.balanceOf(destRecipient), 0);
    }

    function test_unlock_revertsDoubleConfirm() public {
        bytes32 unlockId = keccak256("unlock-double");
        bytes32 sourceLockId = keccak256("source-double");
        uint256 amount = 10_000 * 1e6;

        vm.prank(validators[0]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);

        vm.prank(validators[0]);
        vm.expectRevert(RemitFlowBridge.AlreadyConfirmed.selector);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);
    }

    function test_unlock_revertsNonValidator() public {
        bytes32 unlockId = keccak256("unlock-nonval");

        vm.prank(user);
        vm.expectRevert(RemitFlowBridge.OnlyValidator.selector);
        bridge.confirmUnlock(unlockId, keccak256("x"), address(token), 1000, destRecipient);
    }

    function test_unlock_revertsReplay() public {
        bytes32 unlockId = keccak256("unlock-replay");
        bytes32 sourceLockId = keccak256("source-replay");
        uint256 amount = 10_000 * 1e6;

        // Complete the unlock
        vm.prank(validators[0]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);
        vm.prank(validators[1]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);
        vm.prank(validators[2]);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);

        // Try to replay
        vm.prank(validators[3]);
        vm.expectRevert(RemitFlowBridge.AlreadyProcessed.selector);
        bridge.confirmUnlock(unlockId, sourceLockId, address(token), amount, destRecipient);
    }

    // ── Validator Management Tests ──────────────────────────────────────

    function test_addValidator() public {
        address newVal = address(50);
        vm.prank(admin);
        bridge.addValidator(newVal);
        assertTrue(bridge.validators(newVal));
        assertEq(bridge.validatorCount(), 6);
    }

    function test_removeValidator() public {
        vm.prank(admin);
        bridge.removeValidator(validators[4]);
        assertFalse(bridge.validators(validators[4]));
        assertEq(bridge.validatorCount(), 4);
    }

    // ── Pause Tests ─────────────────────────────────────────────────────

    function test_pause() public {
        vm.prank(admin);
        bridge.pause();
        assertTrue(bridge.paused());
    }

    function test_unpause() public {
        vm.prank(admin);
        bridge.pause();
        vm.prank(admin);
        bridge.unpause();
        assertFalse(bridge.paused());
    }

    // ── Fuzz Tests ──────────────────────────────────────────────────────

    function testFuzz_lock_validAmount(uint256 amount) public {
        amount = bound(amount, MIN_AMOUNT, MAX_AMOUNT);
        token.mint(user, amount);

        vm.startPrank(user);
        token.approve(address(bridge), amount);
        bridge.lock(address(token), amount, POLYGON_CHAIN_ID, destRecipient);
        vm.stopPrank();

        assertEq(bridge.nonce(), 1);
    }
}
