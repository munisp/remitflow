const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Starting deployment...");
  console.log("Network:", hre.network.name);
  
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");
  
  // Deploy RemittanceEscrow
  console.log("\nDeploying RemittanceEscrow...");
  const RemittanceEscrow = await hre.ethers.getContractFactory("RemittanceEscrow");
  const remittanceEscrow = await RemittanceEscrow.deploy();
  await remittanceEscrow.waitForDeployment();
  const remittanceEscrowAddress = await remittanceEscrow.getAddress();
  console.log("RemittanceEscrow deployed to:", remittanceEscrowAddress);
  
  // Deploy AtomicSwap
  console.log("\nDeploying AtomicSwap...");
  const AtomicSwap = await hre.ethers.getContractFactory("AtomicSwap");
  const atomicSwap = await AtomicSwap.deploy();
  await atomicSwap.waitForDeployment();
  const atomicSwapAddress = await atomicSwap.getAddress();
  console.log("AtomicSwap deployed to:", atomicSwapAddress);
  
  // Deploy Settlement
  console.log("\nDeploying Settlement...");
  const Settlement = await hre.ethers.getContractFactory("Settlement");
  const settlement = await Settlement.deploy();
  await settlement.waitForDeployment();
  const settlementAddress = await settlement.getAddress();
  console.log("Settlement deployed to:", settlementAddress);
  
  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      RemittanceEscrow: {
        address: remittanceEscrowAddress,
        abi: "artifacts/contracts/RemittanceEscrow.sol/RemittanceEscrow.json"
      },
      AtomicSwap: {
        address: atomicSwapAddress,
        abi: "artifacts/contracts/AtomicSwap.sol/AtomicSwap.json"
      },
      Settlement: {
        address: settlementAddress,
        abi: "artifacts/contracts/Settlement.sol/Settlement.json"
      }
    }
  };
  
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(
    deploymentsDir,
    `${hre.network.name}-${Date.now()}.json`
  );
  
  fs.writeFileSync(
    deploymentFile,
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nDeployment info saved to:", deploymentFile);
  
  // Save latest deployment
  const latestFile = path.join(deploymentsDir, `${hre.network.name}-latest.json`);
  fs.writeFileSync(
    latestFile,
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("Latest deployment info saved to:", latestFile);
  
  console.log("\n=== Deployment Summary ===");
  console.log("RemittanceEscrow:", remittanceEscrowAddress);
  console.log("AtomicSwap:", atomicSwapAddress);
  console.log("Settlement:", settlementAddress);
  console.log("==========================\n");
  
  // Wait for block confirmations on testnets/mainnet
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("Waiting for block confirmations...");
    await remittanceEscrow.deploymentTransaction().wait(5);
    await atomicSwap.deploymentTransaction().wait(5);
    await settlement.deploymentTransaction().wait(5);
    console.log("Confirmed!");
    
    console.log("\nVerify contracts with:");
    console.log(`npx hardhat verify --network ${hre.network.name} ${remittanceEscrowAddress}`);
    console.log(`npx hardhat verify --network ${hre.network.name} ${atomicSwapAddress}`);
    console.log(`npx hardhat verify --network ${hre.network.name} ${settlementAddress}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
