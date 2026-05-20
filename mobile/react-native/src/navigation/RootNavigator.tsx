/**
 * Root navigation for RemitFlow React Native app
 * Handles auth flow and main tab navigation
 * v120: Added 20 new screens for full PWA parity
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

// Auth screens
import LoginScreen from '../screens/LoginScreen';

// Main tab screens
import DashboardScreen from '../screens/DashboardScreen';
import SendMoneyScreen from '../screens/SendMoneyScreen';
import TransactionHistoryScreen from '../screens/TransactionHistoryScreen';
import WalletScreen from '../screens/WalletScreen';
import ProfileScreen from '../screens/ProfileScreen';

// Detail screens — original
import KYCScreen from '../screens/KYCScreen';
import PaymentRailsScreen from '../screens/PaymentRailsScreen';
import RevenueShareScreen from '../screens/RevenueShareScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import BeneficiaryScreen from '../screens/BeneficiaryScreen';
import FXAlertsScreen from '../screens/FXAlertsScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import RequestMoneyScreen from '../screens/RequestMoneyScreen';
import TransactionReceiptScreen from '../screens/TransactionReceiptScreen';

// Detail screens — v120 new screens
import CardsScreen from '../screens/CardsScreen';
import SavingsGoalsScreen from '../screens/SavingsGoalsScreen';
import BNPLScreen from '../screens/BNPLScreen';
import StablecoinScreen from '../screens/StablecoinScreen';
import DisputesScreen from '../screens/DisputesScreen';
import ReferralScreen from '../screens/ReferralScreen';
import BatchPaymentsScreen from '../screens/BatchPaymentsScreen';
import RateLockScreen from '../screens/RateLockScreen';
import RateCalculatorScreen from '../screens/RateCalculatorScreen';
import AirtimeScreen from '../screens/AirtimeScreen';
import BillPaymentScreen from '../screens/BillPaymentScreen';
import QRPayScreen from '../screens/QRPayScreen';
import DirectDebitScreen from '../screens/DirectDebitScreen';
import RecurringPaymentsScreen from '../screens/RecurringPaymentsScreen';
import VirtualAccountScreen from '../screens/VirtualAccountScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SupportScreen from '../screens/SupportScreen';
import SplitBillScreen from '../screens/SplitBillScreen';
import CBDCScreen from '../screens/CBDCScreen';
import CheckoutSDKScreen from '../screens/CheckoutSDKScreen';
// Detail screens — v140 parity screens
import AfriMarketScreen from '../screens/AfriMarketScreen';
import AgentNetworkScreen from '../screens/AgentNetworkScreen';
import CBDCAdminScreen from '../screens/CBDCAdminScreen';
import CorridorPricingAdminScreen from '../screens/CorridorPricingAdminScreen';
import DocumentVaultScreen from '../screens/DocumentVaultScreen';
import FXHedgingScreen from '../screens/FXHedgingScreen';
import NotificationCenterScreen from '../screens/NotificationCenterScreen';
import PBACPoliciesScreen from '../screens/PBACPoliciesScreen';
import RevenueAnalyticsScreen from '../screens/RevenueAnalyticsScreen';
import RevenueSharePWAScreen from '../screens/RevenueSharePWAScreen';
import ServicesHealthDashboardScreen from '../screens/ServicesHealthDashboardScreen';
import SystemConfigPageScreen from '../screens/SystemConfigPageScreen';
// Detail screens — v138 security screens
import FraudMonitorScreen from '../screens/FraudMonitorScreen';
import SecurityDashboardScreen from '../screens/SecurityDashboardScreen';
// Detail screens — v197 outbound revenue screens
import SendFromNigeriaScreen from '../screens/SendFromNigeriaScreen';
import EducationPaymentsScreen from '../screens/EducationPaymentsScreen';
import MedicalTourismScreen from '../screens/MedicalTourismScreen';
import FormalizationDashboardScreen from '../screens/FormalizationDashboardScreen';
import OutboundRevenueModelScreen from '../screens/OutboundRevenueModelScreen';
import RecipientOnboardingScreen from '../screens/RecipientOnboardingScreen';

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  Main: undefined;
  // Original detail screens
  KYC: undefined;
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
  VirtualAccount: undefined;
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
          <Stack.Screen name="VirtualAccount" component={VirtualAccountScreen} />
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
        </>
      )}
    </Stack.Navigator>
  );
}
