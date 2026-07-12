export enum TenantStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  ONBOARDING = "onboarding",
  SUSPENDED = "suspended",
  DISABLED = "disabled",
}

export enum FeatureFlag {
  // Core
  AUTH = "auth",
  USER_MANAGEMENT = "user_management",
  ACCOUNTS = "accounts",
  PAYMENTS = "payments",
  REPORTING = "reporting",
  NOTIFICATIONS = "notifications",
  KYC_KYB = "kyc_kyb",
  COMPLIANCE = "compliance",
  AUDIT = "audit",

  // Channels
  MOBILE_BANKING = "mobile_banking",
  USSD_BANKING = "ussd_banking",
  WHATSAPP_BANKING = "whatsapp_banking",
  AGENT_BANKING = "agent_banking",
  CHATBOT = "chatbot",

  // Payments & Transfers
  BILL_PAYMENTS = "bill_payments",
  QR_PAYMENTS = "qr_payments",
  BULK_PAYMENTS = "bulk_payments",
  STANDING_ORDERS = "standing_orders",
  REMITTANCE = "remittance",

  // Cards & Accounts
  CARD_MANAGEMENT = "card_management",
  VIRTUAL_ACCOUNTS = "virtual_accounts",
  FX = "fx",

  // Risk, Fraud & Compliance
  FRAUD_DETECTION = "fraud_detection",
  RISK_MANAGEMENT = "risk_management",
  DISPUTE = "dispute",
  AML_COMPLIANCE = "aml_compliance",
  SANCTIONS_SCREENING = "sanctions_screening",
  REGULATORY_REPORTING = "regulatory_reporting",
  TRAVEL_RULE = "travel_rule",

  // Treasury & Finance
  TREASURY = "treasury",
  RECONCILIATION = "reconciliation",
  FINANCE = "finance",

  // Specialised
  DIASPORA_BANKING = "diaspora_banking",

  // Operations & Workflow
  EMPLOYEE_MANAGEMENT = "employee_management",
  DOCUMENT_MANAGEMENT = "document_management",
  MAKER_CHECKER = "maker_checker",

  // Platform & Integration
  OPEN_BANKING = "open_banking",
  BIOMETRIC_AUTH = "biometric_auth",
  DEVELOPER_PLATFORM = "developer_platform",
}

export enum BillingPlan {
  STANDARD = "standard",
  PREMIUM = "premium",
  ENTERPRISE = "enterprise",
}

export enum BillingPeriod {
  MONTHLY = "monthly",
  ANNUAL = "annual",
}

export enum TenantType {
  BANK = "bank",
  MICROFINANCE = "microfinance",
  FINTECH = "fintech",
  MTO = "mto",
}
