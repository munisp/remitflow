# FINTRAC MSB Registration — Application Template

## Part 1: Business Identification

### 1.1 Reporting Entity Information
- **Legal Name**: RemitFlow Inc.
- **Operating Name(s)**: RemitFlow
- **Business Number (BN)**: [TO BE OBTAINED FROM CRA]
- **Date of Incorporation**: [DATE]
- **Province of Incorporation**: [Ontario/BC/Quebec]
- **Registered Office Address**: [ADDRESS]
- **Business Address**: [ADDRESS]
- **Website**: https://remitflow.app
- **Contact Email**: compliance@remitflow.app
- **Contact Phone**: [PHONE]

### 1.2 MSB Activities
Check all applicable:
- [x] Foreign exchange dealing
- [x] Money transferring (remittance)
- [x] Issuing or redeeming money orders, traveller's cheques, or similar instruments
- [x] Dealing in virtual currencies
- [ ] Crowdfunding platform

### 1.3 Geographic Scope
- **Provinces of operation**: All Canadian provinces and territories
- **International corridors**: 
  - Canada → Nigeria (NGN)
  - Canada → Ghana (GHS)
  - Canada → Kenya (KES)
  - Canada → South Africa (ZAR)
  - Canada → UK (GBP)
  - Canada → USA (USD)

## Part 2: Beneficial Ownership

### 2.1 Directors and Officers
| Name | Position | % Ownership | Country of Residence |
|------|----------|-------------|---------------------|
| [NAME] | CEO & Director | [%] | Canada |
| [NAME] | CTO & Director | [%] | Canada |
| [NAME] | CFO | [%] | Canada |
| [NAME] | Chief Compliance Officer | 0% | Canada |

### 2.2 Beneficial Owners (≥25% ownership or control)
| Name | % Ownership | Country | Source of Funds |
|------|-------------|---------|-----------------|
| [NAME] | [%] | [COUNTRY] | [SOURCE] |

## Part 3: Compliance Program

### 3.1 Compliance Officer
- **Name**: [NAME]
- **Title**: Chief Compliance Officer (CCO)
- **Qualifications**: [CAMS, ICA, etc.]
- **Years of experience**: [X] years in AML/CFT compliance
- **Reports to**: Board of Directors (independent of business lines)

### 3.2 AML/CFT Policies
- [x] Written compliance policies and procedures
- [x] Risk assessment (updated annually)
- [x] KYC/CDD program (tiered: Tier 0-3)
- [x] Suspicious Transaction Reporting (STR) procedures
- [x] Large Cash Transaction Reporting (LCTR) procedures
- [x] Electronic Funds Transfer Reporting (EFTR) procedures
- [x] Record keeping (5 years minimum)
- [x] Ongoing monitoring program
- [x] Sanctions screening (OFAC, UN, EU, HMT, Canada SEMA)
- [x] PEP screening (domestic and foreign)
- [x] Training program (annual + new hire)
- [x] Effectiveness review (biennial independent review)

### 3.3 Technology Controls
- **KYC Providers**: Onfido (global), Smile Identity (Africa)
- **Sanctions Screening**: ComplyAdvantage / OFAC API (real-time, every transaction)
- **Transaction Monitoring**: Rule-based + ML anomaly detection
- **Travel Rule**: Notabene (IVMS101 compliant)
- **Audit Trail**: Immutable, SHA-256 hash chain, 7-year retention
- **Encryption**: AES-256 at rest, TLS 1.3 in transit, Vault Transit for PII

### 3.4 Risk Assessment Summary
| Risk Category | Rating | Mitigation |
|--------------|--------|------------|
| Customer risk | Medium-High | Tiered KYC (T0-T3), EDD for PEPs |
| Product risk | Medium | Transaction limits per tier, velocity checks |
| Geographic risk | High | Africa corridors require enhanced monitoring |
| Channel risk | Medium | Digital-only (no cash), device fingerprinting |
| New technology risk | Medium | Stablecoin monitoring via Chainalysis KYT |

## Part 4: Financial Information

### 4.1 Capital
- **Authorized capital**: [AMOUNT]
- **Paid-up capital**: [AMOUNT]
- **Working capital**: [AMOUNT]
- **Fidelity bond**: [AMOUNT] (minimum $50,000 required by some provinces)

### 4.2 Projected Transaction Volume (Year 1)
| Corridor | Monthly Volume (CAD) | Monthly Transactions |
|----------|---------------------|---------------------|
| CA → NG | $500,000 | 2,000 |
| CA → GH | $200,000 | 800 |
| CA → KE | $150,000 | 600 |
| CA → ZA | $100,000 | 400 |
| CA → UK | $300,000 | 1,200 |
| **Total** | **$1,250,000** | **5,000** |

## Part 5: Record Keeping

### 5.1 Records Maintained
- Client identification records (5 years after account closure)
- Transaction records (5 years from date of transaction)
- Large cash transaction records (5 years)
- Suspicious transaction reports (5 years)
- Compliance program documentation (indefinite)
- Training records (5 years after employee departure)
- Risk assessment (current + 5 years of historical versions)

### 5.2 Storage
- **Primary**: PostgreSQL (encrypted at rest, ca-central region)
- **Backup**: Daily encrypted backups, 90-day retention, cross-region replication
- **Audit trail**: Immutable append-only log with hash chain verification

## Part 6: Reporting Obligations

| Report Type | Threshold | Deadline | Method |
|-------------|-----------|----------|--------|
| STR | Reasonable grounds to suspect ML/TF | 30 days | FINTRAC F2R system |
| LCTR | CAD $10,000+ (cash) | 15 days | FINTRAC F2R system |
| EFTR | CAD $10,000+ (electronic) | 5 days | FINTRAC F2R system |
| Terrorist Property | Any amount | Immediately | FINTRAC F2R + RCMP |

## Submission Checklist

- [ ] FINTRAC online registration form completed
- [ ] Business Number (BN) obtained from CRA
- [ ] Corporate documents (articles, bylaws)
- [ ] Compliance program documentation
- [ ] Risk assessment document
- [ ] Training program outline
- [ ] Independent review schedule
- [ ] Provincial registration (if applicable)
- [ ] Fidelity bond/insurance (if applicable)
- [ ] Board resolution authorizing registration
