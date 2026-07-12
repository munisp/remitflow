/**
 * Environment Configuration
 * Defines environment variables with fallbacks
 */

// Core Banking API
export const VITE_CORE_BANKING_URL =
  import.meta.env.VITE_CORE_BANKING_URL || "https://54remit.upi.dev";

// Tenant ID
export const VITE_TENANT_ID = import.meta.env.VITE_TENANT_ID || "remittance";

// API Base URL (defaults to core banking)
export const VITE_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || VITE_CORE_BANKING_URL;

// Demo Mode
export const VITE_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

// Wise API Configuration
export const WISE_API_BASE_URL = "https://api.wise-sandbox.com";
export const WISE_API_TOKEN = import.meta.env.VITE_WISE_API_TOKEN || "CHANGE_ME";
