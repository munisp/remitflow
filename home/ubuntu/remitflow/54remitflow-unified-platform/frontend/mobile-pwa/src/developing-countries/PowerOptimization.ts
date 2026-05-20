// PowerOptimizationManager.ts - Optimize for unstable power
import { AppState, AppStateStatus, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundTimer from 'react-native-background-timer';

interface PowerSavingConfig {
  reducedRefreshRate: boolean;
  disableBackgroundSync: boolean;
  reduceAnimations: boolean;
  dimScreen: boolean;
  pauseNonEssentialTasks: boolean;
  batteryLevel: number;
  isCharging: boolean;
}

export class PowerOptimizationManager {
  private static instance: PowerOptimizationManager;
  private config: PowerSavingConfig;
  private appState: AppStateStatus = 'active';
  private backgroundTasks: Map<string, any> = new Map();
  private listeners: ((config: PowerSavingConfig) => void)[] = [];

  private constructor() {
    this.config = {
      reducedRefreshRate: false,
      disableBackgroundSync: false,
      reduceAnimations: false,
      dimScreen: false,
      pauseNonEssentialTasks: false,
      batteryLevel: 100,
      isCharging: true
    };
    this.initialize();
  }

  static getInstance(): PowerOptimizationManager {
    if (!PowerOptimizationManager.instance) {
      PowerOptimizationManager.instance = new PowerOptimizationManager();
    }
    return PowerOptimizationManager.instance;
  }

  private async initialize(): Promise<void> {
    // Monitor app state
    AppState.addEventListener('change', this.handleAppStateChange.bind(this));
    
    // Monitor battery level (would integrate with react-native-device-info)
    this.startBatteryMonitoring();
    
    // Load saved preferences
    const saved = await AsyncStorage.getItem('power_saving_config');
    if (saved) {
      this.config = JSON.parse(saved);
    }
  }

  private handleAppStateChange(nextAppState: AppStateStatus): void {
    const previousState = this.appState;
    this.appState = nextAppState;
    
    console.log(`[PowerOptimization] App state changed: ${previousState} -> ${nextAppState}`);
    
    if (nextAppState === 'background') {
      this.onAppBackground();
    } else if (nextAppState === 'active' && previousState === 'background') {
      this.onAppForeground();
    }
  }

  private onAppBackground(): void {
    console.log('[PowerOptimization] App entered background, pausing non-essential tasks');
    
    // Pause all background tasks
    this.backgroundTasks.forEach((task, id) => {
      BackgroundTimer.clearInterval(task);
      console.log(`[PowerOptimization] Paused task: ${id}`);
    });
    
    // Save state
    this.saveConfig();
  }

  private onAppForeground(): void {
    console.log('[PowerOptimization] App entered foreground, resuming tasks');
    
    // Resume tasks if not in power saving mode
    if (!this.config.pauseNonEssentialTasks) {
      this.resumeBackgroundTasks();
    }
  }

  private startBatteryMonitoring(): void {
    // Monitor battery every 60 seconds
    const monitorInterval = BackgroundTimer.setInterval(() => {
      this.checkBatteryStatus();
    }, 60000);
    
    this.backgroundTasks.set('battery_monitor', monitorInterval);
    
    // Initial check
    this.checkBatteryStatus();
  }

  private async checkBatteryStatus(): Promise<void> {
    // This would integrate with react-native-device-info
    // For now, simulating battery check
    const batteryLevel = 50; // Would get from DeviceInfo.getBatteryLevel()
    const isCharging = false; // Would get from DeviceInfo.isBatteryCharging()
    
    this.config.batteryLevel = batteryLevel * 100;
    this.config.isCharging = isCharging;
    
    // Enable power saving if battery < 20% and not charging
    if (this.config.batteryLevel < 20 && !this.config.isCharging) {
      await this.enablePowerSavingMode();
    } else if (this.config.batteryLevel > 50 || this.config.isCharging) {
      await this.disablePowerSavingMode();
    }
  }

  async enablePowerSavingMode(): Promise<void> {
    console.log('[PowerOptimization] Enabling power saving mode');
    
    this.config.reducedRefreshRate = true;
    this.config.disableBackgroundSync = true;
    this.config.reduceAnimations = true;
    this.config.pauseNonEssentialTasks = true;
    
    // Pause non-essential background tasks
    this.pauseNonEssentialTasks();
    
    await this.saveConfig();
    this.notifyListeners();
  }

  async disablePowerSavingMode(): Promise<void> {
    console.log('[PowerOptimization] Disabling power saving mode');
    
    this.config.reducedRefreshRate = false;
    this.config.disableBackgroundSync = false;
    this.config.reduceAnimations = false;
    this.config.pauseNonEssentialTasks = false;
    
    // Resume background tasks
    this.resumeBackgroundTasks();
    
    await this.saveConfig();
    this.notifyListeners();
  }

  private pauseNonEssentialTasks(): void {
    // Pause tasks that aren't critical
    const nonEssentialTasks = ['analytics_sync', 'image_prefetch', 'data_refresh'];
    
    nonEssentialTasks.forEach(taskId => {
      const task = this.backgroundTasks.get(taskId);
      if (task) {
        BackgroundTimer.clearInterval(task);
        console.log(`[PowerOptimization] Paused non-essential task: ${taskId}`);
      }
    });
  }

  private resumeBackgroundTasks(): void {
    console.log('[PowerOptimization] Resuming background tasks');
    // Tasks would be resumed here
  }

  private async saveConfig(): Promise<void> {
    try {
      await AsyncStorage.setItem('power_saving_config', JSON.stringify(this.config));
    } catch (error) {
      console.error('[PowerOptimization] Failed to save config:', error);
    }
  }

  getConfig(): PowerSavingConfig {
    return { ...this.config };
  }

  isPowerSavingEnabled(): boolean {
    return this.config.pauseNonEssentialTasks;
  }

  getBatteryLevel(): number {
    return this.config.batteryLevel;
  }

  isCharging(): boolean {
    return this.config.isCharging;
  }

  shouldReduceAnimations(): boolean {
    return this.config.reduceAnimations;
  }

  shouldDisableBackgroundSync(): boolean {
    return this.config.disableBackgroundSync;
  }

  onConfigChange(callback: (config: PowerSavingConfig) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.config));
  }

  // Schedule task to run only when charging
  scheduleChargingOnlyTask(taskId: string, task: () => void, intervalMs: number): void {
    const wrappedTask = () => {
      if (this.config.isCharging) {
        task();
      } else {
        console.log(`[PowerOptimization] Skipping task ${taskId} - not charging`);
      }
    };
    
    const interval = BackgroundTimer.setInterval(wrappedTask, intervalMs);
    this.backgroundTasks.set(taskId, interval);
  }

  cancelTask(taskId: string): void {
    const task = this.backgroundTasks.get(taskId);
    if (task) {
      BackgroundTimer.clearInterval(task);
      this.backgroundTasks.delete(taskId);
      console.log(`[PowerOptimization] Cancelled task: ${taskId}`);
    }
  }
}
