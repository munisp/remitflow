// DataSaverManager.ts - PWA Data Saver mode
export class DataSaverManager {
  private static instance: DataSaverManager;
  private dataSaverEnabled: boolean = false;

  static getInstance(): DataSaverManager {
    if (!DataSaverManager.instance) {
      DataSaverManager.instance = new DataSaverManager();
    }
    return DataSaverManager.instance;
  }

  initialize(): void {
    // Check if Data Saver is enabled (Chrome)
    if ('connection' in navigator) {
      const conn = (navigator as any).connection;
      if (conn && conn.saveData) {
        this.dataSaverEnabled = true;
        console.log('[DataSaver] Data Saver mode detected');
      }
    }
  }

  isDataSaverEnabled(): boolean {
    return this.dataSaverEnabled;
  }

  getConnectionType(): string {
    if ('connection' in navigator) {
      const conn = (navigator as any).connection;
      return conn?.effectiveType || 'unknown';
    }
    return 'unknown';
  }

  shouldLoadImages(): boolean {
    return !this.dataSaverEnabled && this.getConnectionType() !== '2g';
  }
}
