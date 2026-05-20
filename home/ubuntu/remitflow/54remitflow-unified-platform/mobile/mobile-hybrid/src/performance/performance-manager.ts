// performance-manager.ts - Hybrid Performance Optimizations

import { Device } from '@capacitor/device';

class PerformanceManager {
  private static instance: PerformanceManager;

  static getInstance(): PerformanceManager {
    if (!PerformanceManager.instance) {
      PerformanceManager.instance = new PerformanceManager();
    }
    return PerformanceManager.instance;
  }

  async initialize(): Promise<void> {
    const info = await Device.getInfo();
    console.log('[HYBRID] Device:', info);
    
    this.optimizeForDevice(info);
  }

  private optimizeForDevice(info: any): void {
    if (info.platform === 'ios') {
      this.optimizeForIOS();
    } else if (info.platform === 'android') {
      this.optimizeForAndroid();
    }
  }

  private optimizeForIOS(): void {
    console.log('[HYBRID] Optimizing for iOS');
    // iOS-specific optimizations
  }

  private optimizeForAndroid(): void {
    console.log('[HYBRID] Optimizing for Android');
    // Android-specific optimizations
  }

  // Image optimization
  optimizeImage(url: string): string {
    return `${url}?format=webp&quality=80`;
  }

  // Request debouncing
  debounce<T extends (...args: any[]) => any>(fn: T, delay: number = 300): (...args: Parameters<T>) => void {
    let timer: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }
}

export default PerformanceManager.getInstance();
