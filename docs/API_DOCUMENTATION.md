# RemitFlow API Documentation

**Version 69.0.0 — April 2026**

---

## Overview

RemitFlow exposes its entire backend through a **tRPC 11** API, providing end-to-end type safety between the server and any TypeScript client. All procedures are accessible under the base path `/api/trpc` and are grouped into logical namespaces (routers).

### Base URL

```
https://your-tenant.remitflow.space/api/trpc
```

### Authentication

All protected procedures require a valid session cookie (`remitflow_session`) obtained through the Manus OAuth flow. For server-to-server integrations, pass the JWT as a Bearer token in the `Authorization` header.

```http
Authorization: Bearer <jwt_token>
```

### Request Format

tRPC queries use HTTP `GET` with a `input` query parameter (JSON-encoded). Mutations use HTTP `POST` with a JSON body.

**Query example:**
```http
GET /api/trpc/wallet.balances?input=%7B%7D
```

**Mutation example:**
```http
POST /api/trpc/transfer.send
Content-Type: application/json

{"json": {"fromCurrency": "USD", "toCurrency": "NGN", "amount": 100, "beneficiaryId": 42}}
```

### Response Format

All responses are wrapped in tRPC's standard envelope:

```json
{
  "result": {
    "data": {
      "json": { /* your data */ }
    }
  }
}
```

Error responses follow the tRPC error shape:

```json
{
  "error": {
    "json": {
      "message": "Unauthorized",
      "code": -32001,
      "data": { "code": "UNAUTHORIZED", "httpStatus": 401 }
    }
  }
}
```

### HTTP Endpoints (REST)

In addition to tRPC, the following REST endpoints are available:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Basic health check |
| `GET` | `/api/health` | Health check (alias) |
| `GET` | `/api/ready` | Readiness probe |
| `GET` | `/api/health/detailed` | Detailed health with DB/FX status |
| `GET` | `/api/csrf-token` | Get CSRF token for form submissions |
| `GET` | `/api/transactions/export` | Export transactions as CSV (authenticated) |
| `GET` | `/api/receipt/:reference` | Download PDF receipt for a transaction |
| `POST` | `/api/stripe/webhook` | Stripe webhook receiver |
| `GET` | `/api/oauth/callback` | OAuth callback handler |

---

## Router Reference

### `auth` — Authentication

#### `auth.me` (Query, Protected)

Returns the currently authenticated user.

**Response:**
```json
{
  "id": 1,
  "openId": "user_abc123",
  "name": "Amara Okafor",
  "email": "amara@example.com",
  "role": "user",
  "kycTier": 1,
  "createdAt": "2026-01-15T10:00:00.000Z"
}
```

#### `auth.logout` (Mutation, Protected)

Clears the session cookie and logs the user out.

**Response:**
```json
{ "success": true }
```

#### `auth.refresh` (Mutation, Protected)

Re-signs the session cookie with a fresh 1-year expiry.

**Response:**
```json
{ "success": true, "refreshedAt": "2026-04-19T09:00:00.000Z" }
```

---

### `wallet` — Multi-Currency Wallets

#### `wallet.balances` (Query, Protected)

Returns all wallets for the authenticated user.

**Response:**
```json
[
  { "id": 1, "currency": "USD", "balance": 1250.00, "lockedBalance": 0 },
  { "id": 2, "currency": "NGN", "balance": 850000.00, "lockedBalance": 0 },
  { "id": 3, "currency": "GBP", "balance": 320.50, "lockedBalance": 0 }
]
```

#### `wallet.history` (Query, Protected)

Returns recent wallet transaction history.

**Response:**
```json
[
  {
    "id": 101,
    "type": "credit",
    "amount": 500.00,
    "currency": "USD",
    "description": "Top-up via Stripe",
    "createdAt": "2026-04-18T14:30:00.000Z"
  }
]
```

#### `wallet.topup` (Mutation, Protected)

Simulates a bank transfer top-up (instant, for testing).

**Input:**
```json
{ "currency": "USD", "amount": 500 }
```

**Response:**
```json
{ "success": true, "newBalance": 1750.00, "currency": "USD" }
```

#### `wallet.stripeTopup` (Mutation, Protected)

Creates a Stripe Checkout Session for card-based wallet top-up.

**Input:**
```json
{ "currency": "USD", "amount": 500, "origin": "https://app.remitflow.space" }
```

**Response:**
```json
{ "url": "https://checkout.stripe.com/pay/cs_test_..." }
```

#### `wallet.convert` (Mutation, Protected)

Converts between currencies in the user's wallets.

**Input:**
```json
{ "fromCurrency": "USD", "toCurrency": "NGN", "amount": 100 }
```

**Response:**
```json
{ "success": true, "converted": 153846.00, "rate": 1538.46, "fee": 1.50 }
```

---

### `transfer` — Money Transfers

#### `transfer.send` (Mutation, Protected)

Initiates a cross-border money transfer.

**Input:**
```json
{
  "fromCurrency": "USD",
  "toCurrency": "NGN",
  "amount": 200,
  "beneficiaryId": 42,
  "note": "School fees",
  "pin": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "reference": "TXN-1713520800000",
  "fee": 3.00,
  "fxRate": 1538.46,
  "toAmount": 307692.00,
  "status": "processing"
}
```

#### `transfer.quote` (Query, Protected)

Gets a real-time transfer quote without executing.

**Input:**
```json
{ "fromCurrency": "USD", "toCurrency": "NGN", "amount": 200 }
```

**Response:**
```json
{
  "fromAmount": 200,
  "toAmount": 307692.00,
  "fee": 3.00,
  "fxRate": 1538.46,
  "estimatedDelivery": "2026-04-19T11:00:00.000Z",
  "corridor": "USD/NGN"
}
```

#### `transfer.history` (Query, Protected)

Returns paginated transfer history.

**Input:**
```json
{ "page": 1, "limit": 20, "status": "completed" }
```

**Response:**
```json
{
  "transfers": [
    {
      "id": 55,
      "reference": "TXN-1713520800000",
      "fromCurrency": "USD",
      "toCurrency": "NGN",
      "fromAmount": 200,
      "toAmount": 307692.00,
      "fee": 3.00,
      "fxRate": 1538.46,
      "status": "completed",
      "createdAt": "2026-04-18T10:00:00.000Z"
    }
  ],
  "total": 47,
  "page": 1,
  "pages": 3
}
```

---

### `fx` — Foreign Exchange

#### `fx.rates` (Query, Public)

Returns live FX rates for all supported currencies (base: USD).

**Response:**
```json
{
  "base": "USD",
  "rates": {
    "NGN": 1538.46,
    "GBP": 0.7925,
    "EUR": 0.9215,
    "KES": 130.5,
    "GHS": 12.4
  },
  "updatedAt": "2026-04-19T09:00:00.000Z"
}
```

#### `fx.convert` (Query, Public)

Converts an amount between two currencies.

**Input:**
```json
{ "from": "USD", "to": "NGN", "amount": 100 }
```

**Response:**
```json
{ "from": "USD", "to": "NGN", "amount": 100, "converted": 153846.00, "rate": 1538.46 }
```

#### `fx.alerts` (Query, Protected)

Returns the user's active FX rate alerts.

**Response:**
```json
[
  {
    "id": 3,
    "fromCurrency": "USD",
    "toCurrency": "NGN",
    "targetRate": 1600,
    "direction": "above",
    "active": true
  }
]
```

#### `fx.createAlert` (Mutation, Protected)

Creates a new FX rate alert.

**Input:**
```json
{ "fromCurrency": "USD", "toCurrency": "NGN", "targetRate": 1600, "direction": "above" }
```

**Response:**
```json
{ "success": true, "alertId": 4 }
```

---

### `kyc` — Know Your Customer

#### `kyc.status` (Query, Protected)

Returns the user's current KYC tier and document status.

**Response:**
```json
{
  "tier": 2,
  "documents": [
    { "type": "passport", "status": "approved", "uploadedAt": "2026-03-01T10:00:00.000Z" },
    { "type": "proof_of_address", "status": "pending", "uploadedAt": "2026-04-10T14:00:00.000Z" }
  ],
  "limits": {
    "dailyLimit": 5000,
    "monthlyLimit": 50000,
    "currency": "USD"
  }
}
```

#### `kyc.uploadDocument` (Mutation, Protected)

Uploads a KYC document for review.

**Input:**
```json
{
  "documentType": "passport",
  "fileUrl": "https://storage.remitflow.space/kyc/user-1/passport-abc123.jpg",
  "documentNumber": "A12345678",
  "expiryDate": "2030-01-01"
}
```

**Response:**
```json
{ "success": true, "documentId": 15, "status": "pending" }
```

---

### `beneficiaries` — Saved Recipients

#### `beneficiaries.list` (Query, Protected)

Returns all saved beneficiaries for the user.

**Response:**
```json
[
  {
    "id": 42,
    "name": "Chidi Okonkwo",
    "accountNumber": "0123456789",
    "bankName": "First Bank Nigeria",
    "currency": "NGN",
    "country": "NG",
    "isFavorite": true
  }
]
```

#### `beneficiaries.create` (Mutation, Protected)

Adds a new beneficiary.

**Input:**
```json
{
  "name": "Chidi Okonkwo",
  "accountNumber": "0123456789",
  "bankName": "First Bank Nigeria",
  "currency": "NGN",
  "country": "NG",
  "routingNumber": "011151312"
}
```

**Response:**
```json
{ "success": true, "beneficiaryId": 43 }
```

#### `beneficiaries.delete` (Mutation, Protected)

Removes a saved beneficiary.

**Input:**
```json
{ "id": 43 }
```

**Response:**
```json
{ "success": true }
```

---

### `transactions` — Transaction History

#### `transactions.list` (Query, Protected)

Returns paginated transaction history with optional filters.

**Input:**
```json
{
  "page": 1,
  "limit": 20,
  "type": "send",
  "status": "completed",
  "fromDate": "2026-01-01",
  "toDate": "2026-04-19",
  "currency": "USD"
}
```

**Response:**
```json
{
  "transactions": [
    {
      "id": 101,
      "reference": "TXN-1713520800000",
      "type": "send",
      "fromCurrency": "USD",
      "toCurrency": "NGN",
      "fromAmount": 200,
      "toAmount": 307692.00,
      "fee": 3.00,
      "status": "completed",
      "beneficiaryName": "Chidi Okonkwo",
      "createdAt": "2026-04-18T10:00:00.000Z"
    }
  ],
  "total": 47,
  "page": 1,
  "pages": 3
}
```

#### `transactions.get` (Query, Protected)

Returns details of a single transaction by reference.

**Input:**
```json
{ "reference": "TXN-1713520800000" }
```

---

### `savings` — Savings Goals

#### `savings.list` (Query, Protected)

Returns all savings goals for the user.

**Response:**
```json
[
  {
    "id": 7,
    "name": "Emergency Fund",
    "targetAmount": 5000,
    "currentAmount": 1250,
    "currency": "USD",
    "targetDate": "2026-12-31",
    "progressPct": 25
  }
]
```

#### `savings.create` (Mutation, Protected)

Creates a new savings goal.

**Input:**
```json
{
  "name": "Emergency Fund",
  "targetAmount": 5000,
  "currency": "USD",
  "targetDate": "2026-12-31",
  "autoSaveAmount": 100,
  "autoSaveFrequency": "monthly"
}
```

#### `savings.contribute` (Mutation, Protected)

Adds funds to a savings goal.

**Input:**
```json
{ "goalId": 7, "amount": 250 }
```

**Response:**
```json
{ "success": true, "newBalance": 1500, "progressPct": 30 }
```

#### `savings.getGoalProgress` (Query, Protected)

Returns detailed progress metrics for a savings goal.

**Input:**
```json
{ "goalId": 7 }
```

**Response:**
```json
{
  "goalId": 7,
  "name": "Emergency Fund",
  "targetAmount": 5000,
  "currentAmount": 1500,
  "progressPct": 30,
  "remainingAmount": 3500,
  "daysRemaining": 255,
  "requiredMonthlyContribution": 437.50,
  "onTrack": true
}
```

---

### `notifications` — User Notifications

#### `notifications.list` (Query, Protected)

Returns the user's notifications.

**Input:**
```json
{ "unreadOnly": false, "limit": 50 }
```

**Response:**
```json
[
  {
    "id": 201,
    "title": "Transfer Completed",
    "body": "Your transfer of $200 to Chidi Okonkwo has been completed.",
    "type": "transfer",
    "read": false,
    "createdAt": "2026-04-18T10:05:00.000Z"
  }
]
```

#### `notifications.markRead` (Mutation, Protected)

Marks a notification as read.

**Input:**
```json
{ "notificationId": 201 }
```

#### `notifications.markAllRead` (Mutation, Protected)

Marks all notifications as read.

**Response:**
```json
{ "success": true, "count": 5 }
```

---

### `disputes` — Transaction Disputes

#### `disputes.list` (Query, Protected)

Returns the user's open and resolved disputes.

**Response:**
```json
[
  {
    "id": 12,
    "transactionReference": "TXN-1713520800000",
    "reason": "Transaction not received",
    "status": "open",
    "priority": "high",
    "slaDeadline": "2026-04-22T10:00:00.000Z",
    "createdAt": "2026-04-19T09:00:00.000Z"
  }
]
```

#### `disputes.create` (Mutation, Protected)

Opens a new dispute for a transaction.

**Input:**
```json
{
  "transactionReference": "TXN-1713520800000",
  "reason": "Transaction not received",
  "description": "I sent $200 on April 18 but the recipient has not received funds after 48 hours.",
  "evidenceUrl": "https://storage.remitflow.space/disputes/evidence-abc.pdf"
}
```

**Response:**
```json
{ "success": true, "disputeId": 13, "caseNumber": "CASE-2026-0013" }
```

---

### `bnpl` — Buy Now Pay Later

#### `bnpl.plans` (Query, Protected)

Returns the user's active BNPL instalment plans.

**Response:**
```json
[
  {
    "id": 5,
    "description": "Transfer to Nigeria — $500",
    "totalAmount": 500,
    "currency": "USD",
    "installments": 4,
    "installmentAmount": 125,
    "paidCount": 1,
    "nextDueDate": "2026-05-19",
    "status": "active"
  }
]
```

#### `bnpl.applyPlan` (Mutation, Protected)

Creates a BNPL plan for a transfer.

**Input:**
```json
{
  "amount": 500,
  "currency": "USD",
  "description": "Transfer to Nigeria",
  "installments": 4
}
```

**Response:**
```json
{
  "success": true,
  "planId": 6,
  "installmentAmount": 125,
  "firstDueDate": "2026-05-19",
  "schedule": [
    { "installment": 1, "amount": 125, "dueDate": "2026-05-19" },
    { "installment": 2, "amount": 125, "dueDate": "2026-06-19" },
    { "installment": 3, "amount": 125, "dueDate": "2026-07-19" },
    { "installment": 4, "amount": 125, "dueDate": "2026-08-19" }
  ]
}
```

---

### `directDebit` — Direct Debit Mandates

#### `directDebit.mandates` (Query, Protected)

Returns all direct debit mandates for the user.

**Response:**
```json
[
  {
    "id": 3,
    "creditor": "Rent — Lagos Apartment",
    "amount": 150000,
    "currency": "NGN",
    "frequency": "monthly",
    "status": "active",
    "nextDebitDate": "2026-05-01",
    "mandateRef": "DDM-1713520800000"
  }
]
```

#### `directDebit.create` (Mutation, Protected)

Creates a new direct debit mandate.

**Input:**
```json
{
  "creditor": "Rent — Lagos Apartment",
  "creditorAccount": "0123456789",
  "amount": 150000,
  "currency": "NGN",
  "frequency": "monthly",
  "startDate": "2026-05-01"
}
```

#### `directDebit.pause` (Mutation, Protected)

Pauses an active mandate.

**Input:**
```json
{ "mandateId": 3 }
```

#### `directDebit.resume` (Mutation, Protected)

Resumes a paused mandate.

**Input:**
```json
{ "mandateId": 3 }
```

#### `directDebit.cancel` (Mutation, Protected)

Permanently cancels a mandate.

**Input:**
```json
{ "mandateId": 3 }
```

---

### `recurring` — Recurring Payments

#### `recurring.list` (Query, Protected)

Returns all scheduled recurring payments.

**Response:**
```json
[
  {
    "id": 8,
    "beneficiaryId": 42,
    "amount": 200,
    "fromCurrency": "USD",
    "toCurrency": "NGN",
    "frequency": "monthly",
    "nextRunDate": "2026-05-01",
    "status": "active"
  }
]
```

#### `recurring.create` (Mutation, Protected)

Schedules a new recurring payment.

**Input:**
```json
{
  "beneficiaryId": 42,
  "amount": 200,
  "fromCurrency": "USD",
  "toCurrency": "NGN",
  "frequency": "monthly",
  "startDate": "2026-05-01",
  "note": "Monthly support"
}
```

---

### `partnerOnboarding` — White-Label Partner Onboarding

#### `partnerOnboarding.verifyCode` (Mutation, Public)

Verifies a partner invite code.

**Input:**
```json
{ "code": "REMIT-STARTER-2026" }
```

**Response:**
```json
{
  "valid": true,
  "plan": "starter",
  "maxTenants": 1,
  "features": ["white_label", "custom_domain", "api_access"],
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

#### `partnerOnboarding.saveSession` (Mutation, Protected)

Saves onboarding session progress (auto-save between steps).

**Input:**
```json
{
  "inviteCode": "REMIT-STARTER-2026",
  "step": 3,
  "data": {
    "companyName": "Horizon Payments Ltd",
    "brandName": "HorizonPay",
    "primaryColor": "#1A56DB"
  }
}
```

#### `partnerOnboarding.complete` (Mutation, Protected)

Finalises onboarding and creates the tenant.

**Input:**
```json
{
  "inviteCode": "REMIT-STARTER-2026",
  "companyName": "Horizon Payments Ltd",
  "companyType": "fintech",
  "registrationNumber": "RC-1234567",
  "country": "NG",
  "website": "https://horizonpay.ng",
  "contactEmail": "cto@horizonpay.ng",
  "complianceEmail": "compliance@horizonpay.ng",
  "phone": "+234 800 123 4567",
  "brandName": "HorizonPay",
  "tagline": "Send money home, instantly",
  "primaryColor": "#1A56DB",
  "secondaryColor": "#F97316",
  "logoUrl": "https://cdn.horizonpay.ng/logo.png",
  "supportEmail": "support@horizonpay.ng",
  "domain": "horizonpay.remitflow.space",
  "feeType": "percentage",
  "feeValue": 1.5,
  "minFee": 0.5,
  "maxFee": 25,
  "fxSpread": 0.5
}
```

**Response:**
```json
{
  "success": true,
  "tenantId": 7,
  "slug": "horizonpay",
  "dashboardUrl": "/tenant/horizonpay/dashboard",
  "platformUrl": "https://horizonpay.remitflow.space"
}
```

---

### `adminInviteCodes` — Admin: Invite Code Management

All procedures require admin role.

#### `adminInviteCodes.list` (Query, Admin)

Returns all invite codes with usage statistics.

**Response:**
```json
[
  {
    "id": 1,
    "code": "REMIT-STARTER-2026",
    "plan": "starter",
    "maxUses": 1,
    "usedCount": 0,
    "expiresAt": "2026-12-31T23:59:59.000Z",
    "createdAt": "2026-04-19T09:00:00.000Z",
    "isExpired": false,
    "isExhausted": false
  }
]
```

#### `adminInviteCodes.generate` (Mutation, Admin)

Generates a new invite code.

**Input:**
```json
{
  "plan": "growth",
  "maxUses": 5,
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "notes": "For fintech accelerator cohort"
}
```

**Response:**
```json
{ "success": true, "code": "REMIT-GROWTH-X7K2M", "id": 6 }
```

#### `adminInviteCodes.revoke` (Mutation, Admin)

Revokes an invite code immediately.

**Input:**
```json
{ "codeId": 6 }
```

---

### `admin` — Platform Administration

All procedures require admin role.

#### `admin.summary` (Query, Admin)

Returns platform-wide KPIs.

**Response:**
```json
{
  "totalUsers": 1250,
  "activeUsers30d": 847,
  "totalTransactions": 15420,
  "totalVolume": 2847500.00,
  "pendingKyc": 23,
  "openDisputes": 7,
  "totalRevenue": 42712.50
}
```

#### `admin.listUsers` (Query, Admin)

Returns paginated user list with search.

**Input:**
```json
{ "page": 1, "limit": 50, "search": "amara", "role": "user", "kycTier": 2 }
```

#### `admin.updateUserRole` (Mutation, Admin)

Updates a user's role.

**Input:**
```json
{ "userId": 42, "role": "admin" }
```

#### `admin.listPendingKyc` (Query, Admin)

Returns KYC documents awaiting review.

**Response:**
```json
[
  {
    "userId": 88,
    "userName": "Fatima Al-Hassan",
    "documentType": "national_id",
    "uploadedAt": "2026-04-18T09:00:00.000Z",
    "documentUrl": "https://storage.remitflow.space/kyc/user-88/id-abc.jpg"
  }
]
```

#### `admin.approveKyc` (Mutation, Admin)

Approves a KYC document and upgrades the user's tier.

**Input:**
```json
{ "userId": 88, "documentId": 15, "newTier": 2 }
```

#### `admin.rejectKyc` (Mutation, Admin)

Rejects a KYC document with a reason.

**Input:**
```json
{ "userId": 88, "documentId": 15, "reason": "Document expired" }
```

---

### `compliance` — Compliance & AML

#### `compliance.cases` (Query, Protected)

Returns compliance cases for the user (admin sees all).

#### `compliance.flagTransaction` (Mutation, Admin)

Flags a transaction for compliance review.

**Input:**
```json
{
  "transactionId": 101,
  "reason": "Unusual transaction pattern",
  "riskScore": 75
}
```

---

### `community` — Community Features

#### `community.posts` (Query, Public)

Returns community posts with pagination.

**Input:**
```json
{ "page": 1, "limit": 20, "category": "tips" }
```

#### `community.createPost` (Mutation, Protected)

Creates a new community post.

**Input:**
```json
{
  "title": "Best corridors for USD to NGN transfers",
  "content": "After testing several platforms...",
  "category": "tips"
}
```

#### `community.vote` (Mutation, Protected)

Upvotes or downvotes a post.

**Input:**
```json
{ "postId": 15, "direction": "up" }
```

#### `community.listMyVotes` (Query, Protected)

Returns all posts the current user has voted on.

**Response:**
```json
[
  { "postId": 15, "direction": "up", "votedAt": "2026-04-18T10:00:00.000Z" }
]
```

---

### `system` — System Health

#### `system.health` (Query, Public)

Returns system health status.

**Response:**
```json
{
  "status": "ok",
  "db": true,
  "timestamp": "2026-04-19T09:00:00.000Z",
  "version": "69.0.0",
  "uptime": 86400
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | No valid session; login required |
| `FORBIDDEN` | 403 | Insufficient permissions (e.g., non-admin accessing admin procedure) |
| `NOT_FOUND` | 404 | Resource does not exist |
| `BAD_REQUEST` | 400 | Invalid input; see `message` for details |
| `CONFLICT` | 409 | Resource already exists (e.g., duplicate beneficiary) |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |
| `PRECONDITION_FAILED` | 412 | Business rule violation (e.g., insufficient balance, KYC tier too low) |

---

## Rate Limits

| Endpoint Category | Limit |
|---|---|
| Authentication | 10 requests/minute per IP |
| Transfer send | 5 requests/minute per user |
| FX rates (public) | 60 requests/minute per IP |
| All other protected | 120 requests/minute per user |
| Admin procedures | 300 requests/minute per admin |

---

## Webhooks

RemitFlow can push real-time events to your server via webhooks. Configure your webhook URL in the Tenant Dashboard under **Settings → Webhooks**.

**Event types:**

| Event | Trigger |
|---|---|
| `transfer.completed` | Transfer successfully processed |
| `transfer.failed` | Transfer failed after retries |
| `kyc.approved` | KYC document approved |
| `kyc.rejected` | KYC document rejected |
| `dispute.opened` | New dispute filed |
| `dispute.resolved` | Dispute resolved |
| `payment.received` | Incoming payment credited |

**Webhook payload format:**
```json
{
  "event": "transfer.completed",
  "timestamp": "2026-04-19T10:00:00.000Z",
  "tenantId": "horizonpay",
  "data": {
    "reference": "TXN-1713520800000",
    "amount": 200,
    "currency": "USD",
    "userId": 42
  }
}
```

All webhook requests include an `X-RemitFlow-Signature` header (HMAC-SHA256 of the payload using your webhook secret) for verification.

---

## SDK & Client Libraries

### TypeScript / JavaScript

The recommended way to consume the RemitFlow API from a TypeScript frontend is via the tRPC client:

```typescript
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from './server/routers';

const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'https://your-tenant.remitflow.space/api/trpc',
      headers: () => ({
        Authorization: `Bearer ${getToken()}`,
      }),
    }),
  ],
});

// Query example
const balances = await client.wallet.balances.query();

// Mutation example
const result = await client.transfer.send.mutate({
  fromCurrency: 'USD',
  toCurrency: 'NGN',
  amount: 200,
  beneficiaryId: 42,
});
```

### REST Clients (cURL)

For non-TypeScript environments, use the HTTP API directly:

```bash
# Get FX rates (public)
curl https://your-tenant.remitflow.space/api/trpc/fx.rates

# Get wallet balances (authenticated)
curl https://your-tenant.remitflow.space/api/trpc/wallet.balances \
  -H "Authorization: Bearer <token>"

# Send a transfer (mutation)
curl -X POST https://your-tenant.remitflow.space/api/trpc/transfer.send \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"json": {"fromCurrency": "USD", "toCurrency": "NGN", "amount": 200, "beneficiaryId": 42}}'
```

---

*This documentation is auto-generated from the RemitFlow v69.0.0 tRPC router definitions.*
*© 2026 RemitFlow. All rights reserved.*
