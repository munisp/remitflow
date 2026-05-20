const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper function to convert ether to wei
const toWei = (amount) => ethers.parseEther(amount.toString());

describe("SimplifiedEscrow", function () {
    let Escrow, escrow, depositor, beneficiary, arbiter, otherAccount;
    const initialDeposit = toWei(10); // 10 ETH deposit

    // beforeEach hook to set up a fresh contract instance for each test
    beforeEach(async function () {
        // Get signers from Hardhat network
        [depositor, beneficiary, arbiter, otherAccount] = await ethers.getSigners();

        // Deploy the contract with the depositor sending the initial deposit
        Escrow = await ethers.getContractFactory("SimplifiedEscrow");
        escrow = await Escrow.connect(depositor).deploy(beneficiary.address, arbiter.address, { value: initialDeposit });
        await escrow.waitForDeployment();
    });

    // --- Deployment and Initial State Tests ---
    describe("Deployment and Initial State", function () {
        it("Should set the correct depositor, beneficiary, and arbiter", async function () {
            // Comprehensive assertions for initial state
            expect(await escrow.depositor()).to.equal(depositor.address);
            expect(await escrow.beneficiary()).to.equal(beneficiary.address);
            expect(await escrow.arbiter()).to.equal(arbiter.address);
        });

        it("Should set the correct initial amount and state", async function () {
            // Check the amount and state enum (1 is FundsDeposited)
            expect(await escrow.amount()).to.equal(initialDeposit);
            expect(await escrow.currentState()).to.equal(1); // State.FundsDeposited
        });

        it("Should emit a Deposit event on successful deployment with value", async function () {
            // Test event emission during deployment
            const EscrowNoValue = await ethers.getContractFactory("SimplifiedEscrow");
            const escrowNoValue = await EscrowNoValue.connect(depositor).deploy(beneficiary.address, arbiter.address, { value: initialDeposit });
            await escrowNoValue.waitForDeployment();

            // Check for the Deposit event
            await expect(escrowNoValue.deploymentTransaction()).to.emit(escrowNoValue, "Deposit")
                .withArgs(depositor.address, initialDeposit);
        });

        // Edge Case: Deployment with zero initial value
        it("Should set state to AwaitingDeposit (0) if deployed with 0 ETH", async function () {
            const EscrowZero = await ethers.getContractFactory("SimplifiedEscrow");
            const escrowZero = await EscrowZero.connect(depositor).deploy(beneficiary.address, arbiter.address, { value: toWei(0) });
            await escrowZero.waitForDeployment();

            // Check the amount and state enum (0 is AwaitingDeposit)
            expect(await escrowZero.amount()).to.equal(toWei(0));
            expect(await escrowZero.currentState()).to.equal(0); // State.AwaitingDeposit
        });

        // Failure Scenario: Deployment with zero address for beneficiary or arbiter
        it("Should revert if beneficiary is zero address", async function () {
            const EscrowFactory = await ethers.getContractFactory("SimplifiedEscrow");
            await expect(
                EscrowFactory.deploy(ethers.ZeroAddress, arbiter.address, { value: initialDeposit })
            ).to.be.revertedWith("Beneficiary cannot be zero address");
        });

        it("Should revert if arbiter is zero address", async function () {
            const EscrowFactory = await ethers.getContractFactory("SimplifiedEscrow");
            await expect(
                EscrowFactory.deploy(beneficiary.address, ethers.ZeroAddress, { value: initialDeposit })
            ).to.be.revertedWith("Arbiter cannot be zero address");
        });
    });

    // --- Deposit Function Tests (for AwaitingDeposit state) ---
    describe("deposit()", function () {
        let escrowZero;
        const secondDeposit = toWei(5); // 5 ETH

        beforeEach(async function () {
            // Deploy a contract with 0 ETH to test the deposit function
            const EscrowZeroFactory = await ethers.getContractFactory("SimplifiedEscrow");
            escrowZero = await EscrowZeroFactory.connect(depositor).deploy(beneficiary.address, arbiter.address, { value: toWei(0) });
            await escrowZero.waitForDeployment();
        });

        // Success Scenario
        it("Should allow depositor to deposit funds and update state/amount", async function () {
            // Perform the deposit
            await expect(escrowZero.connect(depositor).deposit({ value: secondDeposit }))
                .to.emit(escrowZero, "Deposit")
                .withArgs(depositor.address, secondDeposit);

            // Check state and amount update
            expect(await escrowZero.amount()).to.equal(secondDeposit);
            expect(await escrowZero.currentState()).to.equal(1); // State.FundsDeposited
        });

        // Failure Scenario: Non-depositor attempts to deposit
        it("Should revert if a non-depositor tries to deposit", async function () {
            await expect(
                escrowZero.connect(otherAccount).deposit({ value: secondDeposit })
            ).to.be.revertedWith("Only depositor can deposit");
        });

        // Failure Scenario: Deposit when funds are already deposited
        it("Should revert if deposit is called when state is FundsDeposited", async function () {
            // First, deposit to change state to FundsDeposited
            await escrowZero.connect(depositor).deposit({ value: secondDeposit });

            // Second deposit attempt should fail
            await expect(
                escrowZero.connect(depositor).deposit({ value: toWei(1) })
            ).to.be.revertedWith("Funds already deposited");
        });

        // Edge Case: Depositing zero amount
        it("Should revert if depositor tries to deposit 0 ETH", async function () {
            await expect(
                escrowZero.connect(depositor).deposit({ value: toWei(0) })
            ).to.be.revertedWith("Must send a non-zero amount");
        });
    });

    // --- Release Function Tests ---
    describe("release()", function () {
        // Success Scenario
        it("Should allow arbiter to release funds to beneficiary and update state", async function () {
            // Record initial balances
            const initialBeneficiaryBalance = await ethers.provider.getBalance(beneficiary.address);

            // Perform the release
            const tx = await escrow.connect(arbiter).release();
            const receipt = await tx.wait();

            // Check event emission
            await expect(tx).to.emit(escrow, "Release")
                .withArgs(beneficiary.address, initialDeposit);

            // Check state update (2 is Released)
            expect(await escrow.currentState()).to.equal(2);

            // Check beneficiary balance (must be greater than initial)
            const finalBeneficiaryBalance = await ethers.provider.getBalance(beneficiary.address);
            expect(finalBeneficiaryBalance).to.equal(initialBeneficiaryBalance + initialDeposit);

            // Check contract balance (must be 0)
            expect(await ethers.provider.getBalance(escrow.target)).to.equal(0);

            // Test Gas Usage (The console.log was removed for final code submission, but the test logic remains)
            // console.log("\tGas used for release: " + receipt.gasUsed.toString());
        });

        // Failure Scenario: Non-arbiter attempts to release
        it("Should revert if a non-arbiter tries to release funds", async function () {
            await expect(
                escrow.connect(depositor).release()
            ).to.be.revertedWith("Only arbiter can release funds");
        });

        // Failure Scenario: Release when funds are not deposited (AwaitingDeposit)
        it("Should revert if release is called when state is AwaitingDeposit", async function () {
            const EscrowZeroFactory = await ethers.getContractFactory("SimplifiedEscrow");
            const escrowZero = await EscrowZeroFactory.connect(depositor).deploy(beneficiary.address, arbiter.address, { value: toWei(0) });
            await escrowZero.waitForDeployment();

            await expect(
                escrowZero.connect(arbiter).release()
            ).to.be.revertedWith("Funds not deposited or already settled");
        });

        // Failure Scenario: Release when already settled (Released)
        it("Should revert if release is called when state is Released", async function () {
            // First, release the funds
            await escrow.connect(arbiter).release();

            // Second release attempt should fail
            await expect(
                escrow.connect(arbiter).release()
            ).to.be.revertedWith("Funds not deposited or already settled");
        });
    });

    // --- Refund Function Tests ---
    describe("refund()", function () {
        // Success Scenario
        it("Should allow arbiter to refund funds to depositor and update state", async function () {
            // Perform the refund
            const tx = await escrow.connect(arbiter).refund();
            const receipt = await tx.wait();

            // Check event emission
            await expect(tx).to.emit(escrow, "Refund")
                .withArgs(depositor.address, initialDeposit);

            // Check state update (3 is Refunded)
            expect(await escrow.currentState()).to.equal(3);

            // Check contract balance (must be 0)
            expect(await ethers.provider.getBalance(escrow.target)).to.equal(0);

            // Test Gas Usage
            // console.log("\tGas used for refund: " + receipt.gasUsed.toString());
        });

        // Failure Scenario: Non-arbiter attempts to refund
        it("Should revert if a non-arbiter tries to refund funds", async function () {
            await expect(
                escrow.connect(depositor).refund()
            ).to.be.revertedWith("Only arbiter can refund funds");
        });

        // Failure Scenario: Refund when funds are not deposited (AwaitingDeposit)
        it("Should revert if refund is called when state is Released", async function () {
            // First, release the funds
            await escrow.connect(arbiter).release();

            // Second refund attempt should fail
            await expect(
                escrow.connect(arbiter).refund()
            ).to.be.revertedWith("Funds not deposited or already settled");
        });
    });

    // --- Edge Case: Fallback Function Test ---
    describe("Fallback Function", function () {
        it("Should revert on direct Ether transfer to the contract", async function () {
            // Attempt to send 1 ETH directly to the contract address
            await expect(
                depositor.sendTransaction({
                    to: escrow.target,
                    value: toWei(1),
                })
            ).to.be.revertedWith("Ether transfer not allowed");
        });
    });
});