// DataUsageTracker.ts - Track and limit data usage
import AsyncStorage from '@react-native-async-storage/async-storage';

interface DataUsage {
  date: string;
  bytesReceived: number;
  bytesSent: number;
  totalBytes: number;
}

interface DataLimit {
  dailyLimit: number; // bytes
  monthlyLimit: number; // bytes
  warningThreshold: number; // percentage (0-100)
}

export class DataUsageTracker {
  private static instance: DataUsageTracker;
  private currentUsage: DataUsage;
  private limits: DataLimit;
  private listeners: ((usage: DataUsage, exceeded: boolean) => void)[] = [];

  private constructor() {
    this.currentUsage = {
      date: new Date().toISOString().split('T')[0],
      bytesReceived: 0,
      bytesSent: 0,
      totalBytes: 0
    };
    
    this.limits = {
      dailyLimit: 50 * 1024 * 1024, // 50MB
      monthlyLimit: 500 * 1024 * 1024, // 500MB
      warningThreshold: 80 // 80%
    };
    
    this.initialize();
  }

  static getInstance(): DataUsageTracker {
    if (!DataUsageTracker.instance) {
      DataUsageTracker.instance = new DataUsageTracker();
    }
    return DataUsageTracker.instance;
  }

  private async initialize(): Promise<void> {
    await this.loadUsage();
    await this.loadLimits();
    this.startDailyReset();
  }

  async trackRequest(url: string, bytesReceived: number, bytesSent: number = 0): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    
    // Reset if new day
    if (this.currentUsage.date !== today) {
      await this.resetDailyUsage();
    }
    
    this.currentUsage.bytesReceived += bytesReceived;
    this.currentUsage.bytesSent += bytesSent;
    this.currentUsage.totalBytes = this.currentUsage.bytesReceived + this.currentUsage.bytesSent;
    
    await this.saveUsage();
    
    // Check if limit exceeded
    const exceeded = this.isLimitExceeded();
    if (exceeded) {
      console.warn('[DataUsage] Daily limit exceeded!');
    }
    
    // Check if warning threshold reached
    const percentage = (this.currentUsage.totalBytes / this.limits.dailyLimit) * 100;
    if (percentage >= this.limits.warningThreshold && percentage < 100) {
      console.warn(`[DataUsage] Warning: ${percentage.toFixed(1)}% of daily limit used`);
    }
    
    this.notifyListeners(exceeded);
  }

  private async loadUsage(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem('data_usage');
      if (saved) {
        this.currentUsage = JSON.parse(saved);
      }
    } catch (error) {
      console.error('[DataUsage] Failed to load usage:', error);
    }
  }

  private async saveUsage(): Promise<void> {
    try {
      await AsyncStorage.setItem('data_usage', JSON.stringify(this.currentUsage));
    } catch (error) {
      console.error('[DataUsage] Failed to save usage:', error);
    }
  }

  private async loadLimits(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem('data_limits');
      if (saved) {
        this.limits = JSON.parse(saved);
      }
    } catch (error) {
      console.error('[DataUsage] Failed to load limits:', error);
    }
  }

  private async saveLimits(): Promise<void> {
    try {
      await AsyncStorage.setItem('data_limits', JSON.stringify(this.limits));
    } catch (error) {
      console.error('[DataUsage] Failed to save limits:', error);
    }
  }

  private async resetDailyUsage(): Promise<void> {
    this.currentUsage = {
      date: new Date().toISOString().split('T')[0],
      bytesReceived: 0,
      bytesSent: 0,
      totalBytes: 0
    };
    await this.saveUsage();
    console.log('[DataUsage] Daily usage reset');
  }

  private startDailyReset(): void {
    // Check every hour if we need to reset
    setInterval(() => {
      const today = new Date().toISOString().split('T')[0];
      if (this.currentUsage.date !== today) {
        this.resetDailyUsage();
      }
    }, 3600000); // 1 hour
  }

  isLimitExceeded(): boolean {
    return this.currentUsage.totalBytes >= this.limits.dailyLimit;
  }

  getUsagePercentage(): number {
    return (this.currentUsage.totalBytes / this.limits.dailyLimit) * 100;
  }

  getRemainingData(): number {
    return Math.max(0, this.limits.dailyLimit - this.currentUsage.totalBytes);
  }

  getCurrentUsage(): DataUsage {
    return { ...this.currentUsage };
  }

  getLimits(): DataLimit {
    return { ...this.limits };
  }

  async setDailyLimit(bytes: number): Promise<void> {
    this.limits.dailyLimit = bytes;
    await this.saveLimits();
    console.log(`[DataUsage] Daily limit set to ${this.formatBytes(bytes)}`);
  }

  async setMonthlyLimit(bytes: number): Promise<void> {
    this.limits.monthlyLimit = bytes;
    await this.saveLimits();
    console.log(`[DataUsage] Monthly limit set to ${this.formatBytes(bytes)}`);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  onUsageChange(callback: (usage: DataUsage, exceeded: boolean) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(exceeded: boolean): void {
    this.listeners.forEach(listener => listener(this.currentUsage, exceeded));
  }
}
