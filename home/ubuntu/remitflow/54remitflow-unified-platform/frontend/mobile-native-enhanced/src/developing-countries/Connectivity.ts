// OfflineFirstManager.ts - Offline-first architecture
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { Platform } from 'react-native';

interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
  timestamp: number;
  retries: number;
  priority: 'high' | 'medium' | 'low';
}

interface SyncStatus {
  lastSync: number;
  pendingRequests: number;
  failedRequests: number;
  syncInProgress: boolean;
}

export class OfflineFirstManager {
  private static instance: OfflineFirstManager;
  private requestQueue: QueuedRequest[] = [];
  private syncInProgress: boolean = false;
  private connectionType: string = 'unknown';
  private isConnected: boolean = false;
  private listeners: ((status: SyncStatus) => void)[] = [];

  private constructor() {
    this.initialize();
  }

  static getInstance(): OfflineFirstManager {
    if (!OfflineFirstManager.instance) {
      OfflineFirstManager.instance = new OfflineFirstManager();
    }
    return OfflineFirstManager.instance;
  }

  private async initialize(): Promise<void> {
    // Load queued requests from storage
    await this.loadQueue();
    
    // Monitor network connectivity
    NetInfo.addEventListener((state: NetInfoState) => {
      this.handleConnectivityChange(state);
    });
    
    // Start periodic sync attempts
    this.startPeriodicSync();
  }

  private async handleConnectivityChange(state: NetInfoState): Promise<void> {
    const wasConnected = this.isConnected;
    this.isConnected = state.isConnected ?? false;
    this.connectionType = state.type;
    
    console.log(`[OfflineFirst] Connectivity changed: ${this.connectionType}, connected: ${this.isConnected}`);
    
    // If we just came online, attempt to sync
    if (this.isConnected && !wasConnected) {
      console.log('[OfflineFirst] Connection restored, starting sync...');
      await this.syncQueue();
    }
    
    this.notifyListeners();
  }

  async queueRequest(
    url: string,
    method: string = 'GET',
    body?: any,
    headers?: Record<string, string>,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<string> {
    const request: QueuedRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      url,
      method,
      body,
      headers,
      timestamp: Date.now(),
      retries: 0,
      priority
    };
    
    this.requestQueue.push(request);
    await this.saveQueue();
    
    console.log(`[OfflineFirst] Queued ${method} request to ${url} (priority: ${priority})`);
    
    // If online, attempt immediate sync
    if (this.isConnected) {
      await this.syncQueue();
    }
    
    this.notifyListeners();
    return request.id;
  }

  private async syncQueue(): Promise<void> {
    if (this.syncInProgress || !this.isConnected || this.requestQueue.length === 0) {
      return;
    }
    
    this.syncInProgress = true;
    this.notifyListeners();
    
    console.log(`[OfflineFirst] Syncing ${this.requestQueue.length} queued requests...`);
    
    // Sort by priority (high > medium > low) and timestamp
    const sortedQueue = [...this.requestQueue].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return a.timestamp - b.timestamp;
    });
    
    const failedRequests: QueuedRequest[] = [];
    
    for (const request of sortedQueue) {
      try {
        await this.executeRequest(request);
        // Remove from queue on success
        this.requestQueue = this.requestQueue.filter(r => r.id !== request.id);
        console.log(`[OfflineFirst] Successfully synced request ${request.id}`);
      } catch (error) {
        console.error(`[OfflineFirst] Failed to sync request ${request.id}:`, error);
        request.retries++;
        
        // Retry logic: max 5 retries
        if (request.retries >= 5) {
          console.log(`[OfflineFirst] Request ${request.id} exceeded max retries, removing`);
          this.requestQueue = this.requestQueue.filter(r => r.id !== request.id);
          failedRequests.push(request);
        }
      }
    }
    
    await this.saveQueue();
    
    // Store failed requests for later review
    if (failedRequests.length > 0) {
      await this.saveFailedRequests(failedRequests);
    }
    
    this.syncInProgress = false;
    this.notifyListeners();
    
    console.log(`[OfflineFirst] Sync complete. Remaining: ${this.requestQueue.length}`);
  }

  private async executeRequest(request: QueuedRequest): Promise<any> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        ...request.headers
      },
      body: request.body ? JSON.stringify(request.body) : undefined
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  }

  private async loadQueue(): Promise<void> {
    try {
      const queueData = await AsyncStorage.getItem('offline_request_queue');
      if (queueData) {
        this.requestQueue = JSON.parse(queueData);
        console.log(`[OfflineFirst] Loaded ${this.requestQueue.length} queued requests`);
      }
    } catch (error) {
      console.error('[OfflineFirst] Failed to load queue:', error);
    }
  }

  private async saveQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem('offline_request_queue', JSON.stringify(this.requestQueue));
    } catch (error) {
      console.error('[OfflineFirst] Failed to save queue:', error);
    }
  }

  private async saveFailedRequests(requests: QueuedRequest[]): Promise<void> {
    try {
      const existing = await AsyncStorage.getItem('failed_requests');
      const failed = existing ? JSON.parse(existing) : [];
      failed.push(...requests);
      await AsyncStorage.setItem('failed_requests', JSON.stringify(failed));
    } catch (error) {
      console.error('[OfflineFirst] Failed to save failed requests:', error);
    }
  }

  private startPeriodicSync(): void {
    // Attempt sync every 30 seconds
    setInterval(async () => {
      if (this.isConnected && this.requestQueue.length > 0 && !this.syncInProgress) {
        await this.syncQueue();
      }
    }, 30000);
  }

  onStatusChange(callback: (status: SyncStatus) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(): void {
    const status: SyncStatus = {
      lastSync: Date.now(),
      pendingRequests: this.requestQueue.length,
      failedRequests: 0,
      syncInProgress: this.syncInProgress
    };
    
    this.listeners.forEach(listener => listener(status));
  }

  getStatus(): SyncStatus {
    return {
      lastSync: Date.now(),
      pendingRequests: this.requestQueue.length,
      failedRequests: 0,
      syncInProgress: this.syncInProgress
    };
  }

  isOnline(): boolean {
    return this.isConnected;
  }

  getConnectionType(): string {
    return this.connectionType;
  }

  async clearQueue(): Promise<void> {
    this.requestQueue = [];
    await this.saveQueue();
    this.notifyListeners();
  }
}
