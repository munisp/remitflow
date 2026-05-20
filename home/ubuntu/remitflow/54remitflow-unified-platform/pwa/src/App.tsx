import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import { OfflineIndicator } from './components/OfflineIndicator';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Wallet = lazy(() => import('./pages/Wallet'));
const SendMoney = lazy(() => import('./pages/SendMoney'));
const ReceiveMoney = lazy(() => import('./pages/ReceiveMoney'));
const Transactions = lazy(() => import('./pages/Transactions'));
const ExchangeRates = lazy(() => import('./pages/ExchangeRates'));
const Airtime = lazy(() => import('./pages/Airtime'));
const BillPayment = lazy(() => import('./pages/BillPayment'));
const VirtualAccount = lazy(() => import('./pages/VirtualAccount'));
const Cards = lazy(() => import('./pages/Cards'));
const KYC = lazy(() => import('./pages/KYC'));
const PropertyKYC = lazy(() => import('./pages/PropertyKYC'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const Support = lazy(() => import('./pages/Support'));
const Beneficiaries = lazy(() => import('./pages/Beneficiaries'));
const MPesa = lazy(() => import('./pages/MPesa'));
const WiseTransfer = lazy(() => import('./pages/WiseTransfer'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Security = lazy(() => import('./pages/Security'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const AccountHealth = lazy(() => import('./pages/AccountHealth'));
const PaymentPerformance = lazy(() => import('./pages/PaymentPerformance'));
const Disputes = lazy(() => import('./pages/Disputes'));
const Stablecoin = lazy(() => import('./pages/Stablecoin'));
const TransferTracking = lazy(() => import('./pages/TransferTracking'));
const BatchPayments = lazy(() => import('./pages/BatchPayments'));
const SavingsGoals = lazy(() => import('./pages/SavingsGoals'));
const FXAlerts = lazy(() => import('./pages/FXAlerts'));

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <>
      <OfflineIndicator />
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="send" element={<SendMoney />} />
          <Route path="receive" element={<ReceiveMoney />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="exchange-rates" element={<ExchangeRates />} />
          <Route path="airtime" element={<Airtime />} />
          <Route path="bills" element={<BillPayment />} />
          <Route path="virtual-account" element={<VirtualAccount />} />
          <Route path="cards" element={<Cards />} />
                    <Route path="kyc" element={<KYC />} />
                    <Route path="property-kyc" element={<PropertyKYC />} />
                    <Route path="settings" element={<Settings />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="support" element={<Support />} />
                  <Route path="beneficiaries" element={<Beneficiaries />} />
                  <Route path="mpesa" element={<MPesa />} />
                  <Route path="wise" element={<WiseTransfer />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="security" element={<Security />} />
                                                                  <Route path="audit-logs" element={<AuditLogs />} />
                                                                  <Route path="account-health" element={<AccountHealth />} />
                                                                  <Route path="payment-performance" element={<PaymentPerformance />} />
                                                                                                                                  <Route path="disputes" element={<Disputes />} />
                                                                                                                                                                                                                                                                  <Route path="stablecoin" element={<Stablecoin />} />
                                                                                                                                                                                                                                                                  <Route path="transfer-tracking/:transferId" element={<TransferTracking />} />
                                                                                                                                                                                                                                                                  <Route path="batch-payments" element={<BatchPayments />} />
                                                                                                                                                                                                                                                                  <Route path="savings-goals" element={<SavingsGoals />} />
                                                                                                                                                                                                                                                                  <Route path="fx-alerts" element={<FXAlerts />} />
                                                                                                                                                                                                                                                                </Route>
        
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
};

export default App;
