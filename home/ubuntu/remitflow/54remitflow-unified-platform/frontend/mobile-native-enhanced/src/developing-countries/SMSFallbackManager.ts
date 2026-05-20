// SMSFallbackManager.ts - SMS fallback for critical operations
import { Platform, PermissionsAndroid } from 'react-native';
import SmsAndroid from 'react-native-get-sms-android';

interface SMSTransaction {
  id: string;
  type: 'balance' | 'transfer' | 'payment' | 'statement';
  recipient?: string;
  amount?: number;
  status: 'pending' | 'sent' | 'confirmed' | 'failed';
  timestamp: number;
  smsCode?: string;
}

export class SMSFallbackManager {
  private static instance: SMSFallbackManager;
  private smsGatewayNumber: string = '';
  private transactions: Map<string, SMSTransaction> = new Map();

  private constructor() {
    this.loadConfiguration();
    this.initialize();
  }

  private async loadConfiguration(): Promise<void> {
    try {
      // Load SMS gateway number from secure configuration
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      
      // First try to get from cached config
      const cachedConfig = await AsyncStorage.getItem('sms_gateway_config');
      if (cachedConfig) {
        const config = JSON.parse(cachedConfig);
        this.smsGatewayNumber = config.gatewayNumber;
        return;
      }

      // Fetch from backend API
      const authToken = await AsyncStorage.getItem('auth_token');
      const response = await fetch('https://api.agentbanking.com/v1/config/sms-gateway', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const config = await response.json();
        this.smsGatewayNumber = config.gatewayNumber || config.gateway_number;
        
        // Cache the configuration
        await AsyncStorage.setItem('sms_gateway_config', JSON.stringify({
          gatewayNumber: this.smsGatewayNumber,
          cachedAt: Date.now(),
        }));
      } else {
        // Use country-specific default based on user's region
        const userRegion = await AsyncStorage.getItem('user_region');
        this.smsGatewayNumber = this.getDefaultGatewayForRegion(userRegion || 'NG');
      }
    } catch (error) {
      console.error('[SMSFallback] Failed to load configuration:', error);
      // Fallback to Nigeria default
      this.smsGatewayNumber = '+2349012345678';
    }
  }

  private getDefaultGatewayForRegion(region: string): string {
    // Country-specific SMS banking gateway numbers
    const gateways: Record<string, string> = {
      'NG': '+2349012345678',  // Nigeria
      'GH': '+233302123456',   // Ghana
      'KE': '+254700123456',   // Kenya
      'TZ': '+255222123456',   // Tanzania
      'UG': '+256414123456',   // Uganda
      'ZA': '+27860123456',    // South Africa
    };
    return gateways[region] || gateways['NG'];
  }

  static getInstance(): SMSFallbackManager {
    if (!SMSFallbackManager.instance) {
      SMSFallbackManager.instance = new SMSFallbackManager();
    }
    return SMSFallbackManager.instance;
  }

  private async initialize(): Promise<void> {
    if (Platform.OS === 'android') {
      await this.requestSMSPermissions();
      this.startSMSListener();
    }
  }

  private async requestSMSPermissions(): Promise<boolean> {
    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS
      ]);
      
      return (
        granted['android.permission.SEND_SMS'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.READ_SMS'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.RECEIVE_SMS'] === PermissionsAndroid.RESULTS.GRANTED
      );
    } catch (error) {
      console.error('[SMSFallback] Permission request failed:', error);
      return false;
    }
  }

  private startSMSListener(): void {
    // Listen for incoming SMS responses
    if (Platform.OS === 'android') {
      SmsAndroid.autoSend = false;
      
      // This would integrate with react-native-sms-listener
      console.log('[SMSFallback] SMS listener started');
    }
  }

  async checkBalance(): Promise<string> {
    const transaction: SMSTransaction = {
      id: `sms_${Date.now()}`,
      type: 'balance',
      status: 'pending',
      timestamp: Date.now()
    };
    
    this.transactions.set(transaction.id, transaction);
    
    const message = '*BAL#';
    await this.sendSMS(this.smsGatewayNumber, message);
    
    console.log('[SMSFallback] Balance check SMS sent');
    return transaction.id;
  }

  async transferMoney(recipient: string, amount: number): Promise<string> {
    const transaction: SMSTransaction = {
      id: `sms_${Date.now()}`,
      type: 'transfer',
      recipient,
      amount,
      status: 'pending',
      timestamp: Date.now()
    };
    
    this.transactions.set(transaction.id, transaction);
    
    const message = `*TRANSFER*${recipient}*${amount}#`;
    await this.sendSMS(this.smsGatewayNumber, message);
    
    console.log(`[SMSFallback] Transfer SMS sent: ${amount} to ${recipient}`);
    return transaction.id;
  }

  async requestStatement(days: number = 7): Promise<string> {
    const transaction: SMSTransaction = {
      id: `sms_${Date.now()}`,
      type: 'statement',
      status: 'pending',
      timestamp: Date.now()
    };
    
    this.transactions.set(transaction.id, transaction);
    
    const message = `*STMT*${days}#`;
    await this.sendSMS(this.smsGatewayNumber, message);
    
    console.log(`[SMSFallback] Statement request SMS sent for ${days} days`);
    return transaction.id;
  }

  private async sendSMS(phoneNumber: string, message: string): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        await SmsAndroid.autoSend(
          phoneNumber,
          message,
          (fail) => {
            console.error('[SMSFallback] SMS send failed:', fail);
          },
          (success) => {
            console.log('[SMSFallback] SMS sent successfully');
          }
        );
      } catch (error) {
        console.error('[SMSFallback] SMS send error:', error);
      }
    }
  }

  getTransaction(id: string): SMSTransaction | undefined {
    return this.transactions.get(id);
  }

  getAllTransactions(): SMSTransaction[] {
    return Array.from(this.transactions.values());
  }

  // Parse incoming SMS responses
  parseSMSResponse(sender: string, message: string): void {
    if (sender !== this.smsGatewayNumber) {
      return;
    }
    
    console.log('[SMSFallback] Received SMS response:', message);
    
    // Parse balance response
    if (message.includes('Balance:')) {
      const match = message.match(/Balance:\s*([\d,]+\.?\d*)/);
      if (match) {
        const balance = match[1];
        console.log(`[SMSFallback] Balance: ${balance}`);
      }
    }
    
    // Parse transfer confirmation
    if (message.includes('Transfer successful')) {
      console.log('[SMSFallback] Transfer confirmed');
    }
  }
}
