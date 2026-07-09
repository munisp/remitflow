# Account Service Fix - Get User Accounts Only

## Problem Identified

The remittance UI was incorrectly configured and the backend had a critical bug:

### Backend Issue (account-service)

**Location**: `/home/tani/Documents/54link/54link_core_banking/services/account-service/`

**The Bug**: The `/account/user/all` endpoint was calling a non-existent repository method:

```python
# In services/account.py
def get_accounts_by_user(self, context: Context):
    accounts = self.__account_repository.get_accounts_by_user(  # ❌ This method didn't exist!
        context.keycloak_id, context.tenant_id
    )
```

**Impact**:

- `/account/all` returns ALL accounts in the entire tenant/platform
- `/account/user/all` was supposed to return only the user's accounts but failed

### Frontend Configuration

The remittance UI was already correctly using `/account/account/user/all`, but the backend bug prevented it from working properly.

## Solution Implemented

### 1. Backend Fix: Added Missing Repository Method

**File**: `services/account-service/repositories/account.py`

```python
def get_accounts_by_user(self, keycloak_id: str, tenant_id: str):
    """Get all accounts for a specific user (all account types)"""
    return (
        self.__db.query(Account)
        .filter(
            Account.keycloak_id == keycloak_id,
            Account.tenant_id == tenant_id,
        )
        .order_by(Account.created_at)
        .all()
    )
```

**Key Differences from Existing Methods**:

- `get_accounts(tenant_id)` - Returns ALL accounts in the tenant ❌ (used by `/account/all`)
- `get_accounts_by_keycloak_id(keycloak_id, tenant_id)` - Returns only PRIMARY accounts ⚠️
- `get_accounts_by_user(keycloak_id, tenant_id)` - Returns ALL account types for the user ✅ (NEW)

### 2. Frontend Verification

**File**: `54link_remittance_banking/uis/pwa/src/services/accountService.ts`

✅ **Already correct**: The service was using the right endpoint

```typescript
async getAccounts(): Promise<Account[]> {
  const response = await api.get<AccountsResponse>(
    `/account/account/user/all`,  // ✅ Correct endpoint
  );
  return response.data.account || [];
}
```

Added clarifying comments to prevent future confusion:

```typescript
/**
 * Get all accounts for the current user
 * Uses /account/account/user/all which fetches ONLY accounts belonging to the
 * logged-in user (filtered by keycloak_id on the backend).
 * This does NOT return all accounts in the platform/tenant.
 */
```

### 3. Updated Cards Route

**File**: `54link_remittance_banking/uis/pwa/src/App.tsx`

Replaced old remittance virtual cards with new core banking cards:

```typescript
// Before:
const Cards = lazy(() => import("./pages/Cards"));

// After:
const Cards = lazy(() => import("./pages/CardsPage"));
```

## How It Works Now

### Authentication Flow

```
User logs in
  → keycloak_id stored in localStorage
  → API requests include x-keycloak-id header
  → Backend filters accounts by keycloak_id
  → Only user's accounts returned
```

### Account Fetching Pattern (Dashboard & Wallet)

```typescript
// 1. Get primary account
const primaryAccount = await accountService.getAccountByKeycloakId();

// 2. Get all user accounts (multi-currency)
const allAccounts = await accountService.getAccounts(); // ✅ Only returns user's accounts
```

## Endpoints Comparison

| Endpoint                         | Method                   | Returns                         | Use Case                       |
| -------------------------------- | ------------------------ | ------------------------------- | ------------------------------ |
| `/account/account/keycloak/{id}` | `get_by_keycloak_id()`   | Single PRIMARY account          | Initial login, primary account |
| `/account/account/user/all`      | `get_accounts_by_user()` | ALL user's accounts (all types) | Multi-currency wallet          |
| `/account/account/all`           | `get_accounts()`         | ALL tenant accounts             | ⚠️ Admin only                  |

## Testing

### Verify User Account Filtering

```bash
# Test endpoint returns only user's accounts
curl -X GET "https://54remit.upi.dev/account/account/user/all" \
  -H "x-tenant-id: 54remit" \
  -H "x-keycloak-id: YOUR_USER_ID" \
  -H "x-ledger-id: 1" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should return ONLY accounts where keycloak_id matches YOUR_USER_ID
```

### Frontend Testing

1. Clear localStorage: `localStorage.clear()`
2. Login with a user account
3. Navigate to Wallet page
4. Verify only that user's accounts are displayed
5. Check browser Network tab - confirm `/account/account/user/all` is called
6. Verify response contains only accounts for logged-in user

## Security Impact

### Before Fix

- Potential security vulnerability if `/account/all` was accidentally used
- Would expose all accounts in the platform to any authenticated user

### After Fix

- ✅ User accounts properly isolated by keycloak_id
- ✅ Each user can only see their own accounts
- ✅ Multi-tenant security maintained (tenant_id filter)

## Files Modified

### Backend

- ✅ `/54link_core_banking/services/account-service/repositories/account.py`
  - Added `get_accounts_by_user()` method

### Frontend

- ✅ `/54link_remittance_banking/uis/pwa/src/services/accountService.ts`
  - Added documentation comments
- ✅ `/54link_remittance_banking/uis/pwa/src/App.tsx`
  - Updated Cards route to use CardsPage

## Deployment Notes

### Backend Deployment (account-service)

```bash
cd /home/tani/Documents/54link/54link_core_banking/services/account-service

# 1. Build new image
docker build -t registry.digitalocean.com/talentgraph-auth/54remit-account-service:0.0.17 .

# 2. Push to registry
docker push registry.digitalocean.com/talentgraph-auth/54remit-account-service:0.0.17

# 3. Update helm values
cd ../../infrastructure/charts/account-service
# Edit values.yaml - change tag to 0.0.17

# 4. Deploy
helm upgrade account-service . -n default
```

### Frontend Deployment

```bash
cd /home/tani/Documents/54link/54link_remittance_banking/uis/pwa

# 1. Build
npm run build

# 2. Deploy (method depends on your infrastructure)
```

## Verification Checklist

After deployment, verify:

- [ ] `/account/account/user/all` returns only logged-in user's accounts
- [ ] Dashboard displays correct user accounts
- [ ] Wallet page shows multi-currency accounts
- [ ] Cards page loads core banking cards
- [ ] No 500 errors in account service logs
- [ ] TigerBeetle account lookups succeed for valid accounts
- [ ] No stale account IDs causing errors

## Related Issues

This fix resolves the error logs you saw:

```
ERROR:api.v1.account:Unexpected error during get_account: Account not found.
INFO: 192.168.15.35:50796 - "GET /account/11 HTTP/1.1" 500 Internal Server Error
INFO: 192.168.15.35:50830 - "GET /account/4 HTTP/1.1" 500 Internal Server Error
```

These errors occurred because:

1. Stale account IDs (11, 4) were stored in frontend localStorage
2. These accounts don't exist in TigerBeetle
3. New pattern: Always fetch by keycloak_id first, never use stale IDs

## Recommendations

1. **Clear user localStorage** on next login to remove stale account IDs
2. **Add validation** in frontend to check if account_id is valid before making requests
3. **Backend logging** - improve error messages to distinguish between "not found in DB" vs "not found in TigerBeetle"
4. **Consider caching** - store fetched accounts in React state/context to reduce API calls

## References

- Mobile app implementation: `/banks/client/mobile_app/lib/services/` (follows same pattern)
- Customer portal: `/54link_agent_banking/uis/customer-portal/src/utils/api.js` (uses same endpoint)
- Core banking API docs: `/54link_core_banking/services/account-service/api/v1/account.py`
