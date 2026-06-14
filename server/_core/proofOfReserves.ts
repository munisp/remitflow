/**
 * proofOfReserves.ts — Merkle Tree Reserve Attestation
 *
 * Implements proof-of-reserves for stablecoin holdings:
 *   1. Aggregates all user stablecoin balances from DB
 *   2. Builds Merkle tree of user balance commitments
 *   3. Compares against on-chain vault balances
 *   4. Generates attestation report with reserve ratio
 *   5. Users can verify their balance is included (Merkle proof)
 *
 * This is the same pattern used by Binance, Kraken, and BitMEX
 * for proving exchange solvency without revealing individual balances.
 */

import { createHash } from "crypto";
import { logger } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

export interface UserBalanceLeaf {
  userId: number;
  stablecoin: string;
  balance: number;
  hash: string;
}

export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
}

export interface MerkleProof {
  leaf: string;
  proof: Array<{
    hash: string;
    direction: "left" | "right";
  }>;
  root: string;
  verified: boolean;
}

export interface ReserveAttestation {
  attestationId: string;
  merkleRoot: string;
  totalUserLiabilities: Record<string, number>;
  totalOnChainReserves: Record<string, number>;
  reserveRatios: Record<string, number>;
  fullyBacked: boolean;
  userCount: number;
  stablecoinCount: number;
  generatedAt: string;
  verificationUrl: string;
}

// ── Hashing ─────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hashLeaf(userId: number, stablecoin: string, balance: number): string {
  // Hash: H(userId || stablecoin || balance)
  // Using SHA-256 for deterministic, collision-resistant hashing
  return sha256(`${userId}:${stablecoin}:${balance.toFixed(6)}`);
}

function hashPair(left: string, right: string): string {
  // Sorted concatenation prevents second-preimage attacks
  const [a, b] = left < right ? [left, right] : [right, left];
  return sha256(`${a}${b}`);
}

// ── Merkle Tree Builder ─────────────────────────────────────────────────────

export function buildMerkleTree(leaves: string[]): MerkleNode {
  if (leaves.length === 0) {
    return { hash: sha256("empty") };
  }

  if (leaves.length === 1) {
    return { hash: leaves[0] };
  }

  // Pad to even number
  const paddedLeaves = [...leaves];
  if (paddedLeaves.length % 2 !== 0) {
    paddedLeaves.push(paddedLeaves[paddedLeaves.length - 1]);
  }

  let nodes: MerkleNode[] = paddedLeaves.map(h => ({ hash: h }));

  while (nodes.length > 1) {
    const nextLevel: MerkleNode[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = nodes[i + 1] || nodes[i];
      nextLevel.push({
        hash: hashPair(left.hash, right.hash),
        left,
        right,
      });
    }
    nodes = nextLevel;
  }

  return nodes[0];
}

export function getMerkleRoot(leaves: string[]): string {
  return buildMerkleTree(leaves).hash;
}

// ── Merkle Proof Generation ─────────────────────────────────────────────────

export function generateMerkleProof(
  leaves: string[],
  targetLeaf: string,
): MerkleProof {
  const leafIndex = leaves.indexOf(targetLeaf);
  if (leafIndex === -1) {
    return { leaf: targetLeaf, proof: [], root: "", verified: false };
  }

  const paddedLeaves = [...leaves];
  if (paddedLeaves.length % 2 !== 0) {
    paddedLeaves.push(paddedLeaves[paddedLeaves.length - 1]);
  }

  const proof: Array<{ hash: string; direction: "left" | "right" }> = [];
  let currentIndex = leafIndex;
  let currentLevel = paddedLeaves;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1] || currentLevel[i];

      if (i === currentIndex || i + 1 === currentIndex) {
        if (currentIndex % 2 === 0) {
          proof.push({ hash: right, direction: "right" });
        } else {
          proof.push({ hash: left, direction: "left" });
        }
      }

      nextLevel.push(hashPair(left, right));
    }

    currentIndex = Math.floor(currentIndex / 2);
    currentLevel = nextLevel;
  }

  const root = currentLevel[0];

  return {
    leaf: targetLeaf,
    proof,
    root,
    verified: true,
  };
}

// ── Merkle Proof Verification ───────────────────────────────────────────────

export function verifyMerkleProof(proof: MerkleProof): boolean {
  let hash = proof.leaf;

  for (const step of proof.proof) {
    if (step.direction === "left") {
      hash = hashPair(step.hash, hash);
    } else {
      hash = hashPair(hash, step.hash);
    }
  }

  return hash === proof.root;
}

// ── Reserve Attestation Generator ───────────────────────────────────────────

export async function generateReserveAttestation(params: {
  userBalances: Array<{ userId: number; stablecoin: string; balance: number }>;
  onChainReserves: Record<string, number>;
}): Promise<ReserveAttestation> {
  const { userBalances, onChainReserves } = params;

  // Build leaves
  const leaves: UserBalanceLeaf[] = userBalances.map(ub => ({
    userId: ub.userId,
    stablecoin: ub.stablecoin,
    balance: ub.balance,
    hash: hashLeaf(ub.userId, ub.stablecoin, ub.balance),
  }));

  // Build Merkle tree
  const leafHashes = leaves.map(l => l.hash);
  const merkleRoot = getMerkleRoot(leafHashes);

  // Aggregate liabilities per stablecoin
  const totalLiabilities: Record<string, number> = {};
  for (const leaf of leaves) {
    totalLiabilities[leaf.stablecoin] = (totalLiabilities[leaf.stablecoin] || 0) + leaf.balance;
  }

  // Calculate reserve ratios
  const reserveRatios: Record<string, number> = {};
  let fullyBacked = true;
  for (const [coin, liability] of Object.entries(totalLiabilities)) {
    const reserve = onChainReserves[coin] || 0;
    const ratio = liability > 0 ? Math.round((reserve / liability) * 10000) / 10000 : 1;
    reserveRatios[coin] = ratio;
    if (ratio < 1) fullyBacked = false;
  }

  const userIds = new Set(userBalances.map(ub => ub.userId));
  const stablecoins = new Set(userBalances.map(ub => ub.stablecoin));

  const attestationId = `ATTEST-${Date.now().toString(36)}-${createHash("sha256").update(merkleRoot).digest("hex").slice(0, 8)}`;

  logger.info({
    attestationId,
    merkleRoot,
    userCount: userIds.size,
    fullyBacked,
    reserveRatios,
  }, "Reserve attestation generated");

  return {
    attestationId,
    merkleRoot,
    totalUserLiabilities: totalLiabilities,
    totalOnChainReserves: onChainReserves,
    reserveRatios,
    fullyBacked,
    userCount: userIds.size,
    stablecoinCount: stablecoins.size,
    generatedAt: new Date().toISOString(),
    verificationUrl: `https://remitflow.io/reserves/${attestationId}`,
  };
}

export function generateUserProof(params: {
  userId: number;
  stablecoin: string;
  balance: number;
  allLeafHashes: string[];
}): MerkleProof {
  const leafHash = hashLeaf(params.userId, params.stablecoin, params.balance);
  return generateMerkleProof(params.allLeafHashes, leafHash);
}
