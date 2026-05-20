// LiteModeManager.ts - Lite UI mode for low-end devices
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Platform } from 'react-native';

interface LiteModeConfig {
  enabled: boolean;
  disableImages: boolean;
  disableAnimations: boolean;
  simplifiedUI: boolean;
  reducedColors: boolean;
  textOnlyMode: boolean;
  lowResolutionIcons: boolean;
}

export class LiteModeManager {
  private static instance: LiteModeManager;
  private config: LiteModeConfig;
  private listeners: ((config: LiteModeConfig) => void)[] = [];

  private constructor() {
    this.config = {
      enabled: false,
      disableImages: false,
      disableAnimations: false,
      simplifiedUI: false,
      reducedColors: false,
      textOnlyMode: false,
      lowResolutionIcons: false
    };
    this.initialize();
  }

  static getInstance(): LiteModeManager {
    if (!LiteModeManager.instance) {
      LiteModeManager.instance = new LiteModeManager();
    }
    return LiteModeManager.instance;
  }

  private async initialize(): Promise<void> {
    // Load saved config
    const saved = await AsyncStorage.getItem('lite_mode_config');
    if (saved) {
      this.config = JSON.parse(saved);
    } else {
      // Auto-detect if lite mode should be enabled
      await this.autoDetectLiteMode();
    }
  }

  private async autoDetectLiteMode(): Promise<void> {
    const { width, height } = Dimensions.get('window');
    const totalPixels = width * height;
    
    // Enable lite mode for low-resolution devices (< 720p)
    if (totalPixels < 1280 * 720) {
      await this.enableLiteMode();
      console.log('[LiteMode] Auto-enabled for low-resolution device');
    }
    
    // Check available memory (would integrate with react-native-device-info)
    // If RAM < 2GB, enable lite mode
  }

  async enableLiteMode(): Promise<void> {
    this.config = {
      enabled: true,
      disableImages: true,
      disableAnimations: true,
      simplifiedUI: true,
      reducedColors: true,
      textOnlyMode: false,
      lowResolutionIcons: true
    };
    
    await this.saveConfig();
    this.notifyListeners();
    console.log('[LiteMode] Lite mode enabled');
  }

  async disableLiteMode(): Promise<void> {
    this.config = {
      enabled: false,
      disableImages: false,
      disableAnimations: false,
      simplifiedUI: false,
      reducedColors: false,
      textOnlyMode: false,
      lowResolutionIcons: false
    };
    
    await this.saveConfig();
    this.notifyListeners();
    console.log('[LiteMode] Lite mode disabled');
  }

  async enableTextOnlyMode(): Promise<void> {
    this.config.textOnlyMode = true;
    this.config.disableImages = true;
    this.config.lowResolutionIcons = true;
    
    await this.saveConfig();
    this.notifyListeners();
    console.log('[LiteMode] Text-only mode enabled');
  }

  private async saveConfig(): Promise<void> {
    try {
      await AsyncStorage.setItem('lite_mode_config', JSON.stringify(this.config));
    } catch (error) {
      console.error('[LiteMode] Failed to save config:', error);
    }
  }

  getConfig(): LiteModeConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  shouldDisableImages(): boolean {
    return this.config.disableImages;
  }

  shouldDisableAnimations(): boolean {
    return this.config.disableAnimations;
  }

  shouldUseSimplifiedUI(): boolean {
    return this.config.simplifiedUI;
  }

  isTextOnlyMode(): boolean {
    return this.config.textOnlyMode;
  }

  onConfigChange(callback: (config: LiteModeConfig) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.config));
  }

  // Get appropriate image size based on lite mode
  getImageSize(defaultSize: number): number {
    if (this.config.textOnlyMode) return 0;
    if (this.config.lowResolutionIcons) return defaultSize * 0.5;
    return defaultSize;
  }

  // Get appropriate font size
  getFontSize(defaultSize: number): number {
    // Slightly larger fonts in lite mode for readability
    return this.config.enabled ? defaultSize * 1.1 : defaultSize;
  }
}
