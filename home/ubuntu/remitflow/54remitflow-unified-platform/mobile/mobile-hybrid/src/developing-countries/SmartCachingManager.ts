// SmartCachingManager.ts - Intelligent caching for offline use
import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry {
  key: string;
  data: any;
  timestamp: number;
  expiresAt: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  size: number;
}

interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
}

export class SmartCachingManager {
  private static instance: SmartCachingManager;
  private cache: Map<string, CacheEntry> = new Map();
  private maxCacheSize: number = 50 * 1024 * 1024; // 50MB
  private hits: number = 0;
  private misses: number = 0;

  private constructor() {
    this.initialize();
  }

  static getInstance(): SmartCachingManager {
    if (!SmartCachingManager.instance) {
      SmartCachingManager.instance = new SmartCachingManager();
    }
    return SmartCachingManager.instance;
  }

  private async initialize(): Promise<void> {
    await this.loadCache();
    this.startCleanupTimer();
  }

  async set(
    key: string,
    data: any,
    ttl: number = 3600000, // 1 hour default
    priority: 'critical' | 'high' | 'medium' | 'low' = 'medium'
  ): Promise<void> {
    const entry: CacheEntry = {
      key,
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
      priority,
      size: JSON.stringify(data).length
    };
    
    // Check if adding this entry would exceed cache size
    const currentSize = this.getCurrentCacheSize();
    if (currentSize + entry.size > this.maxCacheSize) {
      await this.evictLowPriorityEntries(entry.size);
    }
    
    this.cache.set(key, entry);
    await this.persistEntry(key, entry);
    
    console.log(`[SmartCache] Cached: ${key} (${this.formatBytes(entry.size)}, priority: ${priority})`);
  }

  async get(key: string): Promise<any | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      console.log(`[SmartCache] Miss: ${key}`);
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      await this.delete(key);
      this.misses++;
      console.log(`[SmartCache] Expired: ${key}`);
      return null;
    }
    
    this.hits++;
    console.log(`[SmartCache] Hit: ${key}`);
    return entry.data;
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    await AsyncStorage.removeItem(`cache_${key}`);
    console.log(`[SmartCache] Deleted: ${key}`);
  }

  async clear(): Promise<void> {
    const keys = Array.from(this.cache.keys());
    this.cache.clear();
    
    await Promise.all(
      keys.map(key => AsyncStorage.removeItem(`cache_${key}`))
    );
    
    console.log('[SmartCache] Cache cleared');
  }

  private async loadCache(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith('cache_'));
      
      for (const key of cacheKeys) {
        const value = await AsyncStorage.getItem(key);
        if (value) {
          const entry: CacheEntry = JSON.parse(value);
          const cacheKey = key.replace('cache_', '');
          this.cache.set(cacheKey, entry);
        }
      }
      
      console.log(`[SmartCache] Loaded ${this.cache.size} entries from storage`);
    } catch (error) {
      console.error('[SmartCache] Failed to load cache:', error);
    }
  }

  private async persistEntry(key: string, entry: CacheEntry): Promise<void> {
    try {
      await AsyncStorage.setItem(`cache_${key}`, JSON.stringify(entry));
    } catch (error) {
      console.error(`[SmartCache] Failed to persist ${key}:`, error);
    }
  }

  private getCurrentCacheSize(): number {
    let total = 0;
    this.cache.forEach(entry => {
      total += entry.size;
    });
    return total;
  }

  private async evictLowPriorityEntries(neededSpace: number): Promise<void> {
    console.log(`[SmartCache] Evicting entries to free ${this.formatBytes(neededSpace)}`);
    
    // Sort entries by priority (low to high) and age (old to new)
    const priorityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    const entries = Array.from(this.cache.entries()).sort((a, b) => {
      const [, entryA] = a;
      const [, entryB] = b;
      
      if (priorityOrder[entryA.priority] !== priorityOrder[entryB.priority]) {
        return priorityOrder[entryA.priority] - priorityOrder[entryB.priority];
      }
      
      return entryA.timestamp - entryB.timestamp;
    });
    
    let freedSpace = 0;
    for (const [key, entry] of entries) {
      if (entry.priority === 'critical') continue; // Never evict critical entries
      
      await this.delete(key);
      freedSpace += entry.size;
      
      if (freedSpace >= neededSpace) break;
    }
    
    console.log(`[SmartCache] Freed ${this.formatBytes(freedSpace)}`);
  }

  private startCleanupTimer(): void {
    // Clean up expired entries every 5 minutes
    setInterval(() => {
      this.cleanupExpired();
    }, 300000);
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    this.cache.forEach((entry, key) => {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    });
    
    for (const key of expiredKeys) {
      await this.delete(key);
    }
    
    if (expiredKeys.length > 0) {
      console.log(`[SmartCache] Cleaned up ${expiredKeys.length} expired entries`);
    }
  }

  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    
    return {
      totalEntries: this.cache.size,
      totalSize: this.getCurrentCacheSize(),
      hitRate: totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0,
      missRate: totalRequests > 0 ? (this.misses / totalRequests) * 100 : 0
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}
