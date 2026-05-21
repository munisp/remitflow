# RemitFlow Database Schema Documentation

## Overview

RemitFlow uses PostgreSQL with Drizzle ORM. The schema supports multi-tenant, multi-currency operations with CBN compliance.

## Core Tables

### Users & Authentication

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | User accounts | id, email, name, role, kyc_tier, login_method |
| `sessions` | Active sessions | id, user_id, token, expires_at, ip_address |
| `login_attempts` | Brute force tracking | user_id, ip, success, created_at |
| `mfa_secrets` | 2FA TOTP secrets | user_id, secret, verified |

### Financial Operations

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `wallets` | Multi-currency wallets | id, user_id, currency, balance, locked_balance |
| `transactions` | All financial movements | id, user_id, type, amount, currency, status, reference |
| `beneficiaries` | Saved recipients | id, user_id, name, bank_name, account_number, country |
| `transfers` | Cross-border transfers | id, sender_id, beneficiary_id, amount, fx_rate, corridor |
| `transfer_fees` | Fee breakdowns | transfer_id, fee_type, amount, currency |
| `ledger_entries` | Double-entry bookkeeping | id, transaction_id, account, debit, credit |

### KYC/AML Compliance

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `kyc_documents` | Uploaded ID documents | id, user_id, document_type, status, verified_at |
| `kyc_workflows` | Temporal workflow state | id, user_id, workflow_id, status, current_step |
| `sanctions_checks` | Screening results | id, user_id, provider, result, checked_at |
| `pep_screening_results` | PEP check outcomes | id, user_id, match_score, provider |
| `goaml_reports` | NFIU STR/SAR/CTR filings | id, report_type, user_id, status |
| `bvn_verifications` | BVN verification results | id, user_id, bvn, status, verified_at |

### FX & Rates

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `fx_rates` | Historical FX rates | id, from_currency, to_currency, rate, provider, fetched_at |
| `fx_rate_alert_targets` | User rate alerts | id, user_id, from_currency, to_currency, target_rate, direction |
| `exchange_rate_alerts` | CBN compliance alerts | id, from_currency, to_currency, threshold, direction |
| `rate_locks` | Locked FX rates | id, user_id, rate, locked_at, expires_at |

### Payments & Rails

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `payment_intents` | Payment initialization | id, user_id, amount, currency, provider, status |
| `payment_state_transitions` | State machine audit | payment_id, from_state, to_state, reason |
| `payment_dlq` | Dead letter queue | id, payment_id, error_code, error_message, attempts |
| `settlement_reconciliations` | Settlement matching | id, provider, expected_amount, actual_amount, status |
| `idempotency_keys` | Exactly-once semantics | key_hash, response, expires_at |

### Observability

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `audit_log` | All user/admin actions | id, user_id, action, description, ip_address |
| `security_events` | Security incidents | id, event_type, severity, user_id, details |
| `slo_metrics` | SLO tracking | id, metric_name, value, target, window |

## Row-Level Security

RLS is enabled on sensitive tables. The application sets `app.current_user_id` and `app.current_user_role` before queries.

| Table | Policy | Rule |
|-------|--------|------|
| `users` | `users_self_access` | Users see only their own record |
| `transactions` | `transactions_owner_access` | Users see only their own transactions |
| `wallets` | `wallets_owner_access` | Users see only their own wallets |
| `beneficiaries` | `beneficiaries_owner_access` | Users see only their own beneficiaries |
| `kyc_documents` | `kyc_owner_access` | Users see only their own KYC docs |
| `notifications` | `notifications_owner_access` | Users see only their own notifications |

All tables have an `admin` policy allowing full access when role = 'admin'.

## Full-Text Search

GIN indexes for fast text search on:
- `beneficiaries` — name, bank_name, account_number
- `transactions` — reference, description, status
- `users` — name, email
- `kyc_documents` — document_type, status
- `audit_log` — action, description
- `notifications` — title, message

## Indexes

Production indexes are defined in `drizzle/migrations/0054_add_production_indexes.sql` covering:
- All foreign key columns
- Frequently queried columns (status, created_at, currency)
- Composite indexes for common query patterns
- Partial indexes for active records
