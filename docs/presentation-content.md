# RemitFlow — Business Presentation Deck Content Outline
## Verified against codebase v213 (c5374db3)

---

## SLIDE 1 — Cover / Tagline
**Title:** RemitFlow
**Tagline:** The World's Most Complete Cross-Border Financial Platform
**Sub-tagline:** Move money. Grow wealth. Power business. Across every border.
**Visual:** Globe with corridors lit up across Africa, Europe, North America, Asia

---

## SLIDE 2 — The Problem
**Title:** The Global Remittance Market Is Broken

Key pain points (verified against codebase corridors & compliance pages):
- Average global remittance fee: 6.3% — families lose billions annually
- Transfers take 3–5 business days through legacy SWIFT rails
- No single platform covers fiat, crypto, mobile money, and investment
- Diaspora communities locked out of homeland investment opportunities
- Businesses face complex CBN Form M compliance, FX controls, and trade finance gaps
- Existing platforms: siloed, expensive, compliance-heavy for users, light on features
- Africa's 1.4B population underserved — 2G/3G connectivity, cash-based economies
- No platform connects the full financial lifecycle: send → save → invest → insure → borrow

---

## SLIDE 3 — The RemitFlow Solution
**Title:** One Platform. Every Financial Need.

Core capabilities (verified):
- **295 web pages + 294 Flutter + 295 React Native screens** — full cross-platform coverage
- **13 live payment corridors** — Nigeria, Ghana, Kenya, Tanzania, Uganda, South Africa, Senegal, Cameroon, Benin, Togo, Mali, Niger + USA/EU diaspora
- **Live FX rates** from openexchangerates.org with automatic static fallback
- **Multi-currency wallets** — NGN, USD, GBP, EUR, CAD, AED, USDT, USDC, BUSD, DAI, NGNT
- **SWIFT GPI / ISO 20022 (pacs.008)** — institutional-grade wire transfers
- **Mojaloop interoperability** — instant settlement across African FSPs
- **M-Pesa STK push** — Kenya mobile money corridor
- **Africa's Talking SMS OTP** — real SDK, works on 2G
- **WebSocket → SSE → Long-poll → Short-poll fallback** — works on 2G/3G/offline

---

## SLIDE 4 — B2B Use Cases
**Title:** Built for Business. Every Type of Business.

### 4a. Partner / IMTO Onboarding
- **TenantOnboardingWizard** — 5-step white-label partner setup (verified: /admin/tenants/new)
- **PartnerApply / PartnerOnboard** — self-service partner application portal
- **AdminPartnerApplications** — admin review and approval workflow
- **PartnerSelfService** — partners manage their own branding, fees, and webhooks
- **PartnerPayoutsV2** — automated partner revenue share disbursements
- **AdminRevenueShare** — platform-level revenue share configuration

### 4b. BDC (Bureau de Change) Portal
- **BDCPartnerPortal** — full BDC onboarding, CBN compliance filing, bulk approvals
- **CbnComplianceDashboard** — CBN Form M validation, CTR reporting, PAPSS compliance
- **CorridorPricingAdmin** — admin sets corridor-specific FX spreads and fees
- **FeeRulesEngine / FeeRulesCRUDV2** — dynamic fee rules by corridor, amount, customer tier

### 4c. SME Trade Finance
- **SMETradePayment** — B2B international trade payments up to $1M
- **CBN Form M Validation** — automated form M validation with CBN reference generation
- **SmeTradeFormMHistory** — audit trail of all Form M submissions
- **go-sme-trade-service** — dedicated Go microservice for trade processing
- **Corridors:** China (CNY), UAE (AED), India (INR), UK (GBP), USA (USD)

### 4d. Agent Banking Network
- **AgentNetwork** — agent registration, territory management, commission tracking
- **AgentPOS** — POS terminal provisioning and management
- **AgentCashIn** — cash-in processing via agent terminals
- **AgentKYBAdmin** — Know Your Business verification for agents
- **POSManagement** — provision, restart, and manage POS terminals remotely

### 4e. Merchant & Checkout
- **MerchantOnboardingPage** — merchant KYB and onboarding
- **MerchantKYBPage** — business verification
- **CheckoutSDK** — embeddable payment SDK for merchant websites
- **DirectDebit** — direct debit mandates for recurring business payments

### 4f. White-Label & Multi-Tenancy
- **AdminWhiteLabel / BrandingPreview** — full white-label branding per tenant
- **TenantAdmin / TenantConfigPage / TenantFeatureFlagsAdmin** — per-tenant feature flags
- **BillingEngineDashboard** — P&L, corridor analytics, billing config per tenant
- **Billing Engine microservice** — Go service: fee %, FX spread, partner split, overhead allocation

### 4g. API & Developer Platform
- **APIKeyManager** — API key creation, rotation, and scoping
- **DeveloperSandbox** — sandbox environment for partner integration testing
- **WebhookAdmin / WebhookManager / WebhookRetryPage** — webhook management with retry
- **APIChangelog / APIUsageDashboard** — API versioning and usage analytics

### 4h. Correspondent Banking
- **CorrespondentBankAdmin** — manage correspondent bank relationships
- **go-correspondent-manager** — Go microservice for correspondent routing
- **SWIFT GPI tracker** — UETR-based real-time SWIFT status tracking

---

## SLIDE 5 — B2C (Individual to Business) Use Cases
**Title:** Everything an Individual Needs. In One App.

### 5a. Core Send Money
- **SendMoney** — send to 13 African corridors + global SWIFT
- **LiveFXCalculator** — real-time FX rate calculator before sending
- **RateLock** — lock an FX rate for up to 24 hours before sending
- **RecurringPayments / ScheduledTransfersV2** — automated recurring transfers
- **BatchPayments** — send to multiple recipients in one transaction
- **TransferTracking / SWIFTTrackerPage** — real-time transfer status

### 5b. Wallets & Cards
- **MultiCurrencyWalletV2** — hold 10+ currencies simultaneously
- **Cards** — virtual and physical Visa/Mastercard/Verve cards
- **VirtualAccount** — dedicated virtual account numbers per currency
- **QRCode** — QR-based payment and receive

### 5c. Savings & Investment
- **Savings / SavingsGoals** — flex and locked savings with auto-save
- **InvestmentPortfolio** — investment portfolio management
- **NGXStockMarket** — buy/sell Nigerian Exchange Group (NGX) listed stocks
- **RealEstateHub** — fractional real estate investment
- **StartupDealRoom** — invest in African startup seed/growth rounds
- **DiasporaInvest** — diaspora investment collectives and diaspora bonds
- **PrivateBankingDashboard** — HNW client portal with negotiated FX spreads, relationship manager

### 5d. Bills & Lifestyle
- **Bills** — pay DSTV, GOtv, NEPA/PHCN electricity, water, internet, school fees
- **Airtime** — MTN, Airtel, Glo, 9mobile top-up (Nigeria + Ghana, Kenya, Senegal, Tanzania)
- **BNPL** — Buy Now Pay Later in 4 installments
- **SplitBill** — split bills with friends and family
- **PayRequest** — request money from contacts
- **MedicalTourism** — medical travel payment facilitation
- **EducationPayments** — tuition and education fee payments
- **TalentBridge** — cross-border freelancer/talent payment
- **CarbonOffsetPage** — carbon offset purchases

### 5e. FX & Rate Management
- **FXAlerts / FXRateAlerts** — set rate alerts for target exchange rates
- **ExchangeRates** — live rate dashboard
- **FXHedging / FXHedgingPage** — FX hedging products
- **FXOptionsPricingPage** — FX options pricing
- **RateLock** — guaranteed rate for 24 hours

### 5f. Loyalty & Community
- **Referral / ReferralDashboard** — earn rewards for referrals
- **LoyaltyRewardsV2** — points-based loyalty program
- **Community / CommunityFeed / CommunityHub / CommunityLeaderboard** — social community features
- **PromoCodeAdmin** — promotional codes (WELCOME10 etc.)

---

## SLIDE 6 — Fiat ↔ Crypto ↔ Stablecoin ↔ Mobile Money
**Title:** Bidirectional. Every Rail. Every Asset Class.

### Fiat Flows (verified)
- **ACH** (USA → Nigeria) — diasporaUSA router, ACH cashback program
- **SEPA** (EU → Nigeria) — diasporaEU router, SEPA transfers
- **SWIFT GPI / ISO 20022 pacs.008** — institutional wire transfers, BIC validation, UETR tracking
- **PAPSS** — Pan-African Payment and Settlement System (go-papss-service)
- **GHIPSS** — Ghana Interbank Payment and Settlement System (go-ghipss-adapter)
- **CIPS** — China Cross-Border Interbank Payment System (go-cips-adapter)
- **BRICSPay** — BRICS payment network adapter (go-bricspay-adapter)
- **PIX** — Brazilian instant payment adapter (python-pix-adapter)
- **UPI** — Indian Unified Payments Interface adapter (rust-upi-adapter)

### Crypto & Stablecoin Flows (verified)
- **Fireblocks NCW** — non-custodial wallet custody (primary), BitGo (secondary failover)
- **Stablecoin wallets** — USDT, USDC, BUSD, DAI, NGNT (ERC-20 Nigerian stablecoin)
- **Stablecoin send** — send stablecoins to any wallet address, deducted from DB wallet
- **Stablecoin swap** — swap between stablecoins (USDT↔USDC↔DAI) with fee calculation
- **SendCrypto** — dedicated crypto send page
- **TRISA / FATF Travel Rule** — Travel Rule compliance for crypto transfers >$1,000
- **rust-crypto-guard** — Rust microservice for crypto transaction security
- **CBDC** — Central Bank Digital Currency wallet (cbdcWallets table, CBDCAdmin page)
- **NGNT** — Nigerian stablecoin (ERC-20) supported natively

### Mobile Money Flows (verified)
- **Mojaloop** — full FSP interoperability: party lookup, quote, transfer, status
- **M-Pesa STK push** — Kenya mobile money (mpesa router in routers.ts)
- **Africa's Talking SMS** — real SDK integration for OTP and notifications
- **XOF adapter** — West African CFA franc mobile money (go-xof-adapter)
- **mBridge adapter** — multi-CBDC bridge (rust-mbridge-adapter)
- **Agent cash-in/cash-out** — physical cash ↔ digital wallet via agent network

### The Full Bidirectional Loop
```
USD (ACH/SEPA/SWIFT) ↔ NGN (bank/mobile money) ↔ USDT/USDC (Fireblocks) ↔ NGNT (ERC-20)
                              ↕
                    M-Pesa (KES) / Mojaloop FSPs / GHIPSS / PAPSS
                              ↕
                    Agent Cash-In/Out (physical ↔ digital)
```

---

## SLIDE 7 — Beyond Remittance
**Title:** RemitFlow Is a Full Financial Ecosystem

### Treasury & Float Income
- **FloatIncomeDashboard** — real treasury_positions table, daily/monthly/YTD yield
- Float pools: USD (5.25%), GBP (5.00%), EUR (3.75%), CAD (4.50%), AED (5.25%)
- TigerBeetle account IDs for float pools (1001–1005)
- Platform earns yield on funds held between receipt and disbursement

### Investment Platform
- **NGX Stock Market** — buy/sell NGX-listed equities
- **Fractional Real Estate** — invest in Nigerian real estate from abroad
- **Startup Deal Room** — seed and growth stage African startup investments
- **Diaspora Bonds** — homeland infrastructure bonds for diaspora investors
- **Investment Collectives** — group investment pools for diaspora communities
- **HNW Private Banking** — negotiated FX spreads, dedicated relationship manager, Priority SWIFT ($25 surcharge), Advisory Retainer ($250/month)

### Embedded Finance & Cross-Sell
- **CrossSellMarketplace** — airtime (5% commission), bills (₦100 flat fee), micro-insurance (8% premium fee)
- **BNPL** — buy now pay later in 4 installments
- **Micro-insurance** — travel, health, device insurance
- **CarbonOffsetPage** — ESG-aligned carbon offset purchases
- **MedicalTourism** — medical travel payments
- **TalentBridge** — cross-border freelancer payments
- **AfriMarket** — African marketplace integration

### Data & Analytics
- **LakehouseAnalytics / LakehousePage** — Delta Lake / Apache Iceberg data lakehouse
- **RevenueAnalytics** — platform revenue analytics
- **AIMetricsDashboard** — AI/ML metrics
- **KnowledgeGraphPage / KGQAPage** — knowledge graph Q&A
- **VectorSearchPage** — semantic vector search (OpenSearch)
- **DataPipelinesPage** — dbt, NiFi, Airflow pipeline management

---

## SLIDE 8 — The Diaspora Angle
**Title:** Built for the 250 Million People Living Away from Home

### Diaspora-Specific Portals (verified pages)
- **DiasporaUSA** — ACH transfers, 1% cashback, zero-fee first transfer, $10 referral bonus
- **DiasporaEU** — SEPA transfers, EU-specific corridors
- **DiasporaUK** — UK-specific features and corridors
- **DiasporaCanada** — Canadian corridor
- **DiasporaItaly** — Italy-specific diaspora portal
- **ImmigrantWorkerSend** — simplified KYC for immigrant workers (NIN + selfie), $500/month limit

### Diaspora Investment (verified)
- **DiasporaInvest** — invest in homeland: Technology, Energy, Agriculture, Infrastructure, Education sectors
- **Diaspora Bonds** — government/infrastructure bonds for diaspora
- **Investment Collectives** — pool resources with other diaspora members
- **RealEstateHub** — buy fractional shares in Nigerian real estate from abroad
- **NGXStockMarket** — invest in Nigerian Exchange Group stocks from anywhere

### Family Support Features
- **FamilyDashboard** — manage family members' financial needs
- **Beneficiaries** — save and manage family recipient profiles
- **RecurringPayments** — automated monthly family support transfers
- **SplitBill** — share costs with family members
- **Bills** — pay family's utility bills, school fees, subscriptions remotely

### Diaspora Acquisition & Retention
- Zero-fee first transfer (USA corridor)
- 1% ACH cashback for first 3 months
- Referral program: $10 per referred friend
- Promo codes (WELCOME10 verified in seed data)
- Community features: leaderboard, feed, hub for diaspora social connection

---

## SLIDE 9 — World-Class Technology Stack
**Title:** Enterprise-Grade Infrastructure. Built for Scale.

### Core Platform
- React 19 + Tailwind 4 + tRPC 11 — end-to-end type safety, zero REST boilerplate
- PostgreSQL with Drizzle ORM — 225 database tables, fully typed queries
- 74 test files, 3,634/3,636 tests passing — production-grade test coverage

### Microservices Architecture (75 services)
- **Go services** — APISIX gateway, BDC connector, correspondent manager, PAPSS, GHIPSS, CIPS, BRICSPay, SME trade, temporal workers, settlement registry, security hardening, XOF adapter, Dapr service, community feed, investment feed, HNW routing
- **Rust services** — PDF receipt generation, B-match FX engine, AML engine, crypto guard, device fingerprinting, HNW FX engine, immigrant worker KYC, mBridge adapter, portfolio calculator, Redis service, TigerBeetle service, Fluvio streaming, UPI adapter, SME bulk processor, share link, audit service, pg service
- **Python services** — AML ML engine, compliance ML, anomaly detector, investment ML, KYC liveness, lakehouse ETL, OpenSearch service, Keycloak service, CBN lakehouse, PIX adapter, sanctions updater, NAV analytics

### Middleware Stack (all wired)
| Middleware | Purpose | Status |
|---|---|---|
| Apache Kafka | Financial event streaming (15 topics) | Wired |
| Dapr | Service mesh pub/sub | Wired |
| Temporal | Workflow orchestration | Wired |
| Redis | Rate limiting, sessions, caching | Wired |
| Permify | Policy-Based Access Control (PBAC) | Wired |
| OpenSearch | Full-text search, vector search | Wired |
| TigerBeetle | Double-entry financial ledger | Wired |
| Delta Lake / Iceberg | Data lakehouse analytics | Wired |
| Keycloak | Enterprise SSO | Wired |
| Mojaloop | FSP interoperability | Wired |
| APISIX + OpenAppSec WAF | API gateway + WAF | Wired |

### Mobile
- **Flutter** — 294 screens, full feature parity with web
- **React Native** — 295 screens, full feature parity with web
- Both wired to tRPC backend via dedicated service layers

### Resilience (for Africa)
- WebSocket → SSE → Long-poll → Short-poll automatic fallback
- IndexedDB offline queue — transactions queued when offline
- Background Sync — syncs when connection restored
- Adaptive connection quality detection (2G/3G/4G/WiFi)
- Bandwidth-aware payload compression

---

## SLIDE 10 — Competitive Advantages
**Title:** Why RemitFlow Wins

| Feature | RemitFlow | Western Union | Wise | WorldRemit | Chipper Cash |
|---|---|---|---|---|---|
| Live corridors | 13 African + global | Limited Africa | Limited Africa | Moderate | West Africa only |
| Crypto/Stablecoin | USDT/USDC/BUSD/DAI/NGNT | No | No | No | Limited |
| Mobile money | Mojaloop + M-Pesa | Limited | No | Moderate | Yes |
| SWIFT GPI ISO 20022 | Yes (pacs.008) | No | No | No | No |
| Investment platform | NGX/Real Estate/Startups | No | No | No | No |
| White-label B2B | Full multi-tenant | No | No | No | No |
| Agent banking | Full POS network | Limited | No | No | No |
| HNW private banking | Yes | No | No | No | No |
| Float income treasury | Yes | No | No | No | No |
| FATF Travel Rule | Yes (TRISA) | Partial | Partial | No | No |
| PBAC security | Yes (Permify) | No | No | No | No |
| Offline capability | Yes (IndexedDB) | No | No | No | No |
| Mobile apps | Flutter + React Native | App only | App only | App only | App only |

---

## SLIDE 11 — Security & Compliance
**Title:** Regulated. Audited. Trusted.

### Compliance Framework (verified pages and routers)
- **KYC Tiers 0–3** — tiered KYC with document OCR, liveness detection (python-kyc-liveness)
- **AML** — ML-based AML engine (Python + Rust), batch processing, case management
- **Sanctions Screening** — compliance_watchlist + sanctions_checks tables, real-time screening
- **Fraud Detection** — logistic regression ML model (fraud-ml service), velocity checks, anomaly detection
- **FCA Compliance** — UK FCA reporting (FCACompliance page, export functionality)
- **CBN Compliance** — Nigerian CBN Form M, CTR reporting, PAPSS compliance dashboard
- **FATF Travel Rule** — TRISA protocol for crypto transfers >$1,000
- **GDPR** — data export (GDPRData), right to erasure (GDPRErasure), consent management
- **DPIA** — Data Protection Impact Assessment page

### Security Architecture (verified)
- **32 attack mitigations** in security.attacks.ts: DDoS, BEC beneficiary-swap detection, credential stuffing, round-tripping, ATO detection, parameter tampering, JWT algorithm validation, timing-safe comparison, amplification attack prevention, concurrency limiting, payload size guard, HTTP method guard, suspicious UA detection, idempotency key deduplication, SIEM buffer
- **OpenAppSec WAF** — APISIX gateway with WAF on all routes
- **PBAC** — Policy-Based Access Control: subject + resource + environment attributes
- **CSP / HSTS / XSS / CSRF** — standard web security headers
- **Rate limiting** — Redis-backed, per-IP and per-user
- **MFA / TOTP** — two-factor authentication (MFASettings page)
- **IP Login History** — track and alert on suspicious login locations
- **SecurityScore** — real-time security score dashboard
- **SecurityAttackSimulator** — test attack scenarios in sandbox

### Infrastructure
- **15+ Docker Compose files** — dev, production, microservices, middleware, observability
- **Kubernetes YAML** — production-grade k8s deployment
- **Grafana dashboards** — real-time monitoring (GrafanaDashboardPage)
- **SLA Monitor** — service-level agreement tracking

---

## SLIDE 12 — Global Reach & Corridors
**Title:** Africa. And Beyond.

### Active Send Corridors (verified pages)
Nigeria, Ghana, Kenya, Tanzania, Uganda, South Africa, Senegal, Cameroon, Benin, Togo, Mali, Niger

### Diaspora Source Markets (verified)
USA (ACH), EU (SEPA), UK, Canada, Italy

### Payment Rails (verified services)
SWIFT GPI, Mojaloop, PAPSS, GHIPSS (Ghana), CIPS (China), BRICSPay, PIX (Brazil), UPI (India), M-Pesa (Kenya), XOF (West Africa CFA), mBridge (multi-CBDC)

### Currencies Supported (verified wallets)
NGN, USD, GBP, EUR, CAD, AED, GHS, KES, TZS, UGX, ZAR, XOF, CNY, INR, BRL + USDT, USDC, BUSD, DAI, NGNT

---

## SLIDE 13 — Call to Action
**Title:** Join the Platform That's Redefining African Finance

Three partnership tracks:
1. **IMTO Partner** — white-label the platform, launch your own remittance brand
2. **BDC Partner** — connect your bureau de change to our liquidity network
3. **API Integration** — embed RemitFlow payments into your existing product

Contact / Next Steps:
- Request a demo
- Access the developer sandbox
- Start the 5-step partner onboarding wizard

**The platform is live. The infrastructure is production-ready. The question is: where do you want to go?**
