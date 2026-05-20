// DataPrefetcher.ts - Intelligent Background Prefetching
// Instant screen loads through predictive loading

import localforage from 'localforage';

interface PrefetchConfig {
  morning: string[];
  afternoon: string[];
  evening: string[];
  marketHours: string[];
}

interface UserBehavior {
  mostVisitedScreens: string[];
  timeBasedPatterns: Map<number, string[]>;
  lastPrefetchTime: number;
}

class DataPrefetcher {
  private static instance: DataPrefetcher;
  private prefetchedData: Map<string, any> = new Map();
  private userBehavior: UserBehavior = {
    mostVisitedScreens: [],
    timeBasedPatterns: new Map(),
    lastPrefetchTime: 0,
  };
  private prefetchConfig: PrefetchConfig = {
    morning: ['balance', 'transactions', 'accounts'],
    afternoon: ['transactions', 'spending_analytics'],
    evening: ['spending_analytics', 'budget'],
    marketHours: ['stocks', 'crypto', 'market_data'],
  };

  static getInstance(): DataPrefetcher {
    if (!DataPrefetcher.instance) {
      DataPrefetcher.instance = new DataPrefetcher();
    }
    return DataPrefetcher.instance;
  }

  async initialize(): Promise<void> {
    await this.loadUserBehavior();
    this.startIntelligentPrefetching();
  }

  private startIntelligentPrefetching(): void {
    // Prefetch based on time of day
    this.prefetchByTimeOfDay();

    // Prefetch based on user patterns
    this.prefetchByUserBehavior();

    // Schedule periodic prefetching
    setInterval(() => {
      this.prefetchByTimeOfDay();
    }, 15 * 60 * 1000); // Every 15 minutes
  }

  private prefetchByTimeOfDay(): void {
    const hour = new Date().getHours();
    let endpoints: string[] = [];

    if (hour >= 6 && hour < 12) {
      // Morning (6am - 12pm)
      endpoints = this.prefetchConfig.morning;
      console.log('[PREFETCH] Morning prefetch');
    } else if (hour >= 12 && hour < 18) {
      // Afternoon (12pm - 6pm)
      endpoints = this.prefetchConfig.afternoon;
      console.log('[PREFETCH] Afternoon prefetch');
    } else if (hour >= 18 && hour < 24) {
      // Evening (6pm - 12am)
      endpoints = this.prefetchConfig.evening;
      console.log('[PREFETCH] Evening prefetch');
    }

    // Check if market hours (9:30am - 4pm EST)
    if (this.isMarketHours()) {
      endpoints = [...endpoints, ...this.prefetchConfig.marketHours];
      console.log('[PREFETCH] Market hours prefetch');
    }

    this.prefetchEndpoints(endpoints);
  }

  private isMarketHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // Monday-Friday, 9:30am - 4pm (simplified)
    return day >= 1 && day <= 5 && hour >= 9 && hour < 16;
  }

  private async prefetchByUserBehavior(): Promise<void> {
    const hour = new Date().getHours();
    const patterns = this.userBehavior.timeBasedPatterns.get(hour);

    if (patterns && patterns.length > 0) {
      console.log('[PREFETCH] User behavior prefetch:', patterns);
      await this.prefetchEndpoints(patterns);
    }
  }

  private async prefetchEndpoints(endpoints: string[]): Promise<void> {
    for (const endpoint of endpoints) {
      await this.prefetchData(endpoint);
    }
  }

  private async prefetchData(endpoint: string): Promise<void> {
    try {
      const url = this.getEndpointUrl(endpoint);
      const response = await fetch(url);
      const data = await response.json();

      this.prefetchedData.set(endpoint, {
        data,
        timestamp: Date.now(),
      });

      console.log(`[PREFETCH] Cached: ${endpoint}`);
    } catch (error) {
      console.error(`[PREFETCH] Failed to prefetch ${endpoint}:`, error);
    }
  }

  private getEndpointUrl(endpoint: string): string {
    const baseUrl = 'https://api.agentbanking.com';
    
    switch (endpoint) {
      case 'balance':
        return `${baseUrl}/accounts/balance`;
      case 'transactions':
        return `${baseUrl}/transactions/recent`;
      case 'accounts':
        return `${baseUrl}/accounts`;
      case 'spending_analytics':
        return `${baseUrl}/analytics/spending`;
      case 'budget':
        return `${baseUrl}/budget`;
      case 'stocks':
        return `${baseUrl}/market/stocks`;
      case 'crypto':
        return `${baseUrl}/market/crypto`;
      case 'market_data':
        return `${baseUrl}/market/data`;
      default:
        return `${baseUrl}/${endpoint}`;
    }
  }

  async getData(endpoint: string): Promise<any> {
    const cached = this.prefetchedData.get(endpoint);

    if (cached && this.isCacheValid(cached.timestamp)) {
      console.log(`[PREFETCH] Cache hit: ${endpoint}`);
      return cached.data;
    }

    console.log(`[PREFETCH] Cache miss: ${endpoint}`);
    await this.prefetchData(endpoint);
    return this.prefetchedData.get(endpoint)?.data;
  }

  private isCacheValid(timestamp: number): boolean {
    const maxAge = 5 * 60 * 1000; // 5 minutes
    return Date.now() - timestamp < maxAge;
  }

  trackScreenVisit(screenName: string): void {
    const hour = new Date().getHours();

    // Update most visited screens
    if (!this.userBehavior.mostVisitedScreens.includes(screenName)) {
      this.userBehavior.mostVisitedScreens.push(screenName);
    }

    // Update time-based patterns
    const patterns = this.userBehavior.timeBasedPatterns.get(hour) || [];
    if (!patterns.includes(screenName)) {
      patterns.push(screenName);
      this.userBehavior.timeBasedPatterns.set(hour, patterns);
    }

    this.saveUserBehavior();
  }

  private async loadUserBehavior(): Promise<void> {
    try {
      const stored = await localforage.getItem('user_behavior');
      if (stored) {
        const data = JSON.parse(stored);
        this.userBehavior = {
          ...data,
          timeBasedPatterns: new Map(data.timeBasedPatterns),
        };
      }
    } catch (error) {
      console.error('[PREFETCH] Failed to load user behavior:', error);
    }
  }

  private async saveUserBehavior(): Promise<void> {
    try {
      const data = {
        ...this.userBehavior,
        timeBasedPatterns: Array.from(this.userBehavior.timeBasedPatterns.entries()),
      };
      await localforage.setItem('user_behavior', JSON.stringify(data));
    } catch (error) {
      console.error('[PREFETCH] Failed to save user behavior:', error);
    }
  }

  clearCache(): void {
    this.prefetchedData.clear();
    console.log('[PREFETCH] Cache cleared');
  }

  getCacheSize(): number {
    return this.prefetchedData.size;
  }
}

export default DataPrefetcher.getInstance();
