// DevelopingCountriesManager.ts - Integration manager for all DC features
import { OfflineFirstManager } from './Connectivity';
import { DataCompressionManager } from './DataCompression';
import { AdaptiveLoadingManager } from './AdaptiveLoading';
import { PowerOptimizationManager } from './PowerOptimization';
import { ProgressiveDataLoader } from './ProgressiveData';
import { SMSFallbackManager } from './SMSFallbackManager';
import { USSDManager } from './USSDManager';
import { LiteModeManager } from './LiteModeManager';
import { DataUsageTracker } from './DataUsageTracker';
import { SmartCachingManager } from './SmartCachingManager';

export class DevelopingCountriesManager {
  private static instance: DevelopingCountriesManager;
  
  private offlineFirst: OfflineFirstManager;
  private compression: DataCompressionManager;
  private adaptiveLoading: AdaptiveLoadingManager;
  private powerOptimization: PowerOptimizationManager;
  private progressiveData: ProgressiveDataLoader;
  private smsFallback: SMSFallbackManager;
  private ussd: USSDManager;
  private liteMode: LiteModeManager;
  private dataUsage: DataUsageTracker;
  private smartCache: SmartCachingManager;

  private constructor() {
    this.offlineFirst = OfflineFirstManager.getInstance();
    this.compression = DataCompressionManager.getInstance();
    this.adaptiveLoading = AdaptiveLoadingManager.getInstance();
    this.powerOptimization = PowerOptimizationManager.getInstance();
    this.progressiveData = ProgressiveDataLoader.getInstance();
    this.smsFallback = SMSFallbackManager.getInstance();
    this.ussd = USSDManager.getInstance();
    this.liteMode = LiteModeManager.getInstance();
    this.dataUsage = DataUsageTracker.getInstance();
    this.smartCache = SmartCachingManager.getInstance();
  }

  static getInstance(): DevelopingCountriesManager {
    if (!DevelopingCountriesManager.instance) {
      DevelopingCountriesManager.instance = new DevelopingCountriesManager();
    }
    return DevelopingCountriesManager.instance;
  }

  async initialize(): Promise<void> {
    console.log('[DC Manager] Initializing developing countries features...');
    
    // Initialize all managers
    await Promise.all([
      this.liteMode.getConfig(),
      this.dataUsage.getCurrentUsage(),
      this.smartCache.getStats()
    ]);
    
    console.log('[DC Manager] All features initialized');
  }

  // Unified API request with all optimizations
  async makeRequest(url: string, options: RequestInit = {}): Promise<any> {
    // Check if online
    if (!this.offlineFirst.isOnline()) {
      console.log('[DC Manager] Offline - queuing request');
      await this.offlineFirst.queueRequest(url, options.method || 'GET', options.body);
      throw new Error('Offline - request queued');
    }
    
    // Check data usage limit
    if (this.dataUsage.isLimitExceeded()) {
      console.warn('[DC Manager] Data limit exceeded');
      throw new Error('Daily data limit exceeded');
    }
    
    // Check cache first
    const cached = await this.smartCache.get(url);
    if (cached) {
      console.log('[DC Manager] Returning cached response');
      return cached;
    }
    
    // Compress request body if present
    if (options.body) {
      const { compressed } = await this.compression.compressData(options.body);
      options.body = compressed;
      options.headers = {
        ...options.headers,
        'Content-Encoding': 'gzip'
      };
    }
    
    // Make request with adaptive timeout
    const timeout = this.adaptiveLoading.getRequestTimeout();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const data = await response.json();
      
      // Track data usage
      const bytesReceived = JSON.stringify(data).length;
      await this.dataUsage.trackRequest(url, bytesReceived);
      
      // Cache response
      await this.smartCache.set(url, data, 3600000, 'medium');
      
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Queue for later if network error
      if (error instanceof Error && error.name === 'AbortError') {
        await this.offlineFirst.queueRequest(url, options.method || 'GET', options.body);
      }
      
      throw error;
    }
  }

  // Get comprehensive status
  getStatus() {
    return {
      online: this.offlineFirst.isOnline(),
      connectionType: this.adaptiveLoading.getConnectionQuality(),
      dataUsage: this.dataUsage.getCurrentUsage(),
      dataLimit: this.dataUsage.getLimits(),
      cacheStats: this.smartCache.getStats(),
      liteMode: this.liteMode.isEnabled(),
      powerSaving: this.powerOptimization.isPowerSavingEnabled(),
      batteryLevel: this.powerOptimization.getBatteryLevel(),
      pendingRequests: this.offlineFirst.getStatus().pendingRequests
    };
  }

  // Managers getters
  getOfflineManager() { return this.offlineFirst; }
  getCompressionManager() { return this.compression; }
  getAdaptiveLoadingManager() { return this.adaptiveLoading; }
  getPowerOptimizationManager() { return this.powerOptimization; }
  getProgressiveDataLoader() { return this.progressiveData; }
  getSMSFallbackManager() { return this.smsFallback; }
  getUSSDManager() { return this.ussd; }
  getLiteModeManager() { return this.liteMode; }
  getDataUsageTracker() { return this.dataUsage; }
  getSmartCachingManager() { return this.smartCache; }
}
