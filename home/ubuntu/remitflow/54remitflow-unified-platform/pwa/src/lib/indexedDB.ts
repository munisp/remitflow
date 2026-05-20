/**
 * IndexedDB Wrapper for Offline-First Architecture
 * 
 * Provides persistent storage for:
 * - Pending transactions (outbox pattern)
 * - Cached wallet balances
 * - Cached beneficiaries
 * - Cached transaction history
 * - Exchange rates
 * 
 * Uses IndexedDB instead of localStorage for:
 * - Better performance with large datasets
 * - Larger storage quota (50MB+ vs 5MB)
 * - Async operations that don't block UI
 * - Structured data with indexes
 */

const DB_NAME = 'remittance_offline_db';
const DB_VERSION = 1;

interface PendingTransfer {
  id: string;
  idempotencyKey: string;
  type: 'transfer' | 'airtime' | 'bill_payment' | 'wallet_fund';
  payload: Record<string, unknown>;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
  retryCount: number;
  lastError?: string;
  createdAt: number;
  syncedAt?: number;
  serverTransactionId?: string;
}

interface CachedWalletBalance {
  currency: string;
  balance: number;
  availableBalance: number;
  pendingBalance: number;
  lastUpdatedAt: number;
  cachedAt: number;
}

interface CachedBeneficiary {
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
  cachedAt: number;
}

interface CachedTransaction {
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
  cachedAt: number;
}

interface CachedExchangeRate {
  pair: string; // e.g., "NGN_USD"
  rate: number;
  inverseRate: number;
  lastUpdatedAt: number;
  cachedAt: number;
}

class IndexedDBStore {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Initialize the database
   */
  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Pending Transfers Store (Outbox)
        if (!db.objectStoreNames.contains('pending_transfers')) {
          const pendingStore = db.createObjectStore('pending_transfers', { keyPath: 'id' });
          pendingStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
          pendingStore.createIndex('status', 'status', { unique: false });
          pendingStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Cached Wallet Balances Store
        if (!db.objectStoreNames.contains('wallet_balances')) {
          const walletStore = db.createObjectStore('wallet_balances', { keyPath: 'currency' });
          walletStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }

        // Cached Beneficiaries Store
        if (!db.objectStoreNames.contains('beneficiaries')) {
          const beneficiaryStore = db.createObjectStore('beneficiaries', { keyPath: 'id' });
          beneficiaryStore.createIndex('isFavorite', 'isFavorite', { unique: false });
          beneficiaryStore.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
          beneficiaryStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }

        // Cached Transactions Store
        if (!db.objectStoreNames.contains('transactions')) {
          const txnStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txnStore.createIndex('type', 'type', { unique: false });
          txnStore.createIndex('status', 'status', { unique: false });
          txnStore.createIndex('createdAt', 'createdAt', { unique: false });
          txnStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }

        // Cached Exchange Rates Store
        if (!db.objectStoreNames.contains('exchange_rates')) {
          const ratesStore = db.createObjectStore('exchange_rates', { keyPath: 'pair' });
          ratesStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }

        // Sync State Store
        if (!db.objectStoreNames.contains('sync_state')) {
          db.createObjectStore('sync_state', { keyPath: 'dataType' });
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Get the database instance
   */
  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  // ==================== PENDING TRANSFERS (OUTBOX) ====================

  /**
   * Add a pending transfer to the outbox
   */
  async addPendingTransfer(transfer: Omit<PendingTransfer, 'id' | 'createdAt' | 'retryCount' | 'status'>): Promise<string> {
    const db = await this.getDB();
    const id = `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const newTransfer: PendingTransfer = {
      ...transfer,
      id,
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pending_transfers'], 'readwrite');
      const store = transaction.objectStore('pending_transfers');
      const request = store.add(newTransfer);

      request.onsuccess = () => resolve(id);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all pending transfers that need to be synced
   */
  async getPendingTransfersToSync(): Promise<PendingTransfer[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pending_transfers'], 'readonly');
      const store = transaction.objectStore('pending_transfers');
      const index = store.index('status');
      
      const results: PendingTransfer[] = [];
      
      // Get pending transfers
      const pendingRequest = index.openCursor(IDBKeyRange.only('pending'));
      pendingRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        }
      };

      // Get failed transfers (for retry)
      const failedRequest = index.openCursor(IDBKeyRange.only('failed'));
      failedRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve(results);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get all pending transfers
   */
  async getAllPendingTransfers(): Promise<PendingTransfer[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pending_transfers'], 'readonly');
      const store = transaction.objectStore('pending_transfers');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update a pending transfer
   */
  async updatePendingTransfer(id: string, updates: Partial<PendingTransfer>): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pending_transfers'], 'readwrite');
      const store = transaction.objectStore('pending_transfers');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (existing) {
          const updated = { ...existing, ...updates };
          const putRequest = store.put(updated);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          reject(new Error(`Transfer ${id} not found`));
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Mark a transfer as synced
   */
  async markTransferSynced(id: string, serverTransactionId: string): Promise<void> {
    await this.updatePendingTransfer(id, {
      status: 'completed',
      syncedAt: Date.now(),
      serverTransactionId,
    });
  }

  /**
   * Mark a transfer as failed
   */
  async markTransferFailed(id: string, error: string): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pending_transfers'], 'readwrite');
      const store = transaction.objectStore('pending_transfers');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (existing) {
          const updated = {
            ...existing,
            status: 'failed',
            retryCount: existing.retryCount + 1,
            lastError: error,
          };
          const putRequest = store.put(updated);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          reject(new Error(`Transfer ${id} not found`));
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete a pending transfer
   */
  async deletePendingTransfer(id: string): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pending_transfers'], 'readwrite');
      const store = transaction.objectStore('pending_transfers');
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get count of pending transfers
   */
  async getPendingTransferCount(): Promise<number> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pending_transfers'], 'readonly');
      const store = transaction.objectStore('pending_transfers');
      const index = store.index('status');
      
      let count = 0;
      
      const pendingRequest = index.count(IDBKeyRange.only('pending'));
      pendingRequest.onsuccess = () => {
        count += pendingRequest.result;
        
        const failedRequest = index.count(IDBKeyRange.only('failed'));
        failedRequest.onsuccess = () => {
          count += failedRequest.result;
          resolve(count);
        };
        failedRequest.onerror = () => reject(failedRequest.error);
      };
      pendingRequest.onerror = () => reject(pendingRequest.error);
    });
  }

  // ==================== WALLET BALANCES ====================

  /**
   * Cache wallet balances
   */
  async cacheWalletBalances(balances: Omit<CachedWalletBalance, 'cachedAt'>[]): Promise<void> {
    const db = await this.getDB();
    const cachedAt = Date.now();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['wallet_balances'], 'readwrite');
      const store = transaction.objectStore('wallet_balances');

      for (const balance of balances) {
        store.put({ ...balance, cachedAt });
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get cached wallet balances
   */
  async getCachedWalletBalances(): Promise<CachedWalletBalance[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['wallet_balances'], 'readonly');
      const store = transaction.objectStore('wallet_balances');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== BENEFICIARIES ====================

  /**
   * Cache beneficiaries
   */
  async cacheBeneficiaries(beneficiaries: Omit<CachedBeneficiary, 'cachedAt'>[]): Promise<void> {
    const db = await this.getDB();
    const cachedAt = Date.now();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['beneficiaries'], 'readwrite');
      const store = transaction.objectStore('beneficiaries');

      for (const beneficiary of beneficiaries) {
        store.put({ ...beneficiary, cachedAt });
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get cached beneficiaries
   */
  async getCachedBeneficiaries(): Promise<CachedBeneficiary[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['beneficiaries'], 'readonly');
      const store = transaction.objectStore('beneficiaries');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== TRANSACTIONS ====================

  /**
   * Cache transactions
   */
  async cacheTransactions(transactions: Omit<CachedTransaction, 'cachedAt'>[]): Promise<void> {
    const db = await this.getDB();
    const cachedAt = Date.now();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['transactions'], 'readwrite');
      const store = transaction.objectStore('transactions');

      for (const txn of transactions) {
        store.put({ ...txn, cachedAt });
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get cached transactions
   */
  async getCachedTransactions(limit: number = 50): Promise<CachedTransaction[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['transactions'], 'readonly');
      const store = transaction.objectStore('transactions');
      const index = store.index('createdAt');
      const request = index.openCursor(null, 'prev');
      
      const results: CachedTransaction[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ==================== EXCHANGE RATES ====================

  /**
   * Cache exchange rates
   */
  async cacheExchangeRates(rates: Omit<CachedExchangeRate, 'cachedAt'>[]): Promise<void> {
    const db = await this.getDB();
    const cachedAt = Date.now();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['exchange_rates'], 'readwrite');
      const store = transaction.objectStore('exchange_rates');

      for (const rate of rates) {
        store.put({ ...rate, cachedAt });
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get cached exchange rate
   */
  async getCachedExchangeRate(pair: string): Promise<CachedExchangeRate | null> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['exchange_rates'], 'readonly');
      const store = transaction.objectStore('exchange_rates');
      const request = store.get(pair);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all cached exchange rates
   */
  async getAllCachedExchangeRates(): Promise<CachedExchangeRate[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['exchange_rates'], 'readonly');
      const store = transaction.objectStore('exchange_rates');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== CLEANUP ====================

  /**
   * Clear old cached data
   */
  async clearOldCache(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    const db = await this.getDB();
    const cutoff = Date.now() - maxAgeMs;

    const stores = ['wallet_balances', 'beneficiaries', 'transactions', 'exchange_rates'];

    for (const storeName of stores) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const index = store.index('cachedAt');
        const request = index.openCursor(IDBKeyRange.upperBound(cutoff));

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
  }

  /**
   * Clear completed pending transfers older than specified age
   */
  async clearCompletedTransfers(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const db = await this.getDB();
    const cutoff = Date.now() - maxAgeMs;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pending_transfers'], 'readwrite');
      const store = transaction.objectStore('pending_transfers');
      const index = store.index('status');
      const request = index.openCursor(IDBKeyRange.only('completed'));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          if (cursor.value.syncedAt && cursor.value.syncedAt < cutoff) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Clear all data (for logout)
   */
  async clearAll(): Promise<void> {
    const db = await this.getDB();
    const stores = ['pending_transfers', 'wallet_balances', 'beneficiaries', 'transactions', 'exchange_rates', 'sync_state'];

    for (const storeName of stores) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }
}

// Export singleton instance
export const indexedDBStore = new IndexedDBStore();

// Export types
export type {
  PendingTransfer,
  CachedWalletBalance,
  CachedBeneficiary,
  CachedTransaction,
  CachedExchangeRate,
};

// Generate idempotency key
export function generateIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${Math.random().toString(36).substr(2, 9)}`;
}
