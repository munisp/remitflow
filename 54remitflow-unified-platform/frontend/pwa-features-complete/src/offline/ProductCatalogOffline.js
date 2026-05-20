import { openDB } from 'idb';

const DB_NAME = 'AgentBankingPWA';
const DB_VERSION = 1;
const STORE_NAME = 'products';

class ProductCatalogOffline {
  constructor() {
    this.db = null;
    this.initDB();
  }

  async initDB() {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('supplier', 'supplier', { unique: false });
          store.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }
      },
    });
  }

  async syncProducts(products) {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    for (const product of products) {
      await store.put({
        ...product,
        lastUpdated: Date.now(),
        synced: true
      });
    }
    
    await tx.done;
    console.log(`Synced ${products.length} products to offline storage`);
  }

  async getProducts(filters = {}) {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    
    let products = await store.getAll();
    
    if (filters.category) {
      const index = store.index('category');
      products = await index.getAll(filters.category);
    }
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      products = products.filter(p => 
        p.name.toLowerCase().includes(searchLower) ||
        p.description.toLowerCase().includes(searchLower)
      );
    }
    
    return products;
  }

  async getProduct(id) {
    return await this.db.get(STORE_NAME, id);
  }

  async addProduct(product) {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).add({
      ...product,
      id: product.id || `local_${Date.now()}`,
      lastUpdated: Date.now(),
      synced: false
    });
    await tx.done;
  }

  async updateProduct(id, updates) {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const product = await store.get(id);
    
    if (product) {
      await store.put({
        ...product,
        ...updates,
        lastUpdated: Date.now(),
        synced: false
      });
    }
    
    await tx.done;
  }

  async deleteProduct(id) {
    await this.db.delete(STORE_NAME, id);
  }

  async getUnsyncedProducts() {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const products = await tx.objectStore(STORE_NAME).getAll();
    return products.filter(p => !p.synced);
  }

  async markAsSynced(ids) {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    for (const id of ids) {
      const product = await store.get(id);
      if (product) {
        await store.put({ ...product, synced: true });
      }
    }
    
    await tx.done;
  }

  async clearAll() {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).clear();
    await tx.done;
  }

  async getStorageInfo() {
    const products = await this.db.getAll(STORE_NAME);
    return {
      totalProducts: products.length,
      unsyncedProducts: products.filter(p => !p.synced).length,
      lastUpdate: Math.max(...products.map(p => p.lastUpdated || 0)),
      estimatedSize: JSON.stringify(products).length
    };
  }
}

export const productCatalogOffline = new ProductCatalogOffline();
