/**
 * Shared API type definitions — split out of the monolithic
 * services/api.ts (wave14). Interfaces only; no runtime code.
 */
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  kycTier: string;
  createdAt: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  reference: string;
  description?: string;
  recipient?: string;
  sender?: string;
  fee?: number;
  exchangeRate?: number;
  createdAt: string;
  completedAt?: string;
}

export interface TransferRequest {
  recipientType: "phone" | "email" | "bank";
  recipient: string;
  recipientName: string;
  amount: number;
  currency: string;
  destinationCurrency: string;
  note?: string;
  deliveryMethod: string;
  rateLockId?: string;
  sourceAccountId?: string;
  senderName?: string;
  switchName?: string;
  destination?: string;
  pin?: string;
}

export interface WalletBalance {
  currency: string;
  available: number;
  pending: number;
  total: number;
}

export interface FundWalletRequest {
  amount: number;
  currency: string;
  paymentMethod: string;
}

export interface WithdrawRequest {
  amount: number;
  currency: string;
  bankCode: string;
  accountNumber: string;
}

export interface ExchangeRate {
  from: string;
  to: string;
  rate: number;
  inverseRate: number;
  provider: string;
  lastUpdated: string;
  validUntil: string;
}

// Raw exchange rate shape as returned by the 54remit backend
export interface BackendExchangeRate {
  id: number;
  tenant_id: string;
  base_currency: string;
  quote_currency: string;
  rate: number;
  created_at: string;
  updated_at: string;
}

export interface RateLock {
  id: string;
  from: string;
  to: string;
  rate: number;
  amount: number;
  lockedAt: string;
  expiresAt: string;
}

export interface ExchangeRateHistory {
  date: string;
  rate: number;
  high: number;
  low: number;
}

export interface AirtimePurchaseRequest {
  phone: string;
  amount: number;
  provider: string;
  type: "airtime" | "data";
  planId?: string;
}

export interface AirtimeTransaction {
  id: string;
  phone: string;
  amount: number;
  provider: string;
  type: string;
  status: string;
  createdAt: string;
}

export interface AirtimeProvider {
  id: string;
  name: string;
  logo: string;
  country: string;
}

export interface DataPlan {
  id: string;
  name: string;
  amount: number;
  data: string;
  validity: string;
}

export interface BillPaymentRequest {
  category: string;
  billerId: string;
  customerId: string;
  amount: number;
  customerName?: string;
}

export interface BillPaymentTransaction {
  id: string;
  category: string;
  biller: string;
  customerId: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface BillCategory {
  id: string;
  name: string;
  icon: string;
}

export interface Biller {
  id: string;
  name: string;
  logo: string;
  category: string;
}

export interface CustomerValidation {
  valid: boolean;
  customerName: string;
  customerId: string;
  minimumAmount?: number;
  maximumAmount?: number;
}

export interface KYCProfile {
  id: string;
  userId: string;
  currentTier: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  phone?: string;
  phoneVerified: boolean;
  email?: string;
  emailVerified: boolean;
  bvn?: string;
  bvnVerified: boolean;
  address?: string;
  idDocumentStatus: string;
  selfieStatus: string;
  addressProofStatus: string;
}

export interface KYCDocument {
  id: string;
  type: string;
  status: string;
  uploadedAt: string;
  verifiedAt?: string;
}

export interface BVNVerification {
  valid: boolean;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
}

export interface KYCLimits {
  tier: string;
  dailyLimit: number;
  monthlyLimit: number;
  singleTransactionLimit: number;
}

export interface KYCUpgradeRequest {
  id: string;
  requestedTier: string;
  status: string;
  createdAt: string;
}

// Property Transaction KYC Types
export interface Party {
  id: string;
  role: "buyer" | "seller" | "agent" | "lawyer" | "escrow";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  idType: string;
  idNumber: string;
  bvn?: string;
  nin?: string;
  kycStatus: string;
  createdAt: string;
}

export interface CreatePartyRequest {
  role: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  idType: string;
  idNumber: string;
  idIssuingCountry: string;
  idIssueDate: string;
  idExpiryDate: string;
  bvn?: string;
  nin?: string;
}

export interface PropertyTransaction {
  id: string;
  referenceNumber: string;
  propertyType: string;
  propertyAddress: string;
  purchasePrice: number;
  currency: string;
  buyerId: string;
  sellerId?: string;
  buyerKycComplete: boolean;
  sellerKycComplete: boolean;
  sourceOfFundsVerified: boolean;
  bankStatementsVerified: boolean;
  incomeVerified: boolean;
  purchaseAgreementVerified: boolean;
  status: string;
  riskScore: number;
  createdAt: string;
}

export interface CreatePropertyTransactionRequest {
  propertyType: string;
  propertyAddress: string;
  purchasePrice: number;
  currency?: string;
  buyerId: string;
}

export interface SourceOfFunds {
  id: string;
  transactionId: string;
  primarySource: string;
  secondarySource?: string;
  employerName?: string;
  businessName?: string;
  status: string;
}

export interface SourceOfFundsRequest {
  primarySource: string;
  secondarySource?: string;
  employerName?: string;
  businessName?: string;
  annualIncome?: number;
  additionalDetails?: string;
}

export interface BankStatement {
  id: string;
  transactionId: string;
  bankName: string;
  accountNumber: string;
  statementStartDate: string;
  statementEndDate: string;
  status: string;
}

export interface BankStatementRequest {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  statementStartDate: string;
  statementEndDate: string;
  documentUrl: string;
}

export interface BankStatementValidation {
  valid: boolean;
  message: string;
  coverageDays: number;
  requiredDays: number;
}

export interface IncomeDocument {
  id: string;
  transactionId: string;
  documentType: string;
  status: string;
}

export interface IncomeDocumentRequest {
  documentType: string;
  documentUrl: string;
  issuerName?: string;
  documentDate?: string;
  amount?: number;
}

export interface PurchaseAgreement {
  id: string;
  transactionId: string;
  buyerName: string;
  sellerName: string;
  propertyAddress: string;
  purchasePrice: number;
  buyerInfoMatchesKyc: boolean;
  sellerInfoMatchesKyc: boolean;
  status: string;
}

export interface PurchaseAgreementRequest {
  documentUrl: string;
  buyerName: string;
  buyerAddress: string;
  sellerName: string;
  sellerAddress: string;
  propertyAddress: string;
  propertyDescription: string;
  propertyType: string;
  purchasePrice: number;
  completionDate?: string;
}

export interface PurchaseAgreementValidation {
  buyerMatch: { matches: boolean; kycName: string; agreementName: string };
  sellerMatch: { matches: boolean; kycName: string; agreementName: string };
  priceMatch: {
    matches: boolean;
    transactionPrice: number;
    agreementPrice: number;
  };
  allValid: boolean;
}

export interface PropertyTransactionChecklist {
  transactionId: string;
  requirements: {
    name: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    description: string;
  }[];
  overallProgress: number;
  canSubmitForReview: boolean;
}

export interface FlowDocumentation {
  steps: {
    step: number;
    name: string;
    description: string;
    endpoint: string;
  }[];
}

export interface VirtualAccount {
  id: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  currency: string;
  status: string;
  createdAt: string;
}

export interface CreateVirtualAccountRequest {
  currency: string;
  bankPreference?: string;
}

export interface VirtualCard {
  id: string;
  cardNumber: string;
  expiryDate: string;
  cvv: string;
  cardType: string;
  currency: string;
  balance: number;
  limit: number;
  status: "active" | "frozen" | "expired";
  createdAt: string;
}

export interface CreateCardRequest {
  cardType: string;
  currency: string;
  initialFunding?: number;
}

export interface CardTransaction {
  id: string;
  cardId: string;
  amount: number;
  currency: string;
  merchant: string;
  status: string;
  createdAt: string;
}

export interface Referral {
  id: string;
  referredEmail: string;
  status: string;
  rewardEarned: number;
  createdAt: string;
}

export interface ReferralReward {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "available" | "claimed";
  source: string;
  createdAt: string;
}

export interface SavingsGoal {
  id?: string;
  goal_id?: string;
  name: string;
  targetAmount?: number;
  target_amount?: number;
  currentAmount?: number;
  current_amount?: number;
  currency?: string;
  stablecoin?: string;
  targetDate?: string;
  target_date?: string;
  status:
    | "active"
    | "completed"
    | "withdrawn"
    | "ACTIVE"
    | "COMPLETED"
    | "WITHDRAWN";
  interestRate?: number;
  createdAt?: string;
  created_at?: string;
}

export interface CreateSavingsGoalRequest {
  name: string;
  target_amount: number;
  target_date: string;
  enable_auto_save: boolean;
  currency?: string;
}

export interface SavingsContribution {
  id: string;
  goalId: string;
  amount: number;
  createdAt: string;
}

export interface SavingsWithdrawal {
  id: string;
  goalId: string;
  amount: number;
  penalty?: number;
  createdAt: string;
}

// Notification types
export interface Notification {
  id: string;
  type: "transaction" | "security" | "promotion" | "system" | "kyc";
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  actionUrl?: string;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
  transactionAlerts: boolean;
  securityAlerts: boolean;
  promotionalAlerts: boolean;
}

// Settings types
export interface UserPreferences {
  language: string;
  currency: string;
  theme: "light" | "dark" | "system";
  biometricAuth: boolean;
  twoFactorAuth: boolean;
  transactionNotifications: boolean;
  marketingEmails: boolean;
  autoLogoutMinutes: number;
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  biometricEnabled: boolean;
  loginNotifications: boolean;
  transactionPin: boolean;
  trustedDevices: { id: string; name: string; lastUsed: string }[];
}

// Support types
export interface CreateSupportTicketRequest {
  subject: string;
  category: string;
  message: string;
  priority?: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: string;
  createdAt: string;
  updatedAt: string;
  messages: SupportMessage[];
}

export interface SupportMessage {
  id: string;
  sender: "user" | "agent";
  message: string;
  createdAt: string;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
}

// Profile types
export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  avatarUrl?: string;
  kycTier: number;
  createdAt: string;
}

export interface LinkedAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  isDefault: boolean;
}

export interface LinkAccountRequest {
  bankCode: string;
  accountNumber: string;
}

// Bank directory types
export interface Bank {
  logo: string;
  tenant_id: string;
  created_at: string;
  status: string;
  updated_at: string;
  code: number;
  ledger_id: string;
  deleted_at: string | null;
  name: string;
}

export interface BankListResponse {
  message: string;
  banks: Bank[];
}

// Dashboard types
export interface DashboardSummary {
  balance: { currency: string; amount: number }[];
  recentTransactions: Transaction[];
  exchangeRates: ExchangeRate[];
  stats: {
    totalSent: number;
    totalReceived: number;
    transactionCount: number;
  };
}

// Beneficiary types
export interface Beneficiary {
  id: string;
  name: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  phoneNumber?: string;
  email?: string;
  isFavorite: boolean;
  lastUsed?: string;
  totalTransactions: number;
}

export interface CreateBeneficiaryRequest {
  name: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  phoneNumber?: string;
  email?: string;
}

// Dispute types
export interface Dispute {
  id: string;
  transactionId: string;
  transactionRef: string;
  type: string;
  reason: string;
  amount: number;
  currency: string;
  status: "open" | "under_review" | "resolved" | "rejected" | "closed";
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  messages: DisputeMessage[];
}

export interface CreateDisputeRequest {
  transactionId: string;
  type: string;
  reason: string;
  description: string;
}

export interface DisputeMessage {
  id: string;
  sender: "user" | "support";
  message: string;
  createdAt: string;
}

// Audit Log types
export interface AuditLog {
  id: string;
  action: string;
  resource: string;
  details: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

// Security types
export interface LoginHistoryEntry {
  id: string;
  ipAddress: string;
  device: string;
  location: string;
  timestamp: string;
  success: boolean;
}

export interface SecurityRecommendation {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  action: string;
  completed: boolean;
}

// Batch Payment types
export interface BatchPayment {
  id: string;
  name: string;
  totalAmount: number;
  currency: string;
  recipientCount: number;
  status: "draft" | "pending" | "processing" | "completed" | "failed";
  payments: BatchPaymentItem[];
  createdAt: string;
  scheduledAt?: string;
}

export interface BatchPaymentItem {
  recipientName: string;
  accountNumber: string;
  bankCode: string;
  amount: number;
  status: string;
  reference?: string;
}

export interface CreateBatchPaymentRequest {
  name: string;
  currency: string;
  payments: Omit<BatchPaymentItem, "status" | "reference">[];
  scheduledAt?: string;
}

// Stablecoin types
export interface StablecoinBalance {
  coin: string;
  symbol: string;
  balance: number;
  usdValue: number;
}

export interface StablecoinTransaction {
  id: string;
  type: "buy" | "sell" | "send" | "receive" | "convert";
  coin: string;
  amount: number;
  usdValue: number;
  status: string;
  createdAt: string;
}

export interface StablecoinRate {
  coin: string;
  usdRate: number;
  ngnRate: number;
  change24h: number;
}

// FX Alert types
export interface FXAlert {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  targetRate: number;
  currentRate: number;
  direction: "above" | "below";
  status: "active" | "triggered" | "expired";
  createdAt: string;
}

export interface CreateFXAlertRequest {
  fromCurrency: string;
  toCurrency: string;
  targetRate: number;
  direction: "above" | "below";
}

export interface FXReward {
  id: string;
  type: string;
  description: string;
  amount: number;
  currency: string;
  status: "available" | "claimed" | "expired";
  expiresAt: string;
}

// Account Health types
export interface AccountHealth {
  score: number;
  maxScore: number;
  level: "excellent" | "good" | "fair" | "needs_improvement";
  categories: {
    name: string;
    score: number;
    maxScore: number;
    status: string;
  }[];
}

export interface HealthRecommendation {
  id: string;
  title: string;
  description: string;
  impact: number;
  category: string;
  actionUrl?: string;
}

// Payment Performance types
export interface PaymentPerformanceMetrics {
  totalVolume: number;
  totalCount: number;
  successRate: number;
  averageProcessingTime: number;
  volumeByDay: { date: string; amount: number; count: number }[];
  volumeByCurrency: { currency: string; amount: number; count: number }[];
  volumeByType: { type: string; amount: number; count: number }[];
}

export interface PaymentInsight {
  id: string;
  title: string;
  description: string;
  type: "positive" | "neutral" | "negative";
  metric: string;
  value: number;
  change: number;
}

