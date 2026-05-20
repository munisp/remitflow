/**
 * Real-time Dashboard Component
 * Nigerian Remittance Platform
 * 
 * Features:
 * - Auto-refreshing metrics every 5 seconds
 * - WebSocket real-time updates
 * - Live transaction feed
 * - Active alerts panel
 * - System health monitoring
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useRealtimeMonitor } from '../../hooks/useRealtimeMonitor';
import { useDashboardWebSocket } from '../../hooks/useWebSocket';
import { StatCard } from '../shared/StatCard';
import { TransactionList } from './TransactionList';
import { AlertsPanel } from './AlertsPanel';
import { formatCurrency, formatNumber, formatPercentage, formatDuration } from '../../utils/formatters';
import { Transaction, DashboardMetrics, Alert } from '../../types/dashboard';
import { toast } from 'react-toastify';

export const RealtimeDashboard: React.FC = () => {
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  // React Query hooks with auto-refresh
  const {
    useMetrics,
    useActiveTransactions,
    useAlerts,
    acknowledgeAlert,
    isAcknowledging,
    updateMetricsCache,
    addTransactionToCache,
    updateTransactionInCache,
    addAlertToCache,
    refreshDashboard
  } = useRealtimeMonitor();

  // Fetch data with auto-refresh
  const { data: metrics, isLoading: metricsLoading, error: metricsError } = useMetrics();
  const { data: activeTransactionsData, isLoading: transactionsLoading } = useActiveTransactions(1, 20);
  const { data: alertsData, isLoading: alertsLoading } = useAlerts(false, 1, 20);

  // WebSocket connection for real-time updates
  const {
    isConnected: wsConnected,
    isConnecting: wsConnecting,
    reconnectAttempts,
    reconnect: wsReconnect
  } = useDashboardWebSocket(
    // On transaction update
    useCallback((transaction: Transaction) => {
      console.log('[Dashboard] Transaction update:', transaction);
      
      // Update cache
      if (transaction.status === 'pending' || transaction.status === 'processing') {
        addTransactionToCache(transaction);
      } else {
        updateTransactionInCache(transaction);
      }

      // Show toast notification
      if (transaction.status === 'completed') {
        toast.success(`Transaction ${transaction.reference} completed`);
      } else if (transaction.status === 'failed') {
        toast.error(`Transaction ${transaction.reference} failed`);
      }
    }, [addTransactionToCache, updateTransactionInCache]),

    // On metrics update
    useCallback((newMetrics: DashboardMetrics) => {
      console.log('[Dashboard] Metrics update:', newMetrics);
      updateMetricsCache(newMetrics);
    }, [updateMetricsCache]),

    // On alert created
    useCallback((alert: Alert) => {
      console.log('[Dashboard] New alert:', alert);
      
      // Update cache
      addAlertToCache(alert);

      // Show toast notification based on severity
      const message = `${alert.title}: ${alert.message}`;
      switch (alert.severity) {
        case 'critical':
          toast.error(message, { autoClose: false });
          break;
        case 'error':
          toast.error(message);
          break;
        case 'warning':
          toast.warning(message);
          break;
        case 'info':
          toast.info(message);
          break;
      }
    }, [addAlertToCache])
  );

  // Handle alert acknowledgment
  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      await acknowledgeAlert(alertId);
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
    }
  };

  // Handle transaction click
  const handleTransactionClick = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    // Could open a modal or navigate to transaction details
  };

  // Handle manual refresh
  const handleRefresh = () => {
    refreshDashboard();
  };

  // Show error if metrics failed to load
  useEffect(() => {
    if (metricsError) {
      toast.error('Failed to load dashboard metrics');
    }
  }, [metricsError]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Real-time Dashboard</h1>
            <p className="text-gray-600 mt-1">Monitor transactions and system health in real-time</p>
          </div>

          <div className="flex items-center space-x-4">
            {/* WebSocket Status */}
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${
                wsConnected ? 'bg-green-500 animate-pulse' :
                wsConnecting ? 'bg-yellow-500 animate-pulse' :
                'bg-red-500'
              }`}></div>
              <span className="text-sm text-gray-600">
                {wsConnected ? 'Live' :
                 wsConnecting ? 'Connecting...' :
                 reconnectAttempts > 0 ? `Reconnecting (${reconnectAttempts})` :
                 'Disconnected'}
              </span>
              {!wsConnected && !wsConnecting && (
                <button
                  onClick={wsReconnect}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Reconnect
                </button>
              )}
            </div>

            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard
          title="Active Transactions"
          value={formatNumber(metrics?.active_transactions || 0)}
          trend="up"
          trendValue="+12%"
          loading={metricsLoading}
          color="blue"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />

        <StatCard
          title="Total Volume (24h)"
          value={formatCurrency(metrics?.total_volume || 0)}
          trend="up"
          trendValue="+8.2%"
          loading={metricsLoading}
          color="green"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        <StatCard
          title="Success Rate"
          value={formatPercentage(metrics?.success_rate || 0)}
          trend="up"
          trendValue="+2.1%"
          loading={metricsLoading}
          color="purple"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        <StatCard
          title="Avg Processing Time"
          value={formatDuration(metrics?.average_processing_time || 0)}
          trend="down"
          trendValue="-15%"
          loading={metricsLoading}
          color="yellow"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Transactions - 2 columns */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Active Transactions</h2>
              <span className="text-sm text-gray-500">
                Auto-refreshing every 3 seconds
              </span>
            </div>

            <TransactionList
              transactions={activeTransactionsData?.data || []}
              loading={transactionsLoading}
              onTransactionClick={handleTransactionClick}
            />

            {activeTransactionsData && activeTransactionsData.total > 20 && (
              <div className="mt-4 text-center">
                <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                  View all {activeTransactionsData.total} transactions →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Alerts Panel - 1 column */}
        <div className="lg:col-span-1">
          <AlertsPanel
            alerts={alertsData?.data || []}
            loading={alertsLoading}
            onAcknowledge={handleAcknowledgeAlert}
            acknowledging={isAcknowledging}
          />
        </div>
      </div>

      {/* Additional Metrics */}
      {metrics && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Transactions per Minute */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Transactions/Minute</h3>
            <p className="text-3xl font-bold text-gray-900">{metrics.transactions_per_minute}</p>
          </div>

          {/* Active Users */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Active Users</h3>
            <p className="text-3xl font-bold text-gray-900">{formatNumber(metrics.active_users)}</p>
          </div>

          {/* Total Fees */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Fees Collected (24h)</h3>
            <p className="text-3xl font-bold text-gray-900">{formatCurrency(metrics.total_fees_collected)}</p>
          </div>
        </div>
      )}
    </div>
  );
};
