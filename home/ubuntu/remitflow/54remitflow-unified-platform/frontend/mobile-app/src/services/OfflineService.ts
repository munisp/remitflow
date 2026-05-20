/**
 * Offline Service
 * Handles offline data storage, synchronization, and conflict resolution
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import SQLite from 'react-native-sqlite-storage';
import NetInfo from '@react-native-community/netinfo';
import {v4 as uuidv4} from 'uuid';

// Types
interface OfflineOperation {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  data: any;
  timestamp: number;
  synced: boolean;
  retryCount: number;
  lastError?: string;
}

interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

interface ConflictResolution {
  strategy: 'CLIENT_WINS' | 'SERVER_WINS' | 'MERGE' | 'MANUAL';
  resolver?: (clientData: any, serverData: any) => any;
}

class OfflineService {
  private db: SQLite.SQLiteDatabase | null = null;
  private isOffline = false;
  private syncInProgress = false;
  private readonly STORAGE_KEYS = {
    OFFLINE_OPERATIONS: 'offline_operations',
    SYNC_METADATA: 'sync_metadata',
    CACHED_DATA: 'cached_data',
  };

  async initialize(): Promise<void> {
    try {
      // Initialize SQLite database
      this.db = await SQLite.openDatabase({
        name: 'AgentBankingOffline.db',
        location: 'default',
      });

      await this.createTables();
      await this.setupNetworkListener();
      
      console.log('OfflineService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize OfflineService:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) return;

    const tables = [
      // Offline operations queue
      `CREATE TABLE IF NOT EXISTS offline_operations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        entity TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        synced INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT
      )`,
      
      // Cached transactions
      `CREATE TABLE IF NOT EXISTS cached_transactions (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        amount REAL,
        type TEXT,
        status TEXT,
        data TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        synced INTEGER DEFAULT 0
      )`,
      
      // Cached customers
      `CREATE TABLE IF NOT EXISTS cached_customers (
        id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        phone TEXT,
        data TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        synced INTEGER DEFAULT 0
      )`,
      
      // Sync metadata
      `CREATE TABLE IF NOT EXISTS sync_metadata (
        entity TEXT PRIMARY KEY,
        last_sync INTEGER,
        sync_token TEXT,
        version INTEGER DEFAULT 1
      )`,
    ];

    for (const table of tables) {
      await this.db.executeSql(table);
    }
  }

  private async setupNetworkListener(): Promise<void> {
    NetInfo.addEventListener(state => {
      const wasOffline = this.isOffline;
      this.isOffline = !state.isConnected || !state.isInternetReachable;
      
      // If we just came back online, trigger sync
      if (wasOffline && !this.isOffline) {
        this.syncOfflineOperations();
      }
    });
  }

  // Offline Operations Management
  async addOfflineOperation(
    type: 'CREATE' | 'UPDATE' | 'DELETE',
    entity: string,
    data: any
  ): Promise<string> {
    const operation: OfflineOperation = {
      id: uuidv4(),
      type,
      entity,
      data,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0,
    };

    if (this.db) {
      await this.db.executeSql(
        'INSERT INTO offline_operations (id, type, entity, data, timestamp, synced, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          operation.id,
          operation.type,
          operation.entity,
          JSON.stringify(operation.data),
          operation.timestamp,
          0,
          0,
        ]
      );
    }

    // Also store in AsyncStorage as backup
    const operations = await this.getOfflineOperations();
    operations.push(operation);
    await AsyncStorage.setItem(
      this.STORAGE_KEYS.OFFLINE_OPERATIONS,
      JSON.stringify(operations)
    );

    return operation.id;
  }

  async getOfflineOperations(): Promise<OfflineOperation[]> {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEYS.OFFLINE_OPERATIONS);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to get offline operations:', error);
      return [];
    }
  }

  async getPendingOperations(): Promise<OfflineOperation[]> {
    if (!this.db) return [];

    try {
      const [results] = await this.db.executeSql(
        'SELECT * FROM offline_operations WHERE synced = 0 ORDER BY timestamp ASC'
      );

      const operations: OfflineOperation[] = [];
      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows.item(i);
        operations.push({
          id: row.id,
          type: row.type,
          entity: row.entity,
          data: JSON.parse(row.data),
          timestamp: row.timestamp,
          synced: row.synced === 1,
          retryCount: row.retry_count,
          lastError: row.last_error,
        });
      }

      return operations;
    } catch (error) {
      console.error('Failed to get pending operations:', error);
      return [];
    }
  }

  // Data Caching
  async cacheTransaction(transaction: any): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.executeSql(
        `INSERT OR REPLACE INTO cached_transactions 
         (id, customer_id, amount, type, status, data, created_at, updated_at, synced) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transaction.id,
          transaction.customerId,
          transaction.amount,
          transaction.type,
          transaction.status,
          JSON.stringify(transaction),
          transaction.createdAt || Date.now(),
          Date.now(),
          transaction.synced ? 1 : 0,
        ]
      );
    } catch (error) {
      console.error('Failed to cache transaction:', error);
    }
  }

  async getCachedTransactions(customerId?: string): Promise<any[]> {
    if (!this.db) return [];

    try {
      const query = customerId
        ? 'SELECT * FROM cached_transactions WHERE customer_id = ? ORDER BY created_at DESC'
        : 'SELECT * FROM cached_transactions ORDER BY created_at DESC';
      
      const params = customerId ? [customerId] : [];
      const [results] = await this.db.executeSql(query, params);

      const transactions = [];
      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows.item(i);
        transactions.push({
          ...JSON.parse(row.data),
          synced: row.synced === 1,
        });
      }

      return transactions;
    } catch (error) {
      console.error('Failed to get cached transactions:', error);
      return [];
    }
  }

  async cacheCustomer(customer: any): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.executeSql(
        `INSERT OR REPLACE INTO cached_customers 
         (id, first_name, last_name, email, phone, data, created_at, updated_at, synced) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer.id,
          customer.firstName,
          customer.lastName,
          customer.email,
          customer.phone,
          JSON.stringify(customer),
          customer.createdAt || Date.now(),
          Date.now(),
          customer.synced ? 1 : 0,
        ]
      );
    } catch (error) {
      console.error('Failed to cache customer:', error);
    }
  }

  async getCachedCustomers(): Promise<any[]> {
    if (!this.db) return [];

    try {
      const [results] = await this.db.executeSql(
        'SELECT * FROM cached_customers ORDER BY first_name, last_name'
      );

      const customers = [];
      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows.item(i);
        customers.push({
          ...JSON.parse(row.data),
          synced: row.synced === 1,
        });
      }

      return customers;
    } catch (error) {
      console.error('Failed to get cached customers:', error);
      return [];
    }
  }

  // Synchronization
  async syncOfflineOperations(): Promise<SyncResult> {
    if (this.syncInProgress || this.isOffline) {
      return {success: false, synced: 0, failed: 0, errors: ['Sync already in progress or offline']};
    }

    this.syncInProgress = true;
    const result: SyncResult = {success: true, synced: 0, failed: 0, errors: []};

    try {
      const pendingOperations = await this.getPendingOperations();
      
      for (const operation of pendingOperations) {
        try {
          await this.syncOperation(operation);
          await this.markOperationSynced(operation.id);
          result.synced++;
        } catch (error: any) {
          await this.updateOperationError(operation.id, error.message);
          result.failed++;
          result.errors.push(`${operation.entity}:${operation.id} - ${error.message}`);
        }
      }

      // Sync cached data
      await this.syncCachedData();

    } catch (error: any) {
      result.success = false;
      result.errors.push(error.message);
    } finally {
      this.syncInProgress = false;
    }

    return result;
  }

  private async syncOperation(operation: OfflineOperation): Promise<void> {
    const apiEndpoint = this.getApiEndpoint(operation.entity);
    const idempotencyKey = this.generateIdempotencyKey(operation.id);
    
    switch (operation.type) {
      case 'CREATE':
        await this.apiPost(apiEndpoint, {
          ...operation.data,
          offline_operation_id: operation.id,
          offline_timestamp: operation.timestamp,
        }, idempotencyKey);
        break;
      case 'UPDATE':
        await this.apiPut(`${apiEndpoint}/${operation.data.id}`, {
          ...operation.data,
          offline_operation_id: operation.id,
          offline_timestamp: operation.timestamp,
        }, idempotencyKey);
        break;
      case 'DELETE':
        await this.apiDelete(`${apiEndpoint}/${operation.data.id}`);
        break;
    }
  }

  private async syncCachedData(): Promise<void> {
    // Sync transactions
    const unsyncedTransactions = await this.getUnsyncedTransactions();
    for (const transaction of unsyncedTransactions) {
      try {
        await this.syncTransaction(transaction);
      } catch (error) {
        console.error('Failed to sync transaction:', error);
      }
    }

    // Sync customers
    const unsyncedCustomers = await this.getUnsyncedCustomers();
    for (const customer of unsyncedCustomers) {
      try {
        await this.syncCustomer(customer);
      } catch (error) {
        console.error('Failed to sync customer:', error);
      }
    }
  }

  private async getUnsyncedTransactions(): Promise<any[]> {
    if (!this.db) return [];

    try {
      const [results] = await this.db.executeSql(
        'SELECT * FROM cached_transactions WHERE synced = 0'
      );

      const transactions = [];
      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows.item(i);
        transactions.push(JSON.parse(row.data));
      }

      return transactions;
    } catch (error) {
      console.error('Failed to get unsynced transactions:', error);
      return [];
    }
  }

  private async getUnsyncedCustomers(): Promise<any[]> {
    if (!this.db) return [];

    try {
      const [results] = await this.db.executeSql(
        'SELECT * FROM cached_customers WHERE synced = 0'
      );

      const customers = [];
      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows.item(i);
        customers.push(JSON.parse(row.data));
      }

      return customers;
    } catch (error) {
      console.error('Failed to get unsynced customers:', error);
      return [];
    }
  }

  private async syncTransaction(transaction: any): Promise<void> {
    const idempotencyKey = this.generateIdempotencyKey(`txn_${transaction.id}`);
    
    try {
      await this.apiPost('/api/v1/transactions/sync', {
        transaction_id: transaction.id,
        customer_id: transaction.customerId,
        amount: transaction.amount,
        type: transaction.type,
        status: transaction.status,
        offline_created_at: transaction.createdAt,
        data: transaction,
      }, idempotencyKey);
      
      await this.markTransactionSynced(transaction.id);
      console.log('Transaction synced successfully:', transaction.id);
    } catch (error) {
      console.error('Failed to sync transaction:', transaction.id, error);
      throw error;
    }
  }

  private async syncCustomer(customer: any): Promise<void> {
    const idempotencyKey = this.generateIdempotencyKey(`cust_${customer.id}`);
    
    try {
      await this.apiPost('/api/v1/customers/sync', {
        customer_id: customer.id,
        first_name: customer.firstName,
        last_name: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        offline_created_at: customer.createdAt,
        data: customer,
      }, idempotencyKey);
      
      await this.markCustomerSynced(customer.id);
      console.log('Customer synced successfully:', customer.id);
    } catch (error) {
      console.error('Failed to sync customer:', customer.id, error);
      throw error;
    }
  }

  private async markOperationSynced(operationId: string): Promise<void> {
    if (!this.db) return;

    await this.db.executeSql(
      'UPDATE offline_operations SET synced = 1 WHERE id = ?',
      [operationId]
    );
  }

  private async markTransactionSynced(transactionId: string): Promise<void> {
    if (!this.db) return;

    await this.db.executeSql(
      'UPDATE cached_transactions SET synced = 1 WHERE id = ?',
      [transactionId]
    );
  }

  private async markCustomerSynced(customerId: string): Promise<void> {
    if (!this.db) return;

    await this.db.executeSql(
      'UPDATE cached_customers SET synced = 1 WHERE id = ?',
      [customerId]
    );
  }

  private async updateOperationError(operationId: string, error: string): Promise<void> {
    if (!this.db) return;

    await this.db.executeSql(
      'UPDATE offline_operations SET retry_count = retry_count + 1, last_error = ? WHERE id = ?',
      [error, operationId]
    );
  }

  // Conflict Resolution
  async resolveConflict(
    entity: string,
    clientData: any,
    serverData: any,
    resolution: ConflictResolution
  ): Promise<any> {
    switch (resolution.strategy) {
      case 'CLIENT_WINS':
        return clientData;
      case 'SERVER_WINS':
        return serverData;
      case 'MERGE':
        return this.mergeData(clientData, serverData);
      case 'MANUAL':
        if (resolution.resolver) {
          return resolution.resolver(clientData, serverData);
        }
        throw new Error('Manual resolution requires a resolver function');
      default:
        return serverData; // Default to server wins
    }
  }

  private mergeData(clientData: any, serverData: any): any {
    // Simple merge strategy - server data takes precedence for conflicts
    return {
      ...clientData,
      ...serverData,
      // Keep client timestamps if they're newer
      updatedAt: Math.max(clientData.updatedAt || 0, serverData.updatedAt || 0),
    };
  }

  // Utility Methods
  private getApiEndpoint(entity: string): string {
    const endpoints: {[key: string]: string} = {
      transaction: '/api/v1/transactions',
      customer: '/api/v1/customers',
      account: '/api/v1/accounts',
      transfer: '/api/v1/transfers',
      payment: '/api/v1/payments',
      balance: '/api/v1/balance',
    };
    return endpoints[entity] || `/api/v1/${entity}`;
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem('auth_token');
    } catch (error) {
      console.error('Failed to get auth token:', error);
      return null;
    }
  }

  private async getApiBaseUrl(): Promise<string> {
    try {
      const baseUrl = await AsyncStorage.getItem('api_base_url');
      return baseUrl || 'https://api.agentbanking.com';
    } catch (error) {
      return 'https://api.agentbanking.com';
    }
  }

  private generateIdempotencyKey(operationId: string): string {
    return `idem_${operationId}_${Date.now()}`;
  }

  private async apiPost(endpoint: string, data: any, idempotencyKey?: string): Promise<any> {
    const baseUrl = await this.getApiBaseUrl();
    const authToken = await this.getAuthToken();
    
    if (!authToken) {
      throw new Error('Authentication required - no auth token available');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'X-Request-ID': uuidv4(),
    };

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API POST failed: ${response.status} - ${errorBody}`);
    }

    return response.json();
  }

  private async apiPut(endpoint: string, data: any, idempotencyKey?: string): Promise<any> {
    const baseUrl = await this.getApiBaseUrl();
    const authToken = await this.getAuthToken();
    
    if (!authToken) {
      throw new Error('Authentication required - no auth token available');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'X-Request-ID': uuidv4(),
    };

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API PUT failed: ${response.status} - ${errorBody}`);
    }

    return response.json();
  }

  private async apiDelete(endpoint: string): Promise<any> {
    const baseUrl = await this.getApiBaseUrl();
    const authToken = await this.getAuthToken();
    
    if (!authToken) {
      throw new Error('Authentication required - no auth token available');
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-Request-ID': uuidv4(),
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API DELETE failed: ${response.status} - ${errorBody}`);
    }

    return response.json();
  }

  // Public Methods
  setOfflineMode(offline: boolean): void {
    this.isOffline = offline;
  }

  isOfflineMode(): boolean {
    return this.isOffline;
  }

  isSyncInProgress(): boolean {
    return this.syncInProgress;
  }

  async clearCache(): Promise<void> {
    if (!this.db) return;

    await this.db.executeSql('DELETE FROM cached_transactions');
    await this.db.executeSql('DELETE FROM cached_customers');
    await this.db.executeSql('DELETE FROM offline_operations');
    await this.db.executeSql('DELETE FROM sync_metadata');
    
    await AsyncStorage.removeItem(this.STORAGE_KEYS.OFFLINE_OPERATIONS);
    await AsyncStorage.removeItem(this.STORAGE_KEYS.SYNC_METADATA);
    await AsyncStorage.removeItem(this.STORAGE_KEYS.CACHED_DATA);
  }

  async getStorageInfo(): Promise<{
    pendingOperations: number;
    cachedTransactions: number;
    cachedCustomers: number;
    lastSync: number | null;
  }> {
    if (!this.db) {
      return {
        pendingOperations: 0,
        cachedTransactions: 0,
        cachedCustomers: 0,
        lastSync: null,
      };
    }

    try {
      const [pendingOps] = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM offline_operations WHERE synced = 0'
      );
      const [cachedTxns] = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM cached_transactions'
      );
      const [cachedCusts] = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM cached_customers'
      );
      const [lastSyncResult] = await this.db.executeSql(
        'SELECT MAX(last_sync) as last_sync FROM sync_metadata'
      );

      return {
        pendingOperations: pendingOps.rows.item(0).count,
        cachedTransactions: cachedTxns.rows.item(0).count,
        cachedCustomers: cachedCusts.rows.item(0).count,
        lastSync: lastSyncResult.rows.item(0).last_sync,
      };
    } catch (error) {
      console.error('Failed to get storage info:', error);
      return {
        pendingOperations: 0,
        cachedTransactions: 0,
        cachedCustomers: 0,
        lastSync: null,
      };
    }
  }
}

export default new OfflineService();
