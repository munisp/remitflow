const hre = require("hardhat");

/**
 * Deploy SimplifiedEscrow contract to Base Network
 * 
 * Networks:
 * - Base Mainnet: Chain ID 8453
 * - Base Sepolia (Testnet): Chain ID 84532
 */
async function main() {
  console.log("🚀 Deploying SimplifiedEscrow to Base Network...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  const balance = await deployer.getBalance();
  console.log("💰 Account balance:", hre.ethers.utils.formatEther(balance), "ETH\n");

  // Admin wallet address (for gas sponsorship)
  const ADMIN_WALLET = process.env.ADMIN_WALLET || deployer.address;
  console.log("👤 Admin wallet:", ADMIN_WALLET);

  // Deploy SimplifiedEscrow
  console.log("\n📦 Deploying SimplifiedEscrow contract...");
  const SimplifiedEscrow = await hre.ethers.getContractFactory("SimplifiedEscrow");
  const escrow = await SimplifiedEscrow.deploy(ADMIN_WALLET);

  await escrow.deployed();

  console.log("✅ SimplifiedEscrow deployed to:", escrow.address);
  console.log("🔗 Transaction hash:", escrow.deployTransaction.hash);

  // Wait for confirmations
  console.log("\n⏳ Waiting for 5 confirmations...");
  await escrow.deployTransaction.wait(5);
  console.log("✅ Confirmed!");

  // Add supported tokens
  console.log("\n💎 Adding supported tokens...");
  
  const tokens = {
    mainnet: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
      WETH: "0x4200000000000000000000000000000000000006",
    },
    sepolia: {
      USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      WETH: "0x4200000000000000000000000000000000000006",
    }
  };

  const network = hre.network.name;
  const tokenList = network === "baseSepolia" ? tokens.sepolia : tokens.mainnet;

  for (const [symbol, address] of Object.entries(tokenList)) {
    console.log(`  Adding ${symbol} (${address})...`);
    const tx = await escrow.addSupportedToken(address);
    await tx.wait();
    console.log(`  ✅ ${symbol} added`);
  }

  // Verify contract on Basescan
  if (network !== "localhost" && network !== "hardhat") {
    console.log("\n🔍 Verifying contract on Basescan...");
    console.log("⏳ Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    try {
      await hre.run("verify:verify", {
        address: escrow.address,
        constructorArguments: [ADMIN_WALLET],
      });
      console.log("✅ Contract verified!");
    } catch (error) {
      console.log("⚠️  Verification failed:", error.message);
    }
  }

  // Print deployment summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 DEPLOYMENT SUMMARY");
  console.log("=".repeat(60));
  console.log("Network:", network);
  console.log("Contract:", escrow.address);
  console.log("Admin Wallet:", ADMIN_WALLET);
  console.log("Deployer:", deployer.address);
  console.log("Gas Used:", escrow.deployTransaction.gasLimit.toString());
  console.log("Supported Tokens:", Object.keys(tokenList).join(", "));
  console.log("=".repeat(60));

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    network: network,
    contract: escrow.address,
    adminWallet: ADMIN_WALLET,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    supportedTokens: tokenList,
    transactionHash: escrow.deployTransaction.hash,
  };

  fs.writeFileSync(
    `deployments/${network}-deployment.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`\n💾 Deployment info saved to deployments/${network}-deployment.json`);
  console.log("\n✅ Deployment complete! 🎉\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
