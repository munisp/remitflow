import { openDB } from 'idb';

class OrdersOffline {
  constructor() {
    this.dbName = 'AgentBankingPWA';
    this.storeName = 'orders';
    this.init();
  }

  async init() {
    this.db = await openDB(this.dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('orders')) {
          const store = db.createObjectStore('orders', { keyPath: 'id' });
          store.createIndex('status', 'status');
          store.createIndex('date', 'createdAt');
        }
      },
    });
  }

  async saveOrder(order) {
    await this.db.put(this.storeName, { ...order, synced: false });
  }

  async getOrders(status) {
    if (status) {
      return await this.db.getAllFromIndex(this.storeName, 'status', status);
    }
    return await this.db.getAll(this.storeName);
  }
}

export const ordersOffline = new OrdersOffline();
