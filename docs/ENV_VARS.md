# RemitFlow Environment Variables

## System-Injected (Automatic — Do Not Set Manually)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Session cookie signing secret |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL (frontend) |
| `OWNER_OPEN_ID` | Owner's Manus OpenID |
| `OWNER_NAME` | Owner's display name |
| `BUILT_IN_FORGE_API_URL` | Manus built-in APIs base URL |
| `BUILT_IN_FORGE_API_KEY` | Bearer token for server-side Manus APIs |
| `VITE_FRONTEND_FORGE_API_KEY` | Bearer token for frontend Manus APIs |
| `VITE_FRONTEND_FORGE_API_URL` | Frontend Manus API base URL |
| `STRIPE_SECRET_KEY` | Stripe secret key (server-side) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (frontend) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `VITE_ANALYTICS_ENDPOINT` | Umami analytics endpoint |
| `VITE_ANALYTICS_WEBSITE_ID` | Umami website ID |
| `VITE_APP_TITLE` | App display title |
| `VITE_APP_LOGO` | App logo URL |

## Optional — Set via Secrets Panel

| Variable | Default | Description |
|---|---|---|
| `FX_API_KEY` | (open.er-api.com free tier) | Currencybeacon or ExchangeRate-API key for production FX rates |
| `FX_API_URL` | `https://open.er-api.com/v6/latest` | FX rates API base URL |
| `TWILIO_ACCOUNT_SID` | — | Twilio SID for SMS notifications |
| `TWILIO_AUTH_TOKEN` | — | Twilio auth token |
| `TWILIO_PHONE` | — | Twilio sender phone number |
| `SENDGRID_API_KEY` | — | SendGrid API key for email notifications |
| `WISE_API_KEY` | — | Wise API key for real bank transfers |
| `MPESA_CONSUMER_KEY` | — | M-Pesa consumer key (Safaricom) |
| `MPESA_CONSUMER_SECRET` | — | M-Pesa consumer secret |
| `MOJALOOP_HUB_URL` | `https://sandbox.mojaloop.io` | Mojaloop hub URL |
| `REDIS_URL` | — | Redis URL for rate limiting and caching (e.g. `redis://localhost:6379`) |

### SMS & Mobile Money

| Variable | Default | Description |
|---|---|---|
| `SMS_PROVIDER` | `console` | SMS provider: `africas_talking`, `twilio`, or `console` (dev fallback) |
| `AFRICASTALKING_API_KEY` | — | Africa's Talking API key for SMS OTP and dispute notifications |
| `AFRICASTALKING_USERNAME` | — | Africa's Talking username (`sandbox` for test, your username for production) |
| `MPESA_SHORTCODE` | — | M-Pesa business shortcode |
| `MPESA_PASSKEY` | — | M-Pesa passkey |

### Middleware & Infrastructure

| Variable | Default | Description |
|---|---|---|
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated Kafka broker addresses |
| `KAFKA_CLIENT_ID` | `remitflow-server` | Kafka client ID |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address |
| `DAPR_HTTP_PORT` | `3500` | Dapr sidecar HTTP port |
| `PERMIFY_ENDPOINT` | `localhost:3478` | Permify PBAC service endpoint |
| `OPENSEARCH_URL` | `http://localhost:9200` | OpenSearch cluster URL |
| `TIGERBEETLE_ADDRESS` | `localhost:3000` | TigerBeetle double-entry ledger address |
| `FLUVIO_ENDPOINT` | `localhost:9003` | Fluvio streaming endpoint |
| `KEYCLOAK_URL` | `http://localhost:8080` | Keycloak auth server URL |
| `KEYCLOAK_REALM` | `remitflow` | Keycloak realm name |
| `KEYCLOAK_CLIENT_ID` | `remitflow-api` | Keycloak client ID |
| `KEYCLOAK_CLIENT_SECRET` | — | Keycloak client secret |
| `KEYCLOAK_PUBLIC_KEY` | — | Keycloak RS256 public key (for JWT verification) |

### Custody & Crypto

| Variable | Default | Description |
|---|---|---|
| `CUSTODY_PROVIDER` | `sandbox` | Custody provider: `fireblocks`, `bitgo`, or `sandbox` |
| `FIREBLOCKS_API_KEY` | — | Fireblocks API key |
| `FIREBLOCKS_API_SECRET` | — | Fireblocks API secret (RSA private key) |
| `BITGO_ACCESS_TOKEN` | — | BitGo access token |
| `BITGO_WALLET_ID` | — | BitGo wallet ID |

### Payments

| Variable | Default | Description |
|---|---|---|
| `PAYPAL_CLIENT_ID` | — | PayPal client ID for investment checkout |
| `PAYPAL_CLIENT_SECRET` | — | PayPal client secret |
| `FLUTTERWAVE_SECRET_KEY` | — | Flutterwave secret key for African payments |
| `FLUTTERWAVE_PUBLIC_KEY` | — | Flutterwave public key (frontend) |

### CBN Compliance (Nigeria)

| Variable | Default | Description |
|---|---|---|
| `CBN_API_KEY` | — | CBN portal API key for regulatory reporting |
| `CBN_PORTAL_URL` | `https://api.cbn.gov.ng` | CBN portal base URL |
| `BMATCH_SERVICE_URL` | `http://rust-bmatch-engine:8097` | BMATCH FX rate engine URL |
| `SETTLEMENT_REGISTRY_URL` | `http://go-settlement-registry:8098` | Settlement registry service URL |

### SWIFT & Correspondent Banking

| Variable | Default | Description |
|---|---|---|
| `SWIFT_BIC` | — | Your institution's SWIFT BIC code |
| `SWIFT_GATEWAY_URL` | — | SWIFT gateway endpoint URL |
| `SWIFT_GATEWAY_KEY` | — | SWIFT gateway API key |

## Defaults Used in Code

All constants with defaults are in `shared/const.ts`:

```ts
export const FX_API_URL = process.env.FX_API_URL ?? 'https://open.er-api.com/v6/latest';
export const DEFAULT_CURRENCY = 'NGN';
export const SUPPORTED_CURRENCIES = ['NGN','USD','GBP','EUR','KES','GHS','ZAR','CAD','AUD'];
export const SUPPORTED_CORRIDORS = ['NGN-GBP','NGN-USD','NGN-EUR','NGN-KES','GHS-GBP','KES-GBP'];
export const MAX_TRANSFER_LIMIT = 10_000_000; // NGN
export const KYC_TIER_LIMITS = { tier1: 50000, tier2: 500000, tier3: 10000000 };
```
