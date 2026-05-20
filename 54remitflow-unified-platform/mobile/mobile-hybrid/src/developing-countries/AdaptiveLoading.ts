// AdaptiveLoadingManager.ts - Adapt to connection speed
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ConnectionQuality = '2G' | '3G' | '4G' | '5G' | 'wifi' | 'unknown';
type LoadingStrategy = 'minimal' | 'standard' | 'full';

interface AdaptiveConfig {
  imageQuality: 'low' | 'medium' | 'high';
  enableAnimations: boolean;
  prefetchData: boolean;
  maxConcurrentRequests: number;
  requestTimeout: number;
  enableVideoAutoplay: boolean;
  loadingStrategy: LoadingStrategy;
}

export class AdaptiveLoadingManager {
  private static instance: AdaptiveLoadingManager;
  private connectionQuality: ConnectionQuality = 'unknown';
  private config: AdaptiveConfig;
  private listeners: ((config: AdaptiveConfig) => void)[] = [];

  private constructor() {
    this.config = this.getDefaultConfig();
    this.initialize();
  }

  static getInstance(): AdaptiveLoadingManager {
    if (!AdaptiveLoadingManager.instance) {
      AdaptiveLoadingManager.instance = new AdaptiveLoadingManager();
    }
    return AdaptiveLoadingManager.instance;
  }

  private async initialize(): Promise<void> {
    // Load saved preferences
    const saved = await AsyncStorage.getItem('adaptive_loading_config');
    if (saved) {
      this.config = JSON.parse(saved);
    }
    
    // Monitor network quality
    NetInfo.addEventListener((state: NetInfoState) => {
      this.handleNetworkChange(state);
    });
  }

  private handleNetworkChange(state: NetInfoState): void {
    const effectiveType = state.details?.cellularGeneration || state.type;
    
    // Map to connection quality
    if (state.type === 'wifi') {
      this.connectionQuality = 'wifi';
    } else if (effectiveType === '2g') {
      this.connectionQuality = '2G';
    } else if (effectiveType === '3g') {
      this.connectionQuality = '3G';
    } else if (effectiveType === '4g') {
      this.connectionQuality = '4G';
    } else if (effectiveType === '5g') {
      this.connectionQuality = '5G';
    } else {
      this.connectionQuality = 'unknown';
    }
    
    console.log(`[AdaptiveLoading] Connection quality: ${this.connectionQuality}`);
    
    // Update config based on connection
    this.updateConfigForConnection();
  }

  private updateConfigForConnection(): void {
    const oldConfig = { ...this.config };
    
    switch (this.connectionQuality) {
      case '2G':
        this.config = {
          imageQuality: 'low',
          enableAnimations: false,
          prefetchData: false,
          maxConcurrentRequests: 1,
          requestTimeout: 30000,
          enableVideoAutoplay: false,
          loadingStrategy: 'minimal'
        };
        break;
      
      case '3G':
        this.config = {
          imageQuality: 'medium',
          enableAnimations: false,
          prefetchData: false,
          maxConcurrentRequests: 2,
          requestTimeout: 20000,
          enableVideoAutoplay: false,
          loadingStrategy: 'standard'
        };
        break;
      
      case '4G':
      case '5G':
      case 'wifi':
        this.config = {
          imageQuality: 'high',
          enableAnimations: true,
          prefetchData: true,
          maxConcurrentRequests: 6,
          requestTimeout: 10000,
          enableVideoAutoplay: true,
          loadingStrategy: 'full'
        };
        break;
      
      default:
        this.config = this.getDefaultConfig();
    }
    
    // Save config
    this.saveConfig();
    
    // Notify listeners if config changed
    if (JSON.stringify(oldConfig) !== JSON.stringify(this.config)) {
      this.notifyListeners();
    }
  }

  private getDefaultConfig(): AdaptiveConfig {
    return {
      imageQuality: 'medium',
      enableAnimations: true,
      prefetchData: false,
      maxConcurrentRequests: 3,
      requestTimeout: 15000,
      enableVideoAutoplay: false,
      loadingStrategy: 'standard'
    };
  }

  private async saveConfig(): Promise<void> {
    try {
      await AsyncStorage.setItem('adaptive_loading_config', JSON.stringify(this.config));
    } catch (error) {
      console.error('[AdaptiveLoading] Failed to save config:', error);
    }
  }

  getConfig(): AdaptiveConfig {
    return { ...this.config };
  }

  getConnectionQuality(): ConnectionQuality {
    return this.connectionQuality;
  }

  shouldLoadImages(): boolean {
    return this.connectionQuality !== '2G';
  }

  shouldEnableAnimations(): boolean {
    return this.config.enableAnimations;
  }

  shouldPrefetchData(): boolean {
    return this.config.prefetchData;
  }

  getImageQuality(): 'low' | 'medium' | 'high' {
    return this.config.imageQuality;
  }

  getMaxConcurrentRequests(): number {
    return this.config.maxConcurrentRequests;
  }

  getRequestTimeout(): number {
    return this.config.requestTimeout;
  }

  onConfigChange(callback: (config: AdaptiveConfig) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(): void {
    console.log('[AdaptiveLoading] Config updated:', this.config);
    this.listeners.forEach(listener => listener(this.config));
  }

  // Manual override for user preferences
  async setImageQuality(quality: 'low' | 'medium' | 'high'): Promise<void> {
    this.config.imageQuality = quality;
    await this.saveConfig();
    this.notifyListeners();
  }

  async setAnimationsEnabled(enabled: boolean): Promise<void> {
    this.config.enableAnimations = enabled;
    await this.saveConfig();
    this.notifyListeners();
  }
}
