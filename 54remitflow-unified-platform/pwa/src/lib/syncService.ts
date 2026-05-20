/**
 * Sync Service - Handles background sync of pending transactions
 * 
 * Uses IndexedDB for persistence and idempotency keys for safe retries.
 * This is the core of the offline-first architecture for the PWA.
 */

import { indexedDBStore, generateIdempotencyKey, PendingTransfer } from './indexedDB';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const MAX_RETRIES = 5;

interface SyncResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

class SyncService {
  private syncInProgress = false;
  private syncInterval: number | null = null;
  private onlineListener: (() => void) | null = null;
  private offlineListener: (() => void) | null = null;

  /**
   * Initialize the sync service
   */
  async init(): Promise<void> {
    // Initialize IndexedDB
    await indexedDBStore.init();

    // Set up online/offline listeners
    this.onlineListener = () => this.onOnline();
    this.offlineListener = () => this.onOffline();

    window.addEventListener('online', this.onlineListener);
    window.addEventListener('offline', this.offlineListener);

    // Start periodic sync if online
    if (navigator.onLine) {
      this.startPeriodicSync();
    }

    // Clean up old data
    await this.cleanup();

    console.log('[SyncService] Initialized');
  }

  /**
   * Cleanup listeners and intervals
   */
  destroy(): void {
    if (this.onlineListener) {
      window.removeEventListener('online', this.onlineListener);
    }
    if (this.offlineListener) {
      window.removeEventListener('offline', this.offlineListener);
    }
    this.stopPeriodicSync();
  }

  /**
   * Handle coming online
   */
  private async onOnline(): Promise<void> {
    console.log('[SyncService] Online - triggering sync');
    this.startPeriodicSync();
    await this.syncPendingTransfers();
  }

  /**
   * Handle going offline
   */
  private onOffline(): void {
    console.log('[SyncService] Offline - stopping sync');
    this.stopPeriodicSync();
  }

  /**
   * Start periodic sync (every 30 seconds when online)
   */
  private startPeriodicSync(): void {
    if (this.syncInterval) return;

    this.syncInterval = window.setInterval(() => {
      if (navigator.onLine) {
        this.syncPendingTransfers();
      }
    }, 30000);
  }

  /**
   * Stop periodic sync
   */
  private stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Queue a transfer for offline processing
   */
  async queueTransfer(
    type: PendingTransfer['type'],
    payload: Record<string, unknown>
  ): Promise<{ id: string; idempotencyKey: string }> {
    const idempotencyKey = generateIdempotencyKey();

    const id = await indexedDBStore.addPendingTransfer({
      idempotencyKey,
      type,
      payload,
    });

    console.log(`[SyncService] Queued transfer ${id} with idempotency key ${idempotencyKey}`);

    // Try to sync immediately if online
    if (navigator.onLine) {
      this.syncPendingTransfers();
    }

    return { id, idempotencyKey };
  }

  /**
   * Sync all pending transfers
   */
  async syncPendingTransfers(): Promise<void> {
    if (this.syncInProgress || !navigator.onLine) {
      return;
    }

    this.syncInProgress = true;

    try {
      const pendingTransfers = await indexedDBStore.getPendingTransfersToSync();

      if (pendingTransfers.length === 0) {
        console.log('[SyncService] No pending transfers to sync');
        return;
      }

      console.log(`[SyncService] Syncing ${pendingTransfers.length} pending transfers`);

      for (const transfer of pendingTransfers) {
        if (transfer.retryCount >= MAX_RETRIES) {
          console.warn(`[SyncService] Transfer ${transfer.id} exceeded max retries`);
          continue;
        }

        try {
          await indexedDBStore.updatePendingTransfer(transfer.id, { status: 'syncing' });

          const result = await this.sendTransferToBackend(transfer);

          if (result.success && result.transactionId) {
            await indexedDBStore.markTransferSynced(transfer.id, result.transactionId);
            console.log(`[SyncService] Transfer ${transfer.id} synced successfully`);
          } else {
            await indexedDBStore.markTransferFailed(transfer.id, result.error || 'Unknown error');
            console.warn(`[SyncService] Transfer ${transfer.id} failed: ${result.error}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await indexedDBStore.markTransferFailed(transfer.id, errorMessage);
          console.error(`[SyncService] Transfer ${transfer.id} error:`, error);
        }
      }
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Send a transfer to the backend API
   */
  private async sendTransferToBackend(transfer: PendingTransfer): Promise<SyncResult> {
    const endpoint = this.getEndpointForType(transfer.type);

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': transfer.idempotencyKey,
          // Auth token would be added here from auth store
        },
        body: JSON.stringify({
          ...transfer.payload,
          idempotency_key: transfer.idempotencyKey,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          transactionId: data.transaction_id || data.id,
        };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorData.detail || errorData.message || 'Unknown error'}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Get API endpoint for transaction type
   */
  private getEndpointForType(type: PendingTransfer['type']): string {
    const endpoints: Record<string, string> = {
      transfer: '/api/v1/transactions/transfer',
      airtime: '/api/v1/airtime/purchase',
      bill_payment: '/api/v1/bills/pay',
      wallet_fund: '/api/v1/wallet/fund',
    };
    return endpoints[type] || '/api/v1/transactions';
  }

  /**
   * Get pending transfer count
   */
  async getPendingCount(): Promise<number> {
    return indexedDBStore.getPendingTransferCount();
  }

  /**
   * Get all pending transfers
   */
  async getPendingTransfers(): Promise<PendingTransfer[]> {
    return indexedDBStore.getAllPendingTransfers();
  }

  /**
   * Clean up old data
   */
  private async cleanup(): Promise<void> {
    try {
      // Clear old cache (older than 24 hours)
      await indexedDBStore.clearOldCache(24 * 60 * 60 * 1000);

      // Clear completed transfers older than 7 days
      await indexedDBStore.clearCompletedTransfers(7 * 24 * 60 * 60 * 1000);

      console.log('[SyncService] Cleanup completed');
    } catch (error) {
      console.error('[SyncService] Cleanup error:', error);
    }
  }

  /**
   * Cache wallet balances
   */
  async cacheWalletBalances(balances: Array<{
    currency: string;
    balance: number;
    availableBalance: number;
    pendingBalance: number;
    lastUpdatedAt: number;
  }>): Promise<void> {
    await indexedDBStore.cacheWalletBalances(balances);
  }

  /**
   * Get cached wallet balances
   */
  async getCachedWalletBalances() {
    return indexedDBStore.getCachedWalletBalances();
  }

  /**
   * Cache beneficiaries
   */
  async cacheBeneficiaries(beneficiaries: Array<{
    id: string;
    name: string;
    phone: string;
    email?: string;
    bankName?: string;
    bankCode?: string;
    accountNumber?: string;
    accountType: 'phone' | 'email' | 'bank';
    isFavorite: boolean;
    lastUsedAt?: number;
  }>): Promise<void> {
    await indexedDBStore.cacheBeneficiaries(beneficiaries);
  }

  /**
   * Get cached beneficiaries
   */
  async getCachedBeneficiaries() {
    return indexedDBStore.getCachedBeneficiaries();
  }

  /**
   * Cache transactions
   */
  async cacheTransactions(transactions: Array<{
    id: string;
    type: string;
    status: string;
    amount: number;
    currency: string;
    fee: number;
    description: string;
    recipientName?: string;
    recipientPhone?: string;
    referenceNumber: string;
    createdAt: number;
    completedAt?: number;
  }>): Promise<void> {
    await indexedDBStore.cacheTransactions(transactions);
  }

  /**
   * Get cached transactions
   */
  async getCachedTransactions(limit?: number) {
    return indexedDBStore.getCachedTransactions(limit);
  }

  /**
   * Cache exchange rates
   */
  async cacheExchangeRates(rates: Array<{
    pair: string;
    rate: number;
    inverseRate: number;
    lastUpdatedAt: number;
  }>): Promise<void> {
    await indexedDBStore.cacheExchangeRates(rates);
  }

  /**
   * Get cached exchange rate
   */
  async getCachedExchangeRate(pair: string) {
    return indexedDBStore.getCachedExchangeRate(pair);
  }

  /**
   * Clear all cached data (for logout)
   */
  async clearAll(): Promise<void> {
    await indexedDBStore.clearAll();
  }
}

// Export singleton instance
export const syncService = new SyncService();

// Export for use in components
export { generateIdempotencyKey };
