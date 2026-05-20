// onboarding-manager.ts - Hybrid Onboarding with Capacitor Storage
import { Preferences } from '@capacitor/preferences';

export interface OnboardingScreen {
  id: number;
  title: string;
  description: string;
}

export const ONBOARDING_SCREENS: OnboardingScreen[] = [
  { id: 1, title: 'Welcome', description: 'Your financial solution' },
  { id: 2, title: 'Instant Transfers', description: 'Send money fast' },
  { id: 3, title: 'Security', description: 'Bank-level protection' },
  { id: 4, title: 'Insights', description: 'Smart analytics' },
  { id: 5, title: 'Personalize', description: 'Customize experience' },
  { id: 6, title: 'Account', description: 'Quick setup' },
  { id: 7, title: 'Security Setup', description: 'Biometric auth' },
  { id: 8, title: 'First Transfer', description: 'Guided tour' },
  { id: 9, title: 'Complete!', description: 'Start banking' },
];

class OnboardingManager {
  private static instance: OnboardingManager;
  private currentScreen: number = 0;
  private completed: boolean = false;

  static getInstance(): OnboardingManager {
    if (!OnboardingManager.instance) {
      OnboardingManager.instance = new OnboardingManager();
    }
    return OnboardingManager.instance;
  }

  async loadProgress(): Promise<void> {
    const { value } = await Preferences.get({ key: 'onboarding_progress' });
    if (value) {
      const data = JSON.parse(value);
      this.currentScreen = data.currentScreen || 0;
      this.completed = data.completed || false;
    }
  }

  async saveProgress(): Promise<void> {
    await Preferences.set({
      key: 'onboarding_progress',
      value: JSON.stringify({
        currentScreen: this.currentScreen,
        completed: this.completed,
      }),
    });
  }

  getCurrentScreen(): number {
    return this.currentScreen;
  }

  isCompleted(): boolean {
    return this.completed;
  }

  async next(): Promise<void> {
    if (this.currentScreen < ONBOARDING_SCREENS.length - 1) {
      this.currentScreen++;
      await this.saveProgress();
    } else {
      await this.complete();
    }
  }

  async skip(): Promise<void> {
    await this.complete();
  }

  async complete(): Promise<void> {
    this.completed = true;
    await this.saveProgress();
  }

  async reset(): Promise<void> {
    this.currentScreen = 0;
    this.completed = false;
    await this.saveProgress();
  }
}

export default OnboardingManager.getInstance();
