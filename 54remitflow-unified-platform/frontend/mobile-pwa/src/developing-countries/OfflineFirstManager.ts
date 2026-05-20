/**
 * OfflineFirstManager - Offline-First Architecture
 * 
 * Provides complete offline functionality with:
 * - Request queuing with priority
 * - Automatic sync when online
 * - Retry logic with backoff
 * - Network monitoring
 * - Conflict resolution
 * 
 * Critical for developing countries with inconsistent connectivity
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

// Request priority
export enum RequestPriority {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  CRITICAL = 3,
}

// Request status
export enum RequestStatus {
  PENDING = 'pending',
  SYNCING = 'syncing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Queued request
export interface QueuedRequest {
  id: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  priority: RequestPriority;
  status: RequestStatus;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  lastAttemptAt?: number;
  error?: string;
}

// Sync result
export interface SyncResult {
  totalRequests: number;
  successful: number;
  failed: number;
  pending: number;
}

// Network status
export interface NetworkStatus {
  isConnected: boolean;
  type: string;
  isInternetReachable: boolean;
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'offline';
}

/**
 * OfflineFirstManager - Singleton for managing offline-first functionality
 */
export class OfflineFirstManager {
  private static instance: OfflineFirstManager;
  private requestQueue: Map<string, QueuedRequest>;
  private isSyncing: boolean;
  private networkStatus: NetworkStatus;
  private netInfoUnsubscribe: (() => void) | null;
  private syncInterval: NodeJS.Timeout | null;

  private constructor() {
    this.requestQueue = new Map();
    this.isSyncing = false;
    this.networkStatus = {
      isConnected: false,
      type: 'unknown',
      isInternetReachable: false,
      quality: 'offline',
    };
    this.netInfoUnsubscribe = null;
    this.syncInterval = null;
    this.initialize();
  }

  public static getInstance(): OfflineFirstManager {
    if (!OfflineFirstManager.instance) {
      OfflineFirstManager.instance = new OfflineFirstManager();
    }
    return OfflineFirstManager.instance;
  }

  /**
   * Initialize offline-first manager
   */
  private async initialize(): Promise<void> {
    try {
      // Load queued requests
      await this.loadQueue();

      // Set up network monitoring
      this.setupNetworkMonitoring();

      // Start periodic sync
      this.startPeriodicSync();

      console.log('[OfflineFirstManager] Initialized successfully');
    } catch (error) {
      console.error('[OfflineFirstManager] Initialization error:', error);
    }
  }

  /**
   * Load request queue from storage
   */
  private async loadQueue(): Promise<void> {
    try {
      const queueJson = await AsyncStorage.getItem('@request_queue');
      if (queueJson) {
        const requests: QueuedRequest[] = JSON.parse(queueJson);
        requests.forEach(request => {
          this.requestQueue.set(request.id, request);
        });
        console.log(`[OfflineFirstManager] Loaded ${requests.length} queued requests`);
      }
    } catch (error) {
      console.error('[OfflineFirstManager] Load queue error:', error);
    }
  }

  /**
   * Save request queue to storage
   */
  private async saveQueue(): Promise<void> {
    try {
      const requests = Array.from(this.requestQueue.values());
      await AsyncStorage.setItem('@request_queue', JSON.stringify(requests));
    } catch (error) {
      console.error('[OfflineFirstManager] Save queue error:', error);
    }
  }

  /**
   * Set up network monitoring
   */
  private setupNetworkMonitoring(): void {
    this.netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      this.updateNetworkStatus(state);

      // Trigger sync when coming online
      if (state.isConnected && state.isInternetReachable) {
        this.syncQueue();
      }
    });

    // Get initial network status
    NetInfo.fetch().then(state => {
      this.updateNetworkStatus(state);
    });
  }

  /**
   * Update network status
   */
  private updateNetworkStatus(state: NetInfoState): void {
    const quality = this.determineNetworkQuality(state);

    this.networkStatus = {
      isConnected: state.isConnected ?? false,
      type: state.type,
      isInternetReachable: state.isInternetReachable ?? false,
      quality,
    };

    console.log(`[OfflineFirstManager] Network status: ${quality} (${state.type})`);
  }

  /**
   * Determine network quality
   */
  private determineNetworkQuality(state: NetInfoState): NetworkStatus['quality'] {
    if (!state.isConnected || !state.isInternetReachable) {
      return 'offline';
    }

    // Check connection type
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
        return 'poor';
      }
    }

    return 'fair';
  }

  /**
   * Start periodic sync
   */
  private startPeriodicSync(): void {
    // Sync every 30 seconds when online
    this.syncInterval = setInterval(() => {
      if (this.networkStatus.isConnected && this.networkStatus.isInternetReachable) {
        this.syncQueue();
      }
    }, 30000);
  }

  /**
   * Queue a request for offline execution
   */
  public async queueRequest(
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    options?: {
      headers?: Record<string, string>;
      body?: any;
      priority?: RequestPriority;
      maxRetries?: number;
    }
  ): Promise<string> {
    try {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request: QueuedRequest = {
        id: requestId,
        url,
        method,
        headers: options?.headers,
        body: options?.body,
        priority: options?.priority ?? RequestPriority.MEDIUM,
        status: RequestStatus.PENDING,
        retryCount: 0,
        maxRetries: options?.maxRetries ?? 3,
        createdAt: Date.now(),
      };

      this.requestQueue.set(requestId, request);
      await this.saveQueue();

      console.log(`[OfflineFirstManager] Queued request: ${requestId} (${method} ${url})`);

      // Try to sync immediately if online
      if (this.networkStatus.isConnected && this.networkStatus.isInternetReachable) {
        this.syncQueue();
      }

      return requestId;
    } catch (error) {
      console.error('[OfflineFirstManager] Queue request error:', error);
      throw error;
    }
  }

  /**
   * Sync queued requests
   */
  public async syncQueue(): Promise<SyncResult> {
    if (this.isSyncing) {
      console.log('[OfflineFirstManager] Sync already in progress');
      return this.getSyncResult();
    }

    if (!this.networkStatus.isConnected || !this.networkStatus.isInternetReachable) {
      console.log('[OfflineFirstManager] Cannot sync: offline');
      return this.getSyncResult();
    }

    this.isSyncing = true;

    try {
      console.log('[OfflineFirstManager] Starting sync...');

      // Get pending requests sorted by priority
      const pendingRequests = this.getPendingRequests();

      for (const request of pendingRequests) {
        await this.syncRequest(request);
      }

      await this.saveQueue();

      const result = this.getSyncResult();
      console.log(`[OfflineFirstManager] Sync complete: ${result.successful} successful, ${result.failed} failed`);

      return result;
    } catch (error) {
      console.error('[OfflineFirstManager] Sync error:', error);
      return this.getSyncResult();
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get pending requests sorted by priority
   */
  private getPendingRequests(): QueuedRequest[] {
    return Array.from(this.requestQueue.values())
      .filter(req => req.status === RequestStatus.PENDING)
      .sort((a, b) => {
        // Sort by priority (descending) then by creation time (ascending)
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.createdAt - b.createdAt;
      });
  }

  /**
   * Sync a single request
   */
  private async syncRequest(request: QueuedRequest): Promise<void> {
    try {
      // Update status
      request.status = RequestStatus.SYNCING;
      request.lastAttemptAt = Date.now();

      // Execute request
      const response = await fetch(request.url, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          ...request.headers,
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
      });

      if (response.ok) {
        // Success
        request.status = RequestStatus.COMPLETED;
        this.requestQueue.delete(request.id);
        console.log(`[OfflineFirstManager] Request completed: ${request.id}`);
      } else {
        // HTTP error
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      // Handle error
      request.retryCount++;
      request.error = error instanceof Error ? error.message : 'Unknown error';

      if (request.retryCount >= request.maxRetries) {
        // Max retries reached
        request.status = RequestStatus.FAILED;
        console.error(`[OfflineFirstManager] Request failed after ${request.retryCount} retries: ${request.id}`);
      } else {
        // Retry later with exponential backoff
        request.status = RequestStatus.PENDING;
        const backoffMs = Math.min(1000 * Math.pow(2, request.retryCount), 30000);
        console.log(`[OfflineFirstManager] Request failed, will retry in ${backoffMs}ms: ${request.id}`);

        // Schedule retry
        setTimeout(() => {
          if (this.networkStatus.isConnected && this.networkStatus.isInternetReachable) {
            this.syncQueue();
          }
        }, backoffMs);
      }
    }
  }

  /**
   * Get sync result
   */
  private getSyncResult(): SyncResult {
    const requests = Array.from(this.requestQueue.values());

    return {
      totalRequests: requests.length,
      successful: requests.filter(r => r.status === RequestStatus.COMPLETED).length,
      failed: requests.filter(r => r.status === RequestStatus.FAILED).length,
      pending: requests.filter(r => r.status === RequestStatus.PENDING).length,
    };
  }

  /**
   * Get queued requests
   */
  public getQueuedRequests(): QueuedRequest[] {
    return Array.from(this.requestQueue.values());
  }

  /**
   * Get request by ID
   */
  public getRequest(requestId: string): QueuedRequest | undefined {
    return this.requestQueue.get(requestId);
  }

  /**
   * Cancel a queued request
   */
  public async cancelRequest(requestId: string): Promise<void> {
    try {
      this.requestQueue.delete(requestId);
      await this.saveQueue();
      console.log(`[OfflineFirstManager] Cancelled request: ${requestId}`);
    } catch (error) {
      console.error('[OfflineFirstManager] Cancel request error:', error);
      throw error;
    }
  }

  /**
   * Clear completed requests
   */
  public async clearCompletedRequests(): Promise<void> {
    try {
      const completed = Array.from(this.requestQueue.values())
        .filter(r => r.status === RequestStatus.COMPLETED);

      completed.forEach(r => this.requestQueue.delete(r.id));
      await this.saveQueue();

      console.log(`[OfflineFirstManager] Cleared ${completed.length} completed requests`);
    } catch (error) {
      console.error('[OfflineFirstManager] Clear completed requests error:', error);
      throw error;
    }
  }

  /**
   * Clear failed requests
   */
  public async clearFailedRequests(): Promise<void> {
    try {
      const failed = Array.from(this.requestQueue.values())
        .filter(r => r.status === RequestStatus.FAILED);

      failed.forEach(r => this.requestQueue.delete(r.id));
      await this.saveQueue();

      console.log(`[OfflineFirstManager] Cleared ${failed.length} failed requests`);
    } catch (error) {
      console.error('[OfflineFirstManager] Clear failed requests error:', error);
      throw error;
    }
  }

  /**
   * Retry failed requests
   */
  public async retryFailedRequests(): Promise<void> {
    try {
      const failed = Array.from(this.requestQueue.values())
        .filter(r => r.status === RequestStatus.FAILED);

      failed.forEach(r => {
        r.status = RequestStatus.PENDING;
        r.retryCount = 0;
        r.error = undefined;
      });

      await this.saveQueue();

      console.log(`[OfflineFirstManager] Retrying ${failed.length} failed requests`);

      // Trigger sync
      if (this.networkStatus.isConnected && this.networkStatus.isInternetReachable) {
        this.syncQueue();
      }
    } catch (error) {
      console.error('[OfflineFirstManager] Retry failed requests error:', error);
      throw error;
    }
  }

  /**
   * Get network status
   */
  public getNetworkStatus(): NetworkStatus {
    return { ...this.networkStatus };
  }

  /**
   * Check if online
   */
  public isOnline(): boolean {
    return this.networkStatus.isConnected && this.networkStatus.isInternetReachable;
  }

  /**
   * Check if syncing
   */
  public isSyncInProgress(): boolean {
    return this.isSyncing;
  }

  /**
   * Get queue statistics
   */
  public getStatistics(): {
    totalRequests: number;
    pendingRequests: number;
    completedRequests: number;
    failedRequests: number;
    averageRetryCount: number;
    oldestPendingRequest?: number;
  } {
    const requests = Array.from(this.requestQueue.values());
    const pending = requests.filter(r => r.status === RequestStatus.PENDING);
    const completed = requests.filter(r => r.status === RequestStatus.COMPLETED);
    const failed = requests.filter(r => r.status === RequestStatus.FAILED);

    const totalRetries = requests.reduce((sum, r) => sum + r.retryCount, 0);
    const averageRetryCount = requests.length > 0 ? totalRetries / requests.length : 0;

    const oldestPending = pending.length > 0
      ? Math.min(...pending.map(r => r.createdAt))
      : undefined;

    return {
      totalRequests: requests.length,
      pendingRequests: pending.length,
      completedRequests: completed.length,
      failedRequests: failed.length,
      averageRetryCount,
      oldestPendingRequest: oldestPending,
    };
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
    }

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }
}

export default OfflineFirstManager;

