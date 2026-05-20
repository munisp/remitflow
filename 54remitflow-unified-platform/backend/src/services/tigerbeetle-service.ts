// tigerbeetle-service.ts - TigerBeetle Financial Ledger Integration
// Handles all revenue tracking with double-entry accounting

import { createClient } from 'tigerbeetle-node';

interface RevenueTransaction {
  id: bigint;
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  timestamp: bigint;
  userData: bigint;
}

interface Account {
  id: bigint;
  ledger: number;
  code: number;
  flags: number;
  debitsPosted: bigint;
  creditsPosted: bigint;
  debitsPending: bigint;
  creditsPending: bigint;
  timestamp: bigint;
}

class TigerBeetleService {
  private client: any;
  private ledgerId: number = 1; // Analytics ledger
  private revenueAccountId: bigint = 1000n;
  private userAccountIdStart: bigint = 10000n;

  async initialize(): Promise<void> {
    this.client = createClient({
      cluster_id: 0,
      replica_addresses: [process.env.TIGERBEETLE_ADDRESS || '127.0.0.1:3000'],
    });

    // Create revenue account if doesn't exist
    await this.createAccount(this.revenueAccountId, 'revenue');

    console.log('[TIGERBEETLE] Service initialized');
  }

  async trackRevenue(userId: string, amount: number, currency: string, transactionId: string): Promise<void> {
    const userAccountId = this.getUserAccountId(userId);

    // Create user account if doesn't exist
    await this.createAccount(userAccountId, 'user');

    // Create transfer (user -> revenue)
    const transfer: RevenueTransaction = {
      id: BigInt(transactionId.replace(/[^0-9]/g, '').slice(0, 16) || Date.now()),
      debitAccountId: userAccountId,
      creditAccountId: this.revenueAccountId,
      amount: BigInt(Math.floor(amount * 100)), // Convert to cents
      ledger: this.ledgerId,
      code: this.getCurrencyCode(currency),
      timestamp: BigInt(Date.now() * 1000), // Microseconds
      userData: 0n,
    };

    const result = await this.client.createTransfers([transfer]);

    if (result.length > 0) {
      console.error('[TIGERBEETLE] Transfer failed:', result);
      throw new Error('Revenue tracking failed');
    }

    console.log('[TIGERBEETLE] Revenue tracked:', amount, currency);
  }

  async getRevenueBalance(): Promise<number> {
    const accounts = await this.client.lookupAccounts([this.revenueAccountId]);
    
    if (accounts.length === 0) return 0;

    const account = accounts[0];
    const balance = Number(account.creditsPosted - account.debitsPosted);
    
    return balance / 100; // Convert from cents
  }

  async getUserBalance(userId: string): Promise<number> {
    const userAccountId = this.getUserAccountId(userId);
    const accounts = await this.client.lookupAccounts([userAccountId]);
    
    if (accounts.length === 0) return 0;

    const account = accounts[0];
    const balance = Number(account.debitsPosted - account.creditsPosted);
    
    return balance / 100; // Convert from cents
  }

  private async createAccount(accountId: bigint, type: string): Promise<void> {
    const account = {
      id: accountId,
      ledger: this.ledgerId,
      code: type === 'revenue' ? 1 : 2,
      flags: 0,
      debitsPosted: 0n,
      creditsPosted: 0n,
      debitsPending: 0n,
      creditsPending: 0n,
      timestamp: BigInt(Date.now() * 1000),
    };

    const result = await this.client.createAccounts([account]);

    if (result.length > 0 && result[0].result !== 'exists') {
      console.error('[TIGERBEETLE] Account creation failed:', result);
    }
  }

  private getUserAccountId(userId: string): bigint {
    // Hash user ID to account ID
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash << 5) - hash + userId.charCodeAt(i);
      hash |= 0;
    }
    return this.userAccountIdStart + BigInt(Math.abs(hash));
  }

  private getCurrencyCode(currency: string): number {
    const codes: Record<string, number> = {
      'USD': 840,
      'EUR': 978,
      'GBP': 826,
      'NGN': 566,
    };
    return codes[currency] || 999;
  }

  async shutdown(): Promise<void> {
    // TigerBeetle client doesn't need explicit shutdown
    console.log('[TIGERBEETLE] Service shutdown');
  }
}

export default new TigerBeetleService();
