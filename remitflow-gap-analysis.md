# RemitFlow Gap Analysis Report

**Version:** v11.1  
**Date:** May 2026  
**Author:** RemitFlow Engineering Team

---

## Executive Summary

This document identifies current gaps in the RemitFlow platform and provides a roadmap for closing them. The analysis covers outbound payment rails, revenue diversification, cross-sell opportunities, and operational resilience.

---

## 1. Outbound Payment Rails

### 1.1 SWIFT Integration

**Current State:** SWIFT GPI is partially implemented via the `go-swift-service` microservice. The service handles outbound SWIFT MT103 messages but lacks full SWIFT gpi Tracker integration.

**Gap:** SWIFT gpi Tracker real-time status updates are not surfaced in the transaction detail UI. End-to-end confirmation (UETR tracking) requires a SWIFT Alliance Gateway license.

**Recommendation:**
- Integrate SWIFT gpi Tracker API (`/g4c/v4/fintracking/gpi/payments/details`) to surface real-time payment status.
- Add UETR (Unique End-to-End Transaction Reference) to all outbound SWIFT transactions.
- Implement SWIFT pre-validation to reduce rejection rates by 40%.

### 1.2 SEPA Instant Credit Transfer (SCT Inst)

**Gap:** SEPA Instant (SCT Inst) is not yet supported. Current SEPA implementation only covers standard SEPA Credit Transfer (SCT) with D+1 settlement.

**Recommendation:** Partner with a SEPA Instant-enabled bank or PSP to offer sub-10-second EUR transfers within the SEPA zone.

### 1.3 Mojaloop / ISO 20022

**Current State:** Mojaloop integration exists via `go-mojaloop-service`. ISO 20022 message transformation is handled by `go-iso20022-transformer`.

**Gap:** Mojaloop Hub connectivity is not production-certified. The DFSP (Digital Financial Service Provider) onboarding with the Central Hub is pending.

---

## 2. Revenue Diversification

### 2.1 Float Income

**Current State:** Customer funds held in transit generate float income. This is not currently tracked or optimized.

**Gap:** Float income is not reported separately in the P&L. The platform does not optimize float placement across money market instruments.

**Recommendation:**
- Implement a float management module that tracks idle balances by currency.
- Integrate with a money market API (e.g., BlackRock Aladdin, Fidelity Institutional) to earn yield on float.
- Target: 2.5–4.5% annualized yield on average daily float balance.
- Estimated incremental revenue: $180K–$320K/year at $8M average daily float.

### 2.2 FX Spread Optimization

**Gap:** Current FX spread is fixed at 1.5% across all corridors. Dynamic spread pricing based on corridor liquidity, time of day, and customer tier is not implemented.

**Recommendation:** Implement dynamic FX pricing engine that adjusts spreads based on real-time liquidity depth, corridor volatility, and customer lifetime value.

---

## 3. Cross-Sell Opportunities

### 3.1 Business Credit Products

**Current State:** Business Credit Scoring (Tier 3) is implemented. Credit scores are generated but not yet used to trigger credit product offers.

**Gap:** The platform does not automatically surface credit product offers (working capital loans, invoice financing) to businesses with high credit scores.

**Recommendation:**
- Implement a cross-sell engine that monitors credit score improvements and triggers targeted product offers.
- Integrate with the Invoice Financing (Tier 2) and Business Savings (Tier 2) modules to create a unified business finance dashboard.
- Target: 15% conversion rate on credit score-triggered offers.

### 3.2 Diaspora Mortgage Cross-Sell

**Gap:** Customers making regular remittances to Nigeria, Ghana, or Kenya are not being offered diaspora mortgage products.

**Recommendation:** Implement a remittance pattern analysis job that identifies customers sending >$500/month consistently for >6 months and surfaces diaspora mortgage pre-qualification offers.

### 3.3 Payroll-to-Remittance Cross-Sell

**Gap:** Businesses using the embedded payroll API are not being cross-sold on bulk remittance products for international payroll.

**Recommendation:** Add a "Pay International Contractors" CTA to the payroll dashboard that routes to the Contractor Payments module.

---

## 4. Compliance Gaps

### 4.1 Travel Rule (FATF Recommendation 16)

**Gap:** The Travel Rule (originator/beneficiary information for transfers >$1,000) is not fully implemented for crypto rails.

**Recommendation:** Integrate with a Travel Rule solution provider (Notabene, Sygna Bridge, or TRP) for crypto transfers.

### 4.2 Enhanced Due Diligence (EDD)

**Gap:** EDD triggers for high-risk customers are manual. The platform does not automatically escalate to EDD based on transaction patterns.

**Recommendation:** Implement automated EDD triggers based on: country risk score, transaction velocity, PEP/sanctions hits, and unusual pattern detection.

---

## 5. Operational Resilience

### 5.1 Multi-Region Failover

**Gap:** The platform is currently single-region. A regional outage would result in full service unavailability.

**Recommendation:** Implement active-passive multi-region deployment with automatic failover. Target RTO: 5 minutes, RPO: 30 seconds.

### 5.2 Circuit Breakers

**Current State:** Circuit breakers are implemented for external service calls via `security.attacks.ts`.

**Gap:** Circuit breaker state is not persisted across server restarts. A cold restart after a cascading failure will immediately retry all failed services.

**Recommendation:** Persist circuit breaker state in Redis with TTL-based recovery windows.

---

## 6. Priority Matrix

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| SWIFT gpi Tracker | High | Medium | P1 |
| Float income tracking | High | Low | P1 |
| Cross-sell engine | High | Medium | P1 |
| Travel Rule (crypto) | High | High | P2 |
| SEPA Instant | Medium | High | P2 |
| Dynamic FX pricing | Medium | Medium | P2 |
| Multi-region failover | High | High | P3 |
| EDD automation | Medium | Medium | P2 |

---

*This report is generated automatically from the RemitFlow platform gap analysis pipeline. Last updated: May 2026.*
