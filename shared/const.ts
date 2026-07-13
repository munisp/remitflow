// ─── Auth & Session ───────────────────────────────────────────────────────────
export const COOKIE_NAME = "app_session_id";
export const SESSION_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7; // 7 days (OWASP A07)
export const ONE_YEAR_MS = SESSION_EXPIRY_MS; // alias kept for backward compat — actually 7 days
export const IMPERSONATION_EXPIRY_MS = 1000 * 60 * 15; // 15 minutes
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// ─── App Identity ─────────────────────────────────────────────────────────────
export const APP_NAME = "RemitFlow";
export const APP_VERSION = "52.0.0";
export const APP_SUPPORT_EMAIL = "support@remitflow.com";
export const APP_COMPLIANCE_EMAIL = "compliance@remitflow.com";
export const APP_LEGAL_EMAIL = "legal@remitflow.com";

// ─── Microservice Ports & URLs ────────────────────────────────────────────────
// NOTE: These URLs are server-side only. Do NOT use SERVICES in browser/client code.
export const SERVICES = {
  FX_ENGINE:            "http://localhost:8081",
  FRAUD_ML:             "http://localhost:8082",
  AML_ENGINE:           "http://localhost:8083",
  COMMUNITY_FEED:       "http://localhost:8084",
  SHARE_LINK:           "http://localhost:8085",
  NAV_ANALYTICS:        "http://localhost:8086",
  INVESTMENT_FEED:      "http://localhost:8087",
  PORTFOLIO_CALC:       "http://localhost:8088",
  INVESTMENT_ML:        "http://localhost:8089",
  KYC_SERVICE:          "http://localhost:8090",
} as const;

// ─── Transfer Business Rules ──────────────────────────────────────────────────
export const TRANSFER = {
  MIN_AMOUNT_USD:        0.50,
  MAX_AMOUNT_USD:        50_000,
  MAX_DAILY_LIMIT_USD:   10_000,
  MAX_MONTHLY_LIMIT_USD: 50_000,
  DEFAULT_FEE_PERCENT:   0.015,
  MIN_FEE_USD:           0.50,
  MAX_FEE_USD:           25.00,
  RATE_LOCK_MINUTES:     30,
  RETRY_ATTEMPTS:        3,
} as const;

// ─── KYC / Compliance ─────────────────────────────────────────────────────────
export const KYC = {
  TIER1_LIMIT_USD:       1_000,
  TIER2_LIMIT_USD:       10_000,
  TIER3_LIMIT_USD:       50_000,
  MAX_UPLOAD_SIZE_MB:    10,
  ALLOWED_DOC_TYPES:     ["passport", "national_id", "drivers_license", "residence_permit"],
  ALLOWED_MIME_TYPES:    ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  REVIEW_SLA_HOURS:      24,
} as const;

// ─── AML / Fraud Thresholds ───────────────────────────────────────────────────
export const AML = {
  CTR_THRESHOLD_USD:     10_000,
  SAR_THRESHOLD_USD:     5_000,
  VELOCITY_WINDOW_HOURS: 24,
  MAX_DAILY_TRANSACTIONS: 20,
  HIGH_RISK_COUNTRIES:   ["IR", "KP", "SY", "CU", "SD", "MM", "BY", "RU"],
  FRAUD_SCORE_THRESHOLD: 0.75,
} as const;

// ─── Investment ───────────────────────────────────────────────────────────────
export const INVESTMENT = {
  MIN_ORDER_USD:         10,
  MAX_ORDER_USD:         100_000,
  PLATFORM_FEE_PERCENT:  0.005,
  MIN_PLATFORM_FEE_USD:  0.10,
  PRICE_HISTORY_DAYS:    365,
} as const;

// ─── Savings ─────────────────────────────────────────────────────────────────
export const SAVINGS = {
  MIN_DEPOSIT_USD:       5,
  DEFAULT_APY_PERCENT:   4.5,
  FLEX_APY_PERCENT:      3.0,
  LOCKED_APY_PERCENT:    6.0,
  LOCK_PERIODS_DAYS:     [30, 90, 180, 365],
  EARLY_WITHDRAWAL_FEE:  0.02,
} as const;

// ─── Referral Program ─────────────────────────────────────────────────────────
export const REFERRAL = {
  BONUS_AMOUNT_NGN:      500,
  REFEREE_BONUS_NGN:     250,
  MAX_REFERRALS:         50,
  MIN_TRANSFER_TO_UNLOCK: 100,
  EXPIRY_DAYS:           90,
} as const;

// ─── Pagination ───────────────────────────────────────────────────────────────
export const PAGINATION = {
  DEFAULT_PAGE_SIZE:     20,
  MAX_PAGE_SIZE:         100,
  TRANSACTION_PAGE_SIZE: 25,
} as const;

// ─── Supported Currencies ─────────────────────────────────────────────────────
export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "RWF",
  "ETB", "XOF", "XAF", "MAD", "EGP", "MWK", "ZMW", "BWP", "MUR",
  "CAD", "AUD", "JPY", "CNY", "INR", "BRL", "MXN", "AED", "SAR",
] as const;

export const SUPPORTED_COUNTRIES = [
  { code: "NG", name: "Nigeria",        currency: "NGN", flag: "🇳🇬" },
  { code: "KE", name: "Kenya",          currency: "KES", flag: "🇰🇪" },
  { code: "GH", name: "Ghana",          currency: "GHS", flag: "🇬🇭" },
  { code: "ZA", name: "South Africa",   currency: "ZAR", flag: "🇿🇦" },
  { code: "TZ", name: "Tanzania",       currency: "TZS", flag: "🇹🇿" },
  { code: "UG", name: "Uganda",         currency: "UGX", flag: "🇺🇬" },
  { code: "RW", name: "Rwanda",         currency: "RWF", flag: "🇷🇼" },
  { code: "ET", name: "Ethiopia",       currency: "ETB", flag: "🇪🇹" },
  { code: "SN", name: "Senegal",        currency: "XOF", flag: "🇸🇳" },
  { code: "MA", name: "Morocco",        currency: "MAD", flag: "🇲🇦" },
  { code: "EG", name: "Egypt",          currency: "EGP", flag: "🇪🇬" },
  { code: "US", name: "United States",  currency: "USD", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", currency: "GBP", flag: "🇬🇧" },
  { code: "CA", name: "Canada",         currency: "CAD", flag: "🇨🇦" },
  { code: "AU", name: "Australia",      currency: "AUD", flag: "🇦🇺" },
  { code: "AE", name: "UAE",            currency: "AED", flag: "🇦🇪" },
] as const;

// ─── Error Codes ──────────────────────────────────────────────────────────────
export const ERROR_CODES = {
  UNAUTHENTICATED:       10001,
  UNAUTHORIZED:          10002,
  VALIDATION_ERROR:      10003,
  TRANSFER_LIMIT:        10004,
  KYC_REQUIRED:          10005,
  INSUFFICIENT_FUNDS:    10006,
  RATE_LOCK_EXPIRED:     10007,
  DUPLICATE_TRANSACTION: 10008,
  AML_BLOCKED:           10009,
  FRAUD_DETECTED:        10010,
  SERVICE_UNAVAILABLE:   10011,
  RATE_LIMIT_EXCEEDED:   10012,
} as const;

// ─── Webhook Events ───────────────────────────────────────────────────────────
export const WEBHOOK_EVENTS = [
  "transfer.created", "transfer.completed", "transfer.failed", "transfer.reversed",
  "kyc.submitted", "kyc.approved", "kyc.rejected",
  "wallet.funded", "wallet.withdrawn",
  "investment.order_placed", "investment.order_filled",
  "savings.deposit", "savings.withdrawal",
  "referral.earned", "fraud.alert", "aml.alert",
] as const;

// ─── Feature Flags ────────────────────────────────────────────────────────────
export const FEATURES = {
  CBDC_ENABLED:          false,
  MOJALOOP_ENABLED:      true,
  BNPL_ENABLED:          true,
  INVESTMENT_ENABLED:    true,
  COMMUNITY_ENABLED:     true,
} as const;
