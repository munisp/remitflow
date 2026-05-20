/**
 * Test Data Generators
 * 
 * Provides test data for various scenarios
 */

export const TEST_USERS = {
  VALID: {
    email: 'test@example.com',
    password: 'SecurePassword123!',
  },
  INVALID: {
    email: 'invalid@example.com',
    password: 'WrongPassword123!',
  },
  WITH_2FA: {
    email: '2fa@example.com',
    password: 'SecurePassword123!',
    code: '123456',
  },
  UNVERIFIED: {
    email: 'unverified@example.com',
    password: 'SecurePassword123!',
  },
};

export const NIGERIAN_BANKS = [
  { name: 'Access Bank', code: '044' },
  { name: 'GTBank', code: '058' },
  { name: 'Zenith Bank', code: '057' },
  { name: 'First Bank', code: '011' },
  { name: 'UBA', code: '033' },
  { name: 'Ecobank', code: '050' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'FCMB', code: '214' },
  { name: 'Stanbic IBTC', code: '221' },
  { name: 'Sterling Bank', code: '232' },
];

export const TRANSACTION_PURPOSES = [
  'family_support',
  'education',
  'medical',
  'business',
  'savings',
  'investment',
  'gift',
  'other',
];

export const PAYMENT_METHODS = [
  'wallet',
  'card',
  'bank_transfer',
  'enaira',
];

export const KYC_TIERS = {
  TIER_1: {
    dailyLimit: 50000,
    monthlyLimit: 200000,
    requiresBVN: false,
    requiresAddress: false,
  },
  TIER_2: {
    dailyLimit: 200000,
    monthlyLimit: 1000000,
    requiresBVN: true,
    requiresAddress: false,
  },
  TIER_3: {
    dailyLimit: 5000000,
    monthlyLimit: 20000000,
    requiresBVN: true,
    requiresAddress: true,
  },
};

export const SAMPLE_TRANSACTIONS = [
  {
    id: 'TXN-001',
    amount: 10000,
    recipient: 'John Doe',
    status: 'completed',
    date: '2025-11-01',
  },
  {
    id: 'TXN-002',
    amount: 25000,
    recipient: 'Jane Smith',
    status: 'pending',
    date: '2025-11-02',
  },
  {
    id: 'TXN-003',
    amount: 50000,
    recipient: 'Bob Johnson',
    status: 'failed',
    date: '2025-11-02',
  },
];
