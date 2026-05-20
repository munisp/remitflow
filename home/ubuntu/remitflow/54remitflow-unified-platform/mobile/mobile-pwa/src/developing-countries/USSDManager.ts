// USSDManager.ts - USSD support for feature phones (PWA variant)

interface USSDResponse {
  success: boolean;
  message: string;
  sessionId?: string;
}

function getPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  return 'web';
}

export class USSDManager {
  private static instance: USSDManager;
  private ussdCode: string = '*123#';
  private sessionActive: boolean = false;

  private constructor() {}

  static getInstance(): USSDManager {
    if (!USSDManager.instance) {
      USSDManager.instance = new USSDManager();
    }
    return USSDManager.instance;
  }

  async dialUSSD(code: string): Promise<USSDResponse> {
    const platform = getPlatform();
    if (platform === 'android' || platform === 'ios') {
      try {
        const encodedCode = encodeURIComponent(code);
        const telUri = `tel:${encodedCode}`;
        window.location.href = telUri;
        this.sessionActive = true;
        return {
          success: true,
          message: 'USSD dialed via system dialer',
          sessionId: `ussd_${Date.now()}`
        };
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('[USSD] System dialer failed:', errMsg);
        return {
          success: false,
          message: 'USSD dial failed'
        };
      }
    }
    
    return {
      success: false,
      message: 'USSD not supported on desktop web'
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
