// security-manager.ts - Hybrid Security Implementation
// Capacitor-based security features

import { Device } from '@capacitor/device';
import { Preferences } from '@capacitor/preferences';

interface SecurityConfig {
  deviceBinding: boolean;
  sessionTimeout: number;
  biometricAuth: boolean;
}

class SecurityManager {
  private static instance: SecurityManager;
  private config: SecurityConfig;

  static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  private constructor() {
    this.config = {
      deviceBinding: true,
      sessionTimeout: 15,
      biometricAuth: true,
    };
  }

  async initialize(): Promise<void> {
    await this.checkDeviceIntegrity();
    this.startSessionTimeout();
  }

  private async checkDeviceIntegrity(): Promise<void> {
    const info = await Device.getInfo();
    console.log('[SECURITY] Device info:', info);

    if (info.isVirtual) {
      console.warn('[SECURITY] Running on emulator');
    }
  }

  private startSessionTimeout(): void {
    setTimeout(() => {
      this.handleSessionTimeout();
    }, this.config.sessionTimeout * 60 * 1000);
  }

  private handleSessionTimeout(): void {
    console.log('[SECURITY] Session timeout');
  }

  async getDeviceFingerprint(): Promise<string> {
    const info = await Device.getInfo();
    const id = await Device.getId();
    
    return `${info.model}-${info.manufacturer}-${id.identifier}`;
  }

  async calculateSecurityScore(): Promise<number> {
    let score = 100;

    const info = await Device.getInfo();
    if (info.isVirtual) score -= 30;

    return Math.max(0, score);
  }
}

export default SecurityManager.getInstance();
