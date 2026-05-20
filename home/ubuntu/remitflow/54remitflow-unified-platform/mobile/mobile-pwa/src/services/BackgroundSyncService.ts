/**
 * Background Sync Service for PWA
 * 
 * Features:
 * - Offline transaction queue
 * - Automatic sync when online
 * - Conflict resolution
 * - Retry with exponential backoff
 */

export interface OfflineTransaction {
  id: string;
  type: 'cash_in' | 'cash_out' | 'transfer' | 'bill_payment';
  amount: number;
  currency: string;
  agentId?: string;
  customerId: string;
  recipientId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  retryCount: number;
  lastError?: string;
}

export interface SyncResult {
  success: boolean;
  transactionId: string;
  serverTransactionId?: string;
  error?: string;
}

export type SyncStatusHandler = (status: SyncStatus) => void;

export interface SyncStatus {
  pending: number;
  syncing: boolean;
  lastSyncAt: Date | null;
  errors: number;
}

class BackgroundSyncService {
  private static instance: BackgroundSyncService;
  private db: IDBDatabase | null = null;
  private syncing = false;
  private handlers: SyncStatusHandler[] = [];
  private status: SyncStatus = {
    pending: 0,
    syncing: false,
    lastSyncAt: null,
    errors: 0
  };

  private readonly DB_NAME = 'AgentBankingOffline';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'transactions';
  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY = 1000; // 1 second

  private constructor() {}

  static getInstance(): BackgroundSyncService {
    if (!BackgroundSyncService.instance) {
      BackgroundSyncService.instance = new BackgroundSyncService();
    }
    return BackgroundSyncService.instance;
  }

  /**
   * Initialize the background sync service
   */
  async initialize(): Promise<void> {
    console.log('[SYNC] Initializing background sync service...');

    // Open IndexedDB
    await this.openDatabase();

    // Register service worker sync
    await this.registerBackgroundSync();

    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());

    // Update pending count
    await this.updateStatus();

    console.log('[SYNC] Background sync service initialized');
  }

  /**
   * Open IndexedDB database
   */
  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.error('[SYNC] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[SYNC] Database opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          console.log('[SYNC] Object store created');
        }
      };
    });
  }

  /**
   * Register background sync with service worker
   */
  private async registerBackgroundSync(): Promise<void> {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await (registration as any).sync.register('sync-transactions');
        console.log('[SYNC] Background sync registered');
      } catch (error) {
        console.warn('[SYNC] Background sync registration failed:', error);
      }
    }
  }

  /**
   * Queue a transaction for offline processing
   */
  async queueTransaction(transaction: Omit<OfflineTransaction, 'id' | 'createdAt' | 'retryCount'>): Promise<string> {
    const id = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const offlineTransaction: OfflineTransaction = {
      ...transaction,
      id,
      createdAt: new Date(),
      retryCount: 0
    };

    await this.saveTransaction(offlineTransaction);
    await this.updateStatus();

    // Try to sync immediately if online
    if (navigator.onLine) {
      this.syncTransactions();
    } else {
      // Request background sync
      await this.registerBackgroundSync();
    }

    console.log('[SYNC] Transaction queued:', id);
    return id;
  }

  /**
   * Save transaction to IndexedDB
   */
  private saveTransaction(transaction: OfflineTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const txn = this.db.transaction([this.STORE_NAME], 'readwrite');
      const store = txn.objectStore(this.STORE_NAME);
      const request = store.put(transaction);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get all pending transactions
   */
  async getPendingTransactions(): Promise<OfflineTransaction[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const txn = this.db.transaction([this.STORE_NAME], 'readonly');
      const store = txn.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Delete a transaction from the queue
   */
  private deleteTransaction(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const txn = this.db.transaction([this.STORE_NAME], 'readwrite');
      const store = txn.objectStore(this.STORE_NAME);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Sync all pending transactions
   */
  async syncTransactions(): Promise<SyncResult[]> {
    if (this.syncing) {
      console.log('[SYNC] Sync already in progress');
      return [];
    }

    if (!navigator.onLine) {
      console.log('[SYNC] Offline, skipping sync');
      return [];
    }

    this.syncing = true;
    this.status.syncing = true;
    this.notifyHandlers();

    const results: SyncResult[] = [];

    try {
      const transactions = await this.getPendingTransactions();
      console.log('[SYNC] Syncing', transactions.length, 'transactions');

      for (const transaction of transactions) {
        const result = await this.syncTransaction(transaction);
        results.push(result);

        if (result.success) {
          await this.deleteTransaction(transaction.id);
        } else if (transaction.retryCount >= this.MAX_RETRIES) {
          // Move to dead letter queue or notify user
          await this.handleFailedTransaction(transaction);
          await this.deleteTransaction(transaction.id);
        } else {
          // Update retry count
          transaction.retryCount++;
          transaction.lastError = result.error;
          await this.saveTransaction(transaction);
        }
      }

      this.status.lastSyncAt = new Date();
      this.status.errors = results.filter(r => !r.success).length;
    } catch (error) {
      console.error('[SYNC] Sync failed:', error);
    } finally {
      this.syncing = false;
      this.status.syncing = false;
      await this.updateStatus();
    }

    return results;
  }

  /**
   * Sync a single transaction
   */
  private async syncTransaction(transaction: OfflineTransaction): Promise<SyncResult> {
    const apiUrl = process.env.REACT_APP_API_URL || '';
    const delay = this.BASE_DELAY * Math.pow(2, transaction.retryCount);

    // Wait with exponential backoff
    if (transaction.retryCount > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      const response = await fetch(`${apiUrl}/api/v1/transactions/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`,
          'X-Offline-Transaction': 'true',
          'X-Idempotency-Key': transaction.id
        },
        body: JSON.stringify({
          ...transaction,
          offlineId: transaction.id
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[SYNC] Transaction synced:', transaction.id);
        
        // Notify user
        this.notifyTransactionSynced(transaction, data.transactionId);

        return {
          success: true,
          transactionId: transaction.id,
          serverTransactionId: data.transactionId
        };
      } else {
        const error = await response.text();
        console.error('[SYNC] Transaction sync failed:', transaction.id, error);
        return {
          success: false,
          transactionId: transaction.id,
          error
        };
      }
    } catch (error) {
      console.error('[SYNC] Transaction sync error:', transaction.id, error);
      return {
        success: false,
        transactionId: transaction.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle permanently failed transaction
   */
  private async handleFailedTransaction(transaction: OfflineTransaction): Promise<void> {
    console.error('[SYNC] Transaction permanently failed:', transaction.id);

    // Save to failed transactions store
    const failedKey = `failed_txn_${transaction.id}`;
    localStorage.setItem(failedKey, JSON.stringify({
      ...transaction,
      failedAt: new Date().toISOString()
    }));

    // Notify user
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Transaction Failed', {
        body: `Your ${transaction.type} transaction of ${transaction.amount} ${transaction.currency} could not be processed. Please try again.`,
        icon: '/icons/icon-192x192.png',
        tag: `failed-${transaction.id}`
      });
    }
  }

  /**
   * Notify user of successful sync
   */
  private notifyTransactionSynced(transaction: OfflineTransaction, serverTransactionId: string): void {
    // Post message to main thread
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'TRANSACTION_SYNCED',
        transaction: {
          id: transaction.id,
          serverTransactionId,
          amount: transaction.amount,
          type: transaction.type
        }
      });
    }

    // Show notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Transaction Synced', {
        body: `Your ${transaction.type} transaction of ${transaction.amount} ${transaction.currency} has been processed.`,
        icon: '/icons/icon-192x192.png',
        tag: `synced-${transaction.id}`
      });
    }
  }

  /**
   * Handle coming online
   */
  private handleOnline(): void {
    console.log('[SYNC] Device is online, starting sync...');
    this.syncTransactions();
  }

  /**
   * Handle going offline
   */
  private handleOffline(): void {
    console.log('[SYNC] Device is offline');
    this.notifyHandlers();
  }

  /**
   * Update sync status
   */
  private async updateStatus(): Promise<void> {
    try {
      const transactions = await this.getPendingTransactions();
      this.status.pending = transactions.length;
      this.notifyHandlers();
    } catch (error) {
      console.error('[SYNC] Failed to update status:', error);
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /**
   * Add status change handler
   */
  addHandler(handler: SyncStatusHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove status change handler
   */
  removeHandler(handler: SyncStatusHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * Notify all handlers of status change
   */
  private notifyHandlers(): void {
    this.handlers.forEach(handler => handler(this.status));
  }

  /**
   * Get auth token
   */
  private getAuthToken(): string {
    return localStorage.getItem('auth_token') || '';
  }

  /**
   * Clear all pending transactions
   */
  async clearQueue(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const txn = this.db.transaction([this.STORE_NAME], 'readwrite');
      const store = txn.objectStore(this.STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.updateStatus();
        resolve();
      };
    });
  }

  /**
   * Get failed transactions
   */
  getFailedTransactions(): OfflineTransaction[] {
    const failed: OfflineTransaction[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('failed_txn_')) {
        try {
          const data = localStorage.getItem(key);
          if (data) {
            failed.push(JSON.parse(data));
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
    
    return failed;
  }

  /**
   * Retry a failed transaction
   */
  async retryFailedTransaction(id: string): Promise<boolean> {
    const key = `failed_txn_${id}`;
    const data = localStorage.getItem(key);
    
    if (!data) {
      return false;
    }

    try {
      const transaction: OfflineTransaction = JSON.parse(data);
      transaction.retryCount = 0;
      delete transaction.lastError;
      
      await this.saveTransaction(transaction);
      localStorage.removeItem(key);
      
      if (navigator.onLine) {
        this.syncTransactions();
      }
      
      return true;
    } catch {
      return false;
    }
  }
}

export default BackgroundSyncService.getInstance();
