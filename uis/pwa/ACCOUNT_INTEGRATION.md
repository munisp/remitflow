# Account Service Integration - Core Banking Multi-Currency Support

## Overview

This document describes the integration of the **54remit Core Banking Account Service** into the remittance UI, enabling full multi-currency account management capabilities.

## What's New

### Core Banking Integration

The remittance UI now directly integrates with the `account-service` from the `54link_core_banking` system, providing:

- **Multi-Currency Account Management**: Support for NGN, USD, EUR, GBP, GHS, JPY, and AUD
- **Real Account Creation**: Create accounts directly via the core banking API
- **Account Types**: Primary, Savings, and Current accounts
- **Real-time Balance Sync**: Live balance updates from core banking ledger
- **Account Number Management**: Each account gets a unique 10-digit account number

## Architecture

### Service Layer

#### `accountService.ts`

Located at: `src/services/accountService.ts`

This service provides:

- Account CRUD operations
- Multi-currency support
- PIN management
- Balance aggregation
- Currency metadata

**Key Methods:**

```typescript
// Create new multi-currency account
accountService.createAccount({
  name: "My USD Account",
  account_type: AccountType.PRIMARY,
  account_currency: AccountCurrency.USD,
});

// Get all user accounts
accountService.getAccounts();

// Get account by ID or account number
accountService.getAccountById(accountId);
accountService.getAccountByNumber(accountNumber);

// PIN management
accountService.setupPin(accountId, { pin: "1234" });
accountService.verifyPin(accountId, { pin: "1234" });

// Helper methods
accountService.getAccountsByCurrency();
accountService.getPrimaryAccount(currency);
accountService.getTotalBalance(exchangeRates);
accountService.getSupportedCurrencies();
```

### Components

#### `CreateAccountModal.tsx`

Located at: `src/components/CreateAccountModal.tsx`

Interactive modal for creating new multi-currency accounts featuring:

- Currency selection with flags
- Account type selection (Primary, Savings, Current)
- Account naming
- Real-time validation
- Error handling

### Updated Pages

#### `Wallet.tsx`

Complete rewrite to use core banking accounts:

- Displays all user accounts from core banking
- Shows account numbers and types
- Real-time balance display
- Multi-currency aggregation
- Create new account button
- Empty state for new users

#### `Dashboard.tsx`

Updated to show aggregated balance from all accounts:

- Total balance across all currencies (NGN equivalent)
- Account count display
- Integration with account service

## API Integration

### Endpoints Used

All endpoints are prefixed with `/account/account`:

| Endpoint                                   | Method | Purpose                |
| ------------------------------------------ | ------ | ---------------------- |
| `/account/account`                         | POST   | Create new account     |
| `/account/account/all`                     | GET    | Get all user accounts  |
| `/account/account/{id}`                    | GET    | Get account by ID      |
| `/account/account/account-number/{number}` | GET    | Get account by number  |
| `/account/account/{id}/setup-pin`          | POST   | Setup PIN for account  |
| `/account/account/{id}/verify-pin`         | POST   | Verify account PIN     |
| `/account/account/check`                   | POST   | Check account with PIN |

### Request Headers

All requests include:

- `x-tenant-id`: Tenant identifier
- `x-keycloak-id`: User's Keycloak ID
- `x-ledger-id`: Ledger identifier
- `Authorization`: Bearer token

These are automatically added by the `api.ts` request handler.

## Data Models

### Account Model

```typescript
interface Account {
  id: number; // Tigerbeetle account ID
  name: string; // Account name
  account_number: string; // 10-digit account number
  account_type: AccountType; // primary | savings | current | mint
  account_currency: AccountCurrency; // USD | EUR | GBP | NGN | GHS | JPY | AUD
  balance: string; // Current balance
  status: AccountStatus; // active | inactive | suspended | deleted
  keycloak_id: string; // User's Keycloak ID
  tenant_id: string; // Tenant ID
  ledger_id: string; // Ledger ID
  created_at?: string;
  updated_at?: string;
}
```

### Supported Currencies

| Code | Name              | Symbol | Flag |
| ---- | ----------------- | ------ | ---- |
| NGN  | Nigerian Naira    | ₦      | 🇳🇬   |
| USD  | US Dollar         | $      | 🇺🇸   |
| EUR  | Euro              | €      | 🇪🇺   |
| GBP  | British Pound     | £      | 🇬🇧   |
| GHS  | Ghanaian Cedi     | ₵      | 🇬🇭   |
| JPY  | Japanese Yen      | ¥      | 🇯🇵   |
| AUD  | Australian Dollar | A$     | 🇦🇺   |

### Account Types

| Type    | Description              | Use Case              |
| ------- | ------------------------ | --------------------- |
| PRIMARY | Main transaction account | Daily transactions    |
| SAVINGS | Savings account          | Savings and interest  |
| CURRENT | Current/Business account | Business transactions |
| MINT    | System mint account      | Internal use only     |

## Features

### Multi-Currency Support

- Users can create accounts in any supported currency
- Each currency account maintains its own balance
- Balances aggregated using live exchange rates
- Currency conversion display in NGN equivalent

### Account Management

- Create multiple accounts per currency
- Different account types (Primary, Savings, Current)
- Account naming for easy identification
- Account number display
- Status management (active/inactive)

### Security

- PIN setup and verification for accounts
- Secure authentication via Keycloak
- Tenant isolation
- Authorization checks

## User Flow

### Creating an Account

1. User navigates to Wallet page
2. Clicks "Create Account" or "Add Another Currency Account"
3. Modal appears with form:
   - Enter account name
   - Select currency (with flags)
   - Select account type
4. Submit form
5. Account created via core banking API
6. Wallet refreshes to show new account

### Viewing Accounts

1. User navigates to Wallet page
2. All active accounts displayed in grid
3. Each card shows:
   - Currency flag and code
   - Account type badge
   - Current balance
   - Account number
4. Total balance displayed at top (NGN equivalent)

## Configuration

### Environment Variables

```env
VITE_CORE_BANKING_URL=https://54remit.upi.dev
VITE_TENANT_ID=remittance
```

These are configured in `.env` and `.env.example` files.

## Migration Notes

### From Old Wallet Service

Previous implementation used a separate wallet service with different data structure. New implementation:

1. **Replaces** wallet service with account service
2. **Uses** real accounts from core banking
3. **Maintains** backward compatibility for transaction history
4. **Improves** data consistency with single source of truth

### Breaking Changes

- `WalletBalance` structure changed to `Account` structure
- Wallet endpoints no longer used for multi-currency
- Account creation now goes through core banking

### Migration Path

1. Existing users will see empty state initially
2. Prompt to create accounts in desired currencies
3. Future: Migrate existing wallet balances to accounts (if applicable)

## Testing

### Manual Testing Checklist

- [ ] Create account in each supported currency
- [ ] Create multiple accounts of same currency
- [ ] View accounts in Wallet page
- [ ] View total balance in Dashboard
- [ ] Verify account numbers are displayed
- [ ] Test error handling (network errors, validation)
- [ ] Test empty state (no accounts)
- [ ] Test loading states

### API Testing

Test account creation:

```bash
curl -X POST https://54remit.upi.dev/account/account \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: remittance" \
  -H "x-keycloak-id: user-id" \
  -H "x-ledger-id: ledger-id" \
  -H "Authorization: Bearer token" \
  -d '{
    "name": "My USD Account",
    "account_type": "primary",
    "account_currency": "USD"
  }'
```

## Future Enhancements

### Planned Features

- [ ] Account-to-account transfers
- [ ] Transaction history per account
- [ ] Interest calculations for savings accounts
- [ ] Account statements
- [ ] Freeze/unfreeze accounts
- [ ] Account limits and restrictions
- [ ] Sub-accounts
- [ ] Joint accounts

### Performance Optimizations

- [ ] Cache account data
- [ ] Pagination for large account lists
- [ ] Batch account operations
- [ ] Real-time balance updates via WebSocket

## Troubleshooting

### Common Issues

**Issue: Accounts not loading**

- Check network connectivity
- Verify authentication token is valid
- Check tenant and ledger IDs are correct
- Inspect browser console for errors

**Issue: Cannot create account**

- Verify all required fields are filled
- Check API endpoint is accessible
- Verify user has proper permissions
- Check core banking service health

**Issue: Balance showing 0**

- Balance is stored as string, parse as float
- Check if account has transactions
- Verify ledger service is running

## Support

For issues or questions:

- Check core banking account service logs
- Review API responses in browser dev tools
- Verify environment configuration
- Contact backend team for account service issues

## References

- Core Banking Account Service: `/54link_core_banking/services/account-service`
- Account Service API: `/54link_core_banking/services/account-service/api/v1/account.py`
- Account Models: `/54link_core_banking/services/account-service/models/account.py`
- Account Schemas: `/54link_core_banking/services/account-service/schemas/v1/account.py`
