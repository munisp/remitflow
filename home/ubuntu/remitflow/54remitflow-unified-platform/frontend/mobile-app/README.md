# Remittance Platform Mobile App

Production-ready React Native mobile application for the Remittance Platform.

## Features

- ✅ Complete authentication (Login, Register, Biometric, PIN)
- ✅ Transaction management
- ✅ Customer management
- ✅ Commission tracking
- ✅ Product catalog & orders
- ✅ Payment processing
- ✅ Settlement & reconciliation
- ✅ Analytics & reports
- ✅ KYC verification
- ✅ Communication (Email, SMS, WhatsApp)
- ✅ Offline support
- ✅ Push notifications
- ✅ QR code scanning

## Tech Stack

- React Native 0.72+
- TypeScript
- Redux Toolkit
- React Navigation
- Expo (optional)

## Installation

```bash
# Install dependencies
npm install

# iOS
cd ios && pod install && cd ..
npx react-native run-ios

# Android
npx react-native run-android
```

## Project Structure

```
src/
├── screens/        # All app screens
├── components/     # Reusable UI components
├── services/       # API and business logic
├── store/          # Redux state management
├── navigation/     # Navigation configuration
├── utils/          # Utility functions
├── hooks/          # Custom React hooks
├── constants/      # App constants
└── types/          # TypeScript types
```

## Configuration

Copy `.env.example` to `.env` and configure:

```
API_URL=https://api.remittance.com
```

## Testing

```bash
npm test
```

## Build

```bash
# iOS
npx react-native build-ios

# Android
cd android && ./gradlew assembleRelease
```

## License

Proprietary - Remittance Platform
