# Property Transaction KYC Flow

## Overview

This document describes the complete KYC flow for high-value property transactions, implementing bank-grade compliance requirements including:

1. Government Issued ID of Client (Buyer)
2. Government Issued ID of Seller (Counterparty) - **Closed Loop Ecosystem**
3. Source of Funds verification
4. Three months of bank statements
5. W-2 or similar income document
6. Purchase Agreement with party validation

## Flow Diagram

```
                                    PROPERTY TRANSACTION KYC FLOW
                                    ==============================

    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │                                    INITIATION                                        │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  1. BUYER INITIATES TRANSACTION                                                      │
    │     POST /property-kyc/transactions                                                  │
    │     - Property type, address, purchase price                                         │
    │     - Transaction reference generated (PTX-XXXXXXXX)                                 │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │                                    BUYER KYC                                         │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  2. BUYER IDENTITY VERIFICATION                                                      │
    │     POST /property-kyc/parties                                                       │
    │     ┌──────────────────────────────────────────────────────────────────────────┐    │
    │     │  Required Documents:                                                      │    │
    │     │  ✓ Government ID (Passport / National ID / Driver's License)             │    │
    │     │  ✓ BVN Verification (Nigeria)                                            │    │
    │     │  ✓ NIN Verification (Nigeria)                                            │    │
    │     │  ✓ Selfie / Liveness Check                                               │    │
    │     │  ✓ Proof of Address                                                      │    │
    │     └──────────────────────────────────────────────────────────────────────────┘    │
    │     PUT /property-kyc/parties/{id}/verify → APPROVED                                │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │                              SELLER KYC (CLOSED LOOP)                                │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  3. ADD SELLER TO TRANSACTION                                                        │
    │     PUT /property-kyc/transactions/{id}/add-seller                                   │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  4. SELLER IDENTITY VERIFICATION                                                     │
    │     POST /property-kyc/parties (role=seller)                                         │
    │     ┌──────────────────────────────────────────────────────────────────────────┐    │
    │     │  Required Documents:                                                      │    │
    │     │  ✓ Government ID (Passport / National ID / Driver's License)             │    │
    │     │  ✓ BVN Verification (Nigeria)                                            │    │
    │     │  ✓ Proof of Property Ownership (C of O, Deed)                            │    │
    │     └──────────────────────────────────────────────────────────────────────────┘    │
    │     PUT /property-kyc/parties/{id}/verify → APPROVED                                │
    │                                                                                      │
    │     *** THIS CREATES A CLOSED LOOP ECOSYSTEM ***                                    │
    │     Both buyer AND seller identities are verified before payment proceeds           │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │                              SOURCE OF FUNDS                                         │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  5. SOURCE OF FUNDS DECLARATION                                                      │
    │     POST /property-kyc/transactions/{id}/source-of-funds                             │
    │     ┌──────────────────────────────────────────────────────────────────────────┐    │
    │     │  Source Options:                                                          │    │
    │     │  • Employment Income → Requires employer details, salary                  │    │
    │     │  • Business Income → Requires business registration, revenue              │    │
    │     │  • Savings → Requires bank statements showing accumulation                │    │
    │     │  • Sale of Property → Requires sale documentation                         │    │
    │     │  • Inheritance → Requires probate/estate documents                        │    │
    │     │  • Gift → Requires donor declaration (HIGH RISK FLAG)                     │    │
    │     │  • Loan → Requires loan agreement, lender details                         │    │
    │     └──────────────────────────────────────────────────────────────────────────┘    │
    │     PUT /source-of-funds/{id}/verify → APPROVED                                     │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │                              FINANCIAL DOCUMENTS                                     │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  6. BANK STATEMENTS (3-MONTH REQUIREMENT)                                            │
    │     POST /property-kyc/transactions/{id}/bank-statements                             │
    │     ┌──────────────────────────────────────────────────────────────────────────┐    │
    │     │  Validation Rules:                                                        │    │
    │     │  ✓ Must cover at least 90 days (3 months)                                │    │
    │     │  ✓ Must be within last 6 months                                          │    │
    │     │  ✓ Account holder name must match KYC                                    │    │
    │     │  ✓ Shows regular income pattern                                          │    │
    │     └──────────────────────────────────────────────────────────────────────────┘    │
    │     GET /transactions/{id}/bank-statements/validate → coverage_days >= 90           │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  7. INCOME DOCUMENTS (W-2 / PAYE)                                                    │
    │     POST /property-kyc/transactions/{id}/income-documents                            │
    │     ┌──────────────────────────────────────────────────────────────────────────┐    │
    │     │  Accepted Document Types:                                                 │    │
    │     │  • W-2 Form (US)                                                         │    │
    │     │  • PAYE Record (Nigeria)                                                 │    │
    │     │  • Tax Return                                                            │    │
    │     │  • Payslip (recent)                                                      │    │
    │     │  • Employment Letter                                                     │    │
    │     │  • Business Registration + Audited Accounts (for business owners)        │    │
    │     └──────────────────────────────────────────────────────────────────────────┘    │
    │     PUT /income-documents/{id}/verify → APPROVED                                    │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │                              PURCHASE AGREEMENT                                      │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  8. PURCHASE AGREEMENT UPLOAD & VALIDATION                                           │
    │     POST /property-kyc/transactions/{id}/purchase-agreement                          │
    │     ┌──────────────────────────────────────────────────────────────────────────┐    │
    │     │  Required Elements:                                                       │    │
    │     │  ✓ Buyer name and address (MUST MATCH BUYER KYC)                         │    │
    │     │  ✓ Seller name and address (MUST MATCH SELLER KYC)                       │    │
    │     │  ✓ Property address and description                                      │    │
    │     │  ✓ Purchase price (MUST MATCH TRANSACTION AMOUNT)                        │    │
    │     │  ✓ Transaction terms and completion date                                 │    │
    │     │  ✓ Buyer signature with date                                             │    │
    │     │  ✓ Seller signature with date                                            │    │
    │     │  ✓ Witness signature (optional but recommended)                          │    │
    │     └──────────────────────────────────────────────────────────────────────────┘    │
    │     GET /purchase-agreements/{id}/validate → buyer_match + seller_match + signed    │
    │     PUT /purchase-agreements/{id}/verify → APPROVED                                 │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │                              COMPLIANCE REVIEW                                       │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  9. SUBMIT FOR REVIEW                                                                │
    │     PUT /property-kyc/transactions/{id}/submit-for-review                            │
    │     ┌──────────────────────────────────────────────────────────────────────────┐    │
    │     │  Automated Checks:                                                        │    │
    │     │  • Risk Score Calculation                                                │    │
    │     │  • AML Screening                                                         │    │
    │     │  • Sanctions Check                                                       │    │
    │     │  • PEP (Politically Exposed Person) Check                                │    │
    │     └──────────────────────────────────────────────────────────────────────────┘    │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────┐
    │  10. COMPLIANCE OFFICER REVIEW                                                       │
    │      GET /property-kyc/transactions/{id}/checklist                                   │
    │      ┌──────────────────────────────────────────────────────────────────────────┐   │
    │      │  Checklist Items:                                                        │   │
    │      │  □ Buyer Government ID - verified                                        │   │
    │      │  □ Seller Government ID - verified                                       │   │
    │      │  □ Source of Funds - verified                                            │   │
    │      │  □ Bank Statements (3 months) - verified                                 │   │
    │      │  □ Income Document - verified                                            │   │
    │      │  □ Purchase Agreement - verified                                         │   │
    │      │  □ AML Check - passed                                                    │   │
    │      │  □ Sanctions Check - passed                                              │   │
    │      │  □ PEP Check - passed                                                    │   │
    │      │  □ Risk Score - acceptable                                               │   │
    │      └──────────────────────────────────────────────────────────────────────────┘   │
    └─────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
    ┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
    │  11a. APPROVE                        │   │  11b. REJECT                         │
    │  PUT /transactions/{id}/approve      │   │  PUT /transactions/{id}/reject       │
    │  - All requirements met              │   │  - Missing documents                 │
    │  - Risk score acceptable             │   │  - Failed compliance checks          │
    │  - Compliance checks passed          │   │  - Suspicious activity               │
    └─────────────────────────────────────┘   └─────────────────────────────────────┘
                              │                               │
                              ▼                               ▼
    ┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
    │  PAYMENT PROCEEDS                    │   │  TRANSACTION BLOCKED                 │
    │  - Funds released to seller          │   │  - Buyer notified of rejection       │
    │  - Or held in escrow                 │   │  - Reason provided                   │
    │  - Transaction completed             │   │  - Appeal process available          │
    └─────────────────────────────────────┘   └─────────────────────────────────────┘
```

## Integration with Platform

### How Property Transaction KYC Fits Into the Platform

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              NIGERIAN REMITTANCE PLATFORM                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐                      │
│  │   PWA / Mobile  │───▶│  API Gateway    │───▶│  Transaction    │                      │
│  │   Applications  │    │  (APISIX)       │    │  Service        │                      │
│  └─────────────────┘    └─────────────────┘    └────────┬────────┘                      │
│                                                          │                               │
│                                                          │ High-value property          │
│                                                          │ transaction detected          │
│                                                          ▼                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           KYC SERVICE (Enhanced)                                 │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │                    Property Transaction KYC Module                       │   │   │
│  │  │                                                                          │   │   │
│  │  │  • Seller/Counterparty KYC (closed loop)                                │   │   │
│  │  │  • Source of Funds verification                                         │   │   │
│  │  │  • Bank statement validation (3-month)                                  │   │   │
│  │  │  • Income document verification (W-2/PAYE)                              │   │   │
│  │  │  • Purchase agreement validation                                        │   │   │
│  │  │                                                                          │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │                    Standard Tiered KYC (Tier 0-4)                        │   │   │
│  │  │  • Phone/Email verification (Tier 1)                                    │   │   │
│  │  │  • ID + Selfie + BVN (Tier 2)                                           │   │   │
│  │  │  • Address + Liveness (Tier 3)                                          │   │   │
│  │  │  • Income + EDD (Tier 4)                                                │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                          │                                              │
│                                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           COMPLIANCE SERVICE                                     │   │
│  │  • AML/Sanctions screening                                                      │   │
│  │  • PEP checks                                                                   │   │
│  │  • Risk scoring                                                                 │   │
│  │  • Transaction monitoring                                                       │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                          │                                              │
│                                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           OPS DASHBOARD                                          │   │
│  │  • Compliance officer review queue                                              │   │
│  │  • Document verification interface                                              │   │
│  │  • Approval/rejection workflow                                                  │   │
│  │  • Audit trail                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                          │                                              │
│                                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           PAYMENT CORRIDORS                                      │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐              │   │
│  │  │  PAPSS  │  │Mojaloop │  │  CIPS   │  │   UPI   │  │   PIX   │              │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘              │   │
│  │                                                                                  │   │
│  │  Payment only proceeds after KYC approval                                       │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Nigeria-Specific Considerations

### Payment Flow Options

**Option 1: Person-to-Person (P2P)**
- Direct payment from buyer to seller
- Both parties must complete full KYC
- Seller receives funds directly to verified bank account
- Common for informal property transactions

**Option 2: Escrow (Title Company / Lawyer)**
- Payment to corporate escrow account
- Escrow agent holds funds until completion
- Corporate KYC required for escrow entity
- Common for formal property transactions
- Provides additional protection for both parties

### Nigerian Identity Documents
- **BVN** (Bank Verification Number) - 11-digit unique identifier
- **NIN** (National Identification Number) - 11-digit unique identifier
- **International Passport**
- **Driver's License**
- **Voter's Card**
- **National ID Card**

### Nigerian Property Documents
- **Certificate of Occupancy (C of O)** - Government-issued land title
- **Deed of Assignment** - Transfer of property rights
- **Governor's Consent** - Required for property transfer
- **Survey Plan** - Property boundaries and dimensions
- **Power of Attorney** - If acting on behalf of another

## API Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/property-kyc/parties` | POST | Create party identity (buyer/seller) |
| `/property-kyc/parties/{id}` | GET | Get party details |
| `/property-kyc/parties/{id}/verify` | PUT | Verify party KYC |
| `/property-kyc/transactions` | POST | Create property transaction |
| `/property-kyc/transactions/{id}` | GET | Get transaction details |
| `/property-kyc/transactions/{id}/add-seller` | PUT | Add seller to transaction |
| `/property-kyc/transactions/{id}/source-of-funds` | POST | Declare source of funds |
| `/property-kyc/transactions/{id}/bank-statements` | POST | Upload bank statement |
| `/property-kyc/transactions/{id}/bank-statements/validate` | GET | Validate 3-month coverage |
| `/property-kyc/transactions/{id}/income-documents` | POST | Upload income document |
| `/property-kyc/transactions/{id}/purchase-agreement` | POST | Upload purchase agreement |
| `/property-kyc/purchase-agreements/{id}/validate` | GET | Validate agreement parties |
| `/property-kyc/transactions/{id}/checklist` | GET | Get KYC checklist status |
| `/property-kyc/transactions/{id}/submit-for-review` | PUT | Submit for compliance review |
| `/property-kyc/transactions/{id}/approve` | PUT | Approve transaction |
| `/property-kyc/transactions/{id}/reject` | PUT | Reject transaction |
| `/property-kyc/flow-documentation` | GET | Get flow documentation |

## Risk Scoring

| Factor | Risk Points | Description |
|--------|-------------|-------------|
| High value (>100M NGN) | +30 | Very high value transaction |
| Elevated value (>50M NGN) | +15 | High value transaction |
| Gift source | +25 | Gift requires donor verification |
| Unspecified source | +20 | "Other" source needs review |
| Loan funded | +10 | Loan-funded purchase |
| Incomplete statements | +15 | Bank statements don't cover 3 months |
| Income not verified | +10 | Missing income documentation |
| Seller KYC incomplete | +20 | Seller identity not verified |

**Risk Thresholds:**
- 0-30: Low risk - Standard review
- 31-50: Medium risk - Enhanced review
- 51-70: High risk - Senior reviewer required
- 71+: Very high risk - Compliance officer escalation

## Closed Loop Ecosystem Benefits

1. **Fraud Prevention** - Both parties verified reduces impersonation risk
2. **Regulatory Compliance** - Meets bank-grade KYC requirements
3. **Audit Trail** - Complete documentation for regulatory review
4. **AML/CFT** - Supports anti-money laundering requirements
5. **Consumer Protection** - Verified parties reduce transaction disputes
6. **Bank Partnership Ready** - Meets requirements for bank integration
