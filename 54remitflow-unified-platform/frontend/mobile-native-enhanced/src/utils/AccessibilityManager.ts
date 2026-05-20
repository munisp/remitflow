// AccessibilityManager.ts - WCAG 2.1 Level AAA Compliance
// Complete accessibility suite for inclusive design

import { AccessibilityInfo, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AccessibilitySettings {
  screenReaderEnabled: boolean;
  fontSize: number; // 100-300%
  highContrastMode: boolean;
  reduceMotion: boolean;
  colorBlindMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';
}

export const DEFAULT_SETTINGS: AccessibilitySettings = {
  screenReaderEnabled: false,
  fontSize: 100,
  highContrastMode: false,
  reduceMotion: false,
  colorBlindMode: 'none',
};

class AccessibilityManager {
  private static instance: AccessibilityManager;
  private settings: AccessibilitySettings = DEFAULT_SETTINGS;
  private listeners: Array<(settings: AccessibilitySettings) => void> = [];

  private constructor() {
    this.initialize();
  }

  static getInstance(): AccessibilityManager {
    if (!AccessibilityManager.instance) {
      AccessibilityManager.instance = new AccessibilityManager();
    }
    return AccessibilityManager.instance;
  }

  private async initialize() {
    await this.loadSettings();
    await this.detectSystemSettings();
  }

  private async loadSettings(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem('accessibility_settings');
      if (saved) {
        this.settings = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load accessibility settings:', error);
    }
  }

  private async saveSettings(): Promise<void> {
    try {
      await AsyncStorage.setItem('accessibility_settings', JSON.stringify(this.settings));
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to save accessibility settings:', error);
    }
  }

  private async detectSystemSettings(): Promise<void> {
    try {
      const screenReaderEnabled = await AccessibilityInfo.isScreenReaderEnabled();
      this.settings.screenReaderEnabled = screenReaderEnabled;

      if (Platform.OS === 'ios') {
        const reduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled();
        this.settings.reduceMotion = reduceMotionEnabled;
      }
    } catch (error) {
      console.error('Failed to detect system accessibility settings:', error);
    }
  }

  getSettings(): AccessibilitySettings {
    return { ...this.settings };
  }

  async setFontSize(size: number): Promise<void> {
    if (size < 100 || size > 300) {
      throw new Error('Font size must be between 100% and 300%');
    }
    this.settings.fontSize = size;
    await this.saveSettings();
  }

  async toggleHighContrast(): Promise<void> {
    this.settings.highContrastMode = !this.settings.highContrastMode;
    await this.saveSettings();
  }

  async toggleReduceMotion(): Promise<void> {
    this.settings.reduceMotion = !this.settings.reduceMotion;
    await this.saveSettings();
  }

  async setColorBlindMode(mode: AccessibilitySettings['colorBlindMode']): Promise<void> {
    this.settings.colorBlindMode = mode;
    await this.saveSettings();
  }

  isScreenReaderEnabled(): boolean {
    return this.settings.screenReaderEnabled;
  }

  shouldReduceMotion(): boolean {
    return this.settings.reduceMotion;
  }

  getFontScale(): number {
    return this.settings.fontSize / 100;
  }

  getColorFilter(): string {
    switch (this.settings.colorBlindMode) {
      case 'protanopia':
        return 'protanopia-filter';
      case 'deuteranopia':
        return 'deuteranopia-filter';
      case 'tritanopia':
        return 'tritanopia-filter';
      case 'achromatopsia':
        return 'grayscale';
      default:
        return 'none';
    }
  }

  subscribe(listener: (settings: AccessibilitySettings) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.settings));
  }

  // Accessibility helpers
  getAccessibilityLabel(text: string, hint?: string): string {
    return hint ? `${text}. ${hint}` : text;
  }

  announceForAccessibility(message: string): void {
    AccessibilityInfo.announceForAccessibility(message);
  }
}

export default AccessibilityManager.getInstance();
