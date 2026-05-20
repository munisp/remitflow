// haptic-manager.ts - PWA Haptic Feedback using Vibration API
// Production-ready implementation for web browsers

export enum HapticPattern {
  LIGHT = 'light',
  MEDIUM = 'medium',
  HEAVY = 'heavy',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
  SELECTION = 'selection',
}

export enum CustomHapticPattern {
  MONEY_SENT = 'money_sent',
  MONEY_RECEIVED = 'money_received',
  TRANSACTION_COMPLETE = 'transaction_complete',
  BIOMETRIC_SUCCESS = 'biometric_success',
  PULL_TO_REFRESH = 'pull_to_refresh',
}

class HapticManager {
  private static instance: HapticManager;
  private enabled: boolean = true;
  private supported: boolean = false;

  private constructor() {
    this.checkSupport();
  }

  static getInstance(): HapticManager {
    if (!HapticManager.instance) {
      HapticManager.instance = new HapticManager();
    }
    return HapticManager.instance;
  }

  private checkSupport(): void {
    this.supported = 'vibrate' in navigator;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled && this.supported;
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.isEnabled()) return;
    navigator.vibrate(pattern);
  }

  // Basic Haptic Patterns
  trigger(pattern: HapticPattern): void {
    switch (pattern) {
      case HapticPattern.LIGHT:
        this.vibrate(10);
        break;
      case HapticPattern.MEDIUM:
        this.vibrate(20);
        break;
      case HapticPattern.HEAVY:
        this.vibrate(40);
        break;
      case HapticPattern.SUCCESS:
        this.vibrate([10, 50, 10]);
        break;
      case HapticPattern.WARNING:
        this.vibrate([20, 50, 20]);
        break;
      case HapticPattern.ERROR:
        this.vibrate([40, 50, 40]);
        break;
      case HapticPattern.SELECTION:
        this.vibrate(5);
        break;
    }
  }

  // Convenience methods
  light(): void {
    this.trigger(HapticPattern.LIGHT);
  }

  medium(): void {
    this.trigger(HapticPattern.MEDIUM);
  }

  heavy(): void {
    this.trigger(HapticPattern.HEAVY);
  }

  success(): void {
    this.trigger(HapticPattern.SUCCESS);
  }

  warning(): void {
    this.trigger(HapticPattern.WARNING);
  }

  error(): void {
    this.trigger(HapticPattern.ERROR);
  }

  selection(): void {
    this.trigger(HapticPattern.SELECTION);
  }

  // Custom Transaction Haptics
  triggerCustom(pattern: CustomHapticPattern): void {
    switch (pattern) {
      case CustomHapticPattern.MONEY_SENT:
        this.vibrate([20, 100, 20]);
        break;
      case CustomHapticPattern.MONEY_RECEIVED:
        this.vibrate([10, 80, 10, 80, 10]);
        break;
      case CustomHapticPattern.TRANSACTION_COMPLETE:
        this.vibrate([10, 50, 10, 150, 10]);
        break;
      case CustomHapticPattern.BIOMETRIC_SUCCESS:
        this.vibrate([40, 100, 10, 50, 10]);
        break;
      case CustomHapticPattern.PULL_TO_REFRESH:
        this.vibrate(5);
        break;
    }
  }

  moneySent(): void {
    this.triggerCustom(CustomHapticPattern.MONEY_SENT);
  }

  moneyReceived(): void {
    this.triggerCustom(CustomHapticPattern.MONEY_RECEIVED);
  }

  transactionComplete(): void {
    this.triggerCustom(CustomHapticPattern.TRANSACTION_COMPLETE);
  }

  biometricSuccess(): void {
    this.triggerCustom(CustomHapticPattern.BIOMETRIC_SUCCESS);
  }

  pullToRefresh(): void {
    this.triggerCustom(CustomHapticPattern.PULL_TO_REFRESH);
  }

  buttonPress(type: 'primary' | 'secondary' | 'destructive' = 'primary'): void {
    switch (type) {
      case 'primary':
        this.medium();
        break;
      case 'secondary':
        this.light();
        break;
      case 'destructive':
        this.heavy();
        break;
    }
  }
}

export default HapticManager.getInstance();
