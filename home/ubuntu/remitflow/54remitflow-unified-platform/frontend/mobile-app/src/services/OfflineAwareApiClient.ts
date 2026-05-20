/**
 * OfflineAwareApiClient.ts - API client with offline-first support
 * Integrates OfflineService, OfflineFirstManager, and EncryptedStorage
 * for seamless offline transaction handling
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { v4 as uuidv4 } from 'uuid';
import OfflineService from './OfflineService';
import { encryptedStorage, encryptedAsyncStorage } from './EncryptedStorage';

// Types
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  offline?: boolean;
  pendingSync?: boolean;
}

interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  data?: any;
  headers?: Record<string, string>;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiresOnline?: boolean;
  idempotencyKey?: string;
  timeout?: number;
  retryCount?: number;
}

interface TransactionRequest {
  type: 'TRANSFER' | 'PAYMENT' | 'DEPOSIT' | 'WITHDRAWAL' | 'AIRTIME' | 'BILL_PAYMENT';
  amount: number;
  currency: string;
  recipient?: string;
  accountId?: string;
  metadata?: Record<string, any>;
}

interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  type: string;
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'offline';
}

// Priority levels for request queue
const PRIORITY_LEVELS = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Offline-aware API client that handles network failures gracefully
 */
export class OfflineAwareApiClient {
  private static instance: OfflineAwareApiClient;
  private baseUrl: string = '';
  private authToken: string | null = null;
  private networkStatus: NetworkStatus = {
    isConnected: true,
    isInternetReachable: true,
    type: 'unknown',
    quality: 'good',
  };
  private pendingRequests: Map<string, RequestConfig> = new Map();
  private syncInProgress: boolean = false;
  private initialized: boolean = false;

  private constructor() {}

  static getInstance(): OfflineAwareApiClient {
    if (!OfflineAwareApiClient.instance) {
      OfflineAwareApiClient.instance = new OfflineAwareApiClient();
    }
    return OfflineAwareApiClient.instance;
  }

  /**
   * Initialize the API client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load configuration
      this.baseUrl = await this.getBaseUrl();
      this.authToken = await AsyncStorage.getItem('auth_token');

      // Initialize offline service
      await OfflineService.initialize();

      // Initialize encrypted storage
      await encryptedStorage.initialize();

      // Setup network listener
      this.setupNetworkListener();

      // Load pending requests from storage
      await this.loadPendingRequests();

      this.initialized = true;
      console.log('[OfflineAwareApiClient] Initialized successfully');

      // Attempt to sync any pending requests
      if (this.networkStatus.isConnected) {
        this.syncPendingRequests();
      }
    } catch (error) {
      console.error('[OfflineAwareApiClient] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get API base URL from configuration
   */
  private async getBaseUrl(): Promise<string> {
    const storedUrl = await AsyncStorage.getItem('api_base_url');
    return storedUrl || 'https://api.agentbanking.com';
  }

  /**
   * Setup network state listener
   */
  private setupNetworkListener(): void {
    NetInfo.addEventListener((state: NetInfoState) => {
      const wasOffline = !this.networkStatus.isConnected;
      
      this.networkStatus = {
        isConnected: state.isConnected || false,
        isInternetReachable: state.isInternetReachable || false,
        type: state.type,
        quality: this.determineNetworkQuality(state),
      };

      console.log('[OfflineAwareApiClient] Network status changed:', this.networkStatus);

      // If we just came back online, sync pending requests
      if (wasOffline && this.networkStatus.isConnected && this.networkStatus.isInternetReachable) {
        console.log('[OfflineAwareApiClient] Back online, syncing pending requests...');
        this.syncPendingRequests();
      }
    });
  }

  /**
   * Determine network quality based on connection type
   */
  private determineNetworkQuality(state: NetInfoState): NetworkStatus['quality'] {
    if (!state.isConnected || !state.isInternetReachable) {
      return 'offline';
    }

    if (state.type === 'wifi') {
      return 'excellent';
    }

    if (state.type === 'cellular') {
      const details = state.details as any;
      if (details?.cellularGeneration === '4g' || details?.cellularGeneration === '5g') {
        return 'good';
      } else if (details?.cellularGeneration === '3g') {
        return 'fair';
      } else {
        return 'poor'; // 2G or unknown
      }
    }

    return 'fair';
  }

  /**
   * Load pending requests from persistent storage
   */
  private async loadPendingRequests(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem('pending_api_requests');
      if (stored) {
        const requests = JSON.parse(stored);
        for (const [id, config] of Object.entries(requests)) {
          this.pendingRequests.set(id, config as RequestConfig);
        }
        console.log(`[OfflineAwareApiClient] Loaded ${this.pendingRequests.size} pending requests`);
      }
    } catch (error) {
      console.error('[OfflineAwareApiClient] Failed to load pending requests:', error);
    }
  }

  /**
   * Save pending requests to persistent storage
   */
  private async savePendingRequests(): Promise<void> {
    try {
      const requests: Record<string, RequestConfig> = {};
      this.pendingRequests.forEach((config, id) => {
        requests[id] = config;
      });
      await AsyncStorage.setItem('pending_api_requests', JSON.stringify(requests));
    } catch (error) {
      console.error('[OfflineAwareApiClient] Failed to save pending requests:', error);
    }
  }

  /**
   * Set authentication token
   */
  async setAuthToken(token: string): Promise<void> {
    this.authToken = token;
    await AsyncStorage.setItem('auth_token', token);
  }

  /**
   * Clear authentication token
   */
  async clearAuthToken(): Promise<void> {
    this.authToken = null;
    await AsyncStorage.removeItem('auth_token');
  }

  /**
   * Make an API request with offline support
   */
  async request<T = any>(config: RequestConfig): Promise<ApiResponse<T>> {
    const requestId = config.idempotencyKey || uuidv4();

    // Check if online and request requires online
    if (config.requiresOnline && !this.networkStatus.isConnected) {
      return {
        success: false,
        error: 'This operation requires an internet connection',
        offline: true,
      };
    }

    // For GET requests when offline, try to return cached data
    if (config.method === 'GET' && !this.networkStatus.isConnected) {
      return this.handleOfflineGet<T>(config);
    }

    // For write operations when offline, queue for later
    if (!this.networkStatus.isConnected && config.method !== 'GET') {
      return this.queueOfflineRequest<T>(requestId, config);
    }

    // Online - make the actual request
    try {
      const response = await this.executeRequest<T>(config, requestId);
      
      // Cache successful GET responses
      if (config.method === 'GET' && response.success) {
        await this.cacheResponse(config.endpoint, response.data);
      }

      return response;
    } catch (error: any) {
      // Network error - queue for retry if it's a write operation
      if (this.isNetworkError(error) && config.method !== 'GET') {
        console.log('[OfflineAwareApiClient] Network error, queuing request');
        return this.queueOfflineRequest<T>(requestId, config);
      }

      return {
        success: false,
        error: error.message || 'Request failed',
      };
    }
  }

  /**
   * Execute the actual HTTP request
   */
  private async executeRequest<T>(config: RequestConfig, requestId: string): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${config.endpoint}`;
    const timeout = config.timeout || 30000;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      ...config.headers,
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    if (config.idempotencyKey) {
      headers['Idempotency-Key'] = config.idempotencyKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: config.method,
        headers,
        body: config.data ? JSON.stringify(config.data) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorBody}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Handle GET request when offline
   */
  private async handleOfflineGet<T>(config: RequestConfig): Promise<ApiResponse<T>> {
    try {
      const cached = await this.getCachedResponse<T>(config.endpoint);
      if (cached) {
        return {
          success: true,
          data: cached,
          offline: true,
        };
      }

      return {
        success: false,
        error: 'No cached data available',
        offline: true,
      };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to retrieve cached data',
        offline: true,
      };
    }
  }

  /**
   * Queue request for offline execution
   */
  private async queueOfflineRequest<T>(requestId: string, config: RequestConfig): Promise<ApiResponse<T>> {
    // Store in pending requests
    this.pendingRequests.set(requestId, {
      ...config,
      retryCount: 0,
    });
    await this.savePendingRequests();

    // Also store in OfflineService for persistence
    await OfflineService.addOfflineOperation({
      id: requestId,
      type: config.method === 'POST' ? 'CREATE' : config.method === 'PUT' ? 'UPDATE' : 'DELETE',
      entity: this.extractEntityFromEndpoint(config.endpoint),
      data: config.data,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0,
    });

    console.log(`[OfflineAwareApiClient] Request queued for offline sync: ${requestId}`);

    return {
      success: true,
      offline: true,
      pendingSync: true,
      data: {
        message: 'Request queued for sync when online',
        requestId,
      } as any,
    };
  }

  /**
   * Extract entity name from endpoint
   */
  private extractEntityFromEndpoint(endpoint: string): string {
    const parts = endpoint.split('/').filter(p => p && !p.startsWith('v'));
    return parts[0] || 'unknown';
  }

  /**
   * Cache API response
   */
  private async cacheResponse(endpoint: string, data: any): Promise<void> {
    try {
      const cacheKey = `api_cache_${endpoint.replace(/\//g, '_')}`;
      await encryptedAsyncStorage.setObject(cacheKey, {
        data,
        cachedAt: Date.now(),
      });
    } catch (error) {
      console.error('[OfflineAwareApiClient] Failed to cache response:', error);
    }
  }

  /**
   * Get cached response
   */
  private async getCachedResponse<T>(endpoint: string): Promise<T | null> {
    try {
      const cacheKey = `api_cache_${endpoint.replace(/\//g, '_')}`;
      const cached = await encryptedAsyncStorage.getObject<{ data: T; cachedAt: number }>(cacheKey);
      
      if (cached) {
        // Check if cache is still valid (24 hours)
        const maxAge = 24 * 60 * 60 * 1000;
        if (Date.now() - cached.cachedAt < maxAge) {
          return cached.data;
        }
      }
      
      return null;
    } catch (error) {
      console.error('[OfflineAwareApiClient] Failed to get cached response:', error);
      return null;
    }
  }

  /**
   * Check if error is a network error
   */
  private isNetworkError(error: any): boolean {
    return (
      error.name === 'AbortError' ||
      error.message?.includes('Network request failed') ||
      error.message?.includes('Failed to fetch') ||
      error.message?.includes('timeout')
    );
  }

  /**
   * Sync pending requests when back online
   */
  async syncPendingRequests(): Promise<void> {
    if (this.syncInProgress || !this.networkStatus.isConnected) {
      return;
    }

    this.syncInProgress = true;
    console.log('[OfflineAwareApiClient] Starting sync of pending requests...');

    try {
      // Sort by priority (highest first)
      const sortedRequests = Array.from(this.pendingRequests.entries()).sort(
        ([, a], [, b]) => (PRIORITY_LEVELS[b.priority || 'MEDIUM'] || 0) - (PRIORITY_LEVELS[a.priority || 'MEDIUM'] || 0)
      );

      for (const [requestId, config] of sortedRequests) {
        try {
          const response = await this.executeRequest(config, requestId);
          
          if (response.success) {
            this.pendingRequests.delete(requestId);
            console.log(`[OfflineAwareApiClient] Synced request: ${requestId}`);
          } else {
            // Increment retry count
            config.retryCount = (config.retryCount || 0) + 1;
            
            // Remove if max retries exceeded
            if (config.retryCount >= 5) {
              this.pendingRequests.delete(requestId);
              console.error(`[OfflineAwareApiClient] Request failed after max retries: ${requestId}`);
            }
          }
        } catch (error) {
          console.error(`[OfflineAwareApiClient] Failed to sync request ${requestId}:`, error);
          
          // If network error, stop syncing
          if (this.isNetworkError(error)) {
            break;
          }
        }
      }

      await this.savePendingRequests();

      // Also sync OfflineService operations
      await OfflineService.syncOfflineOperations();

    } finally {
      this.syncInProgress = false;
      console.log('[OfflineAwareApiClient] Sync complete');
    }
  }

  // ============================================================================
  // TRANSACTION-SPECIFIC METHODS
  // ============================================================================

  /**
   * Process a financial transaction with offline support
   */
  async processTransaction(transaction: TransactionRequest): Promise<ApiResponse> {
    const idempotencyKey = `txn_${uuidv4()}`;

    // Store transaction locally first (for audit trail)
    await encryptedStorage.storeTransaction(idempotencyKey, transaction.accountId || '', {
      ...transaction,
      status: 'pending',
      createdAt: Date.now(),
    });

    return this.request({
      method: 'POST',
      endpoint: '/api/v1/transactions',
      data: {
        ...transaction,
        idempotency_key: idempotencyKey,
        channel: 'mobile',
        offline_created: !this.networkStatus.isConnected,
      },
      priority: 'CRITICAL',
      idempotencyKey,
    });
  }

  /**
   * Transfer money with offline support
   */
  async transfer(
    recipientPhone: string,
    amount: number,
    currency: string = 'NGN',
    pin: string
  ): Promise<ApiResponse> {
    return this.processTransaction({
      type: 'TRANSFER',
      amount,
      currency,
      recipient: recipientPhone,
      metadata: { pin_verified: true },
    });
  }

  /**
   * Check balance (cached when offline)
   */
  async getBalance(accountId: string): Promise<ApiResponse> {
    return this.request({
      method: 'GET',
      endpoint: `/api/v1/accounts/${accountId}/balance`,
    });
  }

  /**
   * Get transaction history (cached when offline)
   */
  async getTransactionHistory(accountId: string, limit: number = 20): Promise<ApiResponse> {
    return this.request({
      method: 'GET',
      endpoint: `/api/v1/accounts/${accountId}/transactions?limit=${limit}`,
    });
  }

  /**
   * Buy airtime with offline support
   */
  async buyAirtime(
    phoneNumber: string,
    amount: number,
    network: string
  ): Promise<ApiResponse> {
    return this.processTransaction({
      type: 'AIRTIME',
      amount,
      currency: 'NGN',
      recipient: phoneNumber,
      metadata: { network },
    });
  }

  /**
   * Pay bill with offline support
   */
  async payBill(
    billerCode: string,
    accountNumber: string,
    amount: number
  ): Promise<ApiResponse> {
    return this.processTransaction({
      type: 'BILL_PAYMENT',
      amount,
      currency: 'NGN',
      metadata: { biller_code: billerCode, account_number: accountNumber },
    });
  }

  // ============================================================================
  // STATUS AND UTILITY METHODS
  // ============================================================================

  /**
   * Get current network status
   */
  getNetworkStatus(): NetworkStatus {
    return { ...this.networkStatus };
  }

  /**
   * Get pending request count
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Check if sync is in progress
   */
  isSyncing(): boolean {
    return this.syncInProgress;
  }

  /**
   * Force sync (manual trigger)
   */
  async forceSync(): Promise<void> {
    if (this.networkStatus.isConnected) {
      await this.syncPendingRequests();
    }
  }

  /**
   * Clear all cached data
   */
  async clearCache(): Promise<void> {
    await OfflineService.clearCache();
    await encryptedStorage.clearAll();
    this.pendingRequests.clear();
    await this.savePendingRequests();
  }

  /**
   * Get storage info
   */
  async getStorageInfo(): Promise<{
    pendingRequests: number;
    offlineOperations: number;
    cachedTransactions: number;
    lastSync: number | null;
  }> {
    const offlineInfo = await OfflineService.getStorageInfo();
    
    return {
      pendingRequests: this.pendingRequests.size,
      offlineOperations: offlineInfo.pendingOperations,
      cachedTransactions: offlineInfo.cachedTransactions,
      lastSync: offlineInfo.lastSync,
    };
  }
}

// Export singleton instance
export const apiClient = OfflineAwareApiClient.getInstance();

export default OfflineAwareApiClient;
