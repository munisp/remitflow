/**
 * Get Tenant Headers Utility
 * Extracts required headers from tenant configuration for API requests
 * Based on 54link core banking pattern
 *
 * Returns headers: x-tenant-id, x-ledger-id, x-mint-id, x-mint-account-id,
 *                  x-keycloak-realm, x-keycloak-pub-key
 *
 * Note: x-keycloak-id is NOT included here - it comes from the logged-in user's
 * keycloak_id stored in localStorage after successful authentication.
 */

import type { Tenant } from "./tenantService";

// Default values - fallback when tenant config is not available
const DEFAULT_TENANT_ID = "remittance";
const DEFAULT_LEDGER_ID = "1";
const DEFAULT_MINT_ID = "1";
const DEFAULT_MINT_ACCOUNT_ID = "MINT_ACCOUNT";
const DEFAULT_KEYCLOAK_REALM = "master";
const DEFAULT_KEYCLOAK_PUB_KEY = "";

export const CURRENCIES_LEDGER_MAP: Record<string, string> = {
  NGN: "1", // NGN ledger ID
  USD: "2", // USD ledger ID
  EUR: "3", // EUR ledger ID
  GBP: "4", // GBP ledger ID
  JPY: "5", // JPY ledger ID
  AUD: "6", // AUD ledger ID
  GHS: "7", // GHS ledger ID
};

/**
 * Extract required headers from tenant config
 * This is a pure function that doesn't depend on the tenantService instance
 * to avoid circular dependencies
 */
export function getTenantHeaders(
  tenant: Tenant | null,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!tenant) {
    // Return default headers if no tenant config
    if (import.meta.env.DEV) {
      console.warn(
        "getTenantHeaders: No tenant config provided, using defaults",
      );
    }
    return {
      "x-tenant-id": DEFAULT_TENANT_ID,
      "x-ledger-id": DEFAULT_LEDGER_ID,
      "x-mint-id": DEFAULT_MINT_ID,
      "x-mint-account-id": DEFAULT_MINT_ACCOUNT_ID,
      "x-keycloak-realm": DEFAULT_KEYCLOAK_REALM,
      "x-keycloak-pub-key": DEFAULT_KEYCLOAK_PUB_KEY,
    };
  }

  // x-tenant-id from tenant.tenant_id
  headers["x-tenant-id"] = tenant.tenant_id || DEFAULT_TENANT_ID;

  // Find specific feature flags for ledger, mint, and auth config
  const ledgerFeature = tenant.feature_flags?.find(
    (flag) => flag.name === "ledger",
  );
  const mintFeature = tenant.feature_flags?.find(
    (flag) => flag.name === "mint",
  );
  const authFeature = tenant.feature_flags?.find(
    (flag) => flag.name === "auth",
  );

  // x-ledger-id from feature_flags.ledger.config.id
  if (ledgerFeature?.config?.id) {
    headers["x-ledger-id"] = String(ledgerFeature.config.id);
  } else {
    headers["x-ledger-id"] = DEFAULT_LEDGER_ID;
  }

  // x-mint-id and x-mint-account-id from feature_flags.mint.config
  if (mintFeature?.config) {
    if (mintFeature.config.id) {
      headers["x-mint-id"] = String(mintFeature.config.id);
    } else {
      headers["x-mint-id"] = DEFAULT_MINT_ID;
    }

    if (mintFeature.config.account_id) {
      headers["x-mint-account-id"] = String(mintFeature.config.account_id);
    } else {
      headers["x-mint-account-id"] = DEFAULT_MINT_ACCOUNT_ID;
    }
  } else {
    headers["x-mint-id"] = DEFAULT_MINT_ID;
    headers["x-mint-account-id"] = DEFAULT_MINT_ACCOUNT_ID;
  }

  // Keycloak headers from feature_flags.auth.config
  if (authFeature?.config) {
    if (import.meta.env.DEV) {
      console.log("getTenantHeaders: authFeature.config", authFeature.config);
    }

    // x-keycloak-realm from feature_flags.auth.config.realm
    headers["x-keycloak-realm"] = String(
      authFeature.config.realm || DEFAULT_KEYCLOAK_REALM,
    );

    // x-keycloak-pub-key from feature_flags.auth.config.public_rsa_key
    headers["x-keycloak-pub-key"] = String(
      authFeature.config.public_rsa_key || DEFAULT_KEYCLOAK_PUB_KEY,
    );

    // Note: x-keycloak-id is NOT included in tenant headers.
    // It represents the logged-in user's keycloak ID and is added
    // separately from localStorage in the API client (see api.ts)
  } else {
    headers["x-keycloak-realm"] = DEFAULT_KEYCLOAK_REALM;
    headers["x-keycloak-pub-key"] = DEFAULT_KEYCLOAK_PUB_KEY;
  }

  if (import.meta.env.DEV) {
    console.log("getTenantHeaders: Generated headers", headers);
  }

  return headers;
}

/**
 * Get tenant headers from localStorage
 * Convenience function for getting headers without direct tenant service access
 */
export function getTenantHeadersFromStorage(): Record<string, string> {
  const tenantConfigStr = localStorage.getItem("tenant_config");
  if (!tenantConfigStr) {
    if (import.meta.env.DEV) {
      console.warn(
        "getTenantHeadersFromStorage: tenant_config not found in localStorage",
      );
    }
    return getTenantHeaders(null); // Return defaults
  }

  try {
    const tenant = JSON.parse(tenantConfigStr);
    return getTenantHeaders(tenant);
  } catch (error) {
    console.error("Failed to parse tenant config:", error);
    return getTenantHeaders(null); // Return defaults
  }
}
