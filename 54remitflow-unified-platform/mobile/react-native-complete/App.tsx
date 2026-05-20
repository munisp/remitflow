/**
 * RemitFlow React Native App — Main Navigator
 * Registers all 36 screens with React Navigation stack navigator.
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

// ─── Auth screens ─────────────────────────────────────────────────────────────
import { LoginScreen } from './src/screens/LoginScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';

// ─── Core screens ─────────────────────────────────────────────────────────────
import { DashboardScreen } from './src/screens/DashboardScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { SendMoneyScreen } from './src/screens/SendMoneyScreen';
import { ReceiveMoneyScreen } from './src/screens/ReceiveMoneyScreen';
import { TransactionsScreen } from './src/screens/TransactionsScreen';
import { TransactionHistoryScreen } from './src/screens/TransactionHistoryScreen';
import { TransactionDetailScreen } from './src/screens/TransactionDetailScreen';
import { ExchangeRatesScreen } from './src/screens/ExchangeRatesScreen';
import { BeneficiariesScreen } from './src/screens/BeneficiariesScreen';
import { CardsScreen } from './src/screens/CardsScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SupportScreen } from './src/screens/SupportScreen';
import { HelpScreen } from './src/screens/HelpScreen';
import { KYCScreen } from './src/screens/KYCScreen';

// ─── v120 screens ─────────────────────────────────────────────────────────────
import { SavingsGoalsScreen } from './src/screens/SavingsGoalsScreen';
import { BNPLScreen } from './src/screens/BNPLScreen';
import { StablecoinScreen } from './src/screens/StablecoinScreen';
import { CBDCScreen } from './src/screens/CBDCScreen';
import { ReferralScreen } from './src/screens/ReferralScreen';
import { SplitBillScreen } from './src/screens/SplitBillScreen';
import { BatchPaymentsScreen } from './src/screens/BatchPaymentsScreen';
import { DirectDebitScreen } from './src/screens/DirectDebitScreen';
import { RecurringPaymentsScreen } from './src/screens/RecurringPaymentsScreen';
import { QRPayScreen } from './src/screens/QRPayScreen';
import { AirtimeScreen } from './src/screens/AirtimeScreen';
import { BillPaymentScreen } from './src/screens/BillPaymentScreen';
import { FXAlertsScreen } from './src/screens/FXAlertsScreen';
import { FraudMonitorScreen } from './src/screens/FraudMonitorScreen';
import { SecurityDashboardScreen } from './src/screens/SecurityDashboardScreen';

// ─── v137 admin screens ───────────────────────────────────────────────────────
import { ServicesHealthDashboardScreen } from './src/screens/ServicesHealthDashboardScreen';
import { PBACPoliciesScreen } from './src/screens/PBACPoliciesScreen';

export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
  Dashboard: undefined;
  Wallet: undefined;
  SendMoney: undefined;
  ReceiveMoney: undefined;
  Transactions: undefined;
  TransactionHistory: undefined;
  TransactionDetail: { transaction: any };
  ExchangeRates: undefined;
  Beneficiaries: undefined;
  Cards: undefined;
  Notifications: undefined;
  Profile: undefined;
  Settings: undefined;
  Support: undefined;
  Help: undefined;
  KYC: undefined;
  SavingsGoals: undefined;
  BNPL: undefined;
  Stablecoin: undefined;
  CBDC: undefined;
  Referral: undefined;
  SplitBill: undefined;
  BatchPayments: undefined;
  DirectDebit: undefined;
  RecurringPayments: undefined;
  QRPay: undefined;
  Airtime: undefined;
  BillPayment: undefined;
  FXAlerts: undefined;
  FraudMonitor: undefined;
  SecurityDashboard: undefined;
  ServicesHealthDashboard: undefined;
  PBACPolicies: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

const screenOptions = {
  headerShown: false,
  cardStyle: { backgroundColor: '#0f0f1a' },
};

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Onboarding" screenOptions={screenOptions}>
        {/* Auth */}
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />

        {/* Core */}
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Wallet" component={WalletScreen} />
        <Stack.Screen name="SendMoney" component={SendMoneyScreen} />
        <Stack.Screen name="ReceiveMoney" component={ReceiveMoneyScreen} />
        <Stack.Screen name="Transactions" component={TransactionsScreen} />
        <Stack.Screen name="TransactionHistory" component={TransactionHistoryScreen} />
        <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
        <Stack.Screen name="ExchangeRates" component={ExchangeRatesScreen} />
        <Stack.Screen name="Beneficiaries" component={BeneficiariesScreen} />
        <Stack.Screen name="Cards" component={CardsScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Support" component={SupportScreen} />
        <Stack.Screen name="Help" component={HelpScreen} />
        <Stack.Screen name="KYC" component={KYCScreen} />

        {/* Financial features */}
        <Stack.Screen name="SavingsGoals" component={SavingsGoalsScreen} />
        <Stack.Screen name="BNPL" component={BNPLScreen} />
        <Stack.Screen name="Stablecoin" component={StablecoinScreen} />
        <Stack.Screen name="CBDC" component={CBDCScreen} />
        <Stack.Screen name="Referral" component={ReferralScreen} />
        <Stack.Screen name="SplitBill" component={SplitBillScreen} />
        <Stack.Screen name="BatchPayments" component={BatchPaymentsScreen} />
        <Stack.Screen name="DirectDebit" component={DirectDebitScreen} />
        <Stack.Screen name="RecurringPayments" component={RecurringPaymentsScreen} />
        <Stack.Screen name="QRPay" component={QRPayScreen} />
        <Stack.Screen name="Airtime" component={AirtimeScreen} />
        <Stack.Screen name="BillPayment" component={BillPaymentScreen} />
        <Stack.Screen name="FXAlerts" component={FXAlertsScreen} />

        {/* Admin */}
        <Stack.Screen name="FraudMonitor" component={FraudMonitorScreen} />
        <Stack.Screen name="SecurityDashboard" component={SecurityDashboardScreen} />
        <Stack.Screen name="ServicesHealthDashboard" component={ServicesHealthDashboardScreen} />
        <Stack.Screen name="PBACPolicies" component={PBACPoliciesScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
