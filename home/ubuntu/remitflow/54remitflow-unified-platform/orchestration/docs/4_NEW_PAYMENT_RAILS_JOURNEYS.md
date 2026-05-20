# 4 New User Journeys: Mojaloop, CIPS, PIX, and UPI

**Document Version:** 1.0  
**Date:** November 12, 2025  
**Status:** Implementation Ready

---

## Overview

This document defines 4 comprehensive user journeys leveraging next-generation payment rails that represent the future of instant, low-cost cross-border remittances:

1. **Mojaloop** - Open-source instant payment system for financial inclusion (Africa focus)
2. **CIPS** - China International Payment System (RMB cross-border)
3. **PIX** - Brazil's instant payment system (24/7 real-time)
4. **UPI** - India's Unified Payments Interface (instant P2P/P2M)

These systems offer **instant settlement**, **low fees**, and **high availability** compared to traditional correspondent banking.

---

## Journey 31: Mojaloop Instant Transfer (Africa Financial Inclusion)

### Overview

**System:** Mojaloop (Open-source instant payment platform)  
**Coverage:** 10+ African countries (Kenya, Tanzania, Uganda, Rwanda, Ghana, etc.)  
**Settlement:** Real-time (< 5 seconds)  
**Fee Structure:** 0.5% (max ₦200)  
**Use Case:** Diaspora remittances to unbanked/underbanked recipients

### User Story

**As a** Nigerian diaspora worker in the UK  
**I want to** send money instantly to my family in Kenya using their mobile money account  
**So that** they can receive funds immediately without needing a bank account

### Journey Steps

**Step 1: Initiate Transfer**
- User logs into platform
- Selects "Send to Africa" option
- Chooses Mojaloop as payment rail
- Enters recipient details (phone number, country)
- Enters amount in NGN (platform converts to recipient currency)

**Step 2: Recipient Lookup**
- Platform queries Mojaloop network for recipient
- Validates phone number is registered with mobile money provider
- Retrieves recipient name for confirmation
- Shows supported mobile money providers (M-Pesa, MTN Mobile Money, Airtel Money, etc.)

**Step 3: Quote & Confirmation**
- Platform requests quote from Mojaloop
- Displays exchange rate (NGN → KES/UGX/TZS/etc.)
- Shows fees (0.5%, max ₦200)
- Shows total amount recipient will receive
- User confirms transfer

**Step 4: Payment & Settlement**
- Platform debits user's wallet
- Records transaction in TigerBeetle ledger
- Initiates Mojaloop transfer
- Mojaloop performs real-time settlement
- Recipient mobile money account credited instantly

**Step 5: Confirmation & Receipt**
- User receives instant confirmation
- SMS sent to both sender and recipient
- Digital receipt with transaction ID
- Mojaloop transaction reference for tracking

### Technical Requirements

**Mojaloop Integration:**
- Party lookup API (identify recipient)
- Quote API (get exchange rate and fees)
- Transfer API (execute payment)
- Transaction status API (confirm settlement)

**Middleware Integration:**
- Keycloak: User authentication
- Permify: Cross-border transfer authorization
- TigerBeetle: Ledger recording (debit user, credit Mojaloop settlement account)
- Kafka: Event streaming for transaction lifecycle
- Temporal: Workflow orchestration with compensation

**Data Requirements:**
- Recipient phone number (E.164 format)
- Recipient country code
- Mobile money provider (auto-detected or user-selected)
- Transfer amount and currency

### Business Rules

- Minimum transfer: ₦1,000
- Maximum transfer: ₦500,000 per transaction
- Daily limit: ₦2,000,000
- Supported currencies: KES, UGX, TZS, RWF, GHS, ZMW, MWK
- KYC requirement: Standard tier minimum
- Settlement time: < 5 seconds (real-time)

### Error Handling

- **Recipient not found:** Suggest alternative payment methods
- **Insufficient liquidity:** Retry with exponential backoff or route through alternative rail
- **Network timeout:** Implement idempotency to prevent duplicate transfers
- **Currency conversion failure:** Lock exchange rate for 30 seconds, retry quote

---

## Journey 32: CIPS Cross-Border Payment (China RMB)

### Overview

**System:** CIPS (China International Payment System)  
**Coverage:** China + 100+ participating countries  
**Settlement:** Same-day or T+1  
**Fee Structure:** 1% (min ₦500, max ₦5,000)  
**Use Case:** Business payments, large remittances to China in RMB

### User Story

**As a** Nigerian business owner importing goods from China  
**I want to** pay my Chinese supplier directly in RMB using CIPS  
**So that** I avoid high SWIFT fees and get better exchange rates

### Journey Steps

**Step 1: Initiate CIPS Payment**
- User logs into business account
- Selects "Pay Supplier" → "China (CIPS)"
- Enters supplier details (Chinese bank account, CNAPS code)
- Enters amount (NGN or RMB)
- Attaches invoice/purchase order

**Step 2: Compliance & Documentation**
- Platform validates supplier information
- Checks against sanctions lists (OFAC, UN, EU)
- Requests trade documentation (invoice, contract, shipping docs)
- Performs AML screening
- Validates business relationship

**Step 3: FX Quote & Approval**
- Platform requests NGN/RMB exchange rate
- Shows mid-market rate + 0.5% spread
- Displays CIPS fee (1%, min ₦500, max ₦5,000)
- Shows total cost in NGN
- User approves payment

**Step 4: Payment Execution**
- Platform debits business account
- Records in TigerBeetle ledger
- Submits payment to CIPS network
- CIPS routes to recipient bank in China
- Settlement occurs (same-day or T+1)

**Step 5: Confirmation & Tracking**
- User receives payment confirmation
- CIPS reference number provided
- Email notification with payment details
- Tracking available for settlement status
- Supplier receives RMB in Chinese bank account

### Technical Requirements

**CIPS Integration:**
- Participant identification (BIC code)
- Payment initiation (ISO 20022 format)
- Status tracking API
- Settlement confirmation

**Middleware Integration:**
- Keycloak: Business user authentication + MFA
- Permify: Business payment authorization (maker-checker workflow)
- TigerBeetle: Ledger recording + fund reservation
- Kafka: Payment lifecycle events
- Temporal: Long-running workflow (T+1 settlement)
- Dapr: Service mesh for CIPS connectivity

**Data Requirements:**
- Supplier Chinese bank account number
- Supplier bank CNAPS code (China National Advanced Payment System)
- Supplier name (must match bank records)
- Payment purpose/invoice reference
- Trade documentation

### Business Rules

- Minimum payment: ₦50,000
- Maximum payment: ₦50,000,000 per transaction
- KYC requirement: Enhanced tier (business verification)
- Supported currencies: RMB (CNY) only
- Settlement: Same-day (if submitted before 3 PM Beijing time), otherwise T+1
- Documentation required for amounts > ₦1,000,000

### Error Handling

- **Invalid CNAPS code:** Validate against CIPS directory, suggest corrections
- **Sanctions hit:** Block payment, notify compliance team, file SAR if required
- **Insufficient documentation:** Request additional docs, hold payment in escrow
- **FX rate expired:** Re-quote and request user confirmation
- **Settlement failure:** Automatic refund to user account within 24 hours

---

## Journey 33: PIX Instant Payment (Brazil)

### Overview

**System:** PIX (Brazil Central Bank instant payment system)  
**Coverage:** Brazil nationwide  
**Settlement:** Instant (< 10 seconds), 24/7/365  
**Fee Structure:** 0.3% (max ₦150)  
**Use Case:** Remittances to Brazil, e-commerce payments, P2P transfers

### User Story

**As a** Brazilian working in Nigeria  
**I want to** send money instantly to my family in Brazil using PIX  
**So that** they receive funds immediately, even on weekends and holidays

### Journey Steps

**Step 1: Initiate PIX Transfer**
- User logs into platform
- Selects "Send to Brazil (PIX)"
- Chooses recipient identification method:
  - CPF/CNPJ (tax ID)
  - Phone number
  - Email address
  - Random key (UUID)
  - QR code
- Enters amount in NGN or BRL

**Step 2: Recipient Validation**
- Platform queries PIX directory (DICT)
- Retrieves recipient name and bank
- Displays recipient information for confirmation
- User verifies recipient identity

**Step 3: FX Quote & Confirmation**
- Platform shows NGN/BRL exchange rate
- Displays PIX fee (0.3%, max ₦150)
- Shows total BRL amount recipient will receive
- User confirms transfer
- Rate locked for 60 seconds

**Step 4: Instant Settlement**
- Platform debits user wallet
- Records in TigerBeetle ledger
- Initiates PIX payment through Brazilian partner bank
- PIX network settles instantly (< 10 seconds)
- Recipient receives BRL in their Brazilian bank account

**Step 5: Instant Confirmation**
- User receives immediate confirmation
- PIX transaction ID (End-to-End ID)
- SMS/email notification to both parties
- Digital receipt with QR code
- Recipient can verify payment in their bank app instantly

### Technical Requirements

**PIX Integration:**
- DICT lookup API (recipient identification)
- Payment initiation API (ISO 20022)
- QR code generation/scanning
- Transaction status API
- Instant settlement confirmation

**Middleware Integration:**
- Keycloak: User authentication
- Permify: Transfer authorization
- TigerBeetle: Instant ledger recording
- Kafka: Real-time event streaming
- Temporal: Workflow orchestration (with timeout handling)
- Redis: Rate locking and caching

**Data Requirements:**
- Recipient PIX key (CPF, phone, email, or random key)
- Transfer amount
- Optional: Payment description/message

### Business Rules

- Minimum transfer: ₦500
- Maximum transfer: ₦1,000,000 per transaction
- Daily limit: ₦5,000,000
- Available: 24/7/365 (including weekends and holidays)
- KYC requirement: Basic tier minimum
- Settlement: Instant (< 10 seconds)
- No chargebacks (instant finality)

### Error Handling

- **Invalid PIX key:** Validate format, suggest corrections
- **Recipient not found:** Prompt user to verify key with recipient
- **Daily limit exceeded:** Show limit, suggest scheduling for next day
- **Network timeout:** Implement idempotency, check transaction status before retry
- **FX rate expired:** Auto-refresh rate, request confirmation

### PIX-Specific Features

**QR Code Payments:**
- Recipient generates PIX QR code
- Sender scans QR code in app
- Amount and recipient pre-filled
- One-tap confirmation

**PIX Pix Copy & Paste:**
- Recipient shares PIX code (text string)
- Sender pastes code in app
- Platform decodes and pre-fills details

**Scheduled PIX:**
- Schedule future PIX payment
- Platform holds funds in escrow
- Executes automatically at scheduled time

---

## Journey 34: UPI Instant Transfer (India)

### Overview

**System:** UPI (Unified Payments Interface)  
**Coverage:** India nationwide  
**Settlement:** Real-time (< 5 seconds), 24/7/365  
**Fee Structure:** 0.5% (max ₦200)  
**Use Case:** Remittances to India, bill payments, merchant payments

### User Story

**As an** Indian expatriate in Nigeria  
**I want to** send money instantly to my family in India using UPI  
**So that** they receive funds in seconds and can use them immediately

### Journey Steps

**Step 1: Initiate UPI Transfer**
- User logs into platform
- Selects "Send to India (UPI)"
- Chooses recipient identification:
  - UPI ID (e.g., name@okaxis, mobile@paytm)
  - Phone number linked to UPI
  - Bank account + IFSC code
  - QR code scan
- Enters amount in NGN or INR

**Step 2: Recipient Lookup**
- Platform queries NPCI (National Payments Corporation of India)
- Validates UPI ID or phone number
- Retrieves recipient name
- Shows linked bank (if available)
- User confirms recipient

**Step 3: Payment Authorization**
- Platform shows NGN/INR exchange rate
- Displays UPI fee (0.5%, max ₦200)
- Shows total INR amount recipient will receive
- User enters UPI PIN or biometric authentication
- Payment authorized

**Step 4: Real-Time Settlement**
- Platform debits user wallet
- Records in TigerBeetle ledger
- Initiates UPI payment through Indian partner bank
- NPCI processes payment in real-time
- Recipient's bank account credited instantly (< 5 seconds)

**Step 5: Instant Confirmation**
- User receives immediate confirmation
- UPI transaction reference (RRN - Retrieval Reference Number)
- SMS to both sender and recipient
- Digital receipt
- Recipient gets instant bank notification

### Technical Requirements

**UPI Integration:**
- Account validation API
- Payment initiation API
- Transaction status API (check payment status)
- QR code generation/scanning
- Collect request API (request money from recipient)

**Middleware Integration:**
- Keycloak: User authentication + UPI PIN management
- Permify: Transfer authorization
- TigerBeetle: Real-time ledger recording
- Kafka: Event streaming
- Temporal: Workflow orchestration
- Redis: Session management for UPI PIN

**Data Requirements:**
- Recipient UPI ID or phone number
- Transfer amount
- Optional: Payment remark/description
- UPI PIN (for authentication)

### Business Rules

- Minimum transfer: ₦100
- Maximum transfer: ₦100,000 per transaction (UPI limit: ₹1 lakh)
- Daily limit: ₦500,000
- Available: 24/7/365
- KYC requirement: Basic tier
- Settlement: Instant (< 5 seconds)
- Transaction limit: 20 transactions per day (UPI limit)

### Error Handling

- **Invalid UPI ID:** Validate format (username@bankcode), suggest corrections
- **Recipient not found:** Prompt to verify UPI ID with recipient
- **UPI limit exceeded:** Show limits, suggest breaking into multiple transactions
- **Bank downtime:** Show affected banks, suggest alternative payment method
- **Incorrect PIN:** Allow 3 attempts, then lock for 24 hours

### UPI-Specific Features

**UPI Collect Request:**
- Sender initiates collect request
- Recipient approves payment from their UPI app
- Useful for merchant payments

**UPI Mandate:**
- Set up recurring UPI payments
- Auto-debit for subscriptions
- User approves mandate once, subsequent payments automatic

**UPI QR Code:**
- Static QR for merchants
- Dynamic QR for specific amounts
- Scan and pay in seconds

**UPI AutoPay:**
- Recurring payments up to ₹5,000
- No PIN required for each transaction
- Useful for subscriptions, bills

---

## Comparative Analysis

| Feature | Mojaloop | CIPS | PIX | UPI |
|---------|----------|------|-----|-----|
| **Geography** | Africa | China + Global | Brazil | India |
| **Settlement** | < 5 sec | T+0 or T+1 | < 10 sec | < 5 sec |
| **Availability** | 24/7 | Business hours | 24/7/365 | 24/7/365 |
| **Fee** | 0.5% | 1% | 0.3% | 0.5% |
| **Max Amount** | ₦500k | ₦50M | ₦1M | ₦100k |
| **KYC Tier** | Standard | Enhanced | Basic | Basic |
| **Use Case** | Mobile money | B2B payments | P2P/P2M | P2P/P2M |
| **Recipient ID** | Phone | Bank account | PIX key | UPI ID |
| **Finality** | Instant | T+1 | Instant | Instant |

---

## Implementation Priority

**Phase 1 (Week 1):** UPI + PIX  
- Largest diaspora populations (India, Brazil)
- Instant settlement, high user demand
- Lower complexity (mature APIs)

**Phase 2 (Week 2):** Mojaloop  
- Strategic for African expansion
- Supports financial inclusion mission
- Open-source, community support

**Phase 3 (Week 3):** CIPS  
- B2B focus, higher complexity
- Requires enhanced compliance
- Larger transaction sizes

---

## Success Metrics

**Transaction Volume:**
- UPI: 10,000 transactions/month (target)
- PIX: 5,000 transactions/month
- Mojaloop: 3,000 transactions/month
- CIPS: 500 transactions/month

**User Satisfaction:**
- Settlement time: < 10 seconds (95th percentile)
- Success rate: > 99%
- User rating: > 4.5/5

**Business Metrics:**
- Revenue per transaction: ₦50-500
- Customer acquisition cost: < ₦2,000
- Lifetime value: > ₦50,000

---

## Next Steps

1. Implement Temporal workflows for each payment rail
2. Integrate with payment system APIs (Mojaloop, CIPS, PIX, UPI)
3. Create middleware integrations (Keycloak, Permify, TigerBeetle)
4. Build frontend components for each journey
5. Conduct integration testing
6. Deploy to staging environment
7. Launch beta program with select users
8. Gather feedback and iterate
9. Full production launch

---

**Document Status:** Ready for Implementation  
**Estimated Implementation Time:** 3 weeks (with 2 developers)  
**Business Impact:** High - Opens 4 major remittance corridors with instant settlement
