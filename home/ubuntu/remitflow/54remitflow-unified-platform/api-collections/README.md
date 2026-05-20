# API Collections - Nigerian Remittance Platform

Complete Postman and Insomnia collections for all 30 user journeys.

## Files

- `postman-collection.json` - Postman collection with all endpoints
- `insomnia-collection.json` - Insomnia collection with all endpoints
- `postman-environment-local.json` - Local development environment
- `postman-environment-staging.json` - Staging environment
- `postman-environment-production.json` - Production environment

## Quick Start

### Postman

1. Open Postman
2. Click "Import"
3. Select `postman-collection.json`
4. Import environment file (e.g., `postman-environment-local.json`)
5. Select the imported environment from the dropdown
6. Run "Authentication > Login" to get access token
7. Start testing endpoints!

### Insomnia

1. Open Insomnia
2. Click "Import/Export" > "Import Data"
3. Select `insomnia-collection.json`
4. Update environment variables (base_url, access_token)
5. Start testing endpoints!

## Authentication

All endpoints (except login) require Bearer token authentication.

1. First, call the Login endpoint:
   ```
   POST /api/v1/auth/login
   {
     "email": "user@example.com",
     "password": "password123"
   }
   ```

2. The response will include an `access_token`
3. This token is automatically saved to the `access_token` variable
4. All subsequent requests will use this token

## User Journeys

### 1. User Onboarding & Authentication (Journeys 1-5)
- Journey 1: User Registration
- Journey 2: Biometric Authentication Setup
- Journey 3: Two-Factor Authentication
- Journey 4: Password Reset
- Journey 5: Social Login

### 2. Domestic Transactions (Journeys 6-10)
- Journey 6: NIBSS Transfer
- Journey 7: Recurring Payment
- Journey 8: Bill Payment
- Journey 9: Airtime Top-up
- Journey 10: P2P QR Transfer

### 3. International Remittances (Journeys 11-15)
- Journey 11: SWIFT Transfer
- Journey 12: Wise Transfer
- Journey 13: Currency Conversion
- Journey 14: PAPSS Transfer
- Journey 15: Stablecoin Transfer

### 4. Wallet & Account Management (Journeys 16-20)
- Journey 16: Wallet Top-up
- Journey 17: Virtual Account
- Journey 18: Add Beneficiary
- Journey 19: Card Management
- Journey 20: Dispute Resolution

### 5. Financial Services (Journeys 21-25)
- Journey 21: Savings Account
- Journey 22: Investment
- Journey 23: Loan Application
- Journey 24: Insurance
- Journey 25: Rewards Redemption

### 6. Compliance & Security (Journeys 26-30)
- Journey 26: KYC Upgrade
- Journey 27: AML Monitoring
- Journey 28: Fraud Detection
- Journey 29: Security Incident
- Journey 30: Regulatory Reporting

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `base_url` | API base URL | `http://localhost:8000` |
| `access_token` | JWT access token | Auto-populated after login |

## Test Scripts

All requests include test scripts that:
- Verify response status codes
- Check response times
- Validate response structure
- Auto-save tokens and IDs for subsequent requests

## API Endpoints Summary

**Total Endpoints:** 90+

- **Authentication:** 7 endpoints
- **User Onboarding:** 14 endpoints
- **Domestic Transactions:** 15 endpoints
- **International Remittances:** 15 endpoints
- **Wallet & Account:** 16 endpoints
- **Financial Services:** 15 endpoints
- **Compliance & Security:** 15 endpoints

## Support

For API documentation, visit: https://api.remittance.com/docs

For issues or questions, contact: api-support@remittance.com
