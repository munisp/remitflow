# Debugging Account Service 500 Errors

## Error Details

```
ERROR:api.v1.account:Unexpected error during get_account: Account not found.
INFO: 192.168.15.35:50796 - "GET /account/11 HTTP/1.1" 500 Internal Server Error
INFO: 192.168.15.35:50830 - "GET /account/4 HTTP/1.1" 500 Internal Server Error
```

## Root Cause

- Account IDs `11` and `4` don't exist in TigerBeetle ledger
- Frontend has stale account IDs stored in localStorage
- Requests failing because accounts were deleted or never existed

## Solution Steps

### 1. Clear Stale Data

```javascript
// In browser console or add to app initialization:
localStorage.removeItem("account_id");
localStorage.removeItem("account");
localStorage.removeItem("user");
```

### 2. Verify Keycloak ID is Set

```javascript
// Check if keycloak_id exists:
console.log("keycloak_id:", localStorage.getItem("keycloak_id"));
// Should be set after login
```

### 3. Use Keycloak ID Method

The accountService now prioritizes `getAccountByKeycloakId()`:

```typescript
// ✅ CORRECT - Dashboard.tsx and Wallet.tsx now do this:
const primaryAccount = await accountService.getAccountByKeycloakId();
const allAccounts = await accountService.getAccounts();

// ❌ WRONG - Don't use stale IDs:
const account = await accountService.getAccountById(11); // Fails if ID doesn't exist
```

### 4. Backend Check

Verify accounts exist in TigerBeetle:

```bash
# SSH into account-service pod
kubectl exec -it deployment/account-service -n default -- /bin/bash

# Check TigerBeetle connection
python3 -c "
from adapters.tigerbeetle import get_tigerbeetle_client
client = get_tigerbeetle_client()
# Query accounts
"
```

### 5. Database vs TigerBeetle Sync

The account might exist in PostgreSQL but not in TigerBeetle:

```sql
-- Check PostgreSQL
SELECT id, account_number, keycloak_id, status
FROM accounts
WHERE id IN (11, 4);

-- If found, they need to be synced to TigerBeetle
```

## Prevention

### Always Use Keycloak ID First

Update any service that directly calls `/account/{id}`:

```typescript
// Before fetching by ID, ensure account exists:
const account = await accountService.getAccountByKeycloakId();
if (account) {
  // Now use account.id safely
  const details = await accountService.getAccountById(account.id);
}
```

### API Middleware Improvement

Add middleware to validate account_id before TigerBeetle queries:

```python
# In account service API
async def validate_account_exists(account_id: int):
    # Check PostgreSQL first
    account = await db.get_account(account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    return account
```

## Current Status

- ✅ accountService.ts uses keycloak ID method
- ✅ Dashboard.tsx fetches by keycloak ID first
- ✅ Wallet.tsx fetches by keycloak ID first
- ⚠️ Some services may still have hardcoded account IDs

## Testing

Clear localStorage and log in again to test full flow:

```bash
# In browser console:
localStorage.clear();
# Then refresh and login
```
