# RemitFlow Partner Onboarding Guide

**Version 1.0 — April 2026**
*For White-Label Partners & Resellers*

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Before You Begin](#2-before-you-begin)
3. [Step-by-Step Onboarding Walkthrough](#3-step-by-step-onboarding-walkthrough)
   - [Step 1 — Verify Your Invite Code](#step-1--verify-your-invite-code)
   - [Step 2 — Company Details](#step-2--company-details)
   - [Step 3 — Branding Configuration](#step-3--branding-configuration)
   - [Step 4 — Domain & URL Setup](#step-4--domain--url-setup)
   - [Step 5 — Fee Structure](#step-5--fee-structure)
   - [Step 6 — Review & Launch](#step-6--review--launch)
4. [Managing Your Tenant Dashboard](#4-managing-your-tenant-dashboard)
5. [Sub-User & Team Management](#5-sub-user--team-management)
6. [Corridor & Fee Configuration](#6-corridor--fee-configuration)
7. [White-Label Branding Reference](#7-white-label-branding-reference)
8. [Compliance & Regulatory Requirements](#8-compliance--regulatory-requirements)
9. [Integration & API Access](#9-integration--api-access)
10. [Support & Escalation](#10-support--escalation)
11. [Frequently Asked Questions](#11-frequently-asked-questions)

---

## 1. Introduction

RemitFlow's white-label programme enables licensed financial institutions, fintech companies, and remittance agents to deploy a fully branded cross-border payments platform under their own identity. As a partner, you receive access to RemitFlow's entire infrastructure — real-time FX rates across 40+ currency corridors, KYC/AML compliance engine, BNPL financing, multi-currency wallets, and agent network — all presented under your brand.

This guide walks you through the complete onboarding process, from invite-code verification to your first live transaction.

---

## 2. Before You Begin

Before starting the onboarding wizard, ensure you have the following ready:

| Requirement | Details |
|---|---|
| **Invite Code** | A unique alphanumeric code issued by the RemitFlow partnerships team (e.g., `REMIT-STARTER-2026`) |
| **Company Registration** | Legal company name, registration number, and country of incorporation |
| **Regulatory Licence** | Money Service Business (MSB) licence, Payment Institution (PI) licence, or equivalent |
| **Brand Assets** | Logo file (PNG, SVG, or JPEG; minimum 200×200 px), primary and secondary brand colours (hex codes) |
| **Domain** | A subdomain or custom domain you wish to use (e.g., `pay.yourcompany.com`) |
| **Contact Information** | Primary technical contact and compliance officer email addresses |

> **Note:** Invite codes are single-use or limited-use tokens with an expiry date. If your code has expired, contact your RemitFlow account manager to request a new one.

---

## 3. Step-by-Step Onboarding Walkthrough

Navigate to **`https://your-remitflow-instance.com/partner/onboard`** to begin. The wizard consists of six steps and takes approximately 15–20 minutes to complete.

---

### Step 1 — Verify Your Invite Code

The first screen presents a single input field for your invite code. This gate prevents unauthorised registrations and ensures that only vetted partners can create tenants.

**How to complete this step:**

1. Enter your invite code exactly as provided (codes are case-insensitive but must include hyphens where present).
2. Click **Verify Code**.
3. The system validates the code against the following criteria:
   - Code exists in the `partner_invite_codes` table
   - Code has not been previously used (or has remaining uses if multi-use)
   - Code has not expired
4. On success, a green confirmation banner appears and the **Next** button becomes active.

**Common errors:**

| Error Message | Cause | Resolution |
|---|---|---|
| "Invalid invite code" | Code does not exist or was mistyped | Check for typos; codes are 20 characters maximum |
| "This code has already been used" | Single-use code was already redeemed | Contact your account manager for a new code |
| "This invite code has expired" | Code passed its expiry date | Request a new code from partnerships@remitflow.com |

---

### Step 2 — Company Details

This step captures your organisation's legal and operational information. All fields are required for regulatory compliance.

**Fields to complete:**

| Field | Description | Example |
|---|---|---|
| **Company Name** | Legal registered name | "Horizon Payments Ltd" |
| **Company Type** | Select from: Fintech, Bank, MFI, MSB, NGO, Other | "Fintech" |
| **Registration Number** | Company registration or incorporation number | "RC-1234567" |
| **Country** | Country of incorporation | "Nigeria" |
| **Website** | Your public-facing website URL | "https://horizonpay.ng" |
| **Primary Contact Email** | Main technical/business contact | "cto@horizonpay.ng" |
| **Compliance Email** | Dedicated compliance officer email | "compliance@horizonpay.ng" |
| **Phone** | International format with country code | "+234 800 123 4567" |

> **Privacy note:** This information is stored securely and used solely for partner verification, regulatory reporting, and support communications. It is never shared with third parties.

---

### Step 3 — Branding Configuration

This is where your white-label identity takes shape. RemitFlow applies your branding across all customer-facing interfaces: the web app, email templates, PDF receipts, and mobile views.

**Branding fields:**

| Field | Description | Format |
|---|---|---|
| **Brand Name** | The name your customers will see | "HorizonPay" |
| **Tagline** | Short marketing phrase (optional) | "Send money home, instantly" |
| **Primary Colour** | Main brand colour for buttons, headers | Hex code: `#1A56DB` |
| **Secondary Colour** | Accent colour for highlights | Hex code: `#F97316` |
| **Logo URL** | Publicly accessible URL to your logo image | `https://cdn.horizonpay.ng/logo.png` |
| **Support Email** | Email shown to end-users for help | `support@horizonpay.ng` |
| **Support Phone** | Phone number shown to end-users | `+234 800 123 4567` |

**Live preview:** As you enter your brand colours and logo URL, the right panel updates in real time to show how your branded platform will appear to customers. Review the preview carefully before proceeding.

**Best practices for logo files:**
- Use a transparent-background PNG or SVG for best results
- Minimum recommended size: 400×200 px (landscape orientation)
- Maximum file size: 2 MB
- Avoid logos with very thin lines that may not render clearly at small sizes

---

### Step 4 — Domain & URL Setup

Your white-label instance will be accessible at a unique URL. You have two options:

**Option A — RemitFlow Subdomain (Recommended for getting started)**

Choose a subdomain prefix under `remitflow.space`:

- Format: `your-brand.remitflow.space`
- Example: `horizonpay.remitflow.space`
- Available immediately after onboarding completes
- No DNS configuration required

**Option B — Custom Domain**

Use your own domain (e.g., `pay.horizonpay.ng`):

1. Enter your domain in the **Custom Domain** field.
2. After onboarding, add the following DNS records at your domain registrar:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `pay` (or your subdomain) | `proxy.remitflow.space` |
| `TXT` | `_remitflow-verify` | `verify=<your-tenant-id>` |

3. DNS propagation typically takes 15 minutes to 48 hours.
4. SSL/TLS certificates are provisioned automatically via Let's Encrypt once DNS is verified.

---

### Step 5 — Fee Structure

Define how you will charge your customers for remittance services. RemitFlow supports flexible fee models that can be overridden per corridor.

**Fee model options:**

| Model | Description | Example |
|---|---|---|
| **Flat Fee** | Fixed amount per transaction | $2.50 per transfer |
| **Percentage** | Percentage of transfer amount | 1.5% of transfer value |
| **Tiered** | Different rates based on amount bands | 2% up to $500; 1% above $500 |
| **Zero Fee** | No fee (revenue from FX spread) | 0% fee; earn on exchange rate |

**Fields to complete:**

| Field | Description | Default |
|---|---|---|
| **Default Fee Type** | Flat, Percentage, or Tiered | Percentage |
| **Default Fee Value** | Numeric value (% or fixed amount) | 1.5 |
| **Minimum Fee** | Floor amount per transaction | $0.50 |
| **Maximum Fee** | Cap per transaction (optional) | $25.00 |
| **FX Spread** | Additional margin on exchange rate (%) | 0.5% |

> **Important:** Your fees are applied on top of RemitFlow's base network costs. The platform will display the total fee to your end-users transparently. Ensure your fee structure complies with local consumer protection regulations in your operating markets.

---

### Step 6 — Review & Launch

The final step presents a complete summary of all your configuration choices. Review each section carefully:

- **Company details** — verify legal name and registration number
- **Branding preview** — confirm logo, colours, and brand name appear correctly
- **Domain** — confirm the URL your customers will use
- **Fee summary** — verify the fee structure you have configured

Once satisfied, click **Launch My Platform**. The system will:

1. Create your tenant record in the database
2. Mark your invite code as used
3. Provision your branded subdomain (or queue custom domain verification)
4. Send a confirmation email to your primary contact with next steps
5. Redirect you to your **Tenant Admin Dashboard**

> **Congratulations!** Your white-label RemitFlow instance is now live. Your customers can begin registering and sending money immediately.

---

## 4. Managing Your Tenant Dashboard

After onboarding, your Tenant Admin Dashboard is accessible at `/tenant/{your-slug}/dashboard`. This is your central control panel.

**Dashboard sections:**

| Section | Description |
|---|---|
| **Overview** | Key metrics: total transactions, active users, revenue, volume this month |
| **Branding** | Update logo, colours, tagline, and contact information at any time |
| **Members** | Invite and manage sub-users (agents, compliance officers, support staff) |
| **Corridors** | Enable/disable specific currency corridors and set per-corridor fee overrides |
| **White-Label Config** | Advanced settings: custom CSS, email template overrides, feature flags |
| **Analytics** | Transaction volume charts, user acquisition, corridor performance |

**Key metrics explained:**

| Metric | Definition |
|---|---|
| **Total Transactions** | Cumulative count of all completed transfers on your platform |
| **Active Users** | Users who have transacted in the last 30 days |
| **Revenue** | Total fees collected from your customers |
| **Volume** | Total value of money transferred (in USD equivalent) |

---

## 5. Sub-User & Team Management

You can invite team members to help manage your tenant. Each sub-user is assigned a role that determines their access level.

**Available roles:**

| Role | Permissions |
|---|---|
| **Owner** | Full access to all settings, billing, and user management |
| **Admin** | All settings except billing and owner management |
| **Compliance** | Read-only access to transactions, KYC records, and audit logs |
| **Support** | View customer accounts and transactions; cannot modify settings |
| **Agent** | Process transactions on behalf of customers at a physical location |

**To invite a sub-user:**

1. Navigate to **Members** in your Tenant Dashboard.
2. Click **Invite Member**.
3. Enter the email address and select a role.
4. Click **Send Invitation**.
5. The invitee receives an email with a secure one-time link to accept and set their password.

---

## 6. Corridor & Fee Configuration

RemitFlow supports 40+ currency corridors. By default, all corridors are enabled for your tenant. You can disable corridors that are not relevant to your market or for which you do not hold the required regulatory approvals.

**To manage corridors:**

1. Navigate to **Corridors** in your Tenant Dashboard.
2. Use the toggle to enable or disable each corridor.
3. To set a corridor-specific fee override, click the **Edit** icon next to any corridor.
4. Enter your custom fee (flat or percentage) for that corridor.
5. Click **Save**.

**Example corridor fee override:**

| Corridor | Default Fee | Your Override |
|---|---|---|
| USD → NGN | 1.5% | 1.0% (competitive pricing for your key market) |
| GBP → KES | 1.5% | 2.0% (higher margin on less competitive corridor) |
| EUR → GHS | 1.5% | 1.5% (no override; use platform default) |

---

## 7. White-Label Branding Reference

### Colour System

RemitFlow uses your primary and secondary colours across the following UI elements:

| Element | Colour Used |
|---|---|
| Primary buttons | Primary colour |
| Navigation sidebar | Primary colour (dark variant) |
| Links and highlights | Primary colour |
| Success states | Green (system default) |
| Warning states | Amber (system default) |
| Accent badges | Secondary colour |
| Email header | Primary colour |
| PDF receipt header | Primary colour + logo |

### Typography

The platform uses **Inter** as the default typeface. Custom font support is available on the Enterprise plan by providing a Google Fonts URL or self-hosted font file.

### Email Templates

All transactional emails (transfer confirmation, KYC approval, welcome email) are automatically branded with your logo and primary colour. The sender name defaults to your **Brand Name** and the reply-to address is set to your **Support Email**.

---

## 8. Compliance & Regulatory Requirements

As a white-label partner, you are the regulated entity responsible for your customers. RemitFlow provides the technology infrastructure; you are responsible for:

| Responsibility | Details |
|---|---|
| **Customer KYC** | Verifying customer identity in accordance with local AML/CFT regulations |
| **Transaction Monitoring** | Reviewing flagged transactions and filing SARs where required |
| **Sanctions Screening** | RemitFlow screens against OFAC, UN, and EU sanctions lists automatically |
| **Record Keeping** | Maintaining transaction records for the period required by your regulator |
| **Regulatory Reporting** | Filing required reports (CTRs, SARs, etc.) with your local FIU |
| **Data Protection** | Complying with GDPR, NDPR, or equivalent data protection laws |

RemitFlow's compliance engine provides:
- Automated AML risk scoring on every transaction
- Real-time sanctions screening
- KYC document verification (Tier 1–3)
- Audit logs for all system actions (retained for 7 years)
- GDPR data export and erasure tools

---

## 9. Integration & API Access

Your tenant has access to the RemitFlow REST/tRPC API for custom integrations. API credentials are available in your Tenant Dashboard under **Settings → API Keys**.

**Base URL:** `https://your-tenant.remitflow.space/api/trpc`

**Authentication:** Bearer token (JWT) in the `Authorization` header.

For full API documentation, see the [RemitFlow API Reference](./API_DOCUMENTATION.md).

**Common integration use cases:**
- Embedding the transfer widget in your existing mobile app
- Syncing transaction data to your internal accounting system
- Triggering compliance workflows from your case management system
- Receiving real-time webhooks for transaction status updates

---

## 10. Support & Escalation

| Channel | Use Case | Response Time |
|---|---|---|
| **In-app chat** | General questions, UI issues | < 4 hours (business hours) |
| **Email:** partners@remitflow.com | Technical integration, billing | < 24 hours |
| **Email:** compliance@remitflow.com | Regulatory and compliance queries | < 4 hours |
| **Emergency hotline** | Critical production incidents | < 1 hour (24/7) |

**Escalation path:**
1. In-app support chat
2. Email to partners@remitflow.com
3. Escalate to your dedicated account manager
4. Executive escalation for P0 incidents

---

## 11. Frequently Asked Questions

**Q: How long does onboarding take?**
The wizard itself takes 15–20 minutes. Your platform is live immediately after completing Step 6. Custom domain DNS propagation may take up to 48 hours.

**Q: Can I change my branding after going live?**
Yes. Navigate to **Branding** in your Tenant Dashboard and update any element at any time. Changes take effect within 5 minutes.

**Q: Can I use my own KYC provider?**
Yes, on the Enterprise plan. RemitFlow supports webhook-based KYC provider integration. Contact your account manager to configure this.

**Q: What happens if a customer disputes a transaction?**
Disputes are managed through the RemitFlow dispute resolution system. Your compliance team will receive a notification and can review and respond to disputes in the Admin Dashboard under **Disputes**.

**Q: Is there a transaction limit for my customers?**
Default limits are set by KYC tier: Tier 1 ($500/day), Tier 2 ($5,000/day), Tier 3 ($50,000/day). You can configure custom limits per tier in your Tenant Dashboard under **Settings → Limits**.

**Q: How do I test my integration before going live?**
Use the sandbox environment at `https://sandbox.remitflow.space`. All test transactions use Stripe's test card `4242 4242 4242 4242` and do not move real money.

**Q: What currencies are supported?**
RemitFlow supports 40+ currencies across Africa, Europe, North America, Asia, and the Middle East. See the full corridor list in your Tenant Dashboard under **Corridors**.

**Q: How are FX rates determined?**
Rates are sourced in real time from ExchangeRate-API and updated every 30 minutes. Your FX spread (configured in Step 5) is applied on top of the mid-market rate.

---

*This document is maintained by the RemitFlow Partnerships Team. For the latest version, visit your Tenant Dashboard → Documentation.*

*© 2026 RemitFlow. All rights reserved.*
