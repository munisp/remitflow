# Multi-Currency Account Integration - Quick Start Guide

## Overview

The remittance UI has been successfully updated to integrate with the **54link Core Banking Account Service**, providing full multi-currency account management capabilities. Users can now create and manage accounts in multiple currencies directly from the remittance application.

## What Changed

### New Files Created

1. **`src/services/accountService.ts`**
   - Complete account service integration with core banking
   - Multi-currency support (NGN, USD, EUR, GBP, GHS, JPY, AUD)
   - Account creation, retrieval, and PIN management
   - Balance aggregation and currency helpers

2. **`src/components/CreateAccountModal.tsx`**
   - Beautiful modal component for creating new accounts
   - Currency selection with flag icons
   - Account type selection (Primary, Savings, Current)
   - Form validation and error handling

3. **`ACCOUNT_INTEGRATION.md`**
   - Comprehensive documentation
   - API reference
   - Architecture details
   - Migration notes

### Modified Files

1. **`src/services/api.ts`**
   - Added export for `accountService` and related types
   - Seamless integration with existing API infrastructure

2. **`src/pages/Wallet.tsx`**
   - Complete rewrite to use core banking accounts
   - Displays real accounts with account numbers
   - Create new account functionality
   - Multi-currency balance aggregation
   - Empty state for new users

3. **`src/pages/Dashboard.tsx`**
   - Updated to fetch accounts from core banking
   - Shows total balance across all currencies
   - Displays account count
   - Improved loading states

## Key Features

### 🌍 Multi-Currency Support

- Support for 7 major currencies: NGN, USD, EUR, GBP, GHS, JPY, AUD
- Each currency shows flag and local name
- Real-time balance in native currency
- Aggregated balance in NGN equivalent

### 💳 Multiple Account Types

- **Primary**: Main transaction account for daily use
- **Savings**: Savings account for earning interest
- **Current**: Business/current account for commercial use

### 🔢 Account Management

- Unique 10-digit account numbers
- Account naming for easy identification
- Multiple accounts per currency
- Account status tracking (active/inactive)

### 🔐 Security Features

- PIN setup and verification
- Secure authentication via Keycloak
- Tenant isolation
- Authorization checks on all operations

## How to Use

### For Users

#### Creating Your First Account

1. Navigate to **Wallet** page
2. You'll see an empty state with "Create Account" button
3. Click **Create Account**
4. In the modal:
   - Enter account name (e.g., "My USD Savings")
   - Select currency (click on currency card)
   - Select account type
5. Click **Create Account**
6. Your new account appears immediately with account number!

#### Creating Additional Accounts

1. On the Wallet page, click **"+ Add Another Currency Account"**
2. Follow same steps as above
3. You can create multiple accounts in the same currency

#### Viewing Your Accounts

- **Wallet Page**: See all your accounts with balances and account numbers
- **Dashboard**: See total balance across all accounts (in NGN)

### For Developers

#### Using the Account Service

```typescript
import { accountService, AccountCurrency, AccountType } from "../services/api";

// Create an account
const newAccount = await accountService.createAccount({
  name: "My Euro Account",
  account_type: AccountType.SAVINGS,
  account_currency: AccountCurrency.EUR,
});

// Get all accounts
const accounts = await accountService.getAccounts();

// Get accounts by currency
const accountsByCurrency = await accountService.getAccountsByCurrency();

// Get primary account for a currency
const usdAccount = await accountService.getPrimaryAccount(AccountCurrency.USD);

// Setup PIN
await accountService.setupPin(accountId, { pin: "1234" });

// Verify PIN
const isValid = await accountService.verifyPin(accountId, { pin: "1234" });
```

#### Supported Currencies

```typescript
const currencies = accountService.getSupportedCurrencies();
// Returns array with: code, name, symbol, flag for each currency
```

#### Get Currency Info

```typescript
const info = accountService.getCurrencyInfo("USD");
// Returns: { name: "US Dollar", symbol: "$", flag: "🇺🇸" }
```

## API Integration

### Authentication Requirements

All API requests require:

- Valid authentication token (automatically added)
- Tenant ID header (`x-tenant-id`)
- Keycloak ID header (`x-keycloak-id`)
- Ledger ID header (`x-ledger-id`)

These are automatically managed by the authentication service.

### Endpoints

| Endpoint                                   | Method | Purpose          |
| ------------------------------------------ | ------ | ---------------- |
| `/account/account`                         | POST   | Create account   |
| `/account/account/all`                     | GET    | Get all accounts |
| `/account/account/{id}`                    | GET    | Get by ID        |
| `/account/account/account-number/{number}` | GET    | Get by number    |

## Configuration

### Environment Variables

Ensure these are set in your `.env` file:

```env
VITE_CORE_BANKING_URL=https://54link.upi.dev
VITE_TENANT_ID=remittance
```

## Testing

### Test Account Creation

1. Login to the application
2. Navigate to Wallet
3. Create accounts in different currencies
4. Verify:
   - Account appears in list
   - Account number is displayed
   - Balance shows correctly
   - Currency flag and name are correct

### Test Multiple Accounts

1. Create 2-3 accounts in different currencies
2. Verify total balance calculation on Dashboard
3. Check account count is correct

## Troubleshooting

### "No accounts" showing even after creating one?

- Check browser console for errors
- Verify core banking service is running
- Check authentication token is valid
- Refresh the page

### Account creation fails?

- Check all form fields are filled
- Verify network connection
- Check core banking API is accessible
- Review error message in modal

### Balance shows as 0?

- New accounts start with 0 balance
- Balances update after transactions
- Check if ledger service is running

## Next Steps

### Immediate Next Steps

1. Test the integration thoroughly
2. Create accounts in different currencies
3. Verify balances and account numbers
4. Test error scenarios

### Future Enhancements

- Account-to-account transfers
- Transaction history per account
- Account statements
- Freeze/unfreeze accounts
- Interest calculations for savings

## Support & Resources

- **Full Documentation**: See `ACCOUNT_INTEGRATION.md`
- **Account Service Code**: `src/services/accountService.ts`
- **Core Banking Service**: `54link_core_banking/services/account-service/`
- **API Reference**: Check `ACCOUNT_INTEGRATION.md`

## Visual Preview

### Wallet Page Features

- ✅ Multi-currency account cards with flags
- ✅ Account numbers displayed
- ✅ Account type badges
- ✅ Total balance in NGN
- ✅ Create account button
- ✅ Empty state for new users

### Dashboard Updates

- ✅ Total balance from all accounts
- ✅ Account count display
- ✅ Quick actions preserved
- ✅ Exchange rates section
- ✅ Recent transactions

## Migration from Old System

If you had previous wallet data:

1. Old wallet service data is not automatically migrated
2. Users will need to create new accounts
3. Previous transaction history is preserved
4. Future: Can implement migration script if needed

## Success! 🎉

Your remittance UI now has full multi-currency account support integrated with the core banking system. Users can create and manage accounts in 7 different currencies with proper account numbers, types, and security features.
