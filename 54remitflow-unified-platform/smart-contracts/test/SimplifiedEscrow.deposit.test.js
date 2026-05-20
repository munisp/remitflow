// Hardhat Test File: SimplifiedEscrow.test.js
// Target: SimplifiedEscrow contract deposit functionality (ETH, USDC, USDT)
// Framework: Hardhat, Ethers.js v6, Chai

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Helper function to generate a unique escrow ID
const generateEscrowId = (prefix) => {
    // Use a simple hash of a unique string to generate a bytes32 ID
    return ethers.keccak256(ethers.toUtf8Bytes(prefix + Date.now().toString()));
};

describe("SimplifiedEscrow: Deposit Functionality", function () {
    // We define a fixture to reuse the same setup in every test.
    async function deployEscrowFixture() {
        // Get signers (accounts)
        const [deployer, depositor, beneficiary, otherAccount] = await ethers.getSigners();

        // Deploy the Escrow contract
        const EscrowFactory = await ethers.getContractFactory("SimplifiedEscrow");
        const escrow = await EscrowFactory.deploy();

        // Deploy mock ERC20 tokens (USDC and USDT)
        // Note: The MockERC20 contract assumes 18 decimals internally, but we use 6-decimal scaling
        // in the test logic to simulate USDC/USDT.
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const usdt = await MockERC20Factory.deploy("Tether USD", "USDT", 6);

        // Mint tokens to the depositor for testing
        const tokenDecimals = 6;
        const depositAmount = ethers.parseUnits("1000", tokenDecimals); // 1000 tokens with 6 decimals
        await usdc.mint(depositor.address, depositAmount);
        await usdt.mint(depositor.address, depositAmount);

        return { escrow, depositor, beneficiary, otherAccount, usdc, usdt, depositAmount, tokenDecimals };
    }

    // --- Test Suite for ETH Deposit ---
    describe("ETH Deposit (depositETH)", function () {
        const ethDepositAmount = ethers.parseEther("1.0"); // 1.0 ETH

        it("Should successfully deposit ETH and emit a Deposit event", async function () {
            const { escrow, depositor, beneficiary } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId("ETH_SUCCESS");

            // Check initial balances
            const initialEscrowBalance = await ethers.provider.getBalance(escrow.target);
            const initialDepositorBalance = await ethers.provider.getBalance(depositor.address);

            // Perform the deposit
            const tx = await escrow.connect(depositor).depositETH(beneficiary.address, escrowId, { value: ethDepositAmount });
            const receipt = await tx.wait();

            // --- Success Scenario Assertions ---
            // 1. Check contract's ETH balance increased
            const finalEscrowBalance = await ethers.provider.getBalance(escrow.target);
            expect(finalEscrowBalance).to.equal(initialEscrowBalance + ethDepositAmount);

            // 2. Check depositor's ETH balance decreased (accounting for gas)
            const finalDepositorBalance = await ethers.provider.getBalance(depositor.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            // Use a tolerance for gas cost
            expect(finalDepositorBalance).to.be.closeTo(initialDepositorBalance - ethDepositAmount - gasUsed, ethers.parseEther("0.0001"));

            // 3. Check the escrow state is correctly set
            const escrowDetails = await escrow.escrows(escrowId);
            expect(escrowDetails.depositor).to.equal(depositor.address);
            expect(escrowDetails.beneficiary).to.equal(beneficiary.address);
            expect(escrowDetails.amount).to.equal(ethDepositAmount);
            expect(escrowDetails.token).to.equal(ethers.ZeroAddress); // address(0) for ETH
            expect(escrowDetails.deposited).to.be.true;

            // 4. Test Events: Check for the Deposit event
            await expect(tx)
                .to.emit(escrow, "Deposit")
                .withArgs(escrowId, depositor.address, ethers.ZeroAddress, ethDepositAmount);

            // 5. Test Gas Usage: Check that gas usage is reasonable
            expect(receipt.gasUsed).to.be.lessThan(200000);
        });

        it("Should fail if the escrow ID already exists (Failure Scenario)", async function () {
            const { escrow, depositor, beneficiary } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId("ETH_EXISTS");

            // First successful deposit
            await escrow.connect(depositor).depositETH(beneficiary.address, escrowId, { value: ethDepositAmount });

            // Second deposit with the same ID should revert
            await expect(
                escrow.connect(depositor).depositETH(beneficiary.address, escrowId, { value: ethDepositAmount })
            ).to.be.revertedWith("Escrow already exists");
        });

        it("Should fail if the deposit amount is zero (Failure Scenario)", async function () {
            const { escrow, depositor, beneficiary } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId("ETH_ZERO");

            // Deposit with value 0 should revert
            await expect(
                escrow.connect(depositor).depositETH(beneficiary.address, escrowId, { value: 0 })
            ).to.be.revertedWith("Deposit amount must be greater than zero");
        });
    });

    // --- Test Suite for ERC20 Deposit (USDC/USDT) ---
    describe("ERC20 Deposit (USDC & USDT - depositERC20)", function () {
        // Helper function to run the ERC20 deposit test for a given token
        async function testERC20Deposit(tokenContract, tokenSymbol) {
            const { escrow, depositor, beneficiary, depositAmount } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId(`${tokenSymbol}_SUCCESS`);

            // --- Setup: Approvals ---
            // Depositor must approve the Escrow contract to spend tokens
            await expect(
                tokenContract.connect(depositor).approve(escrow.target, depositAmount)
            ).to.emit(tokenContract, "Approval").withArgs(depositor.address, escrow.target, depositAmount);

            // Check initial balances
            const initialDepositorBalance = await tokenContract.balanceOf(depositor.address);
            const initialEscrowBalance = await tokenContract.balanceOf(escrow.target);

            // Perform the deposit
            const tx = await escrow.connect(depositor).depositERC20(
                beneficiary.address,
                tokenContract.target,
                depositAmount,
                escrowId
            );
            const receipt = await tx.wait();

            // --- Success Scenario Assertions ---
            // 1. Check balances changed correctly
            const finalDepositorBalance = await tokenContract.balanceOf(depositor.address);
            const finalEscrowBalance = await tokenContract.balanceOf(escrow.target);
            expect(finalDepositorBalance).to.equal(initialDepositorBalance - depositAmount);
            expect(finalEscrowBalance).to.equal(initialEscrowBalance + depositAmount);

            // 2. Check the escrow state is correctly set
            const escrowDetails = await escrow.escrows(escrowId);
            expect(escrowDetails.depositor).to.equal(depositor.address);
            expect(escrowDetails.beneficiary).to.equal(beneficiary.address);
            expect(escrowDetails.amount).to.equal(depositAmount);
            expect(escrowDetails.token).to.equal(tokenContract.target);
            expect(escrowDetails.deposited).to.be.true;

            // 3. Test Events: Check for the Deposit event
            await expect(tx)
                .to.emit(escrow, "Deposit")
                .withArgs(escrowId, depositor.address, tokenContract.target, depositAmount);

            // 4. Test Events: Check for the underlying ERC20 Transfer event
            await expect(tx)
                .to.emit(tokenContract, "Transfer")
                .withArgs(depositor.address, escrow.target, depositAmount);

            // 5. Test Gas Usage: Check that gas usage is reasonable
            expect(receipt.gasUsed).to.be.lessThan(150000);
        }

        it("Should successfully deposit USDC and emit a Deposit event (Success Scenario)", async function () {
            const { usdc } = await loadFixture(deployEscrowFixture);
            await testERC20Deposit(usdc, "USDC");
        });

        it("Should successfully deposit USDT and emit a Deposit event (Success Scenario)", async function () {
            const { usdt } = await loadFixture(deployEscrowFixture);
            await testERC20Deposit(usdt, "USDT");
        });

        it("Should fail if the depositor has not approved the escrow contract (Failure Scenario)", async function () {
            const { escrow, depositor, beneficiary, usdc, depositAmount } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId("USDC_NO_APPROVAL");

            // Deposit without prior approval should revert on transferFrom
            await expect(
                escrow.connect(depositor).depositERC20(
                    beneficiary.address,
                    usdc.target,
                    depositAmount,
                    escrowId
                )
            ).to.be.reverted; // Reverts with a generic message from the ERC20 contract
        });

        it("Should fail if the escrow ID already exists (Failure Scenario)", async function () {
            const { escrow, depositor, beneficiary, usdc, depositAmount } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId("USDC_EXISTS");

            // Setup: Approve
            await usdc.connect(depositor).approve(escrow.target, depositAmount * 2n);

            // First successful deposit
            await escrow.connect(depositor).depositERC20(
                beneficiary.address,
                usdc.target,
                depositAmount,
                escrowId
            );

            // Second deposit with the same ID should revert
            await expect(
                escrow.connect(depositor).depositERC20(
                    beneficiary.address,
                    usdc.target,
                    depositAmount,
                    escrowId
                )
            ).to.be.revertedWith("Escrow already exists");
        });

        it("Should fail if the deposit amount is zero (Failure Scenario)", async function () {
            const { escrow, depositor, beneficiary, usdc, depositAmount } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId("USDC_ZERO");
            const zeroAmount = 0n;

            // Setup: Approve a small amount
            await usdc.connect(depositor).approve(escrow.target, 1n);

            // Deposit with amount 0 should revert
            await expect(
                escrow.connect(depositor).depositERC20(
                    beneficiary.address,
                    usdc.target,
                    zeroAmount,
                    escrowId
                )
            ).to.be.revertedWith("Deposit amount must be greater than zero");
        });

        it("Should fail if the token address is address(0) (Edge Case)", async function () {
            const { escrow, depositor, beneficiary, depositAmount } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId("USDC_ZERO_TOKEN");

            // Deposit with token address 0 should revert
            await expect(
                escrow.connect(depositor).depositERC20(
                    beneficiary.address,
                    ethers.ZeroAddress,
                    depositAmount,
                    escrowId
                )
            ).to.be.revertedWith("Token address cannot be zero");
        });

        it("Should fail if depositor has insufficient balance (Edge Case)", async function () {
            const { escrow, depositor, beneficiary, usdc, depositAmount } = await loadFixture(deployEscrowFixture);
            const escrowId = generateEscrowId("USDC_INSUFFICIENT");
            const excessAmount = depositAmount + ethers.parseUnits("1", 6); // 1 token more than balance

            // Setup: Approve the excess amount
            await usdc.connect(depositor).approve(escrow.target, excessAmount);

            // Deposit with insufficient balance should revert on transferFrom
            await expect(
                escrow.connect(depositor).depositERC20(
                    beneficiary.address,
                    usdc.target,
                    excessAmount,
                    escrowId
                )
            ).to.be.reverted; // Reverts with a generic message from the ERC20 contract
        });
    });
});

// --- Supporting Solidity Contracts (SimplifiedEscrow.sol and MockERC20.sol) ---

/*
// contracts/SimplifiedEscrow.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimplifiedEscrow {
    // Struct to hold escrow details
    struct Escrow {
        address depositor;
        address beneficiary;
        uint256 amount;
        address token; // address(0) for ETH
        bool deposited;
    }

    // Mapping from a unique ID to the Escrow details
    mapping(bytes32 => Escrow) public escrows;

    // Event for successful deposit
    event Deposit(bytes32 indexed escrowId, address indexed depositor, address indexed token, uint256 amount);

    // Function to create and deposit ETH
    function depositETH(address beneficiary, bytes32 escrowId) public payable {
        require(escrows[escrowId].depositor == address(0), "Escrow already exists");
        require(msg.value > 0, "Deposit amount must be greater than zero");

        escrows[escrowId] = Escrow({
            depositor: msg.sender,
            beneficiary: beneficiary,
            amount: msg.value,
            token: address(0), // ETH
            deposited: true
        });

        emit Deposit(escrowId, msg.sender, address(0), msg.value);
    }

    // Function to create and deposit ERC20 tokens
    function depositERC20(
        address beneficiary,
        address tokenAddress,
        uint256 amount,
        bytes32 escrowId
    ) public {
        require(escrows[escrowId].depositor == address(0), "Escrow already exists");
        require(amount > 0, "Deposit amount must be greater than zero");
        require(tokenAddress != address(0), "Token address cannot be zero");

        // Transfer the tokens from the depositor to the contract
        IERC20 token = IERC20(tokenAddress);
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");

        escrows[escrowId] = Escrow({
            depositor: msg.sender,
            beneficiary: beneficiary,
            amount: amount,
            token: tokenAddress,
            deposited: true
        });

        emit Deposit(escrowId, msg.sender, tokenAddress, amount);
    }

    // Minimal withdrawal function for completeness, though not the focus of the test
    function withdraw(bytes32 escrowId) public {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.deposited, "Escrow not deposited");
        require(msg.sender == escrow.beneficiary, "Only beneficiary can withdraw");

        uint256 amount = escrow.amount;
        address token = escrow.token;

        // Mark as withdrawn before transfer to prevent reentrancy
        escrow.deposited = false;
        escrow.amount = 0;

        if (token == address(0)) {
            // ETH withdrawal
            (bool success, ) = payable(msg.sender).call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            // ERC20 withdrawal
            IERC20(token).transfer(msg.sender, amount);
        }
    }
}

// contracts/MockERC20.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockERC20 is ERC20, Ownable {
    constructor(string memory name, string memory symbol, uint8 decimals)
        ERC20(name, symbol)
        Ownable(msg.sender)
    {
        // Note: The decimals parameter is ignored here as OpenZeppelin's ERC20
        // hardcodes decimals to 18. The test code must use ethers.parseUnits("...", 6)
        // to correctly simulate 6-decimal tokens.
    }

    // Function to mint tokens for testing
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
*/