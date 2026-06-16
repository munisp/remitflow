// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RemitFlowVault.sol";
import "../src/RemitFlowEscrow.sol";
import "../src/RemitFlowBridge.sol";
import "../src/RemitFlowTimelock.sol";

/**
 * @notice Deployment script for all RemitFlow contracts.
 *
 * Usage:
 *   # Testnet (Base Sepolia)
 *   forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify
 *
 *   # Mainnet (Polygon)
 *   forge script script/Deploy.s.sol --rpc-url $POLYGON_RPC --broadcast --verify --slow
 *
 * Environment variables:
 *   DEPLOYER_PRIVATE_KEY — private key of deployer EOA
 *   ADMIN_ADDRESS — admin address (should be Gnosis Safe on mainnet)
 *   TREASURY_ADDRESS — treasury for emergency withdrawals
 *   SIGNER_1, SIGNER_2, SIGNER_3 — multi-sig signer addresses
 *   VALIDATOR_1..VALIDATOR_5 — bridge validator addresses
 *   USDC_ADDRESS — USDC contract on target chain
 *   USDT_ADDRESS — USDT contract on target chain
 */
contract DeployRemitFlow is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        address[3] memory signers = [
            vm.envAddress("SIGNER_1"),
            vm.envAddress("SIGNER_2"),
            vm.envAddress("SIGNER_3")
        ];

        address[] memory validators = new address[](5);
        validators[0] = vm.envAddress("VALIDATOR_1");
        validators[1] = vm.envAddress("VALIDATOR_2");
        validators[2] = vm.envAddress("VALIDATOR_3");
        validators[3] = vm.envAddress("VALIDATOR_4");
        validators[4] = vm.envAddress("VALIDATOR_5");

        address usdc = vm.envAddress("USDC_ADDRESS");
        address usdt = vm.envAddress("USDT_ADDRESS");

        address[] memory proposers = new address[](1);
        proposers[0] = admin;
        address[] memory executors = new address[](1);
        executors[0] = admin;

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Timelock (48h delay governance)
        RemitFlowTimelock timelock = new RemitFlowTimelock(admin, proposers, executors);
        console.log("Timelock deployed:", address(timelock));

        // 2. Deploy Vault (admin = timelock for governance, or admin directly for testnet)
        RemitFlowVault vault = new RemitFlowVault(admin, treasury, signers);
        console.log("Vault deployed:", address(vault));

        // 3. Configure Vault tokens
        // USDC: $1M daily limit, $500K single tx, $100K multi-sig threshold
        vault.addToken(usdc, 1_000_000 * 1e6, 500_000 * 1e6, 100_000 * 1e6);
        console.log("USDC configured in vault");

        // USDT: same limits
        vault.addToken(usdt, 1_000_000 * 1e6, 500_000 * 1e6, 100_000 * 1e6);
        console.log("USDT configured in vault");

        // 4. Deploy Escrow
        RemitFlowEscrow escrow = new RemitFlowEscrow(admin);
        console.log("Escrow deployed:", address(escrow));

        // 5. Deploy Bridge
        RemitFlowBridge bridge = new RemitFlowBridge(admin, validators);
        console.log("Bridge deployed:", address(bridge));

        // 6. Enable chains on bridge
        // Polygon: $5M daily, $10 min, $1M max
        bridge.enableChain(137, 5_000_000 * 1e6, 10 * 1e6, 1_000_000 * 1e6);
        // Arbitrum
        bridge.enableChain(42161, 5_000_000 * 1e6, 10 * 1e6, 1_000_000 * 1e6);
        // Base
        bridge.enableChain(8453, 5_000_000 * 1e6, 10 * 1e6, 1_000_000 * 1e6);
        // BSC
        bridge.enableChain(56, 5_000_000 * 1e6, 10 * 1e6, 1_000_000 * 1e6);
        // Optimism
        bridge.enableChain(10, 5_000_000 * 1e6, 10 * 1e6, 1_000_000 * 1e6);
        console.log("5 chains enabled on bridge");

        vm.stopBroadcast();

        // Log deployment summary
        console.log("=== DEPLOYMENT SUMMARY ===");
        console.log("Timelock:", address(timelock));
        console.log("Vault:", address(vault));
        console.log("Escrow:", address(escrow));
        console.log("Bridge:", address(bridge));
        console.log("Admin:", admin);
        console.log("Treasury:", treasury);
    }
}
