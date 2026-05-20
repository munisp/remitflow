// theme-manager.ts - PWA Dark Mode with Auto-Switching
// CSS variables and localStorage persistence

export interface Theme {
  dark: boolean;
  colors: Record<string, string>;
}

export const LightTheme: Theme = {
  dark: false,
  colors: {
    primary: '#007AFF',
    background: '#FFFFFF',
    card: '#F8F8F8',
    text: '#000000',
    border: '#E0E0E0',
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
  },
};

type ThemeMode = 'light' | 'dark' | 'auto';

class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: Theme = LightTheme;
  private themeMode: ThemeMode = 'auto';
  private mediaQuery: MediaQueryList;

  private constructor() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.initialize();
  }

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  private initialize(): void {
    const saved = localStorage.getItem('theme_mode');
    this.themeMode = (saved as ThemeMode) || 'auto';
    this.updateTheme();
    this.mediaQuery.addEventListener('change', () => {
      if (this.themeMode === 'auto') {
        this.updateTheme();
      }
    });
  }

  private updateTheme(): void {
    if (this.themeMode === 'auto') {
      this.currentTheme = this.mediaQuery.matches ? DarkTheme : LightTheme;
    } else {
      this.currentTheme = this.themeMode === 'dark' ? DarkTheme : LightTheme;
    }
    this.applyTheme();
  }

  private applyTheme(): void {
    const root = document.documentElement;
    Object.entries(this.currentTheme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });
    document.body.className = this.currentTheme.dark ? 'dark-mode' : 'light-mode';
  }

  getTheme(): Theme {
    return this.currentTheme;
  }

  setThemeMode(mode: ThemeMode): void {
    this.themeMode = mode;
    localStorage.setItem('theme_mode', mode);
    this.updateTheme();
  }

  isDarkMode(): boolean {
    return this.currentTheme.dark;
  }
}

export default ThemeManager.getInstance();
