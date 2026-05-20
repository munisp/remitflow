/**
 * Example: Integrating TigerBeetle Resilient Client
 * 
 * This file demonstrates how to replace the standard TigerBeetle client
 * with the resilient client in your application.
 * 
 * @module ExampleIntegration
 * @version 1.0.0
 */

import { createResilientClient, ResilientClientConfig } from './tigerbeetle-resilient-client';

// ============================================================================
// CONFIGURATION
// ============================================================================

const config: Partial<ResilientClientConfig> = {
  // TigerBeetle cluster configuration
  clusterId: 0n,
  replicaAddresses: [
    process.env.TIGERBEETLE_REPLICA_1 || '127.0.0.1:3000',
    process.env.TIGERBEETLE_REPLICA_2 || '127.0.0.1:3001',
    process.env.TIGERBEETLE_REPLICA_3 || '127.0.0.1:3002'
  ],

  // Retry configuration (tune based on your environment)
  retry: {
    maxAttempts: parseInt(process.env.TIGERBEETLE_MAX_RETRIES || '5'),
    initialDelayMs: parseInt(process.env.TIGERBEETLE_INITIAL_DELAY || '100'),
    maxDelayMs: parseInt(process.env.TIGERBEETLE_MAX_DELAY || '10000'),
    backoffMultiplier: parseFloat(process.env.TIGERBEETLE_BACKOFF_MULTIPLIER || '2'),
    jitter: process.env.TIGERBEETLE_JITTER !== 'false',
    timeoutMs: parseInt(process.env.TIGERBEETLE_TIMEOUT || '5000')
  },

  // Circuit breaker configuration
  circuitBreaker: {
    failureThreshold: parseInt(process.env.TIGERBEETLE_FAILURE_THRESHOLD || '5'),
    resetTimeoutMs: parseInt(process.env.TIGERBEETLE_RESET_TIMEOUT || '30000'),
    successThreshold: parseInt(process.env.TIGERBEETLE_SUCCESS_THRESHOLD || '3'),
    windowMs: parseInt(process.env.TIGERBEETLE_WINDOW || '60000')
  },

  // Enable logging in development, disable in production
  enableLogging: process.env.NODE_ENV !== 'production'
};

// ============================================================================
// CREATE CLIENT INSTANCE
// ============================================================================

// Singleton pattern - create once, reuse everywhere
let clientInstance: ReturnType<typeof createResilientClient> | null = null;

export function getTigerBeetleClient() {
  if (!clientInstance) {
    clientInstance = createResilientClient(config);
    console.log('TigerBeetle Resilient Client initialized');
  }
  return clientInstance;
}

// ============================================================================
// EXAMPLE USAGE: CREATE ACCOUNTS
// ============================================================================

export async function createBankAccount(userId: string, initialBalance: bigint) {
  const client = getTigerBeetleClient();

  const accounts = [
    {
      id: BigInt(userId),
      debits_pending: 0n,
      debits_posted: 0n,
      credits_pending: 0n,
      credits_posted: initialBalance,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      reserved: 0,
      ledger: 1,
      code: 1,
      flags: 0,
      timestamp: 0n
    }
  ];

  const result = await client.createAccounts(accounts);

  if (result.success) {
    console.log(`Account created for user ${userId}`);
    console.log(`Attempts: ${result.attempts}, Duration: ${result.durationMs}ms`);
    return { success: true, accountId: userId };
  } else {
    console.error(`Failed to create account for user ${userId}`);
    console.error(`Error: ${result.error?.message}`);
    console.error(`Attempts: ${result.attempts}, Circuit State: ${result.circuitState}`);
    
    // Handle circuit breaker state
    if (result.circuitState === 'OPEN') {
      // Service is down, maybe queue for later processing
      console.error('TigerBeetle service is unavailable, queueing for retry');
      // await queueAccountCreation(userId, initialBalance);
    }
    
    return { success: false, error: result.error?.message };
  }
}

// ============================================================================
// EXAMPLE USAGE: CREATE TRANSFERS
// ============================================================================

export async function transferFunds(
  fromAccountId: string,
  toAccountId: string,
  amount: bigint,
  transferId: string
) {
  const client = getTigerBeetleClient();

  const transfers = [
    {
      id: BigInt(transferId),
      debit_account_id: BigInt(fromAccountId),
      credit_account_id: BigInt(toAccountId),
      amount: amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 1,
      code: 1,
      flags: 0,
      timestamp: 0n
    }
  ];

  const result = await client.createTransfers(transfers);

  if (result.success) {
    console.log(`Transfer ${transferId} completed successfully`);
    console.log(`From: ${fromAccountId}, To: ${toAccountId}, Amount: ${amount}`);
    console.log(`Attempts: ${result.attempts}, Duration: ${result.durationMs}ms`);
    return { success: true, transferId };
  } else {
    console.error(`Transfer ${transferId} failed`);
    console.error(`Error: ${result.error?.message}`);
    console.error(`Circuit State: ${result.circuitState}`);
    
    return { success: false, error: result.error?.message };
  }
}

// ============================================================================
// EXAMPLE USAGE: LOOKUP ACCOUNTS
// ============================================================================

export async function getAccountBalance(accountId: string) {
  const client = getTigerBeetleClient();

  const result = await client.lookupAccounts([BigInt(accountId)]);

  if (result.success && result.data && result.data.length > 0) {
    const account = result.data[0];
    const balance = account.credits_posted - account.debits_posted;
    
    console.log(`Account ${accountId} balance: ${balance}`);
    return { success: true, balance };
  } else {
    console.error(`Failed to lookup account ${accountId}`);
    return { success: false, error: result.error?.message };
  }
}

// ============================================================================
// MONITORING: GET METRICS
// ============================================================================

export function getCircuitBreakerMetrics() {
  const client = getTigerBeetleClient();
  const metrics = client.getMetrics();

  console.log('Circuit Breaker Metrics:');
  console.log(`  State: ${metrics.state}`);
  console.log(`  Total Requests: ${metrics.totalRequests}`);
  console.log(`  Total Successes: ${metrics.totalSuccesses}`);
  console.log(`  Total Failures: ${metrics.totalFailures}`);
  console.log(`  Success Rate: ${(metrics.totalSuccesses / metrics.totalRequests * 100).toFixed(2)}%`);
  console.log(`  Current Failure Count: ${metrics.failureCount}`);

  return metrics;
}

// ============================================================================
// CLEANUP: CLOSE CLIENT
// ============================================================================

export async function closeTigerBeetleClient() {
  if (clientInstance) {
    await clientInstance.close();
    clientInstance = null;
    console.log('TigerBeetle Resilient Client closed');
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing TigerBeetle client...');
  await closeTigerBeetleClient();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing TigerBeetle client...');
  await closeTigerBeetleClient();
  process.exit(0);
});

// ============================================================================
// EXAMPLE: BATCH OPERATIONS
// ============================================================================

export async function batchCreateAccounts(userIds: string[], initialBalance: bigint) {
  const client = getTigerBeetleClient();

  const accounts = userIds.map(userId => ({
    id: BigInt(userId),
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: initialBalance,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: 1,
    code: 1,
    flags: 0,
    timestamp: 0n
  }));

  const result = await client.createAccounts(accounts);

  if (result.success) {
    console.log(`Created ${userIds.length} accounts successfully`);
    return { success: true, count: userIds.length };
  } else {
    console.error(`Batch account creation failed: ${result.error?.message}`);
    return { success: false, error: result.error?.message };
  }
}

// ============================================================================
// EXAMPLE: ERROR HANDLING WITH RETRY LOGIC
// ============================================================================

export async function transferWithRetryHandling(
  fromAccountId: string,
  toAccountId: string,
  amount: bigint,
  transferId: string
) {
  const client = getTigerBeetleClient();

  const transfers = [
    {
      id: BigInt(transferId),
      debit_account_id: BigInt(fromAccountId),
      credit_account_id: BigInt(toAccountId),
      amount: amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 1,
      code: 1,
      flags: 0,
      timestamp: 0n
    }
  ];

  const result = await client.createTransfers(transfers);

  // Detailed error handling based on result
  if (result.success) {
    return {
      success: true,
      transferId,
      attempts: result.attempts,
      durationMs: result.durationMs
    };
  }

  // Check if it was a single attempt failure (non-retryable error)
  if (result.attempts === 1) {
    console.error('Non-retryable error (e.g., insufficient funds, invalid account)');
    return {
      success: false,
      error: 'INVALID_REQUEST',
      message: result.error?.message
    };
  }

  // Check circuit breaker state
  if (result.circuitState === 'OPEN') {
    console.error('Service unavailable (circuit breaker open)');
    return {
      success: false,
      error: 'SERVICE_UNAVAILABLE',
      message: 'TigerBeetle service is temporarily unavailable'
    };
  }

  // All retries exhausted
  console.error(`Transfer failed after ${result.attempts} attempts`);
  return {
    success: false,
    error: 'TRANSFER_FAILED',
    message: result.error?.message,
    attempts: result.attempts
  };
}

