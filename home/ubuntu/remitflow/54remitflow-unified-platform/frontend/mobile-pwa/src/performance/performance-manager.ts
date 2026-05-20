// performance-manager.ts - PWA Performance Optimizations

interface PerformanceMetrics {
  fcp: number; // First Contentful Paint
  lcp: number; // Largest Contentful Paint
  fid: number; // First Input Delay
  cls: number; // Cumulative Layout Shift
  ttfb: number; // Time to First Byte
}

class PerformanceManager {
  private static instance: PerformanceManager;
  private metrics: PerformanceMetrics = {
    fcp: 0,
    lcp: 0,
    fid: 0,
    cls: 0,
    ttfb: 0,
  };

  static getInstance(): PerformanceManager {
    if (!PerformanceManager.instance) {
      PerformanceManager.instance = new PerformanceManager();
    }
    return PerformanceManager.instance;
  }

  async initialize(): Promise<void> {
    this.measureWebVitals();
    this.setupServiceWorker();
    this.enableCodeSplitting();
  }

  private measureWebVitals(): void {
    if ('PerformanceObserver' in window) {
      // Measure FCP
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            this.metrics.fcp = entry.startTime;
          }
        }
      }).observe({ entryTypes: ['paint'] });

      // Measure LCP
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1] as any;
        this.metrics.lcp = lastEntry.renderTime || lastEntry.loadTime;
      }).observe({ entryTypes: ['largest-contentful-paint'] });

      // Measure FID
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.metrics.fid = (entry as any).processingStart - entry.startTime;
        }
      }).observe({ entryTypes: ['first-input'] });

      // Measure CLS
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            this.metrics.cls += (entry as any).value;
          }
        }
      }).observe({ entryTypes: ['layout-shift'] });
    }
  }

  private async setupServiceWorker(): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
        console.log('[PWA] Service worker registered');
      } catch (error) {
        console.error('[PWA] Service worker registration failed:', error);
      }
    }
  }

  private enableCodeSplitting(): void {
    // Code splitting handled by bundler (Vite/Webpack)
    console.log('[PWA] Code splitting enabled');
  }

  // Lazy load images
  lazyLoadImages(): void {
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target as HTMLImageElement;
            img.src = img.dataset.src || '';
            imageObserver.unobserve(img);
          }
        });
      });

      document.querySelectorAll('img[data-src]').forEach((img) => {
        imageObserver.observe(img);
      });
    }
  }

  // Prefetch resources
  prefetchResources(urls: string[]): void {
    urls.forEach((url) => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.appendChild(link);
    });
  }

  // Request batching
  private requestBatches: Map<string, any[]> = new Map();

  batchRequest(key: string, request: any): void {
    if (!this.requestBatches.has(key)) {
      this.requestBatches.set(key, []);
      setTimeout(() => this.flushBatch(key), 100);
    }
    this.requestBatches.get(key)!.push(request);
  }

  private async flushBatch(key: string): Promise<void> {
    const batch = this.requestBatches.get(key);
    if (!batch) return;

    await fetch('/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: batch }),
    });

    this.requestBatches.delete(key);
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }
}

export default PerformanceManager.getInstance();
