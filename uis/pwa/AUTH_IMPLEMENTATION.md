# Authentication and Tenant Management - Remittance Banking UI

This document explains the authentication and tenant management implementation for the 54remit remittance banking PWA.

## Overview

The remittance banking UI now uses the core banking auth service with Keycloak integration, following the same pattern as the agent banking and core banking UIs.

## Architecture

### Services

1. **Tenant Service** (`/services/tenant/tenantService.ts`)
   - Manages tenant configuration from the core banking tenant management API
   - Caches tenant config in localStorage
   - Provides methods to get feature flags, branding, and contact info
   - Auto-loads from VITE_TENANT_ID environment variable or defaults to 'remittance'

2. **Auth Service** (`/services/authService.ts`)
   - Handles authentication with Keycloak via core banking auth service
   - Manages login, token refresh, and logout
   - Stores tokens, keycloak_id, and user data
   - Automatically refreshes expired tokens

3. **API Client** (`/services/api.ts`)
   - Updated to inject tenant headers (x-tenant-id, x-keycloak-realm, etc.)
   - Includes Authorization bearer token
   - Supports retry logic and offline queueing

### State Management

**Auth Store** (`/stores/authStore.ts`)

- Zustand store for authentication state
- Methods:
  - `login(email, password)` - Login user
  - `logout()` - Logout and clear all auth data
  - `refreshAuth()` - Refresh token if expired
  - `fetchUserDetails()` - Fetch user profile from user service
- Persists user, token, and authentication status

### App Initialization

**App.tsx**

- Loads tenant configuration on startup
- Shows loading screen while tenant config loads
- Shows error screen if tenant loading fails
- Initializes auth token if user is logged in
- Checks for token expiry and refreshes if needed

## Configuration

### Environment Variables

Create a `.env` file in the root of the PWA:

```env
VITE_CORE_BANKING_URL=https://54remit.upi.dev
VITE_TENANT_ID=remittance
VITE_DEMO_MODE=false
```

### Tenant Configuration

The tenant service fetches configuration from:

```
GET /tenant-management/tenant/{tenant_id}
```

This includes:

- Tenant metadata (name, status, etc.)
- Feature flags (ledger, mint, auth config)
- Branding (logo, colors, domain)
- Contact information

## Authentication Flow

1. **User enters credentials** on Login page
2. **Tenant config is loaded** (if not already cached)
3. **Login request** is sent to `/auth/auth/login` with tenant headers
4. **Response includes**:
   - `access_token` (JWT)
   - `refresh_token`
   - `keycloak_id` (user's Keycloak ID)
   - Optional `user` object
5. **Tokens are stored** in localStorage
6. **API client is updated** with the access token
7. **User is redirected** to dashboard

## API Request Headers

All API requests include:

- `Content-Type: application/json`
- `Authorization: Bearer {access_token}`
- `x-tenant-id: {tenant_id}`
- `x-ledger-id: {ledger_id}` (from tenant feature flags)
- `x-mint-id: {mint_id}` (from tenant feature flags)
- `x-mint-account-id: {mint_account_id}` (from tenant feature flags)
- `x-keycloak-realm: {keycloak_realm}` (from tenant auth config)
- `x-keycloak-pub-key: {public_rsa_key}` (from tenant auth config)
- `x-keycloak-id: {keycloak_id}` (from login response or localStorage)

## Token Management

### Token Storage

- `auth_token` - Access token (JWT)
- `refresh_token` - Refresh token
- `token_expiry` - Expiry timestamp
- `keycloak_id` - User's Keycloak ID

### Token Refresh

- Automatic refresh when token expires (within 5 minutes of expiry)
- Uses refresh token to get new access token
- If refresh fails, user is logged out

### Token Validation

- Tokens are validated on app startup
- Expired tokens trigger refresh
- Invalid tokens trigger logout

## User Management

### User Object

```typescript
interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  keycloak_id?: string;
  keycloakId?: string;
  kycStatus?: "pending" | "verified" | "rejected";
  status?: string;
  createdAt?: string;
  tenant_id?: string;
}
```

### User Profile

- Stored in localStorage as `auth_user`
- Can be fetched from user service using keycloak_id
- Updated after login or on demand

## Protected Routes

The `ProtectedRoute` component checks `isAuthenticated` and redirects to login if false.

## Logout

Logout clears:

- Access token
- Refresh token
- Token expiry
- User data
- Keycloak ID

Logout does NOT clear:

- Tenant configuration (can be reused)

## Error Handling

### Tenant Loading Errors

- Shows error screen with retry button
- Common issues:
  - Invalid tenant ID
  - Network error
  - API unavailable

### Authentication Errors

- Shows error message on login page
- Common issues:
  - Invalid credentials
  - Account not found
  - Tenant config not loaded

### Token Refresh Errors

- Automatically logs out user
- Redirects to login page

## Differences from Other UIs

### Agent Banking UIs

- Use `54remit` tenant ID
- Include agent-specific fields (agent_id, uin, business_name)
- Use agent-service endpoints

### Core Banking UIs

- Use bank-specific tenant IDs (kembi, bpmgd, etc.)
- Include role-based access control
- Use admin-service endpoints

### Remittance Banking UI

- Uses `remittance` tenant ID
- Focuses on cross-border transfers
- Simplified user profile

## Security Considerations

1. **Tokens never exposed in URLs** - Only in Authorization header
2. **HTTPS required in production** - Core banking URL uses HTTPS
3. **Tokens automatically expire** - Refresh required after expiry
4. **Keycloak integration** - Centralized authentication
5. **Tenant isolation** - Each tenant has separate configuration
6. **CORS properly configured** - Core banking allows remittance UI origin

## Troubleshooting

### "Tenant ID is required"

- Set VITE_TENANT_ID in .env
- Or manually call `tenantService.setTenantId('remittance')`

### "Invalid credentials"

- Check email and password
- Ensure user exists in Keycloak for this tenant
- Check tenant config is loaded

### "Token refresh failed"

- Refresh token may be expired
- User needs to login again

### "Failed to load tenant configuration"

- Check VITE_CORE_BANKING_URL is correct
- Check tenant-management service is running
- Check tenant ID exists in database

## Testing

### Demo Mode

Set `VITE_DEMO_MODE=true` to enable demo mode (bypasses real authentication).

### Manual Testing

1. Login with valid credentials
2. Check localStorage for tokens and user data
3. Navigate to protected routes
4. Logout and verify tokens are cleared
5. Check token refresh by waiting for expiry

## Future Enhancements

1. **Registration flow** - Implement customer registration via orchestrator
2. **Password reset** - Implement forgot password flow
3. **2FA/OTP** - Add two-factor authentication
4. **Social login** - Add OAuth providers (Google, Facebook)
5. **Biometric auth** - Add fingerprint/face ID for mobile
6. **Session management** - Track active sessions, force logout
7. **Audit logging** - Log all auth events
