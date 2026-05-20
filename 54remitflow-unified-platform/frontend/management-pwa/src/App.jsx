import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Lazy load pages for better performance
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AgentManagement = lazy(() => import('./pages/AgentManagement'));
const TransactionMonitor = lazy(() => import('./pages/TransactionMonitor'));
const POSManagement = lazy(() => import('./pages/POSManagement'));
const QRCodeManagement = lazy(() => import('./pages/QRCodeManagement'));
const TigerBeetleSync = lazy(() => import('./pages/TigerBeetleSync'));
const FluvioStreaming = lazy(() => import('./pages/FluvioStreaming'));
const InventoryManagement = lazy(() => import('./pages/InventoryManagement'));
const CommissionManagement = lazy(() => import('./pages/CommissionManagement'));
const KYCManagement = lazy(() => import('./pages/KYCManagement'));
const Analytics = lazy(() => import('./pages/Analytics'));
const SystemHealth = lazy(() => import('./pages/SystemHealth'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<LoadingSpinner fullScreen />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="agents" element={<AgentManagement />} />
            <Route path="transactions" element={<TransactionMonitor />} />
            <Route path="pos" element={<POSManagement />} />
            <Route path="qr-codes" element={<QRCodeManagement />} />
            <Route path="tigerbeetle" element={<TigerBeetleSync />} />
            <Route path="fluvio" element={<FluvioStreaming />} />
            <Route path="inventory" element={<InventoryManagement />} />
            <Route path="commissions" element={<CommissionManagement />} />
            <Route path="kyc" element={<KYCManagement />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="health" element={<SystemHealth />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

export default App;
