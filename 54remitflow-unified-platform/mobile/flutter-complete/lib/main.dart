/// RemitFlow Flutter App — Main Entry Point
/// Registers all 35 screens with named routes.
import 'package:flutter/material.dart';

// ─── Auth screens ─────────────────────────────────────────────────────────────
import 'screens/login_screen.dart';
import 'screens/register_screen.dart';
import 'screens/onboarding_screen.dart';

// ─── Core screens ─────────────────────────────────────────────────────────────
import 'screens/dashboard_screen.dart';
import 'screens/wallet_screen.dart';
import 'screens/send_money_screen.dart';
// sendmoney_screen.dart is an alias for send_money_screen.dart
import 'screens/receivemoney_screen.dart';
import 'screens/transactions_screen.dart';
import 'screens/transactionhistory_screen.dart';
import 'screens/kyc_screen.dart';
import 'screens/exchangerates_screen.dart';
import 'screens/beneficiaries_screen.dart';
import 'screens/cards_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/support_screen.dart';

// ─── v120+ financial screens ──────────────────────────────────────────────────
import 'screens/savings_goals_screen.dart';
import 'screens/bnpl_screen.dart';
import 'screens/stablecoin_screen.dart';
import 'screens/cbdc_screen.dart';
import 'screens/referral_screen.dart';
import 'screens/split_bill_screen.dart';
import 'screens/batch_payments_screen.dart';
import 'screens/direct_debit_screen.dart';
import 'screens/recurring_payments_screen.dart';
import 'screens/qr_pay_screen.dart';
import 'screens/airtime_screen.dart';
import 'screens/bill_payment_screen.dart';
import 'screens/fx_alerts_screen.dart';

// ─── Admin screens ────────────────────────────────────────────────────────────
import 'screens/fraud_monitor_screen.dart';
import 'screens/security_dashboard_screen.dart';
import 'screens/services_health_dashboard_screen.dart';
import 'screens/pbac_policies_screen.dart';

void main() {
  runApp(const RemitFlowApp());
}

class RemitFlowApp extends StatelessWidget {
  const RemitFlowApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RemitFlow',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        primaryColor: const Color(0xFF6366f1),
        scaffoldBackgroundColor: const Color(0xFF0f0f1a),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF6366f1),
          secondary: Color(0xFF22c55e),
          background: Color(0xFF0f0f1a),
          surface: Color(0xFF1e1e2e),
        ),
        fontFamily: 'Inter',
      ),
      initialRoute: '/onboarding',
      routes: {
        // Auth
        '/onboarding': (ctx) => const OnboardingScreen(),
        '/login': (ctx) => const LoginScreen(),
        '/register': (ctx) => const RegisterScreen(),

        // Core
        '/dashboard': (ctx) => const DashboardScreen(),
        '/wallet': (ctx) => const WalletScreen(),
        '/send-money': (ctx) => const SendMoneyScreen(),
        '/receive-money': (ctx) => const ReceiveMoneyScreen(),
        '/transactions': (ctx) => const TransactionsScreen(),
        '/transaction-history': (ctx) => const TransactionHistoryScreen(),
        '/kyc': (ctx) => const KYCScreen(),
        '/exchange-rates': (ctx) => const ExchangeRatesScreen(),
        '/beneficiaries': (ctx) => const BeneficiariesScreen(),
        '/cards': (ctx) => const CardsScreen(),
        '/notifications': (ctx) => const NotificationsScreen(),
        '/profile': (ctx) => const ProfileScreen(),
        '/settings': (ctx) => const SettingsScreen(),
        '/support': (ctx) => const SupportScreen(),

        // Financial features
        '/savings-goals': (ctx) => const SavingsGoalsScreen(),
        '/bnpl': (ctx) => const BNPLScreen(),
        '/stablecoin': (ctx) => const StablecoinScreen(),
        '/cbdc': (ctx) => const CBDCScreen(),
        '/referral': (ctx) => const ReferralScreen(),
        '/split-bill': (ctx) => const SplitBillScreen(),
        '/batch-payments': (ctx) => const BatchPaymentsScreen(),
        '/direct-debit': (ctx) => const DirectDebitScreen(),
        '/recurring-payments': (ctx) => const RecurringPaymentsScreen(),
        '/qr-pay': (ctx) => const QRPayScreen(),
        '/airtime': (ctx) => const AirtimeScreen(),
        '/bill-payment': (ctx) => const BillPaymentScreen(),
        '/fx-alerts': (ctx) => const FXAlertsScreen(),

        // Admin
        '/fraud-monitor': (ctx) => const FraudMonitorScreen(),
        '/security-dashboard': (ctx) => const SecurityDashboardScreen(),
        '/services-health': (ctx) => const ServicesHealthDashboardScreen(),
        '/pbac-policies': (ctx) => const PBACPoliciesScreen(),
      },
    );
  }
}
