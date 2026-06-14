// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RemitFlowEscrow.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 100_000_000 * 1e6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract RemitFlowEscrowTest is Test {
    RemitFlowEscrow public escrow;
    MockToken public token;

    address public admin = address(1);
    address public sender = address(2);
    address public recipient = address(3);
    address public arbiter = address(4);

    function setUp() public {
        vm.prank(admin);
        escrow = new RemitFlowEscrow(admin);

        token = new MockToken();
        token.mint(sender, 1_000_000 * 1e6);

        vm.prank(sender);
        token.approve(address(escrow), type(uint256).max);
    }

    // ── Create Escrow Tests ─────────────────────────────────────────────

    function test_createEscrow() public {
        bytes32 escrowId = keccak256("escrow-1");
        uint256 amount = 10_000 * 1e6;
        uint256 duration = 7 days;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, duration, "SETTLE-001");

        (address t, uint256 a, address s, address r, uint8 state, uint256 createdAt, uint256 expiresAt) =
            escrow.getEscrow(escrowId);

        assertEq(t, address(token));
        assertEq(a, amount);
        assertEq(s, sender);
        assertEq(r, recipient);
        assertEq(state, uint8(RemitFlowEscrow.EscrowState.Funded));
        assertGt(createdAt, 0);
        assertEq(expiresAt, createdAt + duration);
        assertEq(token.balanceOf(address(escrow)), amount);
    }

    function test_createEscrow_revertsZeroAmount() public {
        vm.prank(sender);
        vm.expectRevert(RemitFlowEscrow.ZeroAmount.selector);
        escrow.createEscrow(keccak256("zero"), address(token), 0, recipient, arbiter, 1 days, "REF");
    }

    function test_createEscrow_revertsZeroRecipient() public {
        vm.prank(sender);
        vm.expectRevert(RemitFlowEscrow.ZeroAddress.selector);
        escrow.createEscrow(keccak256("no-recip"), address(token), 1000, address(0), arbiter, 1 days, "REF");
    }

    function test_createEscrow_revertsDuplicateId() public {
        bytes32 escrowId = keccak256("dup");
        uint256 amount = 1000 * 1e6;

        vm.startPrank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 1 days, "REF");

        vm.expectRevert(RemitFlowEscrow.InvalidState.selector);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 1 days, "REF2");
        vm.stopPrank();
    }

    // ── Release Tests ───────────────────────────────────────────────────

    function test_release_bySender() public {
        bytes32 escrowId = keccak256("release-1");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(sender);
        escrow.release(escrowId);

        assertEq(token.balanceOf(recipient), amount);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_release_byArbiter() public {
        bytes32 escrowId = keccak256("release-arb");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(arbiter);
        escrow.release(escrowId);

        assertEq(token.balanceOf(recipient), amount);
    }

    function test_release_byAdmin() public {
        bytes32 escrowId = keccak256("release-admin");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(admin);
        escrow.release(escrowId);

        assertEq(token.balanceOf(recipient), amount);
    }

    function test_release_revertsUnauthorized() public {
        bytes32 escrowId = keccak256("release-unauth");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(address(99));
        vm.expectRevert(RemitFlowEscrow.OnlySender.selector);
        escrow.release(escrowId);
    }

    function test_release_revertsDoubleRelease() public {
        bytes32 escrowId = keccak256("double-release");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(sender);
        escrow.release(escrowId);

        vm.prank(sender);
        vm.expectRevert(RemitFlowEscrow.InvalidState.selector);
        escrow.release(escrowId);
    }

    // ── Refund Tests ────────────────────────────────────────────────────

    function test_refund_afterExpiry() public {
        bytes32 escrowId = keccak256("refund-1");
        uint256 amount = 5_000 * 1e6;
        uint256 senderBalBefore = token.balanceOf(sender);

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 1 days, "REF");

        // Advance past expiry
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(sender);
        escrow.refund(escrowId);

        assertEq(token.balanceOf(sender), senderBalBefore);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_refund_revertsBeforeExpiry() public {
        bytes32 escrowId = keccak256("refund-early");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(sender);
        vm.expectRevert(RemitFlowEscrow.EscrowNotExpired.selector);
        escrow.refund(escrowId);
    }

    // ── Dispute Tests ───────────────────────────────────────────────────

    function test_dispute_bySender() public {
        bytes32 escrowId = keccak256("dispute-1");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(sender);
        escrow.dispute(escrowId);

        (,,,,uint8 state,,) = escrow.getEscrow(escrowId);
        assertEq(state, uint8(RemitFlowEscrow.EscrowState.Disputed));
    }

    function test_dispute_byRecipient() public {
        bytes32 escrowId = keccak256("dispute-recip");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(recipient);
        escrow.dispute(escrowId);

        (,,,,uint8 state,,) = escrow.getEscrow(escrowId);
        assertEq(state, uint8(RemitFlowEscrow.EscrowState.Disputed));
    }

    function test_resolveDispute_inFavorOfRecipient() public {
        bytes32 escrowId = keccak256("resolve-1");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(sender);
        escrow.dispute(escrowId);

        vm.prank(arbiter);
        escrow.resolveDispute(escrowId, recipient);

        assertEq(token.balanceOf(recipient), amount);
    }

    function test_resolveDispute_inFavorOfSender() public {
        bytes32 escrowId = keccak256("resolve-sender");
        uint256 amount = 5_000 * 1e6;
        uint256 senderBalBefore = token.balanceOf(sender);

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(recipient);
        escrow.dispute(escrowId);

        vm.prank(arbiter);
        escrow.resolveDispute(escrowId, sender);

        assertEq(token.balanceOf(sender), senderBalBefore);
    }

    function test_resolveDispute_revertsNonArbiter() public {
        bytes32 escrowId = keccak256("resolve-unauth");
        uint256 amount = 5_000 * 1e6;

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, 7 days, "REF");

        vm.prank(sender);
        escrow.dispute(escrowId);

        vm.prank(address(99));
        vm.expectRevert(RemitFlowEscrow.OnlyArbiter.selector);
        escrow.resolveDispute(escrowId, recipient);
    }

    // ── Escrow Count ────────────────────────────────────────────────────

    function test_escrowCount() public {
        vm.startPrank(sender);
        escrow.createEscrow(keccak256("cnt-1"), address(token), 1000 * 1e6, recipient, arbiter, 1 days, "R1");
        escrow.createEscrow(keccak256("cnt-2"), address(token), 2000 * 1e6, recipient, arbiter, 1 days, "R2");
        escrow.createEscrow(keccak256("cnt-3"), address(token), 3000 * 1e6, recipient, arbiter, 1 days, "R3");
        vm.stopPrank();

        assertEq(escrow.escrowCount(), 3);
    }

    // ── Fuzz Tests ──────────────────────────────────────────────────────

    function testFuzz_escrow_fullLifecycle(uint256 amount, uint256 duration) public {
        amount = bound(amount, 1, 500_000 * 1e6);
        duration = bound(duration, 1 hours, 365 days);

        bytes32 escrowId = keccak256(abi.encodePacked("fuzz-", amount, duration));

        vm.prank(sender);
        escrow.createEscrow(escrowId, address(token), amount, recipient, arbiter, duration, "FUZZ");

        // Release
        vm.prank(sender);
        escrow.release(escrowId);

        assertEq(token.balanceOf(recipient), amount);
    }
}
