# FCA Authorized Payment Institution — Application Template

## Application Type: Authorized Payment Institution (API)
**Regulation**: Payment Services Regulations 2017 (PSR 2017), Electronic Money Regulations 2011

## Part A: Firm Details

### A1. Applicant Information
- **Legal name**: RemitFlow UK Ltd
- **Company number**: [COMPANIES HOUSE NUMBER]
- **Registered office**: [UK ADDRESS]
- **Principal place of business**: [UK ADDRESS]
- **FCA Firm Reference Number**: [IF EXISTING]
- **Date of incorporation**: [DATE]

### A2. Payment Services to be Provided
Under PSR 2017, Schedule 1:
- [x] (3) Execution of payment transactions (credit transfers)
- [x] (5) Issuing of payment instruments / acquiring of payment transactions
- [x] (6) Money remittance
- [x] (7) Payment initiation services
- [ ] (8) Account information services

### A3. E-Money Issuance
- [x] Yes — will issue electronic money (stablecoin wallet balances)
- EMD threshold: >€5M outstanding e-money → Authorized EMI required

## Part B: Business Plan

### B1. Executive Summary
RemitFlow UK provides cross-border payment services specializing in UK-to-Africa remittance corridors. The platform serves UK-based diaspora communities sending money to family in Nigeria, Ghana, Kenya, and South Africa.

### B2. Target Market
- UK-based African diaspora (estimated 2.2M people)
- SMBs with African trade relationships
- Average transaction: £200-£500
- Monthly target volume: £2M (Year 1) → £10M (Year 3)

### B3. Revenue Model
- FX spread: 0.5-1.5% (competitive with TransferWise/Wise)
- Fixed fee: £0.99-£2.99 per transaction
- Premium features: batch payouts, API access, merchant gateway

### B4. Competitive Landscape
| Competitor | FX Markup | Speed | Africa Coverage |
|-----------|-----------|-------|-----------------|
| Wise | 0.5-1.0% | 1-3 days | Limited |
| WorldRemit | 2-4% | Minutes-hours | Strong |
| Lemfi | 1-2% | Hours | Strong |
| **RemitFlow** | **0.5-1.5%** | **Minutes** | **Strong** |

## Part C: Governance & Control

### C1. Mind & Management in UK
- CEO/Managing Director: UK resident, based at principal office
- CCO: UK resident, CAMS/ICA certified
- MLRO: UK resident, approved by FCA (CF11 function)
- Board meetings: Quarterly, majority UK-based directors

### C2. Key Personnel (SMF/CF Applications)
| Function | Name | Qualification | UK Resident |
|----------|------|--------------|-------------|
| SMF1 (CEO) | [NAME] | [QUALS] | Yes |
| SMF16 (Compliance Oversight) | [NAME] | CAMS, ICA | Yes |
| SMF17 (MLRO) | [NAME] | ICA Diploma | Yes |
| CF1 (Director) | [NAME] | [QUALS] | Yes |

### C3. Organizational Structure
```
Board of Directors
├── CEO (SMF1)
├── CFO
├── CTO
├── CCO/MLRO (SMF16/17) — independent, direct board access
│   ├── Compliance Analyst
│   ├── Financial Crime Analyst
│   └── Data Protection Officer
└── Head of Operations
    ├── Customer Support
    └── Payment Operations
```

## Part D: Financial Resources

### D1. Initial Capital Requirement
- **Authorized PI**: €125,000 minimum own funds (PSR 2017, reg 6)
- **Safeguarding**: 100% of customer funds (ring-fenced in designated account OR insured)

### D2. Capital Plan
| Item | Year 1 | Year 2 | Year 3 |
|------|--------|--------|--------|
| Revenue | £240,000 | £960,000 | £3,600,000 |
| Operating costs | £480,000 | £720,000 | £1,200,000 |
| Net position | -£240,000 | £240,000 | £2,400,000 |
| Own funds maintained | £200,000 | £300,000 | £500,000 |

### D3. Safeguarding Method
- **Method**: Segregation in designated safeguarding account
- **Bank**: [UK TIER 1 BANK — e.g., Barclays, NatWest]
- **Account type**: Client money account (CASS 7 equivalent for PSPs)
- **Reconciliation**: Daily automated reconciliation (TigerBeetle ledger vs bank statement)

## Part E: AML/CFT Compliance

### E1. MLRO Statement
The firm's MLRO has direct access to the Board and authority to:
- Submit SARs to the NCA without prior approval from business lines
- Halt transactions pending investigation
- Escalate findings to the FCA
- Access all customer and transaction data

### E2. Risk Assessment (JMLSG Guidance)
| Factor | Risk Level | Justification |
|--------|-----------|---------------|
| Customer type | Medium-High | Retail diaspora + SMBs |
| Products | Medium | Remittance, e-money, crypto-to-fiat |
| Delivery channels | Medium | Digital-only (app + web) |
| Geography | High | Africa (Nigeria, Ghana, Kenya: FATF grey/monitoring) |
| Transaction types | Medium | Cross-border, multi-currency |
| New technologies | Medium | Stablecoins, blockchain rails |

### E3. Screening & Monitoring
- **Sanctions**: HM Treasury (OFSI) list + UN + EU + OFAC (real-time, every transaction)
- **PEP**: Domestic + foreign PEP databases (continuous monitoring)
- **Transaction monitoring**: Rule-based (15 scenarios) + ML anomaly detection
- **Travel Rule**: Notabene (all transfers, per UK statutory instrument)
- **SAR filing**: NCA via SAR Online within 24h of determination

## Part F: Operational Resilience

### F1. Important Business Services
1. Payment execution (cross-border remittance)
2. Customer account management (balance, history)
3. Compliance monitoring (sanctions, transaction monitoring)

### F2. Impact Tolerances
| Service | Maximum tolerable disruption | Recovery point |
|---------|------------------------------|----------------|
| Payment execution | 4 hours | Last committed transaction |
| Account access | 24 hours | Real-time |
| Compliance monitoring | 1 hour | No data loss |

### F3. Third-Party Dependencies
| Provider | Service | Criticality | Concentration Risk |
|----------|---------|-------------|-------------------|
| Circle | USDC settlement | High | Medium (alt: Stellar) |
| Onfido | KYC verification | High | Low (alt: Smile ID) |
| Notabene | Travel Rule | Medium | Medium |
| AWS/GCP | Cloud infrastructure | High | Mitigated (multi-cloud) |

## Part G: Data Protection

### G1. DPO Appointment
- **DPO**: [NAME]
- **ICO registration**: [NUMBER]
- **DPIA completed**: Yes (cross-border transfers, KYC document storage, biometrics)

### G2. International Data Transfers
| From | To | Legal Basis | Safeguard |
|------|------|------------|-----------|
| UK | Nigeria | Consent + contractual necessity | SCCs + supplementary measures |
| UK | Canada | Adequacy decision | N/A |
| UK | USA | UK-US Data Bridge | N/A |

## Submission Checklist

- [ ] FCA Connect application submitted
- [ ] Application fee paid (£5,000 for API)
- [ ] Business plan (3 years)
- [ ] Financial projections + capital adequacy
- [ ] Compliance policies (AML, Sanctions, TCF, Complaints)
- [ ] Risk assessment (JMLSG aligned)
- [ ] IT systems documentation (security, resilience)
- [ ] SMF/CF applications for all controlled functions
- [ ] DBS checks for all approved persons
- [ ] PII for all directors and beneficial owners
- [ ] Safeguarding arrangements documentation
- [ ] Outsourcing register
- [ ] Operational resilience self-assessment
- [ ] DPIA documentation
- [ ] Wind-down plan
