/**
 * Root navigation for RemitFlow React Native app
 * Handles auth flow and main tab navigation
 *
 * wave14 perf (H1): rarely-used detail screens are React.lazy'd behind a
 * Suspense boundary so their modules are only evaluated (with Metro
 * inlineRequires) when first navigated to. Auth-critical screens
 * (Login/Onboarding) and the five main-tab screens (Dashboard first) stay
 * eager so first paint and tab switches never hit a fallback spinner.
 *
 * wave14 perf (L3): the truncated VirtualAccountScreen.tsx (11 lines, cut
 * off mid-statement) was deleted along with its commented-out registration;
 * it never compiled and was never reachable.
 */
import React, { Suspense, lazy } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

// Auth screens (eager — auth-critical)
import LoginScreen from '../screens/LoginScreen';
import OnboardingScreen from '../screens/OnboardingScreen';

// Main tab screens (eager — first paint + tab bar)
import DashboardScreen from '../screens/DashboardScreen';
import SendMoneyScreen from '../screens/SendMoneyScreen';
import TransactionHistoryScreen from '../screens/TransactionHistoryScreen';
import WalletScreen from '../screens/WalletScreen';
import ProfileScreen from '../screens/ProfileScreen';

function ScreenFallback() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f1a' }}>
      <ActivityIndicator size="large" color="#6366f1" />
    </View>
  );
}

/**
 * Wrap a lazily-loaded screen module in its own Suspense boundary so a
 * screen being loaded never unmounts the navigator chrome.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyScreen<T extends React.ComponentType<any>>(loader: () => Promise<{ default: T }>) {
  const Lazy = lazy(loader);
  return function LazyScreen(props: React.ComponentProps<T>) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

// Detail screens (lazy — original)
const KYCScreen = lazyScreen(() => import('../screens/KYCScreen'));
// wave-15 §8 (K6): camera-based KYC capture flow (document → selfie
// challenge → optional NFC → verdict). Lazy like every other detail
// screen so the camera module is only evaluated when navigated to.
const KycCaptureScreen = lazyScreen(() => import('../screens/kyc/CaptureScreen'));
const PaymentRailsScreen = lazyScreen(() => import('../screens/PaymentRailsScreen'));
const RevenueShareScreen = lazyScreen(() => import('../screens/RevenueShareScreen'));
const NotificationsScreen = lazyScreen(() => import('../screens/NotificationsScreen'));
const BeneficiaryScreen = lazyScreen(() => import('../screens/BeneficiaryScreen'));
const FXAlertsScreen = lazyScreen(() => import('../screens/FXAlertsScreen'));
const RequestMoneyScreen = lazyScreen(() => import('../screens/RequestMoneyScreen'));
const TransactionReceiptScreen = lazyScreen(() => import('../screens/TransactionReceiptScreen'));

// Detail screens (lazy — v120 new screens)
const CardsScreen = lazyScreen(() => import('../screens/CardsScreen'));
const SavingsGoalsScreen = lazyScreen(() => import('../screens/SavingsGoalsScreen'));
const BNPLScreen = lazyScreen(() => import('../screens/BNPLScreen'));
const StablecoinScreen = lazyScreen(() => import('../screens/StablecoinScreen'));
const DisputesScreen = lazyScreen(() => import('../screens/DisputesScreen'));
const ReferralScreen = lazyScreen(() => import('../screens/ReferralScreen'));
const BatchPaymentsScreen = lazyScreen(() => import('../screens/BatchPaymentsScreen'));
const RateLockScreen = lazyScreen(() => import('../screens/RateLockScreen'));
const RateCalculatorScreen = lazyScreen(() => import('../screens/RateCalculatorScreen'));
const AirtimeScreen = lazyScreen(() => import('../screens/AirtimeScreen'));
const BillPaymentScreen = lazyScreen(() => import('../screens/BillPaymentScreen'));
const QRPayScreen = lazyScreen(() => import('../screens/QRPayScreen'));
const DirectDebitScreen = lazyScreen(() => import('../screens/DirectDebitScreen'));
const RecurringPaymentsScreen = lazyScreen(() => import('../screens/RecurringPaymentsScreen'));
const SettingsScreen = lazyScreen(() => import('../screens/SettingsScreen'));
const SupportScreen = lazyScreen(() => import('../screens/SupportScreen'));
const SplitBillScreen = lazyScreen(() => import('../screens/SplitBillScreen'));
const CBDCScreen = lazyScreen(() => import('../screens/CBDCScreen'));
const CheckoutSDKScreen = lazyScreen(() => import('../screens/CheckoutSDKScreen'));

// Detail screens (lazy — v140 parity screens)
const AfriMarketScreen = lazyScreen(() => import('../screens/AfriMarketScreen'));
const AgentNetworkScreen = lazyScreen(() => import('../screens/AgentNetworkScreen'));
const CBDCAdminScreen = lazyScreen(() => import('../screens/CBDCAdminScreen'));
const CorridorPricingAdminScreen = lazyScreen(() => import('../screens/CorridorPricingAdminScreen'));
const DocumentVaultScreen = lazyScreen(() => import('../screens/DocumentVaultScreen'));
const FXHedgingScreen = lazyScreen(() => import('../screens/FXHedgingScreen'));
const NotificationCenterScreen = lazyScreen(() => import('../screens/NotificationCenterScreen'));
const PBACPoliciesScreen = lazyScreen(() => import('../screens/PBACPoliciesScreen'));
const RevenueAnalyticsScreen = lazyScreen(() => import('../screens/RevenueAnalyticsScreen'));
const RevenueSharePWAScreen = lazyScreen(() => import('../screens/RevenueSharePWAScreen'));
const ServicesHealthDashboardScreen = lazyScreen(() => import('../screens/ServicesHealthDashboardScreen'));
const SystemConfigPageScreen = lazyScreen(() => import('../screens/SystemConfigPageScreen'));

// Detail screens (lazy — v138 security screens)
const FraudMonitorScreen = lazyScreen(() => import('../screens/FraudMonitorScreen'));
const SecurityDashboardScreen = lazyScreen(() => import('../screens/SecurityDashboardScreen'));

// Detail screens (lazy — v197 outbound revenue screens)
const SendFromNigeriaScreen = lazyScreen(() => import('../screens/SendFromNigeriaScreen'));
const EducationPaymentsScreen = lazyScreen(() => import('../screens/EducationPaymentsScreen'));
const MedicalTourismScreen = lazyScreen(() => import('../screens/MedicalTourismScreen'));
const FormalizationDashboardScreen = lazyScreen(() => import('../screens/FormalizationDashboardScreen'));
const OutboundRevenueModelScreen = lazyScreen(() => import('../screens/OutboundRevenueModelScreen'));
const RecipientOnboardingScreen = lazyScreen(() => import('../screens/RecipientOnboardingScreen'));

// Country-specific SendTo screens (wave14 H1): ONE shared parameterized
// screen; all 15 route names below render it with their route-keyed config.
const SendToCountryScreen = lazyScreen(() => import('../screens/SendToCountryScreen'));

// wave12 BDC screens (lazy)
const BDCPartnerPortalScreen = lazyScreen(() => import('../screens/BDCPartnerPortalScreen'));
const BdcOnboardingEmailPreviewScreen = lazyScreen(() => import('../screens/BdcOnboardingEmailPreviewScreen'));
const BdcPickupAuthorizationScreen = lazyScreen(() => import('../screens/BdcPickupAuthorizationScreen'));
const BdcReversalStatusScreen = lazyScreen(() => import('../screens/BdcReversalStatusScreen'));

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  Main: undefined;
  // Original detail screens
  KYC: undefined;
  KycCapture: { docType?: 'passport' | 'national_id' | 'drivers_license' } | undefined;
  PaymentRails: undefined;
  RevenueShare: undefined;
  Notifications: undefined;
  Beneficiary: { id?: string };
  FXAlerts: undefined;
  RequestMoney: undefined;
  TransactionReceipt: { transactionId: string };
  // v120 new screens
  Cards: undefined;
  SavingsGoals: undefined;
  BNPL: undefined;
  Stablecoin: undefined;
  Disputes: undefined;
  Referral: undefined;
  BatchPayments: undefined;
  RateLock: undefined;
  RateCalculator: undefined;
  Airtime: undefined;
  BillPayment: undefined;
  QRPay: undefined;
  DirectDebit: undefined;
  RecurringPayments: undefined;
  Settings: undefined;
  Support: undefined;
  SplitBill: undefined;
  CBDC: undefined;
  CheckoutSDK: undefined;
  // v140 parity screens
  AfriMarket: undefined;
  AgentNetwork: undefined;
  CBDCAdmin: undefined;
  CorridorPricingAdmin: undefined;
  DocumentVault: undefined;
  FXHedging: undefined;
  NotificationCenter: undefined;
  PBACPolicies: undefined;
  RevenueAnalytics: undefined;
  RevenueSharePWA: undefined;
  ServicesHealthDashboard: undefined;
  SystemConfigPage: undefined;
  // v138 security screens
  FraudMonitor: undefined;
  SecurityDashboard: undefined;
  // v197 outbound revenue screens
  SendAbroad: undefined;
  EducationPayments: undefined;
  MedicalTourism: undefined;
  FormalizationDashboard: undefined;
  OutboundRevenueModel: undefined;
  RecipientOnboarding: undefined;
  // Country-specific SendTo screens
  SendToNigeria: undefined;
  SendToGhana: undefined;
  SendToKenya: undefined;
  SendToSouthAfrica: undefined;
  SendToTanzania: undefined;
  SendToUganda: undefined;
  SendToCameroon: undefined;
  SendToSenegal: undefined;
  SendToBenin: undefined;
  SendToTogo: undefined;
  SendToNiger: undefined;
  SendToMali: undefined;
  SendToChina: undefined;
  SendToBrazil: undefined;
  SendToIndia: undefined;
  // wave12 BDC screens
  BDCPartnerPortal: undefined;
  BdcOnboardingEmailPreview: undefined;
  BdcPickupAuthorization: undefined;
  BdcReversalStatus: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Send: undefined;
  Transactions: undefined;
  Wallet: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#1a1a2e', borderTopColor: '#2d2d4e' },
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#6b7280',
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Send" component={SendMoneyScreen} options={{ title: 'Send' }} />
      <Tab.Screen name="Transactions" component={TransactionHistoryScreen} options={{ title: 'History' }} />
      <Tab.Screen name="Wallet" component={WalletScreen} options={{ title: 'Wallet' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    // Only covers the one-time keystore session read (memoized in
    // secureStorage). Once a cached session id is known, AuthContext reports
    // isAuthenticated = true TENTATIVELY (wave14 H5) and Main renders while
    // auth.me resolves asynchronously — no blocking spinner on the network.
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f1a' }}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <>
          <Stack.Screen name="Auth" component={LoginScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        </>
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          {/* Original detail screens */}
          <Stack.Screen name="KYC" component={KYCScreen} />
          <Stack.Screen name="KycCapture" component={KycCaptureScreen} />
          <Stack.Screen name="PaymentRails" component={PaymentRailsScreen} />
          <Stack.Screen name="RevenueShare" component={RevenueShareScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="Beneficiary" component={BeneficiaryScreen} />
          <Stack.Screen name="FXAlerts" component={FXAlertsScreen} />
          <Stack.Screen name="RequestMoney" component={RequestMoneyScreen} />
          <Stack.Screen name="TransactionReceipt" component={TransactionReceiptScreen} />
          {/* v120 new screens */}
          <Stack.Screen name="Cards" component={CardsScreen} />
          <Stack.Screen name="SavingsGoals" component={SavingsGoalsScreen} />
          <Stack.Screen name="BNPL" component={BNPLScreen} />
          <Stack.Screen name="Stablecoin" component={StablecoinScreen} />
          <Stack.Screen name="Disputes" component={DisputesScreen} />
          <Stack.Screen name="Referral" component={ReferralScreen} />
          <Stack.Screen name="BatchPayments" component={BatchPaymentsScreen} />
          <Stack.Screen name="RateLock" component={RateLockScreen} />
          <Stack.Screen name="RateCalculator" component={RateCalculatorScreen} />
          <Stack.Screen name="Airtime" component={AirtimeScreen} />
          <Stack.Screen name="BillPayment" component={BillPaymentScreen} />
          <Stack.Screen name="QRPay" component={QRPayScreen} />
          <Stack.Screen name="DirectDebit" component={DirectDebitScreen} />
          <Stack.Screen name="RecurringPayments" component={RecurringPaymentsScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Support" component={SupportScreen} />
          <Stack.Screen name="SplitBill" component={SplitBillScreen} />
          <Stack.Screen name="CBDC" component={CBDCScreen} />
          <Stack.Screen name="CheckoutSDK" component={CheckoutSDKScreen} />
          {/* v140 parity screens */}
          <Stack.Screen name="AfriMarket" component={AfriMarketScreen} />
          <Stack.Screen name="AgentNetwork" component={AgentNetworkScreen} />
          <Stack.Screen name="CBDCAdmin" component={CBDCAdminScreen} />
          <Stack.Screen name="CorridorPricingAdmin" component={CorridorPricingAdminScreen} />
          <Stack.Screen name="DocumentVault" component={DocumentVaultScreen} />
          <Stack.Screen name="FXHedging" component={FXHedgingScreen} />
          <Stack.Screen name="NotificationCenter" component={NotificationCenterScreen} />
          <Stack.Screen name="PBACPolicies" component={PBACPoliciesScreen} />
          <Stack.Screen name="RevenueAnalytics" component={RevenueAnalyticsScreen} />
          <Stack.Screen name="RevenueSharePWA" component={RevenueSharePWAScreen} />
          <Stack.Screen name="ServicesHealthDashboard" component={ServicesHealthDashboardScreen} />
          <Stack.Screen name="SystemConfigPage" component={SystemConfigPageScreen} />
          {/* v138 security screens */}
          <Stack.Screen name="FraudMonitor" component={FraudMonitorScreen} />
          <Stack.Screen name="SecurityDashboard" component={SecurityDashboardScreen} />
          {/* v197 outbound revenue screens */}
          <Stack.Screen name="SendAbroad" component={SendFromNigeriaScreen} />
          <Stack.Screen name="EducationPayments" component={EducationPaymentsScreen} />
          <Stack.Screen name="MedicalTourism" component={MedicalTourismScreen} />
          <Stack.Screen name="FormalizationDashboard" component={FormalizationDashboardScreen} />
          <Stack.Screen name="OutboundRevenueModel" component={OutboundRevenueModelScreen} />
          <Stack.Screen name="RecipientOnboarding" component={RecipientOnboardingScreen} />
          {/* Country-specific SendTo screens — all render SendToCountryScreen
              with their route-keyed config (wave14 H1) */}
          <Stack.Screen name="SendToNigeria" component={SendToCountryScreen} />
          <Stack.Screen name="SendToGhana" component={SendToCountryScreen} />
          <Stack.Screen name="SendToKenya" component={SendToCountryScreen} />
          <Stack.Screen name="SendToSouthAfrica" component={SendToCountryScreen} />
          <Stack.Screen name="SendToTanzania" component={SendToCountryScreen} />
          <Stack.Screen name="SendToUganda" component={SendToCountryScreen} />
          <Stack.Screen name="SendToCameroon" component={SendToCountryScreen} />
          <Stack.Screen name="SendToSenegal" component={SendToCountryScreen} />
          <Stack.Screen name="SendToBenin" component={SendToCountryScreen} />
          <Stack.Screen name="SendToTogo" component={SendToCountryScreen} />
          <Stack.Screen name="SendToNiger" component={SendToCountryScreen} />
          <Stack.Screen name="SendToMali" component={SendToCountryScreen} />
          <Stack.Screen name="SendToChina" component={SendToCountryScreen} />
          <Stack.Screen name="SendToBrazil" component={SendToCountryScreen} />
          <Stack.Screen name="SendToIndia" component={SendToCountryScreen} />
          {/* wave12 BDC screens */}
          <Stack.Screen name="BDCPartnerPortal" component={BDCPartnerPortalScreen} />
          <Stack.Screen name="BdcOnboardingEmailPreview" component={BdcOnboardingEmailPreviewScreen} />
          <Stack.Screen name="BdcPickupAuthorization" component={BdcPickupAuthorizationScreen} />
          <Stack.Screen name="BdcReversalStatus" component={BdcReversalStatusScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
