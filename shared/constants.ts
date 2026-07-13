/**
 * RemitFlow Production Constants
 * All default values, URLs, IDs, and configuration constants
 * Override via environment variables in production
 */

// ─── APPLICATION ──────────────────────────────────────────────────────────────
export const APP = {
  NAME: "RemitFlow",
  TAGLINE: "Cross-Border Remittance Platform",
  VERSION: "5.0.0",
  BASE_URL: process.env.APP_BASE_URL || `https://${process.env.REMITFLOW_PRODUCTION_DOMAIN || "remitflow.manus.space"}`,
  SUPPORT_EMAIL: "support@remitflow.com",
  COMPLIANCE_EMAIL: "compliance@remitflow.com",
  LEGAL_EMAIL: "legal@remitflow.com",
} as const;

// ─── SUPPORTED CURRENCIES ────────────────────────────────────────────────────
export const CURRENCIES = {
  NGN: { code: "NGN", name: "Nigerian Naira", symbol: "₦", flag: "🇳🇬", decimals: 2 },
  USD: { code: "USD", name: "US Dollar", symbol: "$", flag: "🇺🇸", decimals: 2 },
  GBP: { code: "GBP", name: "British Pound", symbol: "£", flag: "🇬🇧", decimals: 2 },
  EUR: { code: "EUR", name: "Euro", symbol: "€", flag: "🇪🇺", decimals: 2 },
  KES: { code: "KES", name: "Kenyan Shilling", symbol: "KSh", flag: "🇰🇪", decimals: 2 },
  GHS: { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", flag: "🇬🇭", decimals: 2 },
  ZAR: { code: "ZAR", name: "South African Rand", symbol: "R", flag: "🇿🇦", decimals: 2 },
  TZS: { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", flag: "🇹🇿", decimals: 0 },
  UGX: { code: "UGX", name: "Ugandan Shilling", symbol: "USh", flag: "🇺🇬", decimals: 0 },
  XOF: { code: "XOF", name: "West African CFA Franc", symbol: "CFA", flag: "🌍", decimals: 0 },
  XAF: { code: "XAF", name: "Central African CFA Franc", symbol: "FCFA", flag: "🌍", decimals: 0 },
  EGP: { code: "EGP", name: "Egyptian Pound", symbol: "E£", flag: "🇪🇬", decimals: 2 },
  MAD: { code: "MAD", name: "Moroccan Dirham", symbol: "MAD", flag: "🇲🇦", decimals: 2 },
  INR: { code: "INR", name: "Indian Rupee", symbol: "₹", flag: "🇮🇳", decimals: 2 },
  PHP: { code: "PHP", name: "Philippine Peso", symbol: "₱", flag: "🇵🇭", decimals: 2 },
  MXN: { code: "MXN", name: "Mexican Peso", symbol: "MX$", flag: "🇲🇽", decimals: 2 },
  BRL: { code: "BRL", name: "Brazilian Real", symbol: "R$", flag: "🇧🇷", decimals: 2 },
  CAD: { code: "CAD", name: "Canadian Dollar", symbol: "CA$", flag: "🇨🇦", decimals: 2 },
  AUD: { code: "AUD", name: "Australian Dollar", symbol: "A$", flag: "🇦🇺", decimals: 2 },
  CNY: { code: "CNY", name: "Chinese Yuan", symbol: "¥", flag: "🇨🇳", decimals: 2 },
  JPY: { code: "JPY", name: "Japanese Yen", symbol: "¥", flag: "🇯🇵", decimals: 0 },
  AED: { code: "AED", name: "UAE Dirham", symbol: "د.إ", flag: "🇦🇪", decimals: 2 },
  SAR: { code: "SAR", name: "Saudi Riyal", symbol: "﷼", flag: "🇸🇦", decimals: 2 },
  USDT: { code: "USDT", name: "Tether USD", symbol: "₮", flag: "💵", decimals: 6 },
  USDC: { code: "USDC", name: "USD Coin", symbol: "USDC", flag: "💵", decimals: 6 },
  eNGN: { code: "eNGN", name: "Digital Naira (CBDC)", symbol: "e₦", flag: "🇳🇬", decimals: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

// ─── TRANSACTION LIMITS ───────────────────────────────────────────────────────
export const TRANSACTION_LIMITS = {
  // KYC Tier limits (daily, per transaction)
  TIER_0: { daily: 50000, perTx: 10000, monthly: 200000 },   // Unverified
  TIER_1: { daily: 500000, perTx: 100000, monthly: 2000000 }, // Basic KYC
  TIER_2: { daily: 5000000, perTx: 1000000, monthly: 20000000 }, // Full KYC
  TIER_3: { daily: 50000000, perTx: 10000000, monthly: 200000000 }, // Enhanced KYC

  // Minimum transfer amount (in base currency units)
  MIN_TRANSFER: 100, // ₦100 minimum

  // AML reporting threshold (NFIU requirement)
  AML_THRESHOLD: 5000000, // ₦5,000,000 triggers CTR

  // Travel Rule threshold (FATF)
  TRAVEL_RULE_THRESHOLD: 1000, // $1,000 USD equivalent
} as const;

// ─── FX RATES ─────────────────────────────────────────────────────────────────
export const FX_CONFIG = {
  // Primary FX provider
  PRIMARY_URL: process.env.FX_API_URL || "https://open.er-api.com/v6/latest",
  PRIMARY_KEY: process.env.FX_API_KEY || "", // Free tier doesn't need key

  // Fallback FX provider (Currencybeacon)
  FALLBACK_URL: process.env.FX_FALLBACK_URL || "https://api.currencybeacon.com/v1/latest",
  FALLBACK_KEY: process.env.FX_FALLBACK_KEY || "",

  // RemitFlow fee structure
  FEE_PERCENTAGE: 0.015, // 1.5% transfer fee
  FEE_MIN: 200,          // Minimum ₦200 fee
  FEE_MAX: 50000,        // Maximum ₦50,000 fee

  // Rate lock duration
  LOCK_DURATION_HOURS: 24,

  // Cache TTL
  CACHE_TTL_SECONDS: 300, // 5 minutes
} as const;

// ─── CORRIDORS (supported transfer routes) ────────────────────────────────────
export const CORRIDORS = [
  { from: "NGN", to: "USD", fee: 0.015, minAmount: 5000, maxAmount: 5000000, estimatedTime: "1-2 hours" },
  { from: "NGN", to: "GBP", fee: 0.015, minAmount: 5000, maxAmount: 5000000, estimatedTime: "1-2 hours" },
  { from: "NGN", to: "EUR", fee: 0.015, minAmount: 5000, maxAmount: 5000000, estimatedTime: "1-2 hours" },
  { from: "NGN", to: "KES", fee: 0.012, minAmount: 1000, maxAmount: 2000000, estimatedTime: "30 min" },
  { from: "NGN", to: "GHS", fee: 0.012, minAmount: 1000, maxAmount: 2000000, estimatedTime: "30 min" },
  { from: "NGN", to: "ZAR", fee: 0.013, minAmount: 1000, maxAmount: 3000000, estimatedTime: "1 hour" },
  { from: "USD", to: "NGN", fee: 0.015, minAmount: 10, maxAmount: 5000, estimatedTime: "1-2 hours" },
  { from: "GBP", to: "NGN", fee: 0.015, minAmount: 10, maxAmount: 5000, estimatedTime: "1-2 hours" },
  { from: "USD", to: "KES", fee: 0.010, minAmount: 10, maxAmount: 10000, estimatedTime: "30 min" },
  { from: "USD", to: "GHS", fee: 0.010, minAmount: 10, maxAmount: 10000, estimatedTime: "30 min" },
  { from: "USD", to: "ZAR", fee: 0.010, minAmount: 10, maxAmount: 10000, estimatedTime: "1 hour" },
  { from: "USD", to: "PHP", fee: 0.012, minAmount: 10, maxAmount: 10000, estimatedTime: "1-2 hours" },
  { from: "USD", to: "INR", fee: 0.012, minAmount: 10, maxAmount: 10000, estimatedTime: "1-2 hours" },
  { from: "USD", to: "MXN", fee: 0.010, minAmount: 10, maxAmount: 10000, estimatedTime: "1 hour" },
  { from: "USD", to: "BRL", fee: 0.013, minAmount: 10, maxAmount: 10000, estimatedTime: "1-2 hours" },
] as const;

// ─── KYC TIERS ────────────────────────────────────────────────────────────────
export const KYC_TIERS = {
  TIER_0: {
    name: "Unverified",
    requirements: [],
    benefits: ["Basic account access", "View FX rates"],
    limits: TRANSACTION_LIMITS.TIER_0,
  },
  TIER_1: {
    name: "Basic Verified",
    requirements: ["Phone number", "BVN or NIN"],
    benefits: ["Send up to ₦100,000/day", "Receive transfers", "Virtual card"],
    limits: TRANSACTION_LIMITS.TIER_1,
  },
  TIER_2: {
    name: "Fully Verified",
    requirements: ["Government ID", "Selfie/liveness check", "Proof of address"],
    benefits: ["Send up to ₦1,000,000/day", "Physical card", "Savings goals", "BNPL"],
    limits: TRANSACTION_LIMITS.TIER_2,
  },
  TIER_3: {
    name: "Enhanced Due Diligence",
    requirements: ["Business registration", "Source of funds", "Enhanced background check"],
    benefits: ["Unlimited transfers", "Business accounts", "API access", "Priority support"],
    limits: TRANSACTION_LIMITS.TIER_3,
  },
} as const;

// ─── PAYMENT METHODS ──────────────────────────────────────────────────────────
export const PAYMENT_METHODS = {
  BANK_TRANSFER: { id: "bank_transfer", name: "Bank Transfer", icon: "🏦", fee: 0 },
  CARD: { id: "card", name: "Debit/Credit Card", icon: "💳", fee: 0.015 },
  USSD: { id: "ussd", name: "USSD (*737#)", icon: "📱", fee: 0 },
  MOBILE_MONEY: { id: "mobile_money", name: "Mobile Money", icon: "📲", fee: 0.01 },
  CRYPTO: { id: "crypto", name: "Cryptocurrency", icon: "₿", fee: 0.005 },
  CBDC: { id: "cbdc", name: "Digital Naira (eNGN)", icon: "e₦", fee: 0 },
} as const;

// ─── BANKS (Nigeria) ──────────────────────────────────────────────────────────
export const NIGERIAN_BANKS = [
  { code: "044", name: "Access Bank", ussd: "*901#" },
  { code: "058", name: "GTBank", ussd: "*737#" },
  { code: "011", name: "First Bank", ussd: "*894#" },
  { code: "057", name: "Zenith Bank", ussd: "*966#" },
  { code: "033", name: "United Bank for Africa (UBA)", ussd: "*919#" },
  { code: "032", name: "Union Bank", ussd: "*826#" },
  { code: "035", name: "Wema Bank / ALAT", ussd: "*945#" },
  { code: "070", name: "Fidelity Bank", ussd: "*770#" },
  { code: "050", name: "Ecobank", ussd: "*326#" },
  { code: "215", name: "Unity Bank", ussd: "*7799#" },
  { code: "082", name: "Keystone Bank", ussd: "*7111#" },
  { code: "101", name: "Providus Bank", ussd: "" },
  { code: "301", name: "Jaiz Bank", ussd: "*389*301#" },
  { code: "100", name: "Suntrust Bank", ussd: "" },
  { code: "090", name: "Opay", ussd: "*955#" },
  { code: "120", name: "PalmPay", ussd: "*861#" },
  { code: "110", name: "Kuda Bank", ussd: "" },
  { code: "090405", name: "Moniepoint", ussd: "*5573#" },
] as const;

// ─── MOBILE MONEY PROVIDERS ───────────────────────────────────────────────────
export const MOBILE_MONEY_PROVIDERS = [
  { code: "mpesa_ke", name: "M-Pesa Kenya", country: "KE", ussd: "*334#" },
  { code: "mpesa_tz", name: "M-Pesa Tanzania", country: "TZ", ussd: "*150*00#" },
  { code: "mtn_momo", name: "MTN Mobile Money", country: "GH", ussd: "*170#" },
  { code: "airtel_money", name: "Airtel Money", country: "UG", ussd: "*185#" },
  { code: "orange_money", name: "Orange Money", country: "SN", ussd: "#144#" },
  { code: "wave", name: "Wave", country: "SN", ussd: "" },
  { code: "flutterwave", name: "Flutterwave", country: "NG", ussd: "" },
  { code: "paystack", name: "Paystack", country: "NG", ussd: "" },
] as const;

// ─── MOJALOOP CONFIG ──────────────────────────────────────────────────────────
export const MOJALOOP = {
  BASE_URL: process.env.MOJALOOP_URL || "https://sandbox.mojaloop.io",
  FSP_ID: process.env.MOJALOOP_FSP_ID || "remitflow",
  API_KEY: process.env.MOJALOOP_API_KEY || "default-api-key",
  SUPPORTED_SCHEMES: ["MSISDN", "ACCOUNT_ID", "IBAN", "ALIAS"],
  TRANSFER_TIMEOUT_SECONDS: 30,
} as const;

// ─── CBDC CONFIG ──────────────────────────────────────────────────────────────
export const CBDC = {
  eNGN: {
    name: "Digital Naira",
    symbol: "e₦",
    issuer: "Central Bank of Nigeria",
    network: "CBN CBDC Network",
    baseUrl: process.env.CBDC_ENGN_URL || "https://enaira.gov.ng/api",
    apiKey: process.env.CBDC_ENGN_KEY || "",
  },
  DCASH: {
    name: "DCash",
    symbol: "DCASH",
    issuer: "Eastern Caribbean Central Bank",
    network: "ECCB CBDC Network",
    baseUrl: process.env.CBDC_DCASH_URL || "https://dcash.ec/api",
    apiKey: process.env.CBDC_DCASH_KEY || "",
  },
} as const;

// ─── STABLECOIN CONFIG ────────────────────────────────────────────────────────
export const STABLECOINS = {
  USDT: {
    name: "Tether",
    symbol: "USDT",
    networks: ["Ethereum", "Tron", "BSC", "Polygon"],
    contractAddresses: {
      ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      tron: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      bsc: "0x55d398326f99059fF775485246999027B3197955",
      polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    },
  },
  USDC: {
    name: "USD Coin",
    symbol: "USDC",
    networks: ["Ethereum", "Polygon", "Solana", "Avalanche"],
    contractAddresses: {
      ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      polygon: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    },
  },
} as const;

// ─── COMPLIANCE ───────────────────────────────────────────────────────────────
export const COMPLIANCE = {
  // NFIU (Nigeria Financial Intelligence Unit) thresholds
  NFIU: {
    CTR_THRESHOLD: 5000000,    // ₦5M - Currency Transaction Report
    STR_THRESHOLD: 1000000,    // ₦1M - Suspicious Transaction Report
    REPORTING_EMAIL: "reports@nfiu.gov.ng",
  },

  // FCA (UK Financial Conduct Authority)
  FCA: {
    FIRM_REFERENCE: process.env.FCA_FIRM_REF || "FRN-PENDING",
    REGULATORY_CAPITAL_MIN: 125000, // £125,000 minimum
    REPORTING_PERIOD: "quarterly",
  },

  // FATF Travel Rule
  TRAVEL_RULE: {
    THRESHOLD_USD: 1000,
    REQUIRED_FIELDS: ["originatorName", "originatorAccount", "beneficiaryName", "beneficiaryAccount"],
  },

  // Data retention periods
  DATA_RETENTION: {
    TRANSACTION_RECORDS_YEARS: 7,
    KYC_DOCUMENTS_YEARS: 5,
    AUDIT_LOGS_YEARS: 7,
    SESSION_LOGS_DAYS: 90,
  },
} as const;

// ─── REFERRAL PROGRAM ─────────────────────────────────────────────────────────
export const REFERRAL = {
  REWARD_AMOUNT: 1000,        // ₦1,000 per successful referral
  REFEREE_REWARD: 500,        // ₦500 for the new user
  MIN_TRANSACTIONS_TO_QUALIFY: 1, // Referee must complete 1 transfer
  EXPIRY_DAYS: 30,            // Referral link expires in 30 days
} as const;

// ─── BNPL CONFIG ──────────────────────────────────────────────────────────────
export const BNPL = {
  PLANS: [
    { id: "pay3", name: "Pay in 3", installments: 3, intervalDays: 30, interestRate: 0 },
    { id: "pay6", name: "Pay in 6", installments: 6, intervalDays: 30, interestRate: 0.05 },
    { id: "pay12", name: "Pay in 12", installments: 12, intervalDays: 30, interestRate: 0.12 },
  ],
  MIN_AMOUNT: 5000,
  MAX_AMOUNT: 500000,
  CREDIT_SCORE_MIN: 600,
} as const;

// ─── SAVINGS GOALS ────────────────────────────────────────────────────────────
export const SAVINGS = {
  INTEREST_RATES: {
    FLEXIBLE: 0.05,    // 5% APY
    LOCKED_30: 0.08,   // 8% APY (30-day lock)
    LOCKED_90: 0.10,   // 10% APY (90-day lock)
    LOCKED_180: 0.12,  // 12% APY (180-day lock)
    LOCKED_365: 0.15,  // 15% APY (365-day lock)
  },
  MIN_DEPOSIT: 1000,
  MAX_DEPOSIT: 10000000,
} as const;

// ─── AIRTIME & BILLS ──────────────────────────────────────────────────────────
export const AIRTIME_NETWORKS = [
  { code: "MTN", name: "MTN Nigeria", country: "NG", ussd: "*556#" },
  { code: "AIRTEL", name: "Airtel Nigeria", country: "NG", ussd: "*123#" },
  { code: "GLO", name: "Glo Nigeria", country: "NG", ussd: "*777#" },
  { code: "9MOBILE", name: "9mobile Nigeria", country: "NG", ussd: "*200#" },
  { code: "SAFARICOM", name: "Safaricom Kenya", country: "KE", ussd: "*544#" },
  { code: "MTN_GH", name: "MTN Ghana", country: "GH", ussd: "*138#" },
] as const;

export const BILL_CATEGORIES = [
  { code: "ELECTRICITY", name: "Electricity", providers: ["EKEDC", "IKEDC", "AEDC", "PHEDC", "EEDC"] },
  { code: "WATER", name: "Water", providers: ["Lagos Water", "Abuja Water"] },
  { code: "CABLE_TV", name: "Cable TV", providers: ["DSTV", "GOtv", "Startimes"] },
  { code: "INTERNET", name: "Internet", providers: ["Spectranet", "Smile", "Swift"] },
  { code: "EDUCATION", name: "School Fees", providers: ["WAEC", "JAMB", "NECO"] },
] as const;

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
export const NOTIFICATION_TYPES = {
  TRANSFER_SENT: "transfer_sent",
  TRANSFER_RECEIVED: "transfer_received",
  TRANSFER_FAILED: "transfer_failed",
  KYC_APPROVED: "kyc_approved",
  KYC_REJECTED: "kyc_rejected",
  CARD_CREATED: "card_created",
  CARD_TRANSACTION: "card_transaction",
  SAVINGS_MATURED: "savings_matured",
  RATE_ALERT: "rate_alert",
  SECURITY_ALERT: "security_alert",
  REFERRAL_REWARD: "referral_reward",
  SYSTEM: "system",
} as const;

// ─── RATE LIMITS ──────────────────────────────────────────────────────────────
export const RATE_LIMITS = {
  GENERAL: { windowMs: 60_000, max: 100 },
  AUTH: { windowMs: 900_000, max: 10 },
  PAYMENTS: { windowMs: 60_000, max: 20 },
  KYC_UPLOAD: { windowMs: 3_600_000, max: 5 },
  VELOCITY: { windowMs: 3_600_000, max: 10 },
} as const;

// ─── API VERSIONS ─────────────────────────────────────────────────────────────
export const API = {
  CURRENT_VERSION: "v2",
  SUPPORTED_VERSIONS: ["v1", "v2"],
  DEPRECATION_NOTICE: "v1 is deprecated and will be removed on 2027-01-01",
  CHANGELOG_URL: `${APP.BASE_URL}/api/changelog`,
} as const;

// ─── AGENT NETWORK ────────────────────────────────────────────────────────────
export const AGENT = {
  COMMISSION_RATE: 0.005,    // 0.5% per transaction
  MIN_FLOAT: 50000,          // Minimum ₦50,000 float
  MAX_FLOAT: 5000000,        // Maximum ₦5,000,000 float
  TRANSACTION_LIMIT: 500000, // Max ₦500,000 per transaction
} as const;

// ─── POS TERMINALS ────────────────────────────────────────────────────────────
export const POS = {
  TRANSACTION_FEE: 0.005,   // 0.5% per transaction
  MAX_TRANSACTION: 1000000, // Max ₦1,000,000 per transaction
  SETTLEMENT_HOURS: 24,     // T+1 settlement
} as const;

export default {
  APP,
  CURRENCIES,
  CURRENCY_CODES,
  TRANSACTION_LIMITS,
  FX_CONFIG,
  CORRIDORS,
  KYC_TIERS,
  PAYMENT_METHODS,
  NIGERIAN_BANKS,
  MOBILE_MONEY_PROVIDERS,
  MOJALOOP,
  CBDC,
  STABLECOINS,
  COMPLIANCE,
  REFERRAL,
  BNPL,
  SAVINGS,
  AIRTIME_NETWORKS,
  BILL_CATEGORIES,
  NOTIFICATION_TYPES,
  RATE_LIMITS,
  API,
  AGENT,
  POS,
};

// ─── OBSERVABILITY & ALERTING ─────────────────────────────────────────────────
export const OBSERVABILITY = {
  // Grafana
  GRAFANA_URL: process.env.GRAFANA_URL || "http://localhost:3001",
  GRAFANA_USER: process.env.GRAFANA_USER || "admin",
  GRAFANA_PASSWORD: process.env.GRAFANA_PASSWORD || "remitflow-grafana-2025",
  // Prometheus
  PROMETHEUS_URL: process.env.PROMETHEUS_URL || "http://localhost:9090",
  // Alertmanager
  ALERTMANAGER_URL: process.env.ALERTMANAGER_URL || "http://localhost:9093",
  // Slack webhook (set SLACK_WEBHOOK_URL in production)
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || "https://hooks.slack.com/services/REPLACE_ME/REPLACE_ME/REPLACE_ME",
  SLACK_CHANNEL_SECURITY: process.env.SLACK_CHANNEL_SECURITY || "#remitflow-security",
  SLACK_CHANNEL_CRITICAL: process.env.SLACK_CHANNEL_CRITICAL || "#remitflow-critical",
  SLACK_CHANNEL_FRAUD: process.env.SLACK_CHANNEL_FRAUD || "#remitflow-fraud",
  SLACK_CHANNEL_OPS: process.env.SLACK_CHANNEL_OPS || "#remitflow-ops",
} as const;

// ─── APISIX / WAF ─────────────────────────────────────────────────────────────
export const APISIX = {
  GATEWAY_URL: process.env.APISIX_GATEWAY_URL || "http://localhost:9080",
  DASHBOARD_URL: process.env.APISIX_DASHBOARD_URL || "http://localhost:9000",
  ADMIN_URL: process.env.APISIX_ADMIN_URL || "http://localhost:9180",
  ADMIN_KEY: process.env.APISIX_ADMIN_KEY || "remitflow-apisix-admin-2025",
  DASHBOARD_USER: process.env.APISIX_DASHBOARD_USER || "admin",
  DASHBOARD_PASSWORD: process.env.APISIX_DASHBOARD_PASSWORD || "remitflow-apisix-2025",
  // open-appsec WAF
  OPENAPPSEC_CENTRAL_URL: process.env.OPENAPPSEC_CENTRAL_URL || "https://my.openappsec.io",
  OPENAPPSEC_TOKEN: process.env.OPENAPPSEC_TOKEN || "",
} as const;

// ─── SMS / TWILIO ─────────────────────────────────────────────────────────────
export const SMS = {
  PROVIDER: process.env.SMS_PROVIDER || "twilio",
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER || "+15005550006", // Twilio test number
  // Africa's Talking (fallback for African corridors)
  AT_API_KEY: process.env.AT_API_KEY || "",
  AT_USERNAME: process.env.AT_USERNAME || "sandbox",
  AT_SENDER_ID: process.env.AT_SENDER_ID || "RemitFlow",
} as const;

// ─── EMAIL ────────────────────────────────────────────────────────────────────
export const EMAIL = {
  PROVIDER: process.env.EMAIL_PROVIDER || "sendgrid",
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || "",
  FROM_EMAIL: process.env.FROM_EMAIL || "noreply@remitflow.com",
  FROM_NAME: process.env.FROM_NAME || "RemitFlow",
  SUPPORT_EMAIL: "support@remitflow.com",
  COMPLIANCE_EMAIL: "compliance@remitflow.com",
  // SMTP fallback
  SMTP_HOST: process.env.SMTP_HOST || "smtp.sendgrid.net",
  SMTP_PORT: parseInt(process.env.SMTP_PORT || "587"),
  SMTP_USER: process.env.SMTP_USER || "apikey",
  SMTP_PASS: process.env.SMTP_PASS || "",
} as const;

// ─── STRIPE DEFAULTS ──────────────────────────────────────────────────────────
export const STRIPE_DEFAULTS = {
  CURRENCY: "usd",
  MIN_AMOUNT_CENTS: 50, // $0.50 minimum
  MAX_AMOUNT_CENTS: 99999999, // $999,999.99 maximum
  WEBHOOK_TOLERANCE_SECONDS: 300, // 5 minutes
  // Test card numbers
  TEST_CARD_SUCCESS: "4242424242424242",
  TEST_CARD_DECLINE: "4000000000000002",
  TEST_CARD_3DS: "4000002500003155",
} as const;

// ─── DOCKER / INFRASTRUCTURE ──────────────────────────────────────────────────
export const INFRA = {
  // OCR Microservice
  OCR_SERVICE_URL: process.env.OCR_SERVICE_URL || "http://localhost:8765",
  OCR_TIMEOUT_MS: 30000,
  // Redis (for rate limiting, sessions, caching)
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || "remitflow-redis-2025",
  // Database
  DB_POOL_MIN: 2,
  DB_POOL_MAX: 20,
  DB_IDLE_TIMEOUT_MS: 30000,
  // App server
  PORT: parseInt(process.env.PORT || "3000"),
  NODE_ENV: process.env.NODE_ENV || "development",
} as const;
