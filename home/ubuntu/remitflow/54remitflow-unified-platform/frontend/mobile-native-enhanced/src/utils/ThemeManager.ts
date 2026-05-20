// ThemeManager.ts - Adaptive Dark Mode with Auto-Switching
// Production-ready theme management system

import { Appearance, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Theme {
  dark: boolean;
  colors: {
    primary: string;
    background: string;
    card: string;
    text: string;
    border: string;
    notification: string;
    error: string;
    success: string;
    warning: string;
  };
}

export const LightTheme: Theme = {
  dark: false,
  colors: {
    primary: '#007AFF',
    background: '#FFFFFF',
    card: '#F8F8F8',
    text: '#000000',
    border: '#E0E0E0',
    notification: '#FF3B30',
    error: '#FF3B30',
    success: '#34C759',
    warning: '#FF9500',
  },
};

export const DarkTheme: Theme = {
  dark: true,
  colors: {
    primary: '#0A84FF',
    background: '#000000',
    card: '#1C1C1E',
    text: '#FFFFFF',
    border: '#38383A',
    notification: '#FF453A',
    error: '#FF453A',
    success: '#32D74B',
    warning: '#FF9F0A',
  },
};

type ThemeMode = 'light' | 'dark' | 'auto';
type ThemeChangeListener = (theme: Theme) => void;

class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: Theme = LightTheme;
  private themeMode: ThemeMode = 'auto';
  private listeners: ThemeChangeListener[] = [];
  private appearanceSubscription: any = null;

  private constructor() {
    this.initialize();
  }

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  private async initialize() {
    // Load saved theme preference
    const savedMode = await this.loadThemeMode();
    this.themeMode = savedMode || 'auto';

    // Set initial theme
    this.updateTheme();

    // Listen to system appearance changes
    this.appearanceSubscription = Appearance.addChangeListener(() => {
      if (this.themeMode === 'auto') {
        this.updateTheme();
      }
    });
  }

  private async loadThemeMode(): Promise<ThemeMode | null> {
    try {
      const mode = await AsyncStorage.getItem('theme_mode');
      return mode as ThemeMode | null;
    } catch (error) {
      console.error('Failed to load theme mode:', error);
      return null;
    }
  }

  private async saveThemeMode(mode: ThemeMode): Promise<void> {
    try {
      await AsyncStorage.setItem('theme_mode', mode);
    } catch (error) {
      console.error('Failed to save theme mode:', error);
    }
  }

  private updateTheme() {
    const systemColorScheme = Appearance.getColorScheme();
    
    let newTheme: Theme;
    if (this.themeMode === 'auto') {
      newTheme = systemColorScheme === 'dark' ? DarkTheme : LightTheme;
    } else {
      newTheme = this.themeMode === 'dark' ? DarkTheme : LightTheme;
    }

    if (newTheme.dark !== this.currentTheme.dark) {
      this.currentTheme = newTheme;
      this.notifyListeners();
    }
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentTheme));
  }

  // Public API
  getTheme(): Theme {
    return this.currentTheme;
  }

  getThemeMode(): ThemeMode {
    return this.themeMode;
  }

  async setThemeMode(mode: ThemeMode): Promise<void> {
    this.themeMode = mode;
    await this.saveThemeMode(mode);
    this.updateTheme();
  }

  isDarkMode(): boolean {
    return this.currentTheme.dark;
  }

  subscribe(listener: ThemeChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  cleanup() {
    if (this.appearanceSubscription) {
      this.appearanceSubscription.remove();
    }
    this.listeners = [];
  }
}

export default ThemeManager.getInstance();
