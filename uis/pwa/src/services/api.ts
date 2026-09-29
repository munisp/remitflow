/**
 * PWA API surface — barrel module (wave14).
 *
 * The former 53KB monolith was split into per-domain modules under
 * ./api/: core.ts (transport, retry, auth token, error types), types.ts
 * (shared interfaces) and one module per domain (auth, transactions,
 * wallet, rates, payments, kyc, propertyKyc, accounts, engagement,
 * settings, dashboard, ops, transfers). Everything is re-exported here so
 * existing `import ... from "../services/api"` sites are unchanged.
 *
 * Mutation retry policy note: apiRequest now defaults to 0 retries for
 * non-GET methods (duplicate-transfer safety); GET keeps 3 retries.
 */
export * from "./api/core";
export * from "./api/types";
export * from "./api/auth";
export * from "./api/transactions";
export * from "./api/wallet";
export * from "./api/rates";
export * from "./api/payments";
export * from "./api/kyc";
export * from "./api/propertyKyc";
export * from "./api/accounts";
export * from "./api/engagement";
export * from "./api/settings";
export * from "./api/dashboard";
export * from "./api/ops";
export * from "./api/transfers";

import { api } from "./api/core";
export default api;
