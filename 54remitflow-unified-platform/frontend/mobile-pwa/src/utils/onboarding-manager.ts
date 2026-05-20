// onboarding-flow.ts - PWA Interactive Onboarding
// Web-based onboarding with localStorage persistence

export interface OnboardingScreen {
  id: number;
  title: string;
  description: string;
  animation: string;
}

export const ONBOARDING_SCREENS: OnboardingScreen[] = [
  { id: 1, title: 'Welcome to Remittance Platform', description: 'Your complete financial solution', animation: 'welcome' },
  { id: 2, title: 'Instant Transfers', description: 'Send money in seconds', animation: 'transfer' },
  { id: 3, title: 'Bank-Level Security', description: 'Enterprise encryption', animation: 'security' },
  { id: 4, title: 'Smart Insights', description: 'Track and save', animation: 'insights' },
  { id: 5, title: 'Personalize', description: 'Customize your experience', animation: 'personalization' },
  { id: 6, title: 'Account Setup', description: 'Quick and easy', animation: 'account' },
  { id: 7, title: 'Security Setup', description: 'Protect your account', animation: 'security_setup' },
  { id: 8, title: 'First Transfer', description: 'Guided walkthrough', animation: 'first_tx' },
  { id: 9, title: 'All Set!', description: 'Start banking now', animation: 'complete' },
];

class OnboardingManager {
  private static instance: OnboardingManager;
  private currentScreen: number = 0;
  private completed: boolean = false;

  private constructor() {
    this.loadProgress();
  }

  static getInstance(): OnboardingManager {
    if (!OnboardingManager.instance) {
      OnboardingManager.instance = new OnboardingManager();
    }
    return OnboardingManager.instance;
  }

  private loadProgress(): void {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      const data = JSON.parse(saved);
      this.currentScreen = data.currentScreen || 0;
      this.completed = data.completed || false;
    }
  }

  private saveProgress(): void {
    localStorage.setItem('onboarding_progress', JSON.stringify({
      currentScreen: this.currentScreen,
      completed: this.completed,
    }));
  }

  getCurrentScreen(): number {
    return this.currentScreen;
  }

  isCompleted(): boolean {
    return this.completed;
  }

  next(): void {
    if (this.currentScreen < ONBOARDING_SCREENS.length - 1) {
      this.currentScreen++;
      this.saveProgress();
    } else {
      this.complete();
    }
  }

  skip(): void {
    this.complete();
  }

  complete(): void {
    this.completed = true;
    this.saveProgress();
  }

  reset(): void {
    this.currentScreen = 0;
    this.completed = false;
    this.saveProgress();
  }
}

export default OnboardingManager.getInstance();
