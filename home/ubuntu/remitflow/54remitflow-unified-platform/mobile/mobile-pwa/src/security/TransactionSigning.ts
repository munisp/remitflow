// TransactionSigning.ts - Biometric Transaction Confirmation
import * as LocalAuthentication from 'biometrics';
import SecureEnclave from './SecureEnclave';
import ApiClient from '../services/ApiClient';

interface Transaction {
  id: string;
  type: 'payment' | 'wire' | 'trade' | 'account_change' | 'beneficiary';
  amount?: number;
  recipient?: string;
  description: string;
}

interface SigningResult {
  signed: boolean;
  signature?: string;
  timestamp: number;
  biometricType?: string;
}

class TransactionSigning {
  private static instance: TransactionSigning;
  private biometricsAvailable: boolean = false;

  static getInstance(): TransactionSigning {
    if (!TransactionSigning.instance) {
      TransactionSigning.instance = new TransactionSigning();
    }
    return TransactionSigning.instance;
  }

  async initialize(): Promise<void> {
    const { available } = await LocalAuthentication.isSensorAvailable();
    this.biometricsAvailable = available;
  }

  async signTransaction(transaction: Transaction): Promise<SigningResult> {
    // Check if transaction requires biometric signing
    if (!this.requiresBiometricSigning(transaction)) {
      return {
        signed: true,
        timestamp: Date.now(),
      };
    }

    if (!this.biometricsAvailable) {
      throw new Error('Biometric authentication not available');
    }

    try {
      const result = await LocalAuthentication.simplePrompt({
        promptMessage: `Confirm ${transaction.type}`,
        cancelButtonText: 'Cancel',
      });

      if (result.success) {
        const signature = await this.generateSignature(transaction);
        
        await this.logSignedTransaction(transaction, signature);

        return {
          signed: true,
          signature,
          timestamp: Date.now(),
          biometricType: result.biometryType,
        };
      }

      return {
        signed: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[TRANSACTION SIGNING] Failed:', error);
      throw error;
    }
  }

  private requiresBiometricSigning(transaction: Transaction): boolean {
    // Payments over $100
    if (transaction.type === 'payment' && transaction.amount && transaction.amount > 100) {
      return true;
    }

    // All wire transfers
    if (transaction.type === 'wire') {
      return true;
    }

    // All trades
    if (transaction.type === 'trade') {
      return true;
    }

    // Account changes
    if (transaction.type === 'account_change') {
      return true;
    }

    // Beneficiary additions
    if (transaction.type === 'beneficiary') {
      return true;
    }

    return false;
  }

  private async generateSignature(transaction: Transaction): Promise<string> {
    const data = JSON.stringify({
      ...transaction,
      timestamp: Date.now(),
    });

    const signingKey = await SecureEnclave.getOrCreateKey('txn_signing_key');
    const keyBytes = new TextEncoder().encode(signingKey);
    const dataBytes = new TextEncoder().encode(data);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return `sig_hmac256_${signatureHex}_${Date.now()}`;
  }

  private async logSignedTransaction(transaction: Transaction, signature: string): Promise<void> {
    console.log('[TRANSACTION SIGNED]', {
      transactionId: transaction.id,
      signature,
      timestamp: Date.now(),
    });

    try {
      await ApiClient.post('/transactions/signed', {
        transactionId: transaction.id,
        signature,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to log signed transaction:', error);
    }
  }

  async verifySignature(transactionId: string, signature: string): Promise<boolean> {
    if (!signature.startsWith('sig_hmac256_') || signature.length < 40) {
      return false;
    }

    try {
      const response = await ApiClient.post<{ valid: boolean }>('/transactions/verify-signature', {
        transactionId,
        signature,
      });
      return response.data.valid;
    } catch {
      return false;
    }
  }
}

export default TransactionSigning.getInstance();
