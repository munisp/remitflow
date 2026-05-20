const { expect } = require("chai");
const { ethers } = require("hardhat");

// Define a constant for the escrow duration in seconds (e.g., 7 days)
const ESCROW_DURATION = 7 * 24 * 60 * 60; 

describe("SimplifiedEscrow - Refund After Expiry", function () {
    let Escrow;
    let escrow;
    let depositor;
    let beneficiary;
    let otherAccount;
    const depositAmount = ethers.parseEther("10"); // 10 ETH

    // Helper function to increase time in Hardhat Network
    const increaseTime = async (seconds) => {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine");
    };

    beforeEach(async function () {
        // 1. Get signers
        [depositor, beneficiary, otherAccount] = await ethers.getSigners();

        // 2. Deploy the contract
        // --- Actual Hardhat Deployment Setup (Assumes SimplifiedEscrow.sol exists) ---
        Escrow = await ethers.getContractFactory("SimplifiedEscrow");
        
        // Calculate future expiry time
        const latestBlock = await ethers.provider.getBlock("latest");
        const expiryTime = latestBlock.timestamp + ESCROW_DURATION;
        
        // Deploy the contract, sending the depositAmount from the depositor
        escrow = await Escrow.connect(depositor).deploy(beneficiary.address, expiryTime, { value: depositAmount });
        await escrow.waitForDeployment();
        
        // Verify initial state (optional but good practice)
        expect(await ethers.provider.getBalance(escrow.target)).to.equal(depositAmount);
    });

    describe("Refund Success Scenarios", function () {
        it("should allow the depositor to refund the full amount after expiry", async function () {
            // Edge Case: Time just after expiry
            await increaseTime(ESCROW_DURATION + 1); 

            // Check initial balances
            const initialDepositorBalance = await ethers.provider.getBalance(depositor.address);
            const initialEscrowBalance = await ethers.provider.getBalance(escrow.target);
            
            // Execute the refund transaction
            const tx = await escrow.connect(depositor).refund();
            const receipt = await tx.wait();

            // 1. Test Events
            // Assuming the contract emits a 'Refunded' event with the recipient and amount
            await expect(tx)
                .to.emit(escrow, "Refunded")
                .withArgs(depositor.address, depositAmount);

            // 2. Test State/Balance
            // Escrow balance should be zero
            expect(await ethers.provider.getBalance(escrow.target)).to.equal(0);

            // Depositor balance should increase by depositAmount minus gas cost
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const finalDepositorBalance = await ethers.provider.getBalance(depositor.address);
            
            // Use a tolerance check for balance due to gas cost
            expect(finalDepositorBalance).to.be.closeTo(
                initialDepositorBalance + initialEscrowBalance - gasUsed,
                ethers.parseEther("0.0001") // Small tolerance for gas price fluctuations
            );

            // 3. Test Gas Usage (Basic check: should be reasonable)
            console.log(`\tGas used for successful refund: ${receipt.gasUsed.toString()}`);
            expect(receipt.gasUsed).to.be.lessThan(50000); // Arbitrary reasonable limit
        });

        it("should allow the beneficiary to refund the full amount after expiry (if contract allows)", async function () {
            // Note: This test assumes the contract allows the beneficiary to call refund after expiry.
            await increaseTime(ESCROW_DURATION + 1); 

            const initialBeneficiaryBalance = await ethers.provider.getBalance(beneficiary.address);
            const initialEscrowBalance = await ethers.provider.getBalance(escrow.target);
            
            // Execute the refund transaction by the beneficiary
            const tx = await escrow.connect(beneficiary).refund();
            const receipt = await tx.wait();

            // 1. Test Events
            await expect(tx)
                .to.emit(escrow, "Refunded")
                .withArgs(beneficiary.address, depositAmount); // Assuming refund goes to beneficiary if they call it

            // 2. Test State/Balance
            expect(await ethers.provider.getBalance(escrow.target)).to.equal(0);

            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const finalBeneficiaryBalance = await ethers.provider.getBalance(beneficiary.address);
            
            expect(finalBeneficiaryBalance).to.be.closeTo(
                initialBeneficiaryBalance + initialEscrowBalance - gasUsed,
                ethers.parseEther("0.0001")
            );
        });
    });

    describe("Refund Failure Scenarios", function () {
        it("should revert if refund is attempted before expiry", async function () {
            // Time is still before expiry (only a few seconds passed in beforeEach)
            await expect(
                escrow.connect(depositor).refund()
            ).to.be.revertedWith("Escrow not expired"); // Assuming a clear revert message
        });

        it("should revert if refund is attempted by a non-depositor/non-beneficiary account", async function () {
            await increaseTime(ESCROW_DURATION + 1); 

            // Attempt refund from a completely unrelated account
            await expect(
                escrow.connect(otherAccount).refund()
            ).to.be.revertedWith("Only depositor or beneficiary can refund"); // Assuming a clear revert message
        });

        it("should revert if refund is attempted after the funds have already been released (Edge Case)", async function () {
            // 1. Advance time and perform a successful refund
            await increaseTime(ESCROW_DURATION + 1); 
            await escrow.connect(depositor).refund();

            // 2. Attempt a second refund
            await expect(
                escrow.connect(depositor).refund()
            ).to.be.revertedWith("No funds to refund"); // Assuming a clear revert message for empty escrow
        });
    });

    describe("Edge Cases and State Checks", function () {
        it("should revert if refund is attempted exactly at the expiry time (assuming > is required)", async function () {
            // Advance time exactly to the expiry time
            await increaseTime(ESCROW_DURATION); 
            
            // The contract logic is typically `block.timestamp > expiryTime`
            await expect(
                escrow.connect(depositor).refund()
            ).to.be.revertedWith("Escrow not expired");
        });

        it("should successfully refund if the amount is minimal (Edge Case: Smallest possible deposit)", async function () {
            // Deploy a new escrow with 1 wei
            const minimalAmount = 1n; // 1 wei
            const latestBlock = await ethers.provider.getBlock("latest");
            const expiryTime = latestBlock.timestamp + ESCROW_DURATION;
            
            const minimalEscrow = await Escrow.connect(depositor).deploy(beneficiary.address, expiryTime, { value: minimalAmount });
            await minimalEscrow.waitForDeployment();

            await increaseTime(ESCROW_DURATION + 1); 

            const initialDepositorBalance = await ethers.provider.getBalance(depositor.address);
            
            const tx = await minimalEscrow.connect(depositor).refund();
            const receipt = await tx.wait();

            // Check that the escrow is empty
            expect(await ethers.provider.getBalance(minimalEscrow.target)).to.equal(0);

            // Check that the event was emitted with the minimal amount
            await expect(tx)
                .to.emit(minimalEscrow, "Refunded")
                .withArgs(depositor.address, minimalAmount);
            
            // Check depositor balance increase (will be very close to initial - gas)
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const finalDepositorBalance = await ethers.provider.getBalance(depositor.address);
            
            // The increase should be minimalAmount - gasUsed. Since gasUsed is much larger, the final balance 
            // should be close to initial - gasUsed + minimalAmount.
            expect(finalDepositorBalance).to.be.closeTo(
                initialDepositorBalance - gasUsed + minimalAmount,
                ethers.parseEther("0.0001")
            );
        });
    });
});

// --- Mock Contract for Runnable Test ---
// Since the actual contract is not provided, a minimal mock is included to make the test runnable.
// In a real project, this would be in 'contracts/SimplifiedEscrow.sol'
const SimplifiedEscrow_MOCK_SOURCE = \`
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimplifiedEscrow {
    address public depositor;
    address payable public beneficiary;
    uint256 public expiryTime;
    uint256 public amount;
    bool public refunded;

    event Refunded(address indexed recipient, uint256 amount);

    constructor(address payable _beneficiary, uint256 _expiryTime) payable {
        depositor = msg.sender;
        beneficiary = _beneficiary;
        expiryTime = _expiryTime;
        amount = msg.value;
        refunded = false;
    }

    function refund() public {
        require(block.timestamp > expiryTime, "Escrow not expired");
        require(msg.sender == depositor || msg.sender == beneficiary, "Only depositor or beneficiary can refund");
        require(amount > 0, "No funds to refund");
        
        uint256 amountToRefund = amount;
        amount = 0;
        refunded = true;

        (bool success, ) = payable(msg.sender).call{value: amountToRefund}("");
        require(success, "Transfer failed");

        emit Refunded(msg.sender, amountToRefund);
    }
}
\`;

// Hardhat task to compile the mock contract for the test to use
const fs = require('fs');
const path = require('path');
const mockContractPath = path.join(__dirname, "contracts", "SimplifiedEscrow.sol");

// Create the contracts directory if it doesn't exist
if (!fs.existsSync(path.join(__dirname, "contracts"))) {
    fs.mkdirSync(path.join(__dirname, "contracts"));
}

// Write the mock contract source to a file
fs.writeFileSync(mockContractPath, SimplifiedEscrow_MOCK_SOURCE);

// Note: In a real Hardhat environment, the contract would be compiled automatically.
// The inclusion of the mock source is for completeness and to ensure the test logic is sound
// against a defined contract interface.
