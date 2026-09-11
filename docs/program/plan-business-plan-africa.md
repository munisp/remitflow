# Africa Remittance & Mobile Money Platform — Business Plan (Draft)

## 1. Elevator pitch
**Problem** – Sending money to, from, and across Africa is expensive, slow, and unreliable. Recipients often wait days and lose 5–10% of funds to fees and FX spreads; small businesses struggle to pay suppliers across borders.

**Solution** – A mobile-first remittance and business-payment platform built for African corridors. Individuals send money from the diaspora (US, UK, EU, Gulf) directly to mobile money wallets (M-Pesa, MTN MoMo, Orange Money, Airtel, etc.) and bank accounts; businesses use our API and dashboard to run cross-border payroll and supplier payments.

**Value proposition** – Fees 40–60% lower than Western Union / banks; near-instant delivery to mobile money; transparent pricing; full compliance; a simple, trustworthy UX built with local partnerships (banks, mobile operators, payout networks).

---

## 2. Market opportunity

### 2.1 Market size
- Global remittances to Sub-Saharan Africa: **~$54 billion (2023)**; remittances to Nigeria alone ~$20B.  
- Africa cross-border payments projected to grow 8–12% annually; intra-African trade under AfCFTA expands business payments.
- Mobile money transactions in Africa exceed **$900B annually** (GSMA) — a large, fast-growing payout ecosystem to plug into.

### 2.2 Target segments
- **B2C Remitters (diaspora)** – African professionals abroad (Nigerians, Kenyans, Ethiopians, Ghanaians, etc.) sending $100–$1,000/month to family.
- **SMEs & freelancers** – Businesses paying suppliers/contractors across African borders; freelancers receiving international payments.
- **NGOs & enterprises** – Disbursements, field payments, humanitarian cash transfers.

### 2.3 Competition & differentiation
| Player | Weakness | Our edge |
|---|---|---|
| Western Union / MoneyGram | High fees, cash pickup friction | Lower fees, mobile money direct, digital-first |
| Wise / Remitly | Limited African payout corridors | Deep local payout integrations, better FX in Africa |
| Local banks | Slow, expensive, poor UX | Instant payouts, API-first, compliance built-in |

**Moats:** local licensing/relationships, proprietary payout network, FX liquidity partnerships, superior unit economics, developer API for business payments.

---

## 3. Product & technology

### 3.1 Product suite
- **Consumer app (iOS/Android)** – Send money, track transfers, saved recipients, biometric login, real-time FX quote.
- **Business dashboard + API** – Bulk payouts, payroll, approval flows, reconciliation, webhooks.
- **Agent/partner portal** – For payout partners and compliance teams.

### 3.2 Key features
- Instant quotes and transparent fees
- Mobile money + bank account payouts in 10+ African markets at launch
- Multi-currency wallets (USD/GBP/EUR → NGN/KES/GHS/etc.)
- Real-time transaction tracking and notifications (SMS, push, email)
- KYC/AML onboarding (ID verification, sanctions screening)
- Recurring transfers and scheduled payments
- API for developers (REST + webhooks) with sandbox

### 3.3 Technology stack (high level)
- **Frontend:** React Native (iOS/Android), React dashboard
- **Backend:** Cloud-native microservices (Node.js/TypeScript or Go), PostgreSQL, Redis, event streaming (Kafka)
- **Integrations:** Mobile money operator APIs, local banks, FX providers, card processors, KYC vendors (e.g., Onfido, Smile Identity)
- **Security & compliance:** PCI-DSS, encryption at rest/in transit, role-based access, full audit logs

---

## 4. Business model
- **Transaction fees** – 0.5–1.5% per transfer (vs. 5–10% incumbents).
- **FX margin** – Small, transparent spread (0.5–1%) above mid-market rates.
- **B2B subscriptions & volume pricing** – Tiered plans for SMEs; enterprise contracts for NGOs/large employers.
- **Value-added services (later)** – Bill payments, airtime top-up, savings/remittance-linked products.

**Unit economics (illustrative, Year 3):**  
Average transaction $300 → revenue/txn ~$4.50 (fee + FX); contribution margin target ~35–45% after payout costs and partner fees.

---

## 5. Go-to-market strategy

### 5.1 Launch corridors (first 12–18 months)
1. **US/UK → Nigeria** (largest corridor)  
2. **US/UK → Kenya, Ghana**  
3. **EU → Senegal, Côte d’Ivoire (Francophone)**  
4. Intra-Africa pilots: **Nigeria ↔ Ghana ↔ Kenya**

### 5.2 Customer acquisition
- **Digital marketing:** targeted social, search, influencer partnerships in diaspora communities.
- **Community partnerships:** churches, mosques, African associations, remittance events.
- **Referral program:** give/get $10 credit per referral.
- **B2B sales:** direct sales to SMEs, accounting/payroll software integrations.

### 5.3 Partnerships
- Mobile money operators (M-Pesa, MTN, Orange, Airtel)
- Local banks and payment processors (e.g., Flutterwave, Paystack for collection)
- FX liquidity providers and banking partners in US/UK/EU
- Compliance & KYC vendors

---

## 6. Operations & compliance
- **Licensing:** Money Transmitter Licenses (US states), FCA authorization (UK), EU EMI license, local partnerships/licensing in payout markets.
- **AML/KYC:** Tiered KYC, sanctions screening (OFAC, EU), transaction monitoring, SAR filing.
- **Customer support:** 24/7 chat/phone in English, French, Swahili, Hausa; trust & safety team.
- **Treasury & liquidity:** Prefunded accounts in payout currencies; FX hedging to manage volatility.

---

## 7. Financial projections (summary)
| Year | Send Volume | Revenue | Notes |
|---|---|---|---|
| 1 | $40M | $0.8M | 2 corridors, 15K active customers |
| 2 | $180M | $4.5M | 5 corridors, 70K customers |
| 3 | $600M | $16M | 10+ corridors, 200K customers, B2B scaling |

**Path to profitability:** Contribution margin positive by Year 2; EBITDA positive in Year 4 as B2B and value-added services scale.

---

## 8. Funding ask (Seed/Series A)
**Raising $3–5M seed** to fund:
- Licensing & compliance (30%)
- Product & engineering (40%)
- Marketing & partnerships (20%)
- Operations & working capital (10%)

**Milestones (18 months):** 3 live corridors, 25K active customers, $5M+ monthly send volume, 2 B2B contracts, Series A ready.

---

## 9. Risks & mitigation
| Risk | Mitigation |
|---|---|
| Regulatory delays | Experienced compliance team; local counsel; phased licensing |
| FX volatility | Hedging strategy; dynamic pricing |
| Competition | Superior UX, lower fees, deeper payout network |
| Fraud/AML | Robust monitoring, ML-based risk scoring, transaction limits |
| Currency/liquidity shortages | Multiple banking/FX partners; prefunding buffers |

---

## 10. Team (placeholder)
- **CEO/Founder:** [Name] – Fintech/remittance operator, ex-[Company]
- **CTO:** [Name] – Payments infrastructure, ex-[Company]
- **Head of Compliance:** [Name] – Former regulator/AML lead
- **Head of Growth:** [Name] – Consumer fintech marketing in African markets
- **Advisors:** [Names] – Mobile money exec, FX trader, African banking leader

---

## 11. Vision
Become the **default way the African diaspora and African businesses move money**—fast, affordable, transparent—powering financial inclusion and intra-African trade under AfCFTA.
