// HapticManager.ts - Complete Haptic Feedback System
// Production-ready implementation for iOS and Android

import { Platform } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

export enum HapticPattern {
  LIGHT = 'impactLight',
  MEDIUM = 'impactMedium',
  HEAVY = 'impactHeavy',
  SUCCESS = 'notificationSuccess',
  WARNING = 'notificationWarning',
  ERROR = 'notificationError',
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

  private constructor() {
    // Initialize haptic feedback
    this.checkHapticSupport();
  }

  static getInstance(): HapticManager {
    if (!HapticManager.instance) {
      HapticManager.instance = new HapticManager();
    }
    return HapticManager.instance;
  }

  private checkHapticSupport(): boolean {
    if (Platform.OS === 'ios') {
      // iOS 10+ supports haptics
      return true;
    } else if (Platform.OS === 'android') {
      // Android 5.0+ supports vibration
      return true;
    }
    return false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Basic Haptic Patterns
  trigger(pattern: HapticPattern): void {
    if (!this.enabled) return;

    const options = {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    };

    ReactNativeHapticFeedback.trigger(pattern, options);
  }

  // Convenience methods for basic patterns
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
    if (!this.enabled) return;

    switch (pattern) {
      case CustomHapticPattern.MONEY_SENT:
        // Double medium impact
        this.medium();
        setTimeout(() => this.medium(), 100);
        break;

      case CustomHapticPattern.MONEY_RECEIVED:
        // Triple light impact (celebratory)
        this.light();
        setTimeout(() => this.light(), 80);
        setTimeout(() => this.light(), 160);
        break;

      case CustomHapticPattern.TRANSACTION_COMPLETE:
        // Success followed by light
        this.success();
        setTimeout(() => this.light(), 150);
        break;

      case CustomHapticPattern.BIOMETRIC_SUCCESS:
        // Heavy followed by success
        this.heavy();
        setTimeout(() => this.success(), 100);
        break;

      case CustomHapticPattern.PULL_TO_REFRESH:
        // Light selection feedback
        this.selection();
        break;

      default:
        this.medium();
    }
  }

  // Transaction-specific methods
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

  // Button press feedback
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

  // Swipe feedback
  swipe(direction: 'left' | 'right' | 'up' | 'down'): void {
    this.light();
  }

  // Toggle feedback
  toggle(isOn: boolean): void {
    if (isOn) {
      this.medium();
    } else {
      this.light();
    }
  }
}

export default HapticManager.getInstance();
