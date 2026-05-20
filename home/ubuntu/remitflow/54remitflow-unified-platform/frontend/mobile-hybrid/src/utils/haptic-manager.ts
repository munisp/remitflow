// haptic-manager.ts - Hybrid Haptic Feedback using Capacitor
// Production-ready implementation for iOS, Android, and Web

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

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

  private constructor() {}

  static getInstance(): HapticManager {
    if (!HapticManager.instance) {
      HapticManager.instance = new HapticManager();
    }
    return HapticManager.instance;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Basic Haptic Patterns
  async trigger(pattern: HapticPattern): Promise<void> {
    if (!this.enabled) return;

    try {
      switch (pattern) {
        case HapticPattern.LIGHT:
          await Haptics.impact({ style: ImpactStyle.Light });
          break;
        case HapticPattern.MEDIUM:
          await Haptics.impact({ style: ImpactStyle.Medium });
          break;
        case HapticPattern.HEAVY:
          await Haptics.impact({ style: ImpactStyle.Heavy });
          break;
        case HapticPattern.SUCCESS:
          await Haptics.notification({ type: NotificationType.Success });
          break;
        case HapticPattern.WARNING:
          await Haptics.notification({ type: NotificationType.Warning });
          break;
        case HapticPattern.ERROR:
          await Haptics.notification({ type: NotificationType.Error });
          break;
        case HapticPattern.SELECTION:
          await Haptics.selectionStart();
          await Haptics.selectionChanged();
          await Haptics.selectionEnd();
          break;
      }
    } catch (error) {
      console.warn('Haptic feedback not supported:', error);
    }
  }

  // Convenience methods
  async light(): Promise<void> {
    await this.trigger(HapticPattern.LIGHT);
  }

  async medium(): Promise<void> {
    await this.trigger(HapticPattern.MEDIUM);
  }

  async heavy(): Promise<void> {
    await this.trigger(HapticPattern.HEAVY);
  }

  async success(): Promise<void> {
    await this.trigger(HapticPattern.SUCCESS);
  }

  async warning(): Promise<void> {
    await this.trigger(HapticPattern.WARNING);
  }

  async error(): Promise<void> {
    await this.trigger(HapticPattern.ERROR);
  }

  async selection(): Promise<void> {
    await this.trigger(HapticPattern.SELECTION);
  }

  // Custom Transaction Haptics
  async triggerCustom(pattern: CustomHapticPattern): Promise<void> {
    if (!this.enabled) return;

    switch (pattern) {
      case CustomHapticPattern.MONEY_SENT:
        await this.medium();
        setTimeout(async () => await this.medium(), 100);
        break;

      case CustomHapticPattern.MONEY_RECEIVED:
        await this.light();
        setTimeout(async () => await this.light(), 80);
        setTimeout(async () => await this.light(), 160);
        break;

      case CustomHapticPattern.TRANSACTION_COMPLETE:
        await this.success();
        setTimeout(async () => await this.light(), 150);
        break;

      case CustomHapticPattern.BIOMETRIC_SUCCESS:
        await this.heavy();
        setTimeout(async () => await this.success(), 100);
        break;

      case CustomHapticPattern.PULL_TO_REFRESH:
        await this.selection();
        break;
    }
  }

  async moneySent(): Promise<void> {
    await this.triggerCustom(CustomHapticPattern.MONEY_SENT);
  }

  async moneyReceived(): Promise<void> {
    await this.triggerCustom(CustomHapticPattern.MONEY_RECEIVED);
  }

  async transactionComplete(): Promise<void> {
    await this.triggerCustom(CustomHapticPattern.TRANSACTION_COMPLETE);
  }

  async biometricSuccess(): Promise<void> {
    await this.triggerCustom(CustomHapticPattern.BIOMETRIC_SUCCESS);
  }

  async pullToRefresh(): Promise<void> {
    await this.triggerCustom(CustomHapticPattern.PULL_TO_REFRESH);
  }

  async buttonPress(type: 'primary' | 'secondary' | 'destructive' = 'primary'): Promise<void> {
    switch (type) {
      case 'primary':
        await this.medium();
        break;
      case 'secondary':
        await this.light();
        break;
      case 'destructive':
        await this.heavy();
        break;
    }
  }
}

export default HapticManager.getInstance();
