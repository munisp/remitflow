import { openDB } from 'idb';

class MarketplaceOffline {
  constructor() {
    this.dbName = 'AgentBankingPWA';
    this.storeName = 'marketplace';
    this.init();
  }

  async init() {
    this.db = await openDB(this.dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('marketplace')) {
          db.createObjectStore('marketplace', { keyPath: 'id' });
        }
      },
    });
  }

  async saveMarketplaceData(data) {
    await this.db.put(this.storeName, data);
  }

  async getMarketplaceData() {
    return await this.db.getAll(this.storeName);
  }
}

export const marketplaceOffline = new MarketplaceOffline();
