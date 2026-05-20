import { openDB } from 'idb';

class ForecastsOffline {
  constructor() {
    this.dbName = 'AgentBankingPWA';
    this.storeName = 'forecasts';
    this.init();
  }

  async init() {
    this.db = await openDB(this.dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('forecasts')) {
          db.createObjectStore('forecasts', { keyPath: 'id' });
        }
      },
    });
  }

  async saveForecast(forecast) {
    await this.db.put(this.storeName, forecast);
  }

  async getForecasts() {
    return await this.db.getAll(this.storeName);
  }
}

export const forecastsOffline = new ForecastsOffline();
