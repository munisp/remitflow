# Crypto Licensing Readiness Guide

This document outlines the regulatory requirements for operating stablecoin/cryptocurrency services across key jurisdictions and maps them to platform capabilities.

## Executive Summary

The Nigerian Remittance Platform has implemented technical controls that support regulatory compliance for cryptocurrency operations. However, **licensing and regulatory approvals must be obtained before operating live stablecoin services** in each jurisdiction.

**Current Status:** Technical infrastructure ready, licensing pending.

---

## Jurisdiction-Specific Requirements

### Nigeria (Primary Market)

**Regulatory Bodies:**
- Central Bank of Nigeria (CBN)
- Securities and Exchange Commission (SEC Nigeria)
- Nigerian Financial Intelligence Unit (NFIU)

**Key Requirements:**

| Requirement | Platform Capability | Status |
|-------------|---------------------|--------|
| Virtual Asset Service Provider (VASP) Registration | KYC service, AML screening | Ready |
| CBN AML/CFT Compliance | Compliance service, transaction monitoring | Ready |
| Customer Due Diligence (CDD) | Tiered KYC (Tier 1-3) | Ready |
| Transaction Reporting | Audit service, lakehouse analytics | Ready |
| Suspicious Transaction Reports (STRs) | Risk service, chain analytics | Ready |
| Foreign Exchange Controls | Rate service, corridor limits | Ready |

**Licensing Path:**
1. Register with SEC Nigeria as a Digital Asset Exchange
2. Obtain CBN approval for foreign exchange operations
3. Register with NFIU for AML reporting
4. Implement CBN's Guidelines on Operations of Bank Accounts for Virtual Asset Service Providers

**Platform Gaps:**
- [ ] Formal SEC Nigeria registration
- [ ] CBN VASP approval
- [ ] NFIU reporting integration (API endpoints exist, formal registration needed)

---

### United Kingdom

**Regulatory Body:** Financial Conduct Authority (FCA)

**Key Requirements:**

| Requirement | Platform Capability | Status |
|-------------|---------------------|--------|
| Cryptoasset Registration | Full platform stack | Ready |
| AML/CTF Compliance | Compliance service, chain analytics | Ready |
| Customer Due Diligence | KYC service with document verification | Ready |
| Transaction Monitoring | Risk service, ML fraud detection | Ready |
| Travel Rule Compliance | Transaction metadata, counterparty info | Partial |
| Financial Promotions | Marketing controls | Not Implemented |

**Licensing Path:**
1. Apply for FCA Cryptoasset Registration
2. Demonstrate AML/CTF compliance framework
3. Appoint Money Laundering Reporting Officer (MLRO)
4. Implement Travel Rule for transfers >£1,000

**Platform Gaps:**
- [ ] FCA registration application
- [ ] Travel Rule implementation for VASP-to-VASP transfers
- [ ] Financial promotions compliance module
- [ ] UK-specific reporting templates

---

### United States

**Regulatory Bodies:**
- Financial Crimes Enforcement Network (FinCEN)
- State Money Transmitter Regulators
- Office of Foreign Assets Control (OFAC)

**Key Requirements:**

| Requirement | Platform Capability | Status |
|-------------|---------------------|--------|
| FinCEN MSB Registration | Platform infrastructure | Ready |
| State Money Transmitter Licenses | Per-state compliance | Not Started |
| OFAC Sanctions Screening | Chain analytics integration | Ready |
| Bank Secrecy Act (BSA) Compliance | AML controls, reporting | Ready |
| SAR Filing | Compliance service | Ready |
| CTR Filing (>$10,000) | Transaction monitoring | Ready |

**Licensing Path:**
1. Register as Money Services Business (MSB) with FinCEN
2. Obtain state-by-state Money Transmitter Licenses (MTLs)
3. Implement OFAC sanctions screening
4. Establish BSA compliance program

**Platform Gaps:**
- [ ] FinCEN MSB registration
- [ ] State MTL applications (47+ states)
- [ ] FinCEN SAR/CTR filing integration
- [ ] State-specific reporting requirements

**Note:** State-by-state licensing is expensive and time-consuming. Consider partnering with a licensed entity or using a licensing-as-a-service provider.

---

### European Union (MiCA)

**Regulatory Framework:** Markets in Crypto-Assets Regulation (MiCA)

**Key Requirements:**

| Requirement | Platform Capability | Status |
|-------------|---------------------|--------|
| CASP Authorization | Full platform stack | Ready |
| Governance Requirements | PBAC, audit logging | Ready |
| Capital Requirements | Treasury management | Partial |
| Custody Requirements | Wallet service, key management | Ready |
| Market Abuse Prevention | Transaction monitoring | Ready |
| Consumer Protection | Dispute service, support | Ready |

**Licensing Path:**
1. Apply for Crypto-Asset Service Provider (CASP) authorization in one EU member state
2. Passport authorization to other EU states
3. Implement MiCA-specific disclosures and warnings
4. Meet capital requirements (varies by service type)

**Platform Gaps:**
- [ ] CASP authorization application
- [ ] MiCA-specific disclosure templates
- [ ] Capital adequacy documentation
- [ ] EU representative appointment

---

### Ghana, Kenya, South Africa (Secondary African Markets)

**Ghana:**
- Bank of Ghana (BoG) - No specific crypto framework yet
- Securities and Exchange Commission Ghana - Digital asset guidelines pending
- **Recommendation:** Monitor regulatory developments, prepare for licensing

**Kenya:**
- Central Bank of Kenya (CBK) - Cautionary stance on crypto
- Capital Markets Authority (CMA) - Sandbox available
- **Recommendation:** Apply for CMA regulatory sandbox

**South Africa:**
- Financial Sector Conduct Authority (FSCA) - Crypto declared financial product
- South African Reserve Bank (SARB) - AML requirements
- **Recommendation:** Register as Financial Services Provider (FSP)

---

## Platform Compliance Capabilities

### Already Implemented

1. **KYC/AML Infrastructure**
   - Tiered KYC verification (Tier 1-3)
   - Document verification integration points
   - Biometric verification support
   - PEP/sanctions screening

2. **Transaction Monitoring**
   - Real-time risk scoring
   - ML-powered fraud detection
   - Velocity checks and limits
   - Chain analytics integration (Chainalysis, TRM, Elliptic)

3. **Audit & Reporting**
   - Comprehensive audit logging
   - Transaction history with full metadata
   - Lakehouse analytics for regulatory reporting
   - PBAC for access control

4. **Wallet Security**
   - Encrypted key storage
   - Multi-chain support
   - Hot/cold wallet architecture
   - Transaction signing controls

5. **Compliance Controls**
   - Sanctions screening
   - Mixer/tumbler detection
   - Address risk scoring
   - Transaction blocking for high-risk addresses

### Needs Implementation

1. **Travel Rule Compliance**
   - VASP-to-VASP information sharing
   - Originator/beneficiary data collection
   - Integration with Travel Rule protocols (TRISA, Sygna, etc.)

2. **Regulatory Reporting**
   - Jurisdiction-specific SAR/STR templates
   - Automated filing with regulators
   - Regulatory data export formats

3. **Financial Promotions**
   - Marketing compliance controls
   - Risk warnings and disclosures
   - Jurisdiction-specific content filtering

---

## Recommended Licensing Strategy

### Phase 1: Nigeria (Months 1-6)
1. Engage Nigerian legal counsel
2. Prepare SEC Nigeria VASP application
3. Implement CBN-specific reporting
4. Obtain necessary approvals

### Phase 2: UK (Months 6-12)
1. Engage UK legal counsel
2. Prepare FCA registration application
3. Implement Travel Rule
4. Appoint MLRO

### Phase 3: EU (Months 12-18)
1. Select EU member state for CASP authorization
2. Prepare MiCA compliance documentation
3. Meet capital requirements
4. Obtain authorization and passport

### Phase 4: US (Months 18-36)
1. Register with FinCEN as MSB
2. Evaluate state-by-state licensing vs. partnership
3. Begin priority state MTL applications
4. Implement state-specific requirements

---

## Cost Estimates

| Jurisdiction | Licensing Cost | Timeline | Annual Compliance |
|--------------|----------------|----------|-------------------|
| Nigeria | $50,000-100,000 | 6-12 months | $25,000-50,000 |
| UK (FCA) | $100,000-200,000 | 6-12 months | $50,000-100,000 |
| EU (MiCA) | $200,000-500,000 | 12-18 months | $100,000-200,000 |
| US (Federal + States) | $1,000,000-5,000,000 | 24-48 months | $500,000-1,000,000 |

**Note:** Costs include legal fees, application fees, compliance infrastructure, and ongoing maintenance. Actual costs vary significantly based on scope and complexity.

---

## Risk Mitigation

1. **Regulatory Change Risk**
   - Monitor regulatory developments in all target markets
   - Maintain flexible architecture to adapt to new requirements
   - Engage with industry associations and regulators

2. **Enforcement Risk**
   - Implement conservative compliance controls
   - Document all compliance decisions
   - Maintain clear audit trails

3. **Reputational Risk**
   - Proactive communication with regulators
   - Transparent customer communications
   - Robust dispute resolution

---

## Contacts & Resources

### Regulatory Bodies
- CBN: https://www.cbn.gov.ng/
- SEC Nigeria: https://sec.gov.ng/
- FCA: https://www.fca.org.uk/
- FinCEN: https://www.fincen.gov/

### Industry Associations
- Global Digital Finance (GDF)
- Blockchain Association
- Chamber of Digital Commerce

### Compliance Service Providers
- Chainalysis: https://www.chainalysis.com/
- TRM Labs: https://www.trmlabs.com/
- Elliptic: https://www.elliptic.co/

---

*Last Updated: December 2025*
*Document Owner: Compliance Team*
*Review Frequency: Quarterly*
