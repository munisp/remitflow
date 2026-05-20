import { openDB } from 'idb';

class StoreManagementOffline {
  constructor() {
    this.dbName = 'AgentBankingPWA';
    this.storeName = 'stores';
    this.init();
  }

  async init() {
    this.db = await openDB(this.dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('stores')) {
          db.createObjectStore('stores', { keyPath: 'id' });
        }
      },
    });
  }

  async saveStore(store) {
    await this.db.put(this.storeName, { ...store, lastUpdated: Date.now() });
  }

  async getStore(id) {
    return await this.db.get(this.storeName, id);
  }

  async getAllStores() {
    return await this.db.getAll(this.storeName);
  }
}

export const storeManagementOffline = new StoreManagementOffline();
