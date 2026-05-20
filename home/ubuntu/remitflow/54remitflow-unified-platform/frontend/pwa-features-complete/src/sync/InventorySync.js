class InventorySync {
  constructor() {
    this.syncTag = 'inventory_sync';
    this.init();
  }

  async init() {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      this.registration = await navigator.serviceWorker.ready;
    }
  }

  async registerSync() {
    try {
      await this.registration.sync.register(this.syncTag);
      console.log(`${this.syncTag} sync registered`);
      return true;
    } catch (error) {
      console.error(`Failed to register ${this.syncTag} sync:`, error);
      return false;
    }
  }

  async syncData(data) {
    const stored = await this.storeDataForSync(data);
    if (stored) {
      await this.registerSync();
    }
  }

  async storeDataForSync(data) {
    try {
      const db = await openDB('AgentBankingPWA', 1);
      await db.put('pendingSync', {
        id: `${this.syncTag}_${Date.now()}`,
        type: this.syncTag,
        data: data,
        timestamp: Date.now(),
        synced: false
      });
      return true;
    } catch (error) {
      console.error('Failed to store data for sync:', error);
      return false;
    }
  }

  async getPendingSync() {
    const db = await openDB('AgentBankingPWA', 1);
    const all = await db.getAll('pendingSync');
    return all.filter(item => item.type === this.syncTag && !item.synced);
  }

  async markSynced(id) {
    const db = await openDB('AgentBankingPWA', 1);
    const item = await db.get('pendingSync', id);
    if (item) {
      item.synced = true;
      await db.put('pendingSync', item);
    }
  }
}

export const inventorysync = new InventorySync();
