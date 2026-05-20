// OfflineFirstManager.ts - PWA Offline-first with Service Worker
export class OfflineFirstManager {
  private static instance: OfflineFirstManager;
  private swRegistration: ServiceWorkerRegistration | null = null;

  static getInstance(): OfflineFirstManager {
    if (!OfflineFirstManager.instance) {
      OfflineFirstManager.instance = new OfflineFirstManager();
    }
    return OfflineFirstManager.instance;
  }

  async initialize(): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('/sw.js');
        console.log('[OfflineFirst] Service Worker registered');
        
        // Listen for updates
        this.swRegistration.addEventListener('updatefound', () => {
          console.log('[OfflineFirst] Service Worker update found');
        });
      } catch (error) {
        console.error('[OfflineFirst] Service Worker registration failed:', error);
      }
    }
  }

  async queueRequest(url: string, options: RequestInit = {}): Promise<void> {
    const request = new Request(url, options);
    
    // Use Background Sync API if available
    if ('sync' in this.swRegistration!) {
      try {
        await this.swRegistration!.sync.register('sync-requests');
        console.log('[OfflineFirst] Background sync registered');
      } catch (error) {
        console.error('[OfflineFirst] Background sync failed:', error);
      }
    }
  }

  isOnline(): boolean {
    return navigator.onLine;
  }
}
