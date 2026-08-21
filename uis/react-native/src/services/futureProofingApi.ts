/**
 * Future-proofing API service for React Native
 * Wraps tRPC calls for all future-proofing endpoints
 */
import { secureGet } from './secureStorage';

const API_BASE_URL = process.env.REMITFLOW_API_URL ?? 'https://remitflow.app';

async function getHeaders(): Promise<Record<string, string>> {
  // CLI-005: session token from keystore-backed storage.
  const sessionId = await secureGet('session_id');
  return {
    'Content-Type': 'application/json',
    ...(sessionId ? { Cookie: `app_session_id=${sessionId}` } : {}),
  };
}

async function trpcQuery<T>(procedure: string, input?: Record<string, unknown>): Promise<T> {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '';
  const res = await fetch(`${API_BASE_URL}/api/trpc/${procedure}${params}`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error(`API ${procedure} failed: ${res.status}`);
  const data = await res.json();
  return data?.result?.data?.json ?? data;
}

async function trpcMutate<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/trpc/${procedure}`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(`API ${procedure} failed: ${res.status}`);
  const data = await res.json();
  return data?.result?.data?.json ?? data;
}

// ── AI & Agentic ──────────────────────────────────────────────────────────────
export const parsePaymentIntent = (text: string) =>
  trpcMutate<{ intent: { action: string; amount?: number; currency?: string; recipient?: string; confidence: number } }>('futureProofing.parsePaymentIntent', { text });

export const getPredictiveTransfers = () =>
  trpcQuery<{ suggestions: Array<{ beneficiary: string; amount: number; currency: string; confidence: number }> }>('futureProofing.getPredictiveTransfers');

export const getFxForecast = (pair: string, horizon = 7) =>
  trpcQuery<{ pair: string; forecast: Array<{ date: string; rate: number }> }>('futureProofing.getFxForecast', { pair, horizon });

// ── Open Banking ──────────────────────────────────────────────────────────────
export const getConnectedAccounts = () =>
  trpcQuery<{ accounts: Array<{ bankName: string; accountNumber: string; accountType: string }> }>('futureProofing.getConnectedAccounts');

export const getSupportedBanks = () =>
  trpcQuery<{ banks: Array<{ id: string; name: string; nibssCode: string }> }>('futureProofing.getSupportedBanks');

export const initiateBankConnection = (bankId: string) =>
  trpcMutate<{ authorizationUrl: string; consentId: string }>('futureProofing.initiateBankConnection', { bankId });

// ── CBDC ──────────────────────────────────────────────────────────────────────
export const initiateENairaTransfer = (recipientWalletId: string, amount: number) =>
  trpcMutate<{ transferId: string; status: string }>('futureProofing.initiateENairaTransfer', { recipientWalletId, amount, currency: 'eNGN' });

export const bridgeCBDCToFiat = (amount: number, fromCurrency: string, toCurrency: string, destinationAccount: string) =>
  trpcMutate<{ bridgeId: string; status: string }>('futureProofing.bridgeCBDCToFiat', { amount, fromCurrency, toCurrency, destinationAccount });

// ── Compliance ────────────────────────────────────────────────────────────────
export const screenSanctions = (name: string, country?: string, dateOfBirth?: string) =>
  trpcMutate<{ screeningId: string; riskLevel: string; hits: Array<{ name: string; list: string; score: number }> }>('futureProofing.screenSanctions', { name, ...(country ? { country } : {}), ...(dateOfBirth ? { dateOfBirth } : {}) });

export const submitDSAR = (requestType: string, details: string) =>
  trpcMutate<{ requestId: string; status: string }>('futureProofing.submitDSAR', { requestType, details });

// ── Payment Rails ─────────────────────────────────────────────────────────────
export const submitFedNowTransfer = (amount: number, routingNumber: string, accountNumber: string, creditorName: string) =>
  trpcMutate<{ transactionId: string; endToEndId: string; status: string }>('futureProofing.submitFedNowTransfer', { amount, routingNumber, accountNumber, creditorName });

export const orchestratePayment = (amount: number, currency: string, corridor: string, destinationType: string) =>
  trpcMutate<{ selectedRail: string; estimatedFee: number; estimatedTime: string }>('futureProofing.orchestratePayment', { amount, currency, corridor, destinationType });

// ── Security ──────────────────────────────────────────────────────────────────
export const submitBiometricSample = (typingPattern: number[], touchPressure: number, deviceMotion: Record<string, number>) =>
  trpcMutate<{ fingerprintId: string; riskScore: number }>('futureProofing.submitBiometricSample', { typingPattern, touchPressure, deviceMotion });

// ── Business Model ────────────────────────────────────────────────────────────
export const getDynamicPricing = (amount: number, corridor: string, paymentMethod: string) =>
  trpcQuery<{ fee: number; feePercentage: number; exchangeRate: number }>('futureProofing.getDynamicPricing', { amount, corridor, paymentMethod });

export const getSubscriptionTiers = () =>
  trpcQuery<{ tiers: Array<{ id: string; name: string; price: number; features: string[] }>; currentTierId?: string }>('futureProofing.getSubscriptionTiers');

export const subscribeTier = (tierId: string) =>
  trpcMutate<{ success: boolean; subscriptionId: string }>('futureProofing.subscribeTier', { tierId });

// ── Middleware Health ─────────────────────────────────────────────────────────
export const getMiddlewareHealth = () =>
  trpcQuery<Record<string, { status: string; latencyMs: number }>>('futureProofing.getMiddlewareHealth');
