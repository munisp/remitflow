// USSDManager.ts - USSD support for feature phones
import { Capacitor } from '@capacitor/core';
import { Platform, NativeModules, Linking } from 'react-native';

interface USSDResponse {
  success: boolean;
  message: string;
  sessionId?: string;
}

const { USSDModule } = NativeModules;

export class USSDManager {
  private static instance: USSDManager;
  private ussdCode: string = '*123#'; // Bank's USSD code
  private sessionActive: boolean = false;

  private constructor() {}

  static getInstance(): USSDManager {
    if (!USSDManager.instance) {
      USSDManager.instance = new USSDManager();
    }
    return USSDManager.instance;
  }

  async dialUSSD(code: string): Promise<USSDResponse> {
    const platform = Capacitor.getPlatform();
    if (platform === 'android') {
      if (USSDModule) {
        try {
          console.log(`[USSD] Dialing via native module: ${code}`);
          const result = await USSDModule.dial(code);
          this.sessionActive = true;
          return {
            success: true,
            message: result.message || 'USSD session started',
            sessionId: result.sessionId || `ussd_${Date.now()}`
          };
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error('[USSD] Native module dial failed:', errMsg);
        }
      }

      try {
        const encodedCode = encodeURIComponent(code);
        const telUri = `tel:${encodedCode}`;
        const canOpen = await Linking.canOpenURL(telUri);
        if (canOpen) {
          await Linking.openURL(telUri);
          this.sessionActive = true;
          return {
            success: true,
            message: 'USSD dialed via system dialer',
            sessionId: `ussd_${Date.now()}`
          };
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('[USSD] System dialer fallback failed:', errMsg);
      }

      return {
        success: false,
        message: 'USSD dial failed — no native module or system dialer available'
      };
    }
    
    return {
      success: false,
      message: 'USSD not supported on this platform'
    };
  }

  async checkBalance(): Promise<USSDResponse> {
    return await this.dialUSSD(`${this.ussdCode}*1#`);
  }

  async transferMoney(recipient: string, amount: number): Promise<USSDResponse> {
    return await this.dialUSSD(`${this.ussdCode}*2*${recipient}*${amount}#`);
  }

  async buyAirtime(amount: number): Promise<USSDResponse> {
    return await this.dialUSSD(`${this.ussdCode}*3*${amount}#`);
  }

  async payBill(billerCode: string, amount: number): Promise<USSDResponse> {
    return await this.dialUSSD(`${this.ussdCode}*4*${billerCode}*${amount}#`);
  }

  isSessionActive(): boolean {
    return this.sessionActive;
  }

  endSession(): void {
    this.sessionActive = false;
    console.log('[USSD] Session ended');
  }
}
