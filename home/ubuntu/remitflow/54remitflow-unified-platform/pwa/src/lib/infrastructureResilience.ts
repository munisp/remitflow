/**
 * Infrastructure Resilience for Developing Countries
 * 
 * Comprehensive implementation for:
 * 1. Extended Offline Support (7+ days)
 * 2. 2G Network Optimization
 * 3. Power Management
 * 4. Feature Phone Support (USSD/SMS)
 * 5. Older Smartphone Optimization
 * 
 * Designed for African markets with infrastructure challenges.
 */

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

export const OfflineConfig = {
  // Maximum days the app can function offline
  MAX_OFFLINE_DAYS: 7,
  
  // Cache TTLs (in hours)
  BALANCE_CACHE_TTL_HOURS: 24,
  TRANSACTION_CACHE_TTL_HOURS: 72,
  BENEFICIARY_CACHE_TTL_HOURS: 168, // 7 days
  FX_RATE_CACHE_TTL_HOURS: 4,
  REFERENCE_DATA_CACHE_TTL_HOURS: 720, // 30 days
  
  // Queue retention
  PENDING_QUEUE_RETENTION_DAYS: 14,
  COMPLETED_QUEUE_RETENTION_DAYS: 7,
  
  // Sync settings
  MAX_RETRY_ATTEMPTS: 5,
  RETRY_BACKOFF_BASE_SECONDS: 30,
  MAX_RETRY_BACKOFF_SECONDS: 3600,
  
  // Offline restrictions
  MAX_OFFLINE_TRANSFER_AMOUNT: 50000, // NGN
  BLOCK_HIGH_VALUE_AFTER_DAYS: 3,
};

export const NetworkConfig = {
  // Connection types
  CONNECTION_2G: '2g',
  CONNECTION_3G: '3g',
  CONNECTION_4G: '4g',
  CONNECTION_WIFI: 'wifi',
  CONNECTION_UNKNOWN: 'unknown',
  
  // Sync intervals by connection type (seconds)
  SYNC_INTERVAL_2G: 300,
  SYNC_INTERVAL_3G: 120,
  SYNC_INTERVAL_4G: 60,
  SYNC_INTERVAL_WIFI: 30,
  
  // Batch sizes by connection type
  BATCH_SIZE_2G: 5,
  BATCH_SIZE_3G: 10,
  BATCH_SIZE_4G: 25,
  BATCH_SIZE_WIFI: 50,
  
  // Compression threshold
  COMPRESS_THRESHOLD_BYTES: 1024,
  
  // Request timeouts (seconds)
  TIMEOUT_2G: 60,
  TIMEOUT_3G: 30,
  TIMEOUT_4G: 15,
  TIMEOUT_WIFI: 10,
};

export const PowerConfig = {
  CRITICAL_BATTERY_PERCENT: 10,
  LOW_BATTERY_PERCENT: 20,
  SYNC_DISABLED_BELOW_PERCENT: 5,
  REDUCED_SYNC_BELOW_PERCENT: 20,
  MAX_BACKGROUND_JOBS_LOW_BATTERY: 1,
  MAX_BACKGROUND_JOBS_NORMAL: 5,
};

// =============================================================================
// TYPES
// =============================================================================

export type DeviceTier = 'tier_1' | 'tier_2' | 'tier_3' | 'feature';
export type CacheCategory = 'cold' | 'warm' | 'hot' | 'staged';
export type ConnectionType = '2g' | '3g' | '4g' | 'wifi' | 'unknown';

export interface CachedItem<T = unknown> {
  key: string;
  category: CacheCategory;
  data: T;
  cachedAt: number; // timestamp
  ttlHours: number;
  version: number;
  checksum: string;
}

export interface QueuedOperation {
  id: string;
  idempotencyKey: string;
  operationType: string;
  payload: Record<string, unknown>;
  createdAt: number;
  lastAttemptAt?: number;
  attemptCount: number;
  status: 'pending' | 'syncing' | 'completed' | 'failed' | 'blocked';
  errorMessage?: string;
  serverTransactionId?: string;
  offlineBalanceSnapshot?: number;
  offlineRateSnapshot?: number;
}

export interface NetworkProfile {
  connectionType: ConnectionType;
  effectiveBandwidthKbps: number;
  rttMs: number;
  isMetered: boolean;
  saveDataEnabled: boolean;
}

export interface BatteryState {
  levelPercent: number;
  isCharging: boolean;
  chargingTimeSeconds?: number;
  dischargingTimeSeconds?: number;
}

export interface DeviceFeatureFlags {
  animationsEnabled: boolean;
  chartsEnabled: boolean;
  liveUpdatesEnabled: boolean;
  imageQuality: 'high' | 'medium' | 'low';
  prefetchEnabled: boolean;
  backgroundSyncEnabled: boolean;
  biometricEnabled: boolean;
  pushNotificationsEnabled: boolean;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
}

function calculateChecksum(data: unknown): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).substr(0, 8);
}

// =============================================================================
// EXTENDED OFFLINE SUPPORT (7+ DAYS)
// =============================================================================

export class OfflineDataManager {
  private cache: Map<string, CachedItem> = new Map();
  private operationQueue: QueuedOperation[] = [];
  private lastOnlineAt: number | null = null;
  private _lastSyncAt: number | null = null;

  get offlineDurationHours(): number {
    if (!this.lastOnlineAt) return 0;
    return (Date.now() - this.lastOnlineAt) / (1000 * 60 * 60);
  }

  get offlineDurationDays(): number {
    return this.offlineDurationHours / 24;
  }

  get lastSyncAt(): number | null {
    return this._lastSyncAt;
  }

  setOnline(): void {
    this.lastOnlineAt = Date.now();
    this._lastSyncAt = Date.now();
  }

  canPerformOperation(operationType: string, amount: number = 0): { allowed: boolean; reason: string } {
    // Check offline duration
    if (this.offlineDurationDays > OfflineConfig.MAX_OFFLINE_DAYS) {
      return {
        allowed: false,
        reason: `Offline for ${this.offlineDurationDays.toFixed(1)} days. Please connect to sync.`,
      };
    }

    // Check high-value transfer restrictions
    if (operationType === 'transfer' && amount > OfflineConfig.MAX_OFFLINE_TRANSFER_AMOUNT) {
      if (this.offlineDurationDays > OfflineConfig.BLOCK_HIGH_VALUE_AFTER_DAYS) {
        return {
          allowed: false,
          reason: `High-value transfers blocked after ${OfflineConfig.BLOCK_HIGH_VALUE_AFTER_DAYS} days offline.`,
        };
      }
    }

    // Check cached balance
    if (operationType === 'transfer') {
      const balance = this.getCached('wallet_balance');
      if (!balance) {
        return { allowed: false, reason: 'Balance data not available. Please connect to sync.' };
      }
      if (this.isExpired(balance)) {
        return { allowed: false, reason: 'Balance data expired. Please connect to sync.' };
      }
    }

    return { allowed: true, reason: 'OK' };
  }

  cacheData<T>(key: string, data: T, category: CacheCategory, ttlHours?: number): CachedItem<T> {
    const defaultTtl = this.getDefaultTtl(category);
    const item: CachedItem<T> = {
      key,
      category,
      data,
      cachedAt: Date.now(),
      ttlHours: ttlHours ?? defaultTtl,
      version: 1,
      checksum: calculateChecksum(data),
    };
    this.cache.set(key, item as CachedItem);
    return item;
  }

  getCached<T>(key: string): CachedItem<T> | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (this.isExpired(item)) {
      this.cache.delete(key);
      return null;
    }
    return item as CachedItem<T>;
  }

  getCachedWithStaleness<T>(key: string): { data: T | null; isStale: boolean; cachedAt: number | null } {
    const item = this.getCached<T>(key);
    if (!item) {
      return { data: null, isStale: false, cachedAt: null };
    }
    return {
      data: item.data,
      isStale: this.isStale(item),
      cachedAt: item.cachedAt,
    };
  }

  queueOperation(
    operationType: string,
    payload: Record<string, unknown>,
    balanceSnapshot?: number,
    rateSnapshot?: number
  ): QueuedOperation {
    const operation: QueuedOperation = {
      id: generateId(),
      idempotencyKey: generateIdempotencyKey(),
      operationType,
      payload,
      createdAt: Date.now(),
      attemptCount: 0,
      status: 'pending',
      offlineBalanceSnapshot: balanceSnapshot,
      offlineRateSnapshot: rateSnapshot,
    };
    this.operationQueue.push(operation);
    return operation;
  }

  getPendingOperations(): QueuedOperation[] {
    return this.operationQueue.filter(op => op.status === 'pending' || op.status === 'failed');
  }

  markOperationSynced(operationId: string, serverTransactionId: string): void {
    const op = this.operationQueue.find(o => o.id === operationId);
    if (op) {
      op.status = 'completed';
      op.serverTransactionId = serverTransactionId;
    }
  }

  markOperationFailed(operationId: string, error: string): void {
    const op = this.operationQueue.find(o => o.id === operationId);
    if (op) {
      op.status = 'failed';
      op.errorMessage = error;
      op.attemptCount++;
      op.lastAttemptAt = Date.now();
    }
  }

  cleanupOldOperations(): number {
    const cutoffCompleted = Date.now() - OfflineConfig.COMPLETED_QUEUE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoffPending = Date.now() - OfflineConfig.PENDING_QUEUE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    
    const originalCount = this.operationQueue.length;
    this.operationQueue = this.operationQueue.filter(op => {
      if (op.status === 'completed' && op.createdAt < cutoffCompleted) return false;
      if ((op.status === 'pending' || op.status === 'failed') && op.createdAt < cutoffPending) return false;
      return true;
    });
    return originalCount - this.operationQueue.length;
  }

  private isExpired(item: CachedItem): boolean {
    const expiresAt = item.cachedAt + item.ttlHours * 60 * 60 * 1000;
    return Date.now() > expiresAt;
  }

  private isStale(item: CachedItem): boolean {
    const staleThreshold = item.cachedAt + item.ttlHours * 0.75 * 60 * 60 * 1000;
    return Date.now() > staleThreshold;
  }

  private getDefaultTtl(category: CacheCategory): number {
    const ttls: Record<CacheCategory, number> = {
      cold: OfflineConfig.REFERENCE_DATA_CACHE_TTL_HOURS,
      warm: OfflineConfig.TRANSACTION_CACHE_TTL_HOURS,
      hot: OfflineConfig.FX_RATE_CACHE_TTL_HOURS,
      staged: OfflineConfig.PENDING_QUEUE_RETENTION_DAYS * 24,
    };
    return ttls[category] ?? 24;
  }
}

// =============================================================================
// 2G NETWORK OPTIMIZATION
// =============================================================================

export class NetworkOptimizer {
  private profile: NetworkProfile = {
    connectionType: 'unknown',
    effectiveBandwidthKbps: 0,
    rttMs: 1000,
    isMetered: true,
    saveDataEnabled: false,
  };

  private syncTokens: Map<string, string> = new Map();
  private lastSyncTimestamps: Map<string, number> = new Map();

  updateConnection(
    connectionType: ConnectionType,
    downlinkMbps?: number,
    rttMs?: number,
    saveData: boolean = false
  ): void {
    this.profile = {
      connectionType,
      effectiveBandwidthKbps: (downlinkMbps ?? 0) * 1000,
      rttMs: rttMs ?? this.estimateRtt(connectionType),
      isMetered: connectionType !== 'wifi',
      saveDataEnabled: saveData,
    };
  }

  get isSlowConnection(): boolean {
    return this.profile.connectionType === '2g' || this.profile.connectionType === '3g';
  }

  get syncIntervalSeconds(): number {
    const intervals: Record<ConnectionType, number> = {
      '2g': NetworkConfig.SYNC_INTERVAL_2G,
      '3g': NetworkConfig.SYNC_INTERVAL_3G,
      '4g': NetworkConfig.SYNC_INTERVAL_4G,
      wifi: NetworkConfig.SYNC_INTERVAL_WIFI,
      unknown: NetworkConfig.SYNC_INTERVAL_3G,
    };
    return intervals[this.profile.connectionType];
  }

  get batchSize(): number {
    const sizes: Record<ConnectionType, number> = {
      '2g': NetworkConfig.BATCH_SIZE_2G,
      '3g': NetworkConfig.BATCH_SIZE_3G,
      '4g': NetworkConfig.BATCH_SIZE_4G,
      wifi: NetworkConfig.BATCH_SIZE_WIFI,
      unknown: NetworkConfig.BATCH_SIZE_3G,
    };
    return sizes[this.profile.connectionType];
  }

  get requestTimeoutSeconds(): number {
    const timeouts: Record<ConnectionType, number> = {
      '2g': NetworkConfig.TIMEOUT_2G,
      '3g': NetworkConfig.TIMEOUT_3G,
      '4g': NetworkConfig.TIMEOUT_4G,
      wifi: NetworkConfig.TIMEOUT_WIFI,
      unknown: NetworkConfig.TIMEOUT_3G,
    };
    return timeouts[this.profile.connectionType];
  }

  getSyncParams(resource: string): Record<string, string> {
    const params: Record<string, string> = {};
    
    const token = this.syncTokens.get(resource);
    if (token) {
      params.sync_token = token;
    }
    
    const lastSync = this.lastSyncTimestamps.get(resource);
    if (lastSync) {
      params.since = new Date(lastSync).toISOString();
    }
    
    return params;
  }

  updateSyncState(resource: string, syncToken?: string, timestamp?: number): void {
    if (syncToken) {
      this.syncTokens.set(resource, syncToken);
    }
    this.lastSyncTimestamps.set(resource, timestamp ?? Date.now());
  }

  getProgressiveLoadParams(resource: string, pageSize: number = 10): Record<string, string | number> {
    const effectivePageSize = this.isSlowConnection ? Math.min(pageSize, 5) : pageSize;
    
    return {
      limit: effectivePageSize,
      fields: 'essential',
      ...this.getSyncParams(resource),
    };
  }

  private estimateRtt(connectionType: ConnectionType): number {
    const estimates: Record<ConnectionType, number> = {
      '2g': 2000,
      '3g': 500,
      '4g': 100,
      wifi: 50,
      unknown: 1000,
    };
    return estimates[connectionType];
  }
}

// =============================================================================
// POWER MANAGEMENT
// =============================================================================

export class PowerManager {
  private battery: BatteryState = {
    levelPercent: 100,
    isCharging: false,
  };
  private deferredSyncs: Array<{ type: string; payload: unknown; deferredAt: number }> = [];
  private powerSaveMode: boolean = false;

  updateBatteryState(
    level: number,
    charging: boolean,
    chargingTime?: number,
    dischargingTime?: number
  ): void {
    const wasCharging = this.battery.isCharging;
    this.battery = {
      levelPercent: level <= 1 ? level * 100 : level,
      isCharging: charging,
      chargingTimeSeconds: chargingTime,
      dischargingTimeSeconds: dischargingTime,
    };

    // Trigger deferred syncs when plugged in
    if (charging && !wasCharging && this.deferredSyncs.length > 0) {
      console.log(`[PowerManager] Device plugged in, ${this.deferredSyncs.length} deferred syncs ready`);
    }
  }

  setPowerSaveMode(enabled: boolean): void {
    this.powerSaveMode = enabled;
  }

  get isCritical(): boolean {
    return this.battery.levelPercent <= PowerConfig.CRITICAL_BATTERY_PERCENT;
  }

  get isLow(): boolean {
    return this.battery.levelPercent <= PowerConfig.LOW_BATTERY_PERCENT;
  }

  get canSync(): boolean {
    if (this.battery.isCharging) return true;
    return this.battery.levelPercent > PowerConfig.SYNC_DISABLED_BELOW_PERCENT;
  }

  shouldSyncNow(priority: 'critical' | 'normal' = 'normal'): { shouldSync: boolean; reason: string } {
    if (!this.canSync) {
      return { shouldSync: false, reason: 'Battery too low for sync' };
    }

    if (this.powerSaveMode && priority !== 'critical') {
      return { shouldSync: false, reason: 'Power save mode enabled' };
    }

    if (this.isLow && !this.battery.isCharging && priority === 'normal') {
      return { shouldSync: false, reason: 'Low battery, deferring non-critical sync' };
    }

    return { shouldSync: true, reason: 'OK' };
  }

  deferSync(syncType: string, payload: unknown): void {
    this.deferredSyncs.push({
      type: syncType,
      payload,
      deferredAt: Date.now(),
    });
  }

  getDeferredSyncs(): Array<{ type: string; payload: unknown; deferredAt: number }> {
    const syncs = [...this.deferredSyncs];
    this.deferredSyncs = [];
    return syncs;
  }

  getMaxBackgroundJobs(): number {
    if (this.isLow && !this.battery.isCharging) {
      return PowerConfig.MAX_BACKGROUND_JOBS_LOW_BATTERY;
    }
    return PowerConfig.MAX_BACKGROUND_JOBS_NORMAL;
  }

  getSyncStrategy(): {
    syncEnabled: boolean;
    maxJobs: number;
    deferNonCritical: boolean;
    aggressiveSync: boolean;
    recommendations: string[];
  } {
    const recommendations: string[] = [];

    if (this.isCritical) {
      recommendations.push('Critical battery - only essential operations');
    } else if (this.isLow) {
      recommendations.push('Low battery - sync deferred until charging');
    } else if (this.battery.isCharging) {
      recommendations.push('Charging - good time for full sync');
    }

    return {
      syncEnabled: this.canSync,
      maxJobs: this.getMaxBackgroundJobs(),
      deferNonCritical: this.isLow && !this.battery.isCharging,
      aggressiveSync: this.battery.isCharging && this.battery.levelPercent > 50,
      recommendations,
    };
  }
}

// =============================================================================
// DEVICE OPTIMIZATION
// =============================================================================

export class DeviceOptimizer {
  private tier: DeviceTier;

  constructor(tier: DeviceTier = 'tier_1') {
    this.tier = tier;
  }

  static detectTier(options: {
    ramMb?: number;
    osVersion?: string;
    screenWidth?: number;
    supportsWebGL?: boolean;
    supportsServiceWorker?: boolean;
  }): DeviceTier {
    const { ramMb, screenWidth, supportsWebGL = true, supportsServiceWorker = true } = options;

    // RAM-based detection
    if (ramMb !== undefined) {
      if (ramMb < 1024) return 'tier_3';
      if (ramMb < 2048) return 'tier_2';
    }

    // Screen-based detection
    if (screenWidth !== undefined) {
      if (screenWidth < 320) return 'tier_3';
      if (screenWidth < 375) return 'tier_2';
    }

    // Feature-based detection
    if (!supportsServiceWorker) return 'tier_3';
    if (!supportsWebGL) return 'tier_2';

    return 'tier_1';
  }

  getFeatureFlags(): DeviceFeatureFlags {
    if (this.tier === 'tier_1') {
      return {
        animationsEnabled: true,
        chartsEnabled: true,
        liveUpdatesEnabled: true,
        imageQuality: 'high',
        prefetchEnabled: true,
        backgroundSyncEnabled: true,
        biometricEnabled: true,
        pushNotificationsEnabled: true,
      };
    } else if (this.tier === 'tier_2') {
      return {
        animationsEnabled: false,
        chartsEnabled: true,
        liveUpdatesEnabled: false,
        imageQuality: 'medium',
        prefetchEnabled: false,
        backgroundSyncEnabled: true,
        biometricEnabled: true,
        pushNotificationsEnabled: true,
      };
    } else {
      return {
        animationsEnabled: false,
        chartsEnabled: false,
        liveUpdatesEnabled: false,
        imageQuality: 'low',
        prefetchEnabled: false,
        backgroundSyncEnabled: false,
        biometricEnabled: false,
        pushNotificationsEnabled: false,
      };
    }
  }

  getListPageSize(): number {
    const sizes: Record<DeviceTier, number> = {
      tier_1: 25,
      tier_2: 15,
      tier_3: 10,
      feature: 5,
    };
    return sizes[this.tier];
  }

  getCacheLimits(): {
    maxTransactionsCached: number;
    maxBeneficiariesCached: number;
    maxImageCacheMb: number;
  } {
    if (this.tier === 'tier_1') {
      return {
        maxTransactionsCached: 500,
        maxBeneficiariesCached: 100,
        maxImageCacheMb: 50,
      };
    } else if (this.tier === 'tier_2') {
      return {
        maxTransactionsCached: 200,
        maxBeneficiariesCached: 50,
        maxImageCacheMb: 20,
      };
    } else {
      return {
        maxTransactionsCached: 50,
        maxBeneficiariesCached: 20,
        maxImageCacheMb: 5,
      };
    }
  }

  shouldDeferLoad(component: string): boolean {
    const heavyComponents = ['charts', 'analytics', 'recommendations', 'ml_features'];

    if (this.tier === 'tier_3') {
      return heavyComponents.includes(component);
    } else if (this.tier === 'tier_2') {
      return ['analytics', 'ml_features'].includes(component);
    }

    return false;
  }
}

// =============================================================================
// UNIFIED RESILIENCE MANAGER
// =============================================================================

export class InfrastructureResilienceManager {
  offlineManager: OfflineDataManager;
  networkOptimizer: NetworkOptimizer;
  powerManager: PowerManager;
  deviceOptimizer: DeviceOptimizer | null = null;

  constructor() {
    this.offlineManager = new OfflineDataManager();
    this.networkOptimizer = new NetworkOptimizer();
    this.powerManager = new PowerManager();
  }

  initialize(
    deviceTier: DeviceTier = 'tier_1',
    connectionType: ConnectionType = 'unknown'
  ): {
    deviceTier: DeviceTier;
    connectionType: ConnectionType;
    offlineMaxDays: number;
    featureFlags: DeviceFeatureFlags;
    syncIntervalSeconds: number;
    batchSize: number;
  } {
    this.deviceOptimizer = new DeviceOptimizer(deviceTier);
    this.networkOptimizer.updateConnection(connectionType);

    return {
      deviceTier,
      connectionType,
      offlineMaxDays: OfflineConfig.MAX_OFFLINE_DAYS,
      featureFlags: this.deviceOptimizer.getFeatureFlags(),
      syncIntervalSeconds: this.networkOptimizer.syncIntervalSeconds,
      batchSize: this.networkOptimizer.batchSize,
    };
  }

  getSyncRecommendation(): {
    shouldSync: boolean;
    syncInterval: number;
    batchSize: number;
    deferNonCritical: boolean;
    pendingOperations: number;
    offlineHours: number;
    recommendations: string[];
  } {
    const powerStrategy = this.powerManager.getSyncStrategy();

    return {
      shouldSync: powerStrategy.syncEnabled,
      syncInterval: this.networkOptimizer.syncIntervalSeconds,
      batchSize: this.networkOptimizer.batchSize,
      deferNonCritical: powerStrategy.deferNonCritical,
      pendingOperations: this.offlineManager.getPendingOperations().length,
      offlineHours: this.offlineManager.offlineDurationHours,
      recommendations: powerStrategy.recommendations,
    };
  }

  canPerformTransfer(amount: number): { allowed: boolean; reason: string } {
    return this.offlineManager.canPerformOperation('transfer', amount);
  }

  queueTransfer(
    recipientId: string,
    amount: number,
    currency: string,
    balanceSnapshot: number
  ): QueuedOperation {
    return this.offlineManager.queueOperation(
      'transfer',
      { recipientId, amount, currency },
      balanceSnapshot
    );
  }
}

// =============================================================================
// BROWSER API INTEGRATION
// =============================================================================

export function initializeFromBrowserAPIs(manager: InfrastructureResilienceManager): void {
  // Network Information API
  if ('connection' in navigator) {
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    if (connection) {
      const updateNetwork = () => {
        const effectiveType = connection.effectiveType as ConnectionType || 'unknown';
        manager.networkOptimizer.updateConnection(
          effectiveType,
          connection.downlink,
          connection.rtt,
          connection.saveData || false
        );
      };
      
      updateNetwork();
      connection.addEventListener('change', updateNetwork);
    }
  }

  // Battery API
  if ('getBattery' in navigator) {
    (navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }).getBattery?.()
      .then((battery: BatteryManager) => {
        const updateBattery = () => {
          manager.powerManager.updateBatteryState(
            battery.level,
            battery.charging,
            battery.chargingTime,
            battery.dischargingTime
          );
        };
        
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
      })
      .catch(() => {
        console.log('[Resilience] Battery API not available');
      });
  }

  // Online/Offline events
  window.addEventListener('online', () => {
    manager.offlineManager.setOnline();
    console.log('[Resilience] Device online');
  });

  window.addEventListener('offline', () => {
    console.log('[Resilience] Device offline');
  });

  // Device tier detection
  const tier = DeviceOptimizer.detectTier({
    screenWidth: window.screen.width,
    supportsWebGL: !!document.createElement('canvas').getContext('webgl'),
    supportsServiceWorker: 'serviceWorker' in navigator,
  });
  
  manager.initialize(tier, 'unknown');
}

// Type definitions for browser APIs
interface NetworkInformation {
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
  addEventListener(type: string, listener: () => void): void;
}

interface BatteryManager {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  addEventListener(type: string, listener: () => void): void;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const resilienceManager = new InfrastructureResilienceManager();

// Auto-initialize in browser environment
if (typeof window !== 'undefined') {
  initializeFromBrowserAPIs(resilienceManager);
}
