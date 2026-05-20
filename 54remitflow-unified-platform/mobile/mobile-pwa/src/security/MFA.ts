// MFA.ts - Multi-Factor Authentication System
import * as OTPAuth from 'otpauth';
import localforage from 'localforage';

interface MFAMethod {
  type: 'totp' | 'sms' | 'email' | 'push' | 'hardware_key' | 'backup_code';
  enabled: boolean;
  verified: boolean;
  lastUsed?: number;
}

interface TOTPSetup {
  secret: string;
  qrCode: string;
  backupCodes: string[];
}

interface MFAVerification {
  success: boolean;
  method: string;
  timestamp: number;
}

class MFA {
  private static instance: MFA;
  private methods: Map<string, MFAMethod> = new Map();
  private totpSecret: string | null = null;
  private backupCodes: Set<string> = new Set();

  static getInstance(): MFA {
    if (!MFA.instance) {
      MFA.instance = new MFA();
    }
    return MFA.instance;
  }

  async initialize(): Promise<void> {
    await this.loadMFAMethods();
    await this.loadBackupCodes();
  }

  async setupTOTP(userId: string): Promise<TOTPSetup> {
    const secret = this.generateSecret();
    const totp = new OTPAuth.TOTP({
      issuer: 'Remittance Platform',
      label: userId,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const qrCode = totp.toString();
    const backupCodes = this.generateBackupCodes();

    this.totpSecret = secret;
    this.backupCodes = new Set(backupCodes);

    await this.saveTOTPSecret(secret);
    await this.saveBackupCodes(backupCodes);

    return {
      secret,
      qrCode,
      backupCodes,
    };
  }

  async verifyTOTP(code: string): Promise<MFAVerification> {
    if (!this.totpSecret) {
      return {
        success: false,
        method: 'totp',
        timestamp: Date.now(),
      };
    }

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(this.totpSecret),
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: code, window: 1 });
    const success = delta !== null;

    if (success) {
      await this.updateMethodLastUsed('totp');
    }

    return {
      success,
      method: 'totp',
      timestamp: Date.now(),
    };
  }

  async sendSMSOTP(phoneNumber: string): Promise<boolean> {
    const code = this.generateOTP();
    
    try {
      await fetch('https://api.remittance-platform.com/mfa/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, code }),
      });

      await localforage.setItem('sms_otp', code);
      await localforage.setItem('sms_otp_expiry', (Date.now() + 300000).toString());
      
      return true;
    } catch (error) {
      console.error('Failed to send SMS OTP:', error);
      return false;
    }
  }

  async verifySMSOTP(code: string): Promise<MFAVerification> {
    const storedCode = await localforage.getItem('sms_otp');
    const expiry = await localforage.getItem('sms_otp_expiry');

    if (!storedCode || !expiry) {
      return {
        success: false,
        method: 'sms',
        timestamp: Date.now(),
      };
    }

    const isExpired = Date.now() > parseInt(expiry);
    const isValid = storedCode === code && !isExpired;

    if (isValid) {
      await localforage.removeItem('sms_otp');
      await localforage.removeItem('sms_otp_expiry');
      await this.updateMethodLastUsed('sms');
    }

    return {
      success: isValid,
      method: 'sms',
      timestamp: Date.now(),
    };
  }

  async sendEmailOTP(email: string): Promise<boolean> {
    const code = this.generateOTP();
    
    try {
      await fetch('https://api.remittance-platform.com/mfa/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });

      await localforage.setItem('email_otp', code);
      await localforage.setItem('email_otp_expiry', (Date.now() + 600000).toString());
      
      return true;
    } catch (error) {
      console.error('Failed to send email OTP:', error);
      return false;
    }
  }

  async verifyEmailOTP(code: string): Promise<MFAVerification> {
    const storedCode = await localforage.getItem('email_otp');
    const expiry = await localforage.getItem('email_otp_expiry');

    if (!storedCode || !expiry) {
      return {
        success: false,
        method: 'email',
        timestamp: Date.now(),
      };
    }

    const isExpired = Date.now() > parseInt(expiry);
    const isValid = storedCode === code && !isExpired;

    if (isValid) {
      await localforage.removeItem('email_otp');
      await localforage.removeItem('email_otp_expiry');
      await this.updateMethodLastUsed('email');
    }

    return {
      success: isValid,
      method: 'email',
      timestamp: Date.now(),
    };
  }

  async verifyBackupCode(code: string): Promise<MFAVerification> {
    const isValid = this.backupCodes.has(code);

    if (isValid) {
      this.backupCodes.delete(code);
      await this.saveBackupCodes(Array.from(this.backupCodes));
    }

    return {
      success: isValid,
      method: 'backup_code',
      timestamp: Date.now(),
    };
  }

  private generateSecret(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secret = '';
    for (let i = 0; i < 32; i++) {
      secret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return secret;
  }

  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push(this.generateBackupCode());
    }
    return codes;
  }

  private generateBackupCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
      if (i === 3) code += '-';
    }
    return code;
  }

  private async loadMFAMethods(): Promise<void> {
    const stored = await localforage.getItem('mfa_methods');
    if (stored) {
      const methods = JSON.parse(stored);
      this.methods = new Map(Object.entries(methods));
    }
  }

  private async saveTOTPSecret(secret: string): Promise<void> {
    await localforage.setItem('totp_secret', secret);
  }

  private async loadBackupCodes(): Promise<void> {
    const stored = await localforage.getItem('backup_codes');
    if (stored) {
      this.backupCodes = new Set(JSON.parse(stored));
    }
  }

  private async saveBackupCodes(codes: string[]): Promise<void> {
    await localforage.setItem('backup_codes', JSON.stringify(codes));
  }

  private async updateMethodLastUsed(method: string): Promise<void> {
    const mfaMethod = this.methods.get(method);
    if (mfaMethod) {
      mfaMethod.lastUsed = Date.now();
      this.methods.set(method, mfaMethod);
      await this.saveMFAMethods();
    }
  }

  private async saveMFAMethods(): Promise<void> {
    const methods = Object.fromEntries(this.methods);
    await localforage.setItem('mfa_methods', JSON.stringify(methods));
  }

  getMethods(): MFAMethod[] {
    return Array.from(this.methods.values());
  }

  async enableMethod(type: MFAMethod['type']): Promise<void> {
    this.methods.set(type, {
      type,
      enabled: true,
      verified: false,
    });
    await this.saveMFAMethods();
  }

  async disableMethod(type: MFAMethod['type']): Promise<void> {
    this.methods.delete(type);
    await this.saveMFAMethods();
  }
}

export default MFA.getInstance();
