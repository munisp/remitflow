/**
 * Environment Configuration
 * Defines environment variables with fallbacks
 */

const sameOrigin = typeof window !== "undefined" ? window.location.origin : "";

// Core banking and gateway endpoints must be explicitly configured outside a
// same-origin deployment. No sandbox or third-party endpoint is used by default.
export const VITE_CORE_BANKING_URL =
  import.meta.env.VITE_CORE_BANKING_URL || sameOrigin;
export const VITE_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || VITE_CORE_BANKING_URL;

// Tenant identity is provided by deployment configuration or authenticated tenant discovery.
export const VITE_TENANT_ID = import.meta.env.VITE_TENANT_ID || "";

// Feature flags are opt-in and do not activate non-production behavior by default.
export const VITE_EXPERIMENTAL_FEATURES_ENABLED = import.meta.env.VITE_EXPERIMENTAL_FEATURES_ENABLED === "true";

// Wise integration must be configured with a real provider endpoint and token.
export const WISE_API_BASE_URL = import.meta.env.VITE_WISE_API_BASE_URL || "";
export const WISE_API_TOKEN = import.meta.env.VITE_WISE_API_TOKEN || "";
