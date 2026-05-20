// ProgressiveDataLoader.ts - Load data progressively
import AsyncStorage from '@react-native-async-storage/async-storage';

interface DataPriority {
  critical: string[];
  high: string[];
  medium: string[];
  low: string[];
}

interface LoadProgress {
  total: number;
  loaded: number;
  percentage: number;
  currentPriority: keyof DataPriority;
}

export class ProgressiveDataLoader {
  private static instance: ProgressiveDataLoader;
  private loadProgress: LoadProgress = {
    total: 0,
    loaded: 0,
    percentage: 0,
    currentPriority: 'critical'
  };
  private listeners: ((progress: LoadProgress) => void)[] = [];
  private cache: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): ProgressiveDataLoader {
    if (!ProgressiveDataLoader.instance) {
      ProgressiveDataLoader.instance = new ProgressiveDataLoader();
    }
    return ProgressiveDataLoader.instance;
  }

  async loadDataProgressively(priorities: DataPriority): Promise<void> {
    const allEndpoints = [
      ...priorities.critical,
      ...priorities.high,
      ...priorities.medium,
      ...priorities.low
    ];
    
    this.loadProgress.total = allEndpoints.length;
    this.loadProgress.loaded = 0;
    
    console.log(`[ProgressiveLoader] Starting progressive load of ${allEndpoints.length} endpoints`);
    
    // Load critical data first (blocking)
    await this.loadPriority('critical', priorities.critical);
    
    // Load high priority (non-blocking)
    this.loadPriority('high', priorities.high).catch(console.error);
    
    // Load medium priority (delayed)
    setTimeout(() => {
      this.loadPriority('medium', priorities.medium).catch(console.error);
    }, 2000);
    
    // Load low priority (further delayed)
    setTimeout(() => {
      this.loadPriority('low', priorities.low).catch(console.error);
    }, 5000);
  }

  private async loadPriority(priority: keyof DataPriority, endpoints: string[]): Promise<void> {
    this.loadProgress.currentPriority = priority;
    console.log(`[ProgressiveLoader] Loading ${priority} priority data (${endpoints.length} endpoints)`);
    
    for (const endpoint of endpoints) {
      try {
        // Check cache first
        const cached = await this.getCachedData(endpoint);
        if (cached) {
          console.log(`[ProgressiveLoader] Using cached data for ${endpoint}`);
          this.cache.set(endpoint, cached);
        } else {
          // Fetch from network
          const data = await this.fetchData(endpoint);
          this.cache.set(endpoint, data);
          await this.cacheData(endpoint, data);
        }
        
        this.loadProgress.loaded++;
        this.loadProgress.percentage = (this.loadProgress.loaded / this.loadProgress.total) * 100;
        this.notifyListeners();
      } catch (error) {
        console.error(`[ProgressiveLoader] Failed to load ${endpoint}:`, error);
      }
    }
    
    console.log(`[ProgressiveLoader] Completed ${priority} priority load`);
  }

  private async fetchData(endpoint: string): Promise<any> {
    // Simulate API call
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  }

  private async getCachedData(endpoint: string): Promise<any | null> {
    try {
      const cached = await AsyncStorage.getItem(`cache_${endpoint}`);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        // Cache valid for 1 hour
        if (Date.now() - timestamp < 3600000) {
          return data;
        }
      }
    } catch (error) {
      console.error('[ProgressiveLoader] Cache read error:', error);
    }
    return null;
  }

  private async cacheData(endpoint: string, data: any): Promise<void> {
    try {
      await AsyncStorage.setItem(`cache_${endpoint}`, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('[ProgressiveLoader] Cache write error:', error);
    }
  }

  getData(endpoint: string): any | null {
    return this.cache.get(endpoint) || null;
  }

  getProgress(): LoadProgress {
    return { ...this.loadProgress };
  }

  onProgress(callback: (progress: LoadProgress) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.loadProgress));
  }

  async clearCache(): Promise<void> {
    this.cache.clear();
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(key => key.startsWith('cache_'));
    await AsyncStorage.multiRemove(cacheKeys);
    console.log('[ProgressiveLoader] Cache cleared');
  }
}
