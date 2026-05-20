// OfflineManager.ts - Hybrid Offline with Capacitor
import { Network } from '@capacitor/network';
import { Storage } from '@capacitor/storage';

export class OfflineManager {
  private static instance: OfflineManager;

  static getInstance(): OfflineManager {
    if (!OfflineManager.instance) {
      OfflineManager.instance = new OfflineManager();
    }
    return OfflineManager.instance;
  }

  async initialize(): Promise<void> {
    const status = await Network.getStatus();
    console.log('[Offline] Network status:', status);
    
    Network.addListener('networkStatusChange', (status) => {
      console.log('[Offline] Network changed:', status);
    });
  }

  async isOnline(): Promise<boolean> {
    const status = await Network.getStatus();
    return status.connected;
  }

  async queueRequest(key: string, data: any): Promise<void> {
    await Storage.set({ key, value: JSON.stringify(data) });
  }
}
