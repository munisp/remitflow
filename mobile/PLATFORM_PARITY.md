# RemitFlow — Cross-Platform Feature Parity Matrix
> Last updated: April 2026 (v140 sprint)

## Platform Overview

| Platform | Tech Stack | Target | Screens/Pages |
|---|---|---|---|
| **PWA** | React 19 + tRPC + Tailwind 4 | Desktop & Mobile Web | 254 pages |
| **React Native** | RN 0.73 + TypeScript | iOS & Android | 260 screens |
| **Flutter** | Flutter 3.x + Riverpod + go_router | iOS & Android | 259 screens |

## Core User Journey — Feature Parity

| Feature | PWA | React Native | Flutter |
|---|---|---|---|
| Login / OAuth | ✅ Manus OAuth | ✅ Session token | ✅ Session token |
| Biometric Login | ✅ WebAuthn (FIDO2) | ✅ Face ID / Touch ID | ✅ Face ID / Fingerprint |
| Dashboard | ✅ Full analytics | ✅ Summary cards | ✅ Summary cards |
| Send Money | ✅ Full flow + FX preview | ✅ Full flow + FX preview | ✅ Full flow + FX preview |
| Transaction History | ✅ Full CRUD + export | ✅ List + filter | ✅ List + filter |
| Wallet / Balances | ✅ Multi-currency + top-up | ✅ Balance + top-up | ✅ Balance + top-up |
| Beneficiaries | ✅ Full CRUD | ✅ List + add | ✅ List + add |
| KYC Verification | ✅ 4-step wizard + doc upload | ✅ 4-step wizard | ✅ 4-step wizard |
| FX Alerts | ✅ Create / manage alerts | ✅ View + create | ✅ View + create |
| Push Notifications | ✅ Web Push (VAPID) | ✅ FCM (firebase_messaging) | ✅ FCM (firebase_messaging) |
| Deep Links | ✅ URL routing | ✅ Universal Links / App Links | ✅ App Links (app_links) |
| Profile / Settings | ✅ Full settings | ✅ Profile edit | ✅ Profile edit |
| Revenue Share | ✅ Full dashboard | ✅ Summary view | ✅ Summary view |
| Payment Rails | ✅ Full management | ✅ View rails | ✅ View rails |
| **Request Money** | ✅ QR + shareable link | ✅ Full flow | ✅ Full flow |
| **Transaction Receipt** | ✅ Print / PDF | ✅ Share receipt | ✅ Share receipt |
| **Onboarding Wizard** | ✅ Web onboarding | ✅ PIN + biometrics + push | ✅ PIN + biometrics + push |
| **AfriMarket** | ✅ Full marketplace | ✅ v140 | ✅ v140 |
| **Agent Network** | ✅ Full management | ✅ v140 | ✅ v140 |
| **CBDC Admin** | ✅ Full admin | ✅ v140 | ✅ v140 |
| **Corridor Pricing Admin** | ✅ Full admin | ✅ v140 | ✅ v140 |
| **Document Vault** | ✅ Full vault | ✅ v140 | ✅ v140 |
| **FX Hedging** | ✅ Full hedging | ✅ v140 | ✅ v140 |
| **Notification Center** | ✅ Full center | ✅ v140 | ✅ v140 |
| **PBAC Policies** | ✅ Full PBAC | ✅ v140 | ✅ v140 |
| **Revenue Analytics** | ✅ Full analytics | ✅ v140 | ✅ v140 |
| **Services Health** | ✅ Full dashboard | ✅ v140 | ✅ v140 |
| **System Config** | ✅ Full config | ✅ v140 | ✅ v140 |
| **M-Pesa** | ✅ Full integration | ✅ v140 | ✅ v140 |
| **KGQA** | ✅ Full QA | ✅ v140 | ✅ v140 |
| **Fee Rules V2** | ✅ Full CRUD | ✅ v140 | ✅ v140 |

## Admin / Advanced Features (PWA Only)

These features are intentionally PWA-only as they require desktop-class UI:
- Admin Dashboard (user management, KYC review, compliance)
- Real-Time Transaction Monitor
- Security Attack Simulator
- API Changelog
- A/B Testing Dashboard
- Revenue Analytics
- Compliance Case Management
- System Configuration
- Microservices Health Monitor
- Webhook Management
- All 40+ country-specific Send To pages

## Mobile-Specific Features

| Feature | React Native | Flutter |
|---|---|---|
| Biometric Service | `biometricService.ts` (react-native-biometrics) | `biometric_service.dart` (local_auth) |
| Push Notifications | `pushNotificationService.ts` (@react-native-firebase/messaging) | `push_notification_service.dart` (firebase_messaging) |
| Deep Links | `deepLinkService.ts` (Linking API) | `deep_link_service.dart` (app_links) |
| Navigation | React Navigation 6 | go_router |
| State Management | React Context + hooks | Riverpod |
| API Client | tRPC HTTP client | Dio HTTP client |

## API Endpoint Coverage

All mobile screens connect to the same tRPC backend:

| Screen | tRPC Procedures Used |
|---|---|
| Request Money | `requestMoney.list`, `requestMoney.create`, `requestMoney.cancel`, `requestMoney.getByToken` |
| Transaction Receipt | `transactions.getById` |
| Login | `auth.me` |
| Dashboard | `dashboard.summary`, `transactions.list`, `fx.rates` |
| Send Money | `transfer.quote`, `transfer.send`, `beneficiaries.list` |
| Transaction History | `transactions.list`, `transactions.export` |
| Wallet | `wallet.balances`, `wallet.history`, `wallet.topup`, `wallet.withdraw` |
| Beneficiaries | `beneficiaries.list`, `beneficiaries.add`, `beneficiaries.remove`, `beneficiaries.update` |
| KYC | `kyc.getStatus`, `kyc.submitDocument`, `kyc.getDocuments` |
| FX Alerts | `fxAlerts.list`, `fxAlerts.create`, `fxAlerts.delete` |
| Profile | `profile.get`, `profile.update` |
| Notifications | `pushNotifications.list`, `pushNotifications.markRead` |
| AfriMarket | `afriMarket.getListings`, `afriMarket.create`, `afriMarket.delete` |
| Agent Network | `agentNetwork.list`, `agentNetwork.getById` |
| CBDC Admin | `cbdc.getStatus`, `cbdc.mint`, `cbdc.burn` |
| Corridor Pricing | `corridorPricing.list`, `corridorPricing.update` |
| Document Vault | `documentVault.list`, `documentVault.upload`, `documentVault.delete` |
| FX Hedging | `fxHedging.getPositions`, `fxHedging.create`, `fxHedging.close` |
| Notification Center | `notificationCenter.list`, `notificationCenter.markAllRead` |
| PBAC Policies | `pbac.getPolicies`, `pbac.updatePolicy` |
| Revenue Analytics | `revenueShare.getAnalytics` |
| Services Health | `servicesHealth.getAll` |
| System Config | `systemConfig.getAll`, `systemConfig.update` |
| M-Pesa | `mpesa.getStatus`, `mpesa.send` |
| KGQA | `kgqa.query` |
| Fee Rules V2 | `feeEngine.getRules`, `feeEngine.updateRule` |

## v140 Changes

- Added 12 missing React Native screens for full PWA parity
- Added 9 missing Flutter screens for full PWA parity
- Fixed transfer-state-machine.ts: correct column names, metadata-based pipeline state
- Wired scoreFraud/buildFeatures (local ML) and runTransferPipeline into transfer.send
- Transfer now created with status "pending" and advanced through state machine
- All 1,579 tests passing
