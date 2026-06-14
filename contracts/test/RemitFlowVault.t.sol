// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RemitFlowVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 100_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockUSDT is ERC20 {
    constructor() ERC20("Tether USD", "USDT") {
        _mint(msg.sender, 100_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RemitFlowVaultTest is Test {
    RemitFlowVault public vault;
    MockUSDC public usdc;
    MockUSDT public usdt;

    address public admin = address(1);
    address public treasury = address(2);
    address public operator = address(3);
    address public guardian = address(4);
    address public user = address(5);
    address[3] public signers = [address(10), address(11), address(12)];

    uint256 constant DAILY_LIMIT = 1_000_000 * 1e6; // $1M
    uint256 constant SINGLE_TX_LIMIT = 500_000 * 1e6; // $500K
    uint256 constant MULTI_SIG_THRESHOLD = 100_000 * 1e6; // $100K

    function setUp() public {
        vm.startPrank(admin);
        vault = new RemitFlowVault(admin, treasury, signers);
        vm.stopPrank();

        usdc = new MockUSDC();
        usdt = new MockUSDT();

        // Setup vault
        vm.startPrank(admin);
        vault.addToken(address(usdc), DAILY_LIMIT, SINGLE_TX_LIMIT, MULTI_SIG_THRESHOLD);
        vault.addToken(address(usdt), DAILY_LIMIT, SINGLE_TX_LIMIT, MULTI_SIG_THRESHOLD);
        vault.addOperator(operator);
        vault.addGuardian(guardian);
        vm.stopPrank();

        // Fund operator with tokens
        usdc.mint(operator, 10_000_000 * 1e6);
        usdt.mint(operator, 10_000_000 * 1e6);

        // Approve vault
        vm.startPrank(operator);
        usdc.approve(address(vault), type(uint256).max);
        usdt.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    // ── Constructor Tests ───────────────────────────────────────────────

    function test_constructor_setsAdmin() public view {
        assertEq(vault.admin(), admin);
    }

    function test_constructor_setsTreasury() public view {
        assertEq(vault.treasury(), treasury);
    }

    function test_constructor_setsSigners() public view {
        assertEq(vault.signers(0), signers[0]);
        assertEq(vault.signers(1), signers[1]);
        assertEq(vault.signers(2), signers[2]);
    }

    function test_constructor_revertsZeroAdmin() public {
        vm.expectRevert(RemitFlowVault.ZeroAddress.selector);
        new RemitFlowVault(address(0), treasury, signers);
    }

    function test_constructor_revertsZeroTreasury() public {
        vm.expectRevert(RemitFlowVault.ZeroAddress.selector);
        new RemitFlowVault(admin, address(0), signers);
    }

    // ── Token Management Tests ──────────────────────────────────────────

    function test_addToken() public view {
        (bool supported,,,,,,) = vault.tokenConfigs(address(usdc));
        assertTrue(supported);
    }

    function test_addToken_onlyAdmin() public {
        vm.startPrank(operator);
        vm.expectRevert(RemitFlowVault.OnlyAdmin.selector);
        vault.addToken(address(0xdead), 1e18, 1e17, 1e16);
        vm.stopPrank();
    }

    function test_removeToken() public {
        vm.prank(admin);
        vault.removeToken(address(usdc));
        (bool supported,,,,,,) = vault.tokenConfigs(address(usdc));
        assertFalse(supported);
    }

    function test_getSupportedTokenCount() public view {
        assertEq(vault.getSupportedTokenCount(), 2);
    }

    // ── Deposit Tests ───────────────────────────────────────────────────

    function test_deposit() public {
        uint256 amount = 10_000 * 1e6;
        bytes32 key = keccak256("deposit-1");

        vm.prank(operator);
        vault.deposit(address(usdc), amount, key);

        assertEq(usdc.balanceOf(address(vault)), amount);
        assertEq(vault.totalDeposits(), amount);
    }

    function test_deposit_emitsEvent() public {
        uint256 amount = 10_000 * 1e6;
        bytes32 key = keccak256("deposit-event");

        vm.prank(operator);
        vm.expectEmit(false, true, false, true);
        emit RemitFlowVault.Deposited(bytes32(0), address(usdc), amount, operator);
        vault.deposit(address(usdc), amount, key);
    }

    function test_deposit_revertsIdempotencyReuse() public {
        bytes32 key = keccak256("same-key");
        uint256 amount = 1000 * 1e6;

        vm.startPrank(operator);
        vault.deposit(address(usdc), amount, key);

        vm.expectRevert(RemitFlowVault.IdempotencyKeyUsed.selector);
        vault.deposit(address(usdc), amount, key);
        vm.stopPrank();
    }

    function test_deposit_revertsZeroAmount() public {
        vm.prank(operator);
        vm.expectRevert(RemitFlowVault.ZeroAmount.selector);
        vault.deposit(address(usdc), 0, keccak256("zero"));
    }

    function test_deposit_revertsNonOperator() public {
        vm.prank(user);
        vm.expectRevert(RemitFlowVault.OnlyOperator.selector);
        vault.deposit(address(usdc), 1000 * 1e6, keccak256("user"));
    }

    function test_deposit_revertsUnsupportedToken() public {
        vm.prank(operator);
        vm.expectRevert(RemitFlowVault.TokenNotSupported.selector);
        vault.deposit(address(0xdead), 1000, keccak256("bad-token"));
    }

    function test_deposit_revertsWhenPaused() public {
        vm.prank(guardian);
        vault.pause();

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vault.deposit(address(usdc), 1000 * 1e6, keccak256("paused"));
    }

    // ── Withdrawal Tests ────────────────────────────────────────────────

    function test_withdraw() public {
        uint256 depositAmount = 100_000 * 1e6;
        uint256 withdrawAmount = 50_000 * 1e6;

        vm.startPrank(operator);
        vault.deposit(address(usdc), depositAmount, keccak256("dep-wd"));
        vault.withdraw(address(usdc), withdrawAmount, user, keccak256("wd-1"));
        vm.stopPrank();

        assertEq(usdc.balanceOf(user), withdrawAmount);
        assertEq(usdc.balanceOf(address(vault)), depositAmount - withdrawAmount);
    }

    function test_withdraw_revertsDailyLimit() public {
        uint256 depositAmount = 2_000_000 * 1e6;
        usdc.mint(operator, depositAmount);

        vm.startPrank(operator);
        vault.deposit(address(usdc), depositAmount, keccak256("big-dep"));

        // First withdrawal near limit
        vault.withdraw(address(usdc), SINGLE_TX_LIMIT, user, keccak256("wd-big-1"));

        // Second should exceed daily limit
        vm.expectRevert(RemitFlowVault.ExceedsDailyLimit.selector);
        vault.withdraw(address(usdc), SINGLE_TX_LIMIT, user, keccak256("wd-big-2"));
        vm.stopPrank();
    }

    function test_withdraw_revertsSingleTxLimit() public {
        uint256 amount = SINGLE_TX_LIMIT + 1;

        vm.startPrank(operator);
        vault.deposit(address(usdc), 1_000_000 * 1e6, keccak256("dep-stl"));

        vm.expectRevert(RemitFlowVault.ExceedsSingleTxLimit.selector);
        vault.withdraw(address(usdc), amount, user, keccak256("wd-over-stl"));
        vm.stopPrank();
    }

    function test_withdraw_revertsRequiresMultiSig() public {
        uint256 amount = MULTI_SIG_THRESHOLD; // exactly at threshold

        vm.startPrank(operator);
        vault.deposit(address(usdc), 500_000 * 1e6, keccak256("dep-ms"));

        vm.expectRevert(RemitFlowVault.RequiresMultiSig.selector);
        vault.withdraw(address(usdc), amount, user, keccak256("wd-ms"));
        vm.stopPrank();
    }

    function test_withdraw_revertsInsufficientBalance() public {
        vm.startPrank(operator);
        vault.deposit(address(usdc), 1000 * 1e6, keccak256("dep-insuf"));

        vm.expectRevert(RemitFlowVault.InsufficientBalance.selector);
        vault.withdraw(address(usdc), 5000 * 1e6, user, keccak256("wd-insuf"));
        vm.stopPrank();
    }

    function test_withdraw_revertsZeroAddress() public {
        vm.startPrank(operator);
        vault.deposit(address(usdc), 10_000 * 1e6, keccak256("dep-za"));

        vm.expectRevert(RemitFlowVault.ZeroAddress.selector);
        vault.withdraw(address(usdc), 1000 * 1e6, address(0), keccak256("wd-za"));
        vm.stopPrank();
    }

    function test_withdraw_dailyLimitResets() public {
        uint256 depositAmount = 2_000_000 * 1e6;
        usdc.mint(operator, depositAmount);

        vm.startPrank(operator);
        vault.deposit(address(usdc), depositAmount, keccak256("dep-reset"));
        vault.withdraw(address(usdc), SINGLE_TX_LIMIT, user, keccak256("wd-d1"));
        vm.stopPrank();

        // Advance 1 day
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(operator);
        vault.withdraw(address(usdc), SINGLE_TX_LIMIT, user, keccak256("wd-d2"));

        assertEq(usdc.balanceOf(user), SINGLE_TX_LIMIT * 2);
    }

    // ── Multi-Sig Tests ─────────────────────────────────────────────────

    function test_multiSig_createAndApprove() public {
        uint256 depositAmount = 500_000 * 1e6;
        usdc.mint(operator, depositAmount);

        vm.prank(operator);
        vault.deposit(address(usdc), depositAmount, keccak256("dep-ms2"));

        bytes32 requestId = keccak256("ms-req-1");

        // Signer 1 creates
        vm.prank(signers[0]);
        vault.createMultiSigWithdrawal(address(usdc), 200_000 * 1e6, user, requestId);

        // Signer 2 approves — triggers execution (2-of-3)
        vm.prank(signers[1]);
        vault.approveMultiSig(requestId);

        assertEq(usdc.balanceOf(user), 200_000 * 1e6);
    }

    function test_multiSig_revertsDoubleApproval() public {
        uint256 depositAmount = 500_000 * 1e6;
        usdc.mint(operator, depositAmount);

        vm.prank(operator);
        vault.deposit(address(usdc), depositAmount, keccak256("dep-ms3"));

        bytes32 requestId = keccak256("ms-req-2");

        vm.prank(signers[0]);
        vault.createMultiSigWithdrawal(address(usdc), 200_000 * 1e6, user, requestId);

        vm.prank(signers[0]);
        vm.expectRevert(RemitFlowVault.AlreadyApproved.selector);
        vault.approveMultiSig(requestId);
    }

    function test_multiSig_revertsNonSigner() public {
        bytes32 requestId = keccak256("ms-req-3");

        vm.prank(user);
        vm.expectRevert(RemitFlowVault.OnlySigner.selector);
        vault.createMultiSigWithdrawal(address(usdc), 1000 * 1e6, user, requestId);
    }

    // ── Reserve Attestation Tests ───────────────────────────────────────

    function test_attestReserves() public {
        uint256 amount = 50_000 * 1e6;

        vm.prank(operator);
        vault.deposit(address(usdc), amount, keccak256("dep-attest"));

        bytes32 merkleRoot = keccak256("test-merkle-root");
        vm.prank(admin);
        vault.attestReserves(merkleRoot);

        assertEq(vault.lastMerkleRoot(), merkleRoot);
        assertGt(vault.lastAttestationTimestamp(), 0);
    }

    function test_getReserveStatus() public {
        uint256 depositAmount = 100_000 * 1e6;
        uint256 withdrawAmount = 30_000 * 1e6;

        vm.startPrank(operator);
        vault.deposit(address(usdc), depositAmount, keccak256("dep-rs"));
        vault.withdraw(address(usdc), withdrawAmount, user, keccak256("wd-rs"));
        vm.stopPrank();

        (uint256 reserves, uint256 deposits, uint256 withdrawals,,) = vault.getReserveStatus();
        assertEq(reserves, depositAmount - withdrawAmount);
        assertEq(deposits, depositAmount);
        assertEq(withdrawals, withdrawAmount);
    }

    function test_getTokenBalance() public {
        uint256 amount = 25_000 * 1e6;

        vm.prank(operator);
        vault.deposit(address(usdc), amount, keccak256("dep-bal"));

        assertEq(vault.getTokenBalance(address(usdc)), amount);
    }

    // ── Pause/Emergency Tests ───────────────────────────────────────────

    function test_pause_byGuardian() public {
        vm.prank(guardian);
        vault.pause();
        assertTrue(vault.paused());
    }

    function test_unpause_onlyAdmin() public {
        vm.prank(guardian);
        vault.pause();

        vm.prank(guardian);
        vm.expectRevert(RemitFlowVault.OnlyAdmin.selector);
        vault.unpause();

        vm.prank(admin);
        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_emergencyWithdraw() public {
        uint256 amount = 50_000 * 1e6;

        vm.prank(operator);
        vault.deposit(address(usdc), amount, keccak256("dep-emerg"));

        vm.prank(admin);
        vault.emergencyWithdraw(address(usdc), amount, treasury);

        assertEq(usdc.balanceOf(treasury), amount);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    // ── Operator Management Tests ───────────────────────────────────────

    function test_addOperator() public {
        address newOp = address(20);
        vm.prank(admin);
        vault.addOperator(newOp);
        assertTrue(vault.operators(newOp));
    }

    function test_removeOperator() public {
        vm.prank(admin);
        vault.removeOperator(operator);
        assertFalse(vault.operators(operator));
    }

    // ── Fuzz Tests ──────────────────────────────────────────────────────

    function testFuzz_deposit_anyAmount(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 * 1e6);
        usdc.mint(operator, amount);

        vm.startPrank(operator);
        usdc.approve(address(vault), amount);
        vault.deposit(address(usdc), amount, keccak256(abi.encodePacked("fuzz-dep-", amount)));
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(vault)), amount);
    }

    function testFuzz_withdraw_withinLimits(uint256 amount) public {
        amount = bound(amount, 1, MULTI_SIG_THRESHOLD - 1);
        usdc.mint(operator, 1_000_000 * 1e6);

        vm.startPrank(operator);
        usdc.approve(address(vault), 1_000_000 * 1e6);
        vault.deposit(address(usdc), 1_000_000 * 1e6, keccak256(abi.encodePacked("fuzz-wd-dep-", amount)));
        vault.withdraw(address(usdc), amount, user, keccak256(abi.encodePacked("fuzz-wd-", amount)));
        vm.stopPrank();

        assertEq(usdc.balanceOf(user), amount);
    }
}
