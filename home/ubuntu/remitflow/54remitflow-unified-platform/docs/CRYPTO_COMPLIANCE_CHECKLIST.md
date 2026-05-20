# Crypto/Stablecoin Compliance Checklist

This checklist tracks compliance requirements for operating stablecoin services. Use this as a pre-launch verification and ongoing compliance monitoring tool.

## Pre-Launch Requirements

### 1. Licensing & Registration

- [ ] **Nigeria**
  - [ ] SEC Nigeria VASP registration submitted
  - [ ] SEC Nigeria VASP registration approved
  - [ ] CBN notification/approval obtained
  - [ ] NFIU registration completed
  - [ ] Local legal entity established

- [ ] **UK (if applicable)**
  - [ ] FCA Cryptoasset Registration submitted
  - [ ] FCA Cryptoasset Registration approved
  - [ ] MLRO appointed and registered
  - [ ] UK legal entity established

- [ ] **EU (if applicable)**
  - [ ] CASP authorization application submitted
  - [ ] CASP authorization granted
  - [ ] EU representative appointed
  - [ ] Passporting to target member states

- [ ] **US (if applicable)**
  - [ ] FinCEN MSB registration completed
  - [ ] State MTL applications submitted (list states)
  - [ ] State MTL approvals received (list states)

### 2. KYC/AML Controls

- [x] **Customer Identification**
  - [x] Tiered KYC system implemented (Tier 1-3)
  - [x] Document verification integration
  - [x] Biometric verification support
  - [x] Address verification capability
  - [ ] Enhanced Due Diligence (EDD) procedures documented

- [x] **Sanctions Screening**
  - [x] OFAC sanctions list integration
  - [x] UN sanctions list integration
  - [x] EU sanctions list integration
  - [x] Real-time screening on transactions
  - [x] Periodic re-screening of existing customers

- [x] **PEP Screening**
  - [x] PEP database integration
  - [x] Adverse media screening
  - [x] Ongoing monitoring for PEP status changes

### 3. Chain Analytics & Risk Scoring

- [x] **Address Risk Scoring**
  - [x] Chain analytics provider integrated (Chainalysis/TRM/Elliptic)
  - [x] Risk scoring on all deposit addresses
  - [x] Risk scoring on all withdrawal addresses
  - [x] Configurable risk thresholds

- [x] **Mixer/Tumbler Detection**
  - [x] Mixer detection enabled
  - [x] Automatic blocking of mixer-associated addresses
  - [x] Alert generation for mixer exposure

- [x] **Sanctions Address Screening**
  - [x] Sanctioned address database maintained
  - [x] Real-time screening on all transactions
  - [x] Automatic blocking of sanctioned addresses

- [x] **Transaction Risk Assessment**
  - [x] Pre-transaction screening
  - [x] Post-transaction monitoring
  - [x] Risk-based transaction limits

### 4. Transaction Monitoring

- [x] **Real-Time Monitoring**
  - [x] Velocity checks implemented
  - [x] Amount thresholds configured
  - [x] Pattern detection enabled
  - [x] ML-based anomaly detection

- [x] **Alert Management**
  - [x] Alert generation system
  - [x] Alert prioritization
  - [x] Alert investigation workflow
  - [x] Alert resolution tracking

- [ ] **Reporting**
  - [ ] SAR/STR templates configured
  - [ ] Automated SAR filing (where applicable)
  - [ ] CTR filing for large transactions
  - [ ] Regulatory report generation

### 5. Travel Rule Compliance

- [ ] **Originator Information**
  - [ ] Name collection
  - [ ] Account number/wallet address
  - [ ] Physical address or national ID
  - [ ] Date and place of birth (where required)

- [ ] **Beneficiary Information**
  - [ ] Name collection
  - [ ] Account number/wallet address

- [ ] **VASP-to-VASP Transfers**
  - [ ] Travel Rule protocol integration (TRISA/Sygna/etc.)
  - [ ] Counterparty VASP verification
  - [ ] Information exchange mechanism

### 6. Wallet & Key Security

- [x] **Key Management**
  - [x] Encrypted key storage implemented
  - [x] Key encryption at rest
  - [ ] HSM integration for production
  - [ ] Key backup and recovery procedures
  - [ ] Key rotation procedures

- [x] **Wallet Architecture**
  - [x] Hot/cold wallet separation
  - [x] Multi-signature support (architecture ready)
  - [x] Withdrawal approval workflow
  - [x] Balance monitoring

- [x] **Access Controls**
  - [x] PBAC implemented
  - [x] Role-based access to wallet operations
  - [x] Audit logging of all wallet access
  - [x] Multi-factor authentication

### 7. Operational Controls

- [x] **Audit Logging**
  - [x] All transactions logged
  - [x] All administrative actions logged
  - [x] Immutable audit trail
  - [x] Log retention policy (7+ years)

- [x] **Incident Response**
  - [x] Incident detection capabilities
  - [x] Incident response procedures documented
  - [x] Escalation procedures defined
  - [ ] Regulatory notification procedures

- [ ] **Business Continuity**
  - [ ] Disaster recovery plan
  - [ ] Backup procedures tested
  - [ ] Failover capabilities verified

### 8. Customer Protection

- [x] **Dispute Resolution**
  - [x] Dispute service implemented
  - [x] Dispute investigation workflow
  - [x] Resolution tracking
  - [x] Customer communication

- [ ] **Disclosures & Warnings**
  - [ ] Risk warnings displayed
  - [ ] Fee disclosures
  - [ ] Terms of service for crypto
  - [ ] Privacy policy updated for crypto

- [x] **Customer Support**
  - [x] Support channels available
  - [x] Crypto-specific support training
  - [x] Escalation procedures

### 9. Technical Security

- [x] **Infrastructure Security**
  - [x] Network segmentation
  - [x] Firewall configuration
  - [x] DDoS protection
  - [x] Intrusion detection

- [x] **Application Security**
  - [x] Input validation
  - [x] Output encoding
  - [x] Authentication controls
  - [x] Authorization controls

- [ ] **Penetration Testing**
  - [ ] External penetration test completed
  - [ ] Internal penetration test completed
  - [ ] Remediation of findings

### 10. Documentation

- [x] **Policies**
  - [x] AML/CFT policy
  - [x] KYC policy
  - [x] Risk assessment policy
  - [ ] Crypto-specific addendum to policies

- [ ] **Procedures**
  - [ ] Customer onboarding procedures
  - [ ] Transaction monitoring procedures
  - [ ] SAR filing procedures
  - [ ] Incident response procedures

- [ ] **Training**
  - [ ] Staff AML training completed
  - [ ] Crypto-specific training completed
  - [ ] Training records maintained

---

## Ongoing Compliance

### Daily
- [ ] Review high-risk transaction alerts
- [ ] Process pending KYC verifications
- [ ] Monitor chain analytics alerts
- [ ] Check system health and availability

### Weekly
- [ ] Review transaction monitoring reports
- [ ] Update sanctions lists
- [ ] Review customer complaints
- [ ] Team compliance meeting

### Monthly
- [ ] Generate compliance metrics report
- [ ] Review and update risk thresholds
- [ ] Audit sample of transactions
- [ ] Update training materials

### Quarterly
- [ ] Comprehensive risk assessment
- [ ] Policy review and updates
- [ ] Regulatory change assessment
- [ ] Board compliance report

### Annually
- [ ] Independent compliance audit
- [ ] Penetration testing
- [ ] Business continuity test
- [ ] Full policy review

---

## Compliance Contacts

| Role | Name | Contact |
|------|------|---------|
| Compliance Officer | TBD | TBD |
| MLRO (UK) | TBD | TBD |
| Legal Counsel (Nigeria) | TBD | TBD |
| Legal Counsel (UK) | TBD | TBD |
| External Auditor | TBD | TBD |

---

## Regulatory Contacts

| Regulator | Contact | Purpose |
|-----------|---------|---------|
| SEC Nigeria | compliance@sec.gov.ng | VASP registration |
| CBN | TBD | Banking matters |
| NFIU | TBD | STR filing |
| FCA | TBD | UK registration |
| FinCEN | TBD | US MSB |

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Dec 2025 | Platform Team | Initial checklist |

---

*This checklist should be reviewed and updated quarterly or when regulatory requirements change.*
