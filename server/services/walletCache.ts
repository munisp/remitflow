/**
 * Wallet Balance LRU Cache — Lesson 6 from 1B Payments/Day research
 *
 * The benchmark reveals that TigerBeetle's bottleneck is read amplification:
 * each transfer requires account balance lookups through the LSM tree.
 * This cache reduces database reads for wallet balance checks by keeping
 * the 10,000 most recently accessed wallets in memory with a 5-second TTL.
 *
 * Optimistic concurrency control via the `version` column prevents stale
 * reads from causing double-spends.
 *
 * Reference: https://backend.how/posts/1b-payments-per-day/
 */

import { logger } from '../_core/logger';

const MAX_ENTRIES = parseInt(process.env.WALLET_CACHE_MAX_ENTRIES ?? "10000", 10);
const TTL_MS = parseInt(process.env.WALLET_CACHE_TTL_MS ?? "5000", 10);

type CachedWallet = {
  id: number;
  userId: number;
  currency: string;
  balance: string;
  reservedBalance: string;
  version: number;
  cachedAt: number; // Unix ms
};

class WalletLRUCache {
  private cache = new Map<number, CachedWallet>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  get(walletId: number): CachedWallet | null {
    const entry = this.cache.get(walletId);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > TTL_MS) {
      this.cache.delete(walletId);
      this.misses++;
      return null;
    }

    // LRU: move to end (most recently used)
    this.cache.delete(walletId);
    this.cache.set(walletId, entry);
    this.hits++;
    return entry;
  }

  set(wallet: Omit<CachedWallet, "cachedAt">): void {
    // Evict oldest entry if at capacity
    if (this.cache.size >= MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }

    this.cache.set(wallet.id, { ...wallet, cachedAt: Date.now() });
  }

  /**
   * Invalidate a wallet entry after a committed transfer.
   * Called by the transfer procedure after successful commit.
   */
  invalidate(walletId: number): void {
    this.cache.delete(walletId);
  }

  /**
   * Invalidate all wallets for a user (e.g., after account suspension).
   */
  invalidateByUser(userId: number): void {
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (entry.userId === userId) {
        this.cache.delete(key);
      }
    }
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxEntries: MAX_ENTRIES,
      ttlMs: TTL_MS,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(2) + "%" : "0%",
    };
  }

  clear(): void {
    this.cache.clear();
    logger.info("Wallet cache cleared");
  }
}

// Singleton
export const walletCache = new WalletLRUCache();
