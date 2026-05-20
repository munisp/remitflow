import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'providers/auth_provider.dart';
import 'screens/login_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/send_money_screen.dart';
import 'screens/transaction_history_screen.dart';
import 'screens/wallet_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/kyc_screen.dart';
import 'screens/payment_rails_screen.dart';
import 'screens/revenue_share_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/beneficiary_screen.dart';
import 'screens/fx_alerts_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/request_money_screen.dart';
import 'screens/transaction_receipt_screen.dart';
// v120 new screens
import 'screens/cards_screen.dart';
import 'screens/savings_goals_screen.dart';
import 'screens/bnpl_screen.dart';
import 'screens/stablecoin_screen.dart';
import 'screens/disputes_screen.dart';
import 'screens/referral_screen.dart';
import 'screens/batch_payments_screen.dart';
import 'screens/rate_lock_screen.dart';
import 'screens/rate_calculator_screen.dart';
import 'screens/airtime_screen.dart';
import 'screens/bill_payment_screen.dart';
import 'screens/qr_pay_screen.dart';
import 'screens/direct_debit_screen.dart';
import 'screens/recurring_payments_screen.dart';
import 'screens/virtual_account_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/support_screen.dart';
import 'screens/split_bill_screen.dart';
import 'screens/cbdc_screen.dart';
import 'screens/checkout_sdk_screen.dart';
// v140 parity screens
import 'screens/cbdc_admin_screen.dart';
import 'screens/corridor_pricing_admin_screen.dart';
import 'screens/fee_rules_crudv2_page_screen.dart';
import 'screens/kgqa_page_screen.dart';
import 'screens/m_pesa_screen.dart';
import 'screens/pbac_policies_screen.dart';
import 'screens/revenue_share_pwa_screen.dart';
import 'screens/services_health_dashboard_screen.dart';
import 'screens/system_config_page_screen.dart';
// v138 security screens
import 'screens/fraud_monitor_screen.dart';
import 'screens/security_dashboard_screen.dart';
// v197 outbound revenue screens
import 'screens/send_from_nigeria_screen.dart';
import 'screens/education_payments_screen.dart';
import 'screens/medical_tourism_screen.dart';
import 'screens/formalization_dashboard_screen.dart';
import 'screens/outbound_revenue_model_screen.dart';
import 'screens/recipient_onboarding_screen.dart';
import 'widgets/main_shell.dart';

final _router = GoRouter(
  initialLocation: '/dashboard',
  redirect: (context, state) {
    // Auth redirect handled by auth provider
    return null;
  },
  routes: [
    GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
    GoRoute(path: '/onboarding', builder: (context, state) => const OnboardingScreen()),
    ShellRoute(
      builder: (context, state, child) => MainShell(child: child),
      routes: [
        GoRoute(path: '/dashboard', builder: (context, state) => const DashboardScreen()),
        GoRoute(path: '/send', builder: (context, state) => const SendMoneyScreen()),
        GoRoute(path: '/transactions', builder: (context, state) => const TransactionHistoryScreen()),
        GoRoute(path: '/wallet', builder: (context, state) => const WalletScreen()),
        GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen()),
      ],
    ),
    // Original detail screens
    GoRoute(path: '/kyc', builder: (context, state) => const KYCScreen()),
    GoRoute(path: '/payment-rails', builder: (context, state) => const PaymentRailsScreen()),
    GoRoute(path: '/revenue-share', builder: (context, state) => const RevenueShareScreen()),
    GoRoute(path: '/notifications', builder: (context, state) => const NotificationsScreen()),
    GoRoute(path: '/beneficiaries', builder: (context, state) => const BeneficiaryScreen()),
    GoRoute(path: '/fx-alerts', builder: (context, state) => const FXAlertsScreen()),
    GoRoute(path: '/request-money', builder: (context, state) => const RequestMoneyScreen()),
    GoRoute(
      path: '/transaction-receipt/:id',
      builder: (context, state) => TransactionReceiptScreen(transactionId: state.pathParameters['id'] ?? ''),
    ),
    // v120 new screens
    GoRoute(path: '/cards', builder: (context, state) => const CardsScreen()),
    GoRoute(path: '/savings-goals', builder: (context, state) => const SavingsGoalsScreen()),
    GoRoute(path: '/bnpl', builder: (context, state) => const BnplScreen()),
    GoRoute(path: '/stablecoin', builder: (context, state) => const StablecoinScreen()),
    GoRoute(path: '/disputes', builder: (context, state) => const DisputesScreen()),
    GoRoute(path: '/referral', builder: (context, state) => const ReferralScreen()),
    GoRoute(path: '/batch-payments', builder: (context, state) => const BatchPaymentsScreen()),
    GoRoute(path: '/rate-lock', builder: (context, state) => const RateLockScreen()),
    GoRoute(path: '/rate-calculator', builder: (context, state) => const RateCalculatorScreen()),
    GoRoute(path: '/airtime', builder: (context, state) => const AirtimeScreen()),
    GoRoute(path: '/bill-payment', builder: (context, state) => const BillPaymentScreen()),
    GoRoute(path: '/qr-pay', builder: (context, state) => const QrPayScreen()),
    GoRoute(path: '/direct-debit', builder: (context, state) => const DirectDebitScreen()),
    GoRoute(path: '/recurring-payments', builder: (context, state) => const RecurringPaymentsScreen()),
    GoRoute(path: '/virtual-account', builder: (context, state) => const VirtualAccountScreen()),
    GoRoute(path: '/settings', builder: (context, state) => const SettingsScreen()),
    GoRoute(path: '/support', builder: (context, state) => const SupportScreen()),
    GoRoute(path: '/split-bill', builder: (context, state) => const SplitBillScreen()),
    GoRoute(path: '/cbdc', builder: (context, state) => const CbdcScreen()),
    GoRoute(path: '/checkout-sdk', builder: (context, state) => const CheckoutSdkScreen()),
    // v140 parity screens
    GoRoute(path: '/cbdc-admin', builder: (context, state) => const CBDCAdminScreen()),
    GoRoute(path: '/corridor-pricing-admin', builder: (context, state) => const CorridorPricingAdminScreen()),
    GoRoute(path: '/fee-rules-v2', builder: (context, state) => const FeeRulesCRUDV2Screen()),
    GoRoute(path: '/kgqa', builder: (context, state) => const KGQAScreen()),
    GoRoute(path: '/mpesa', builder: (context, state) => const MPesaScreen()),
    GoRoute(path: '/pbac-policies', builder: (context, state) => const PBACPoliciesScreen()),
    GoRoute(path: '/revenue-share-pwa', builder: (context, state) => const RevenueSharePWAScreen()),
    GoRoute(path: '/services-health', builder: (context, state) => const ServicesHealthDashboardScreen()),
    GoRoute(path: '/system-config', builder: (context, state) => const SystemConfigPageScreen()),
    // v138 security screens
    GoRoute(path: '/fraud-monitor', builder: (context, state) => const FraudMonitorScreen()),
    GoRoute(path: '/security-dashboard', builder: (context, state) => const SecurityDashboardScreen()),
    // v197 outbound revenue screens
    GoRoute(path: '/send-abroad', builder: (context, state) => const SendFromNigeriaScreen()),
    GoRoute(path: '/education-payments', builder: (context, state) => const EducationPaymentsScreen()),
    GoRoute(path: '/medical-tourism', builder: (context, state) => const MedicalTourismScreen()),
    GoRoute(path: '/formalization-dashboard', builder: (context, state) => const FormalizationDashboardScreen()),
    GoRoute(path: '/outbound-revenue-model', builder: (context, state) => const OutboundRevenueModelScreen()),
    GoRoute(path: '/recipient-onboarding', builder: (context, state) => const RecipientOnboardingScreen()),
  ],
);

class RemitFlowApp extends ConsumerWidget {
  const RemitFlowApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'RemitFlow',
      debugShowCheckedModeBanner: false,
      theme: _buildTheme(),
      routerConfig: _router,
    );
  }

  ThemeData _buildTheme() {
    const primaryColor = Color(0xFF6366F1);
    const backgroundColor = Color(0xFF0F0F1A);
    const surfaceColor = Color(0xFF1A1A2E);
    const borderColor = Color(0xFF2D2D4E);

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        primary: primaryColor,
        secondary: Color(0xFF8B5CF6),
        background: backgroundColor,
        surface: surfaceColor,
        onPrimary: Colors.white,
        onBackground: Colors.white,
        onSurface: Color(0xFFE2E8F0),
      ),
      scaffoldBackgroundColor: backgroundColor,
      cardColor: surfaceColor,
      textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme).copyWith(
        displayLarge: GoogleFonts.inter(fontSize: 32, fontWeight: FontWeight.w800, color: Colors.white),
        headlineMedium: GoogleFonts.inter(fontSize: 24, fontWeight: FontWeight.w700, color: Colors.white),
        titleLarge: GoogleFonts.inter(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
        bodyLarge: GoogleFonts.inter(fontSize: 16, color: const Color(0xFFE2E8F0)),
        bodyMedium: GoogleFonts.inter(fontSize: 14, color: const Color(0xFF9CA3AF)),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: backgroundColor,
        foregroundColor: Colors.white,
        elevation: 0,
        titleTextStyle: GoogleFonts.inter(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: surfaceColor,
        selectedItemColor: primaryColor,
        unselectedItemColor: Color(0xFF6B7280),
        type: BottomNavigationBarType.fixed,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: backgroundColor,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: borderColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: primaryColor, width: 2),
        ),
        labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
        hintStyle: const TextStyle(color: Color(0xFF6B7280)),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryColor,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          textStyle: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}
