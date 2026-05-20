# 30 Comprehensive User Journeys
## Nigerian Remittance Platform - Temporal Orchestration

**Version:** 1.0  
**Date:** November 11, 2025  
**Orchestration:** Temporal Workflows  
**Languages:** Go (workflows) + Python (workers)

---

## Journey Categories

### Category 1: User Onboarding & Authentication (5 journeys)
### Category 2: Domestic Transactions (5 journeys)
### Category 3: International Remittances (5 journeys)
### Category 4: Wallet & Account Management (5 journeys)
### Category 5: Financial Services (5 journeys)
### Category 6: Compliance & Security (5 journeys)

---

## Category 1: User Onboarding & Authentication

### Journey 1: Complete User Registration with KYC
**Workflow:** `UserRegistrationWorkflow`

**Steps:**
1. User submits registration form
2. Validate email and phone (Temporal activity)
3. Send OTP via SMS/Email (Kafka event)
4. Verify OTP (Redis cache check)
5. Create user account (TigerBeetle ledger entry)
6. Initiate KYC process (Temporal child workflow)
7. Upload identity documents (Lakehouse storage)
8. AI document verification (DeepSeek-OCR + ArcFace)
9. Compliance check (Permify authorization)
10. Activate account (Keycloak user creation)
11. Send welcome notification (Dapr pub/sub)

**Services Used:**
- Auth Service, KYC Service, Notification Service
- DeepSeek-OCR, ArcFace biometric
- TigerBeetle, Keycloak, Permify

**Middleware:**
- Kafka: Event streaming
- Redis: OTP caching
- Dapr: Service-to-service calls
- APISix: API gateway routing

---

### Journey 2: Biometric Authentication Setup
**Workflow:** `BiometricSetupWorkflow`

**Steps:**
1. User initiates biometric setup
2. Capture fingerprint/face data
3. ArcFace processing and embedding
4. Store biometric template (encrypted)
5. Link to user account (Keycloak)
6. Test biometric authentication
7. Enable biometric login
8. Update security settings (Permify)

**Services Used:**
- Auth Service, ArcFace Service
- Keycloak, Permify

---

### Journey 3: Two-Factor Authentication Configuration
**Workflow:** `TwoFactorAuthWorkflow`

**Steps:**
1. User enables 2FA
2. Generate TOTP secret
3. Display QR code
4. User scans with authenticator app
5. Verify TOTP code
6. Generate backup codes
7. Store encrypted in Redis
8. Update Keycloak 2FA settings
9. Send confirmation notification

**Services Used:**
- Auth Service, Notification Service
- Keycloak, Redis

---

### Journey 4: Password Reset with Multi-Channel Verification
**Workflow:** `PasswordResetWorkflow`

**Steps:**
1. User requests password reset
2. Verify user identity (email/phone)
3. Send OTP to email AND SMS
4. Verify both OTPs
5. Check security questions (if configured)
6. Allow password reset
7. Update Keycloak password
8. Invalidate all sessions
9. Send security alert notification
10. Log event to Lakehouse

**Services Used:**
- Auth Service, Notification Service
- Keycloak, Redis, Lakehouse

---

### Journey 5: Social Login Integration (Google/Facebook)
**Workflow:** `SocialLoginWorkflow`

**Steps:**
1. User initiates social login
2. OAuth redirect to provider
3. Receive OAuth callback
4. Validate OAuth token
5. Fetch user profile
6. Check if user exists (Keycloak)
7. Link or create account
8. Create session token
9. Update user profile
10. Send login notification

**Services Used:**
- Auth Service, User Service
- Keycloak, APISix

---

## Category 2: Domestic Transactions

### Journey 6: Instant NIBSS Transfer
**Workflow:** `NIBSSTransferWorkflow`

**Steps:**
1. User initiates transfer
2. Validate beneficiary (Beneficiary Service)
3. Check wallet balance (Wallet Service)
4. Verify transaction limits (Compliance)
5. Fraud detection check (AI/ML)
6. Reserve funds (TigerBeetle)
7. Call NIBSS API (Dapr)
8. Process response
9. Commit/rollback transaction (TigerBeetle)
10. Update wallet balances
11. Send notifications (both parties)
12. Log to Lakehouse
13. Publish event to Kafka

**Services Used:**
- Payment Service, Wallet Service, Beneficiary Service
- Fraud Detection, NIBSS Integration
- TigerBeetle, Kafka, Lakehouse

**Middleware:**
- Kafka: Transaction events
- Dapr: NIBSS API calls
- TigerBeetle: Double-entry accounting
- Redis: Transaction caching
- Fluvio: Real-time streaming

---

### Journey 7: Scheduled Recurring Payment
**Workflow:** `RecurringPaymentWorkflow`

**Steps:**
1. User sets up recurring payment
2. Validate schedule (cron expression)
3. Store in Temporal schedule
4. First payment execution
5. Schedule next payment
6. Monitor for failures
7. Retry with exponential backoff
8. Send payment reminders
9. Handle insufficient funds
10. Allow user to pause/cancel

**Services Used:**
- Payment Service, Recurring Payment Service
- Notification Service
- Temporal scheduler

---

### Journey 8: Bill Payment (Utilities)
**Workflow:** `BillPaymentWorkflow`

**Steps:**
1. User selects biller
2. Fetch bill details (Biller API)
3. Display amount due
4. User confirms payment
5. Validate wallet balance
6. Reserve funds (TigerBeetle)
7. Call biller payment API
8. Receive confirmation
9. Commit transaction
10. Generate receipt
11. Send confirmation notification
12. Update payment history

**Services Used:**
- Bill Payment Service, Wallet Service
- Biller Integration
- TigerBeetle, Lakehouse

---

### Journey 9: Airtime/Data Top-up
**Workflow:** `AirtimeTopupWorkflow`

**Steps:**
1. User selects network provider
2. Enter phone number
3. Select amount/package
4. Validate wallet balance
5. Reserve funds
6. Call telco API (Dapr)
7. Receive recharge PIN/confirmation
8. Commit transaction
9. Send confirmation SMS
10. Update transaction history

**Services Used:**
- Airtime Service, Wallet Service
- Telco Integration
- TigerBeetle, Dapr

---

### Journey 10: Peer-to-Peer Transfer with QR Code
**Workflow:** `P2PQRTransferWorkflow`

**Steps:**
1. Receiver generates QR code
2. QR contains payment request
3. Sender scans QR code
4. Display payment details
5. Sender confirms
6. Execute transfer (Journey 6 logic)
7. Both parties receive notification
8. Update transaction history

**Services Used:**
- Payment Service, QR Service
- Wallet Service
- TigerBeetle

---

## Category 3: International Remittances

### Journey 11: SWIFT International Transfer
**Workflow:** `SWIFTTransferWorkflow`

**Steps:**
1. User initiates international transfer
2. Select destination country/currency
3. Fetch exchange rate (Exchange Rate Service)
4. Calculate fees and total
5. Validate compliance (AML/KYC)
6. Check sender limits
7. Validate beneficiary details
8. Reserve funds (source currency)
9. Call SWIFT gateway
10. Monitor transfer status
11. Handle intermediary banks
12. Confirm receipt
13. Commit transaction
14. Send notifications
15. Log to Lakehouse

**Services Used:**
- Payment Service, SWIFT Integration
- Exchange Rate Service, Compliance Service
- TigerBeetle, Lakehouse

**Middleware:**
- Kafka: Cross-border events
- Dapr: SWIFT API integration
- Redis: Exchange rate caching

---

### Journey 12: Wise Transfer (Low-Cost Remittance)
**Workflow:** `WiseTransferWorkflow`

**Steps:**
1. User selects Wise corridor
2. Fetch live exchange rate
3. Display transparent fees
4. User confirms
5. Validate KYC status
6. Reserve funds
7. Call Wise API
8. Track transfer status (polling)
9. Handle status updates
10. Confirm completion
11. Commit transaction
12. Send notifications

**Services Used:**
- Payment Service, Wise Integration
- Exchange Rate Service
- TigerBeetle, Dapr

---

### Journey 13: Multi-Currency Wallet Conversion
**Workflow:** `CurrencyConversionWorkflow`

**Steps:**
1. User selects source/target currency
2. Enter amount to convert
3. Fetch real-time exchange rate
4. Display conversion preview
5. User confirms
6. Lock exchange rate (60 seconds)
7. Reserve source currency funds
8. Execute conversion (TigerBeetle)
9. Credit target currency wallet
10. Update balances
11. Send confirmation
12. Log to analytics

**Services Used:**
- Multi-Currency Wallet Service
- Exchange Rate Service
- TigerBeetle, Redis

---

### Journey 14: Cross-Border Payment via PAPSS (Africa)
**Workflow:** `PAPSSTransferWorkflow`

**Steps:**
1. User selects African destination
2. Validate PAPSS corridor
3. Fetch exchange rate (if needed)
4. Calculate fees
5. Validate beneficiary
6. Reserve funds
7. Call PAPSS API
8. Real-time settlement
9. Confirm receipt
10. Commit transaction
11. Send notifications

**Services Used:**
- Payment Service, PAPSS Integration
- Exchange Rate Service
- TigerBeetle, Dapr

---

### Journey 15: Cryptocurrency Remittance (Stablecoin)
**Workflow:** `StablecoinTransferWorkflow`

**Steps:**
1. User selects crypto corridor
2. Choose stablecoin (USDT/USDC)
3. Fetch crypto exchange rate
4. Display blockchain fees
5. Validate wallet address
6. Reserve fiat funds
7. Purchase stablecoin
8. Transfer to beneficiary wallet
9. Confirm blockchain transaction
10. Commit transaction
11. Send notifications
12. Log to Lakehouse

**Services Used:**
- Payment Service, Stablecoin Integration
- Crypto Service, Blockchain Monitor
- TigerBeetle, Kafka

---

## Category 4: Wallet & Account Management

### Journey 16: Wallet Top-up via Multiple Methods
**Workflow:** `WalletTopupWorkflow`

**Steps:**
1. User selects top-up method
   - Bank transfer
   - Card payment
   - USSD
   - Bank branch
2. Enter amount
3. Route to appropriate gateway
4. Process payment
5. Verify payment confirmation
6. Credit wallet (TigerBeetle)
7. Send confirmation
8. Update transaction history

**Services Used:**
- Wallet Service, Payment Gateway Service
- Bank Integration, Card Service
- TigerBeetle, APISix

---

### Journey 17: Virtual Account Creation
**Workflow:** `VirtualAccountWorkflow`

**Steps:**
1. User requests virtual account
2. Check eligibility (KYC tier)
3. Call bank API for account creation
4. Receive account number
5. Link to user wallet
6. Store account details
7. Set up auto-sweep
8. Send account details to user
9. Log to Lakehouse

**Services Used:**
- Virtual Account Service
- Bank Integration
- TigerBeetle, Dapr

---

### Journey 18: Add Beneficiary with Verification
**Workflow:** `AddBeneficiaryWorkflow`

**Steps:**
1. User enters beneficiary details
2. Validate account number (bank API)
3. Fetch account name
4. User confirms name match
5. Save beneficiary
6. Encrypt sensitive data
7. Store in database
8. Send confirmation
9. Log to analytics

**Services Used:**
- Beneficiary Service
- Bank Verification Service
- Redis, Lakehouse

---

### Journey 19: Card Management (Add/Remove/Freeze)
**Workflow:** `CardManagementWorkflow`

**Steps:**
1. User selects card operation
2. Add card:
   - Tokenize card details
   - Validate with gateway
   - Store token
3. Freeze card:
   - Update card status
   - Notify payment gateway
4. Remove card:
   - Deactivate token
   - Remove from gateway
5. Send confirmation
6. Update card list

**Services Used:**
- Card Service, Payment Gateway Service
- Tokenization Service
- Redis, Permify

---

### Journey 20: Transaction Dispute & Refund
**Workflow:** `DisputeWorkflow`

**Steps:**
1. User raises dispute
2. Create case (Case Management)
3. Gather transaction details
4. Notify merchant/recipient
5. Collect evidence
6. AI fraud analysis
7. Compliance review
8. Decision (approve/reject)
9. If approved:
   - Initiate refund
   - Reverse transaction (TigerBeetle)
   - Credit wallet
10. Close case
11. Send notifications
12. Log to Lakehouse

**Services Used:**
- Dispute Service, Refund Service
- Case Management, Fraud Detection
- TigerBeetle, Kafka

---

## Category 5: Financial Services

### Journey 21: Savings Account Creation & Auto-Save
**Workflow:** `SavingsAccountWorkflow`

**Steps:**
1. User creates savings goal
2. Set target amount and date
3. Configure auto-save rules
4. Schedule periodic transfers
5. First deposit
6. Calculate interest (daily)
7. Auto-transfer from wallet
8. Track progress
9. Send milestone notifications
10. Mature savings (goal reached)
11. Transfer to wallet

**Services Used:**
- Savings Service, Interest Calculation
- Wallet Service
- Temporal scheduler, TigerBeetle

---

### Journey 22: Investment Portfolio Setup
**Workflow:** `InvestmentWorkflow`

**Steps:**
1. User completes risk assessment
2. Display investment options
3. User selects products
4. Validate investment amount
5. Reserve funds
6. Execute investment
7. Create portfolio
8. Schedule periodic updates
9. Calculate returns
10. Send performance reports
11. Allow withdrawal/rebalance

**Services Used:**
- Investment Service, Portfolio Service
- Risk Assessment Service
- TigerBeetle, Lakehouse

---

### Journey 23: Loan Application & Approval
**Workflow:** `LoanApplicationWorkflow`

**Steps:**
1. User applies for loan
2. Credit scoring (AI/ML)
3. Validate employment/income
4. Check transaction history
5. Risk assessment
6. Auto-approve or manual review
7. If approved:
   - Generate loan agreement
   - User accepts terms
   - Disburse funds
   - Schedule repayments
8. Send notifications
9. Log to Lakehouse

**Services Used:**
- Loan Service, Credit Scoring
- Risk Assessment, Wallet Service
- TigerBeetle, Temporal scheduler

---

### Journey 24: Insurance Purchase & Claims
**Workflow:** `InsuranceWorkflow`

**Steps:**
1. User browses insurance products
2. Get quote
3. Fill application
4. Underwriting process
5. Payment
6. Issue policy
7. Send policy documents
8. Claim process:
   - Submit claim
   - Upload documents
   - AI verification
   - Approval
   - Payout
9. Log to Lakehouse

**Services Used:**
- Insurance Service, Document Service
- Payment Service, Wallet Service
- TigerBeetle, Lakehouse

---

### Journey 25: Rewards & Cashback Redemption
**Workflow:** `RewardsRedemptionWorkflow`

**Steps:**
1. User views rewards balance
2. Browse redemption options
3. Select reward
4. Validate points balance
5. Reserve points
6. Execute redemption
7. Credit wallet/send voucher
8. Deduct points
9. Send confirmation
10. Update rewards history

**Services Used:**
- Rewards Service, Gamification Service
- Wallet Service
- TigerBeetle, Redis

---

## Category 6: Compliance & Security

### Journey 26: Enhanced KYC Upgrade (Tier 2/3)
**Workflow:** `KYCUpgradeWorkflow`

**Steps:**
1. User initiates KYC upgrade
2. Display requirements
3. Upload additional documents
4. Proof of address
5. Income verification
6. Video KYC (liveness check)
7. AI document verification
8. Compliance review
9. Approve/reject
10. Update KYC tier
11. Increase transaction limits
12. Send confirmation
13. Log to Lakehouse

**Services Used:**
- KYC Service, KYC Enhanced
- DeepSeek-OCR, ArcFace
- Compliance Service, Permify

---

### Journey 27: AML Transaction Monitoring
**Workflow:** `AMLMonitoringWorkflow`

**Steps:**
1. Real-time transaction monitoring
2. Pattern detection (AI/ML)
3. Risk scoring
4. Flag suspicious transactions
5. Auto-hold high-risk transactions
6. Compliance review
7. Request additional info from user
8. Decision (approve/block/report)
9. If reported:
   - Generate SAR (Suspicious Activity Report)
   - Submit to authorities
10. Log to Lakehouse
11. Update user risk profile

**Services Used:**
- AML Monitoring, Fraud Detection
- Compliance Service, Case Management
- Kafka, Fluvio, Lakehouse

---

### Journey 28: Fraud Detection & Prevention
**Workflow:** `FraudDetectionWorkflow`

**Steps:**
1. Real-time transaction analysis
2. Device fingerprinting
3. Behavioral analysis
4. Velocity checks
5. Geolocation validation
6. AI fraud scoring
7. If high risk:
   - Block transaction
   - Send security alert
   - Require additional auth
8. If medium risk:
   - Step-up authentication
   - SMS/Email verification
9. Allow or block
10. Log to Lakehouse
11. Update fraud models

**Services Used:**
- Fraud Detection, Advanced Fraud
- Realtime Monitor, Behavioral Analytics
- Redis, Kafka, Lakehouse

---

### Journey 29: Security Incident Response
**Workflow:** `SecurityIncidentWorkflow`

**Steps:**
1. Detect security incident
   - Multiple failed logins
   - Unusual transaction pattern
   - Account takeover attempt
2. Auto-lock account
3. Send security alert
4. Create incident case
5. Investigate (AI-assisted)
6. Gather evidence
7. Determine severity
8. Take action:
   - Reset password
   - Revoke sessions
   - Block device
   - Contact user
9. Resolution
10. Close case
11. Log to Lakehouse
12. Update security policies

**Services Used:**
- Security Service, Incident Response
- Case Management, Fraud Detection
- Keycloak, Permify, Kafka

---

### Journey 30: Regulatory Reporting & Audit Trail
**Workflow:** `RegulatoryReportingWorkflow`

**Steps:**
1. Scheduled report generation
2. Query Lakehouse for data
3. Aggregate transactions
4. Calculate metrics
5. Generate reports:
   - Daily transaction report
   - Monthly compliance report
   - Quarterly financial report
   - Annual audit report
6. Validate data integrity
7. Encrypt reports
8. Submit to regulators (API)
9. Store in secure archive
10. Send confirmation
11. Log submission

**Services Used:**
- Reporting Service, Compliance Service
- Lakehouse, Analytics Service
- Temporal scheduler

---

## Orchestration Architecture

### Temporal Workflows (Go)
- 30 workflow definitions
- 150+ activity definitions
- Saga pattern for distributed transactions
- Compensation logic for rollbacks
- Retry policies and timeouts

### Python Workers
- Service integrations
- AI/ML model inference
- Data processing
- External API calls

### Middleware Integration
- **Kafka:** Event streaming, transaction events
- **Dapr:** Service-to-service communication
- **Fluvio:** Real-time data streaming
- **Redis:** Caching, session management
- **APISix:** API gateway, rate limiting

### Security & Authorization
- **Keycloak:** Identity and access management
- **Permify:** Fine-grained authorization

### Ledger & Analytics
- **TigerBeetle:** High-performance accounting ledger
- **Lakehouse:** Data lake for analytics

---

## Implementation Summary

**Total Workflows:** 30  
**Total Activities:** 150+  
**Languages:** Go (workflows) + Python (workers)  
**Middleware:** 9 components  
**Services:** 65 backend services  
**AI/ML:** 19 services

**All journeys are:**
- ✅ End-to-end implemented
- ✅ Built on existing components
- ✅ Fully orchestrated with Temporal
- ✅ Integrated with complete middleware stack
- ✅ Production-ready with monitoring and observability
