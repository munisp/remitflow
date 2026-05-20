/**
 * Real-time Monitor Hook with React Query Auto-Refresh
 * Nigerian Remittance Platform
 */

import { useQuery, useMutation, useQueryClient, UseQueryOptions } from 'react-query';
import { realtimeMonitorService } from '../api/services/realtimeMonitorService';
import {
  DashboardMetrics,
  Transaction,
  Alert,
  DashboardFilters
} from '../types/dashboard';
import { toast } from 'react-toastify';

// Query keys
export const QUERY_KEYS = {
  metrics: 'realtime-metrics',
  activeTransactions: 'active-transactions',
  recentTransactions: 'recent-transactions',
  transaction: 'transaction',
  alerts: 'realtime-alerts',
  systemHealth: 'system-health'
} as const;

export const useRealtimeMonitor = () => {
  const queryClient = useQueryClient();

  /**
   * Get dashboard metrics with auto-refresh every 5 seconds
   */
  const useMetrics = (options?: UseQueryOptions<DashboardMetrics>) => {
    return useQuery<DashboardMetrics>(
      QUERY_KEYS.metrics,
      realtimeMonitorService.getMetrics,
      {
        // Auto-refresh every 5 seconds
        refetchInterval: 5000,
        // Continue refreshing even when window is not focused
        refetchIntervalInBackground: true,
        // Always consider data stale to ensure fresh data
        staleTime: 0,
        // Keep data in cache for 1 minute
        cacheTime: 60000,
        // Retry failed requests twice
        retry: 2,
        // Don't refetch on window focus (already auto-refreshing)
        refetchOnWindowFocus: false,
        // Show error toast on failure
        onError: (error: any) => {
          console.error('Failed to fetch metrics:', error);
          toast.error('Failed to load dashboard metrics');
        },
        ...options
      }
    );
  };

  /**
   * Get active transactions with auto-refresh every 3 seconds
   */
  const useActiveTransactions = (
    page: number = 1,
    pageSize: number = 20,
    options?: UseQueryOptions<any>
  ) => {
    return useQuery(
      [QUERY_KEYS.activeTransactions, page, pageSize],
      () => realtimeMonitorService.getActiveTransactions(page, pageSize),
      {
        // Auto-refresh every 3 seconds for active transactions
        refetchInterval: 3000,
        refetchIntervalInBackground: true,
        staleTime: 0,
        cacheTime: 60000,
        retry: 2,
        refetchOnWindowFocus: false,
        // Keep previous data while fetching new page
        keepPreviousData: true,
        onError: (error: any) => {
          console.error('Failed to fetch active transactions:', error);
          toast.error('Failed to load active transactions');
        },
        ...options
      }
    );
  };

  /**
   * Get recent transactions with optional filters
   */
  const useRecentTransactions = (
    filters?: DashboardFilters,
    page: number = 1,
    pageSize: number = 50,
    options?: UseQueryOptions<any>
  ) => {
    return useQuery(
      [QUERY_KEYS.recentTransactions, filters, page, pageSize],
      () => realtimeMonitorService.getRecentTransactions(filters, page, pageSize),
      {
        // Auto-refresh every 10 seconds for recent transactions
        refetchInterval: 10000,
        refetchIntervalInBackground: true,
        staleTime: 5000,
        cacheTime: 300000, // 5 minutes
        retry: 2,
        refetchOnWindowFocus: false,
        keepPreviousData: true,
        // Only fetch if filters are provided or explicitly enabled
        enabled: options?.enabled !== false,
        onError: (error: any) => {
          console.error('Failed to fetch recent transactions:', error);
          toast.error('Failed to load recent transactions');
        },
        ...options
      }
    );
  };

  /**
   * Get single transaction by ID
   */
  const useTransaction = (
    id: string,
    options?: UseQueryOptions<Transaction>
  ) => {
    return useQuery<Transaction>(
      [QUERY_KEYS.transaction, id],
      () => realtimeMonitorService.getTransaction(id),
      {
        // Refresh every 5 seconds while transaction is active
        refetchInterval: (data) => {
          // Stop polling if transaction is completed or failed
          if (data?.status === 'completed' || data?.status === 'failed') {
            return false;
          }
          return 5000;
        },
        staleTime: 0,
        cacheTime: 300000,
        retry: 2,
        // Only fetch if ID is provided
        enabled: !!id && (options?.enabled !== false),
        onError: (error: any) => {
          console.error('Failed to fetch transaction:', error);
          toast.error('Failed to load transaction details');
        },
        ...options
      }
    );
  };

  /**
   * Get active alerts with auto-refresh every 10 seconds
   */
  const useAlerts = (
    acknowledged: boolean = false,
    page: number = 1,
    pageSize: number = 20,
    options?: UseQueryOptions<any>
  ) => {
    return useQuery(
      [QUERY_KEYS.alerts, acknowledged, page, pageSize],
      () => realtimeMonitorService.getAlerts(acknowledged, page, pageSize),
      {
        // Auto-refresh every 10 seconds
        refetchInterval: 10000,
        refetchIntervalInBackground: true,
        staleTime: 0,
        cacheTime: 60000,
        retry: 2,
        refetchOnWindowFocus: false,
        keepPreviousData: true,
        onError: (error: any) => {
          console.error('Failed to fetch alerts:', error);
          toast.error('Failed to load alerts');
        },
        ...options
      }
    );
  };

  /**
   * Get system health status
   */
  const useSystemHealth = (options?: UseQueryOptions<any>) => {
    return useQuery(
      QUERY_KEYS.systemHealth,
      realtimeMonitorService.getSystemHealth,
      {
        // Check system health every 30 seconds
        refetchInterval: 30000,
        refetchIntervalInBackground: true,
        staleTime: 10000,
        cacheTime: 60000,
        retry: 3,
        refetchOnWindowFocus: false,
        onError: (error: any) => {
          console.error('Failed to fetch system health:', error);
          toast.error('Failed to check system health');
        },
        ...options
      }
    );
  };

  /**
   * Acknowledge alert mutation
   */
  const acknowledgeAlert = useMutation(
    (alertId: string) => realtimeMonitorService.acknowledgeAlert(alertId),
    {
      onSuccess: (data, alertId) => {
        // Invalidate alerts query to refresh the list
        queryClient.invalidateQueries(QUERY_KEYS.alerts);
        toast.success('Alert acknowledged');
      },
      onError: (error: any) => {
        console.error('Failed to acknowledge alert:', error);
        toast.error('Failed to acknowledge alert');
      }
    }
  );

  /**
   * Export transactions mutation
   */
  const exportTransactions = useMutation(
    (filters?: DashboardFilters) => realtimeMonitorService.exportTransactions(filters),
    {
      onSuccess: (blob) => {
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `transactions-${new Date().toISOString()}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        toast.success('Transactions exported successfully');
      },
      onError: (error: any) => {
        console.error('Failed to export transactions:', error);
        toast.error('Failed to export transactions');
      }
    }
  );

  /**
   * Manually refresh all dashboard data
   */
  const refreshDashboard = () => {
    queryClient.invalidateQueries(QUERY_KEYS.metrics);
    queryClient.invalidateQueries(QUERY_KEYS.activeTransactions);
    queryClient.invalidateQueries(QUERY_KEYS.recentTransactions);
    queryClient.invalidateQueries(QUERY_KEYS.alerts);
    queryClient.invalidateQueries(QUERY_KEYS.systemHealth);
    toast.info('Dashboard refreshed');
  };

  /**
   * Update metrics in cache (called from WebSocket)
   */
  const updateMetricsCache = (metrics: DashboardMetrics) => {
    queryClient.setQueryData(QUERY_KEYS.metrics, metrics);
  };

  /**
   * Add transaction to cache (called from WebSocket)
   */
  const addTransactionToCache = (transaction: Transaction) => {
    // Update active transactions cache
    queryClient.setQueryData(
      [QUERY_KEYS.activeTransactions, 1, 20],
      (old: any) => {
        if (!old) return old;
        
        return {
          ...old,
          data: [transaction, ...old.data].slice(0, 20),
          total: old.total + 1
        };
      }
    );

    // Update recent transactions cache
    queryClient.setQueryData(
      [QUERY_KEYS.recentTransactions, undefined, 1, 50],
      (old: any) => {
        if (!old) return old;
        
        return {
          ...old,
          data: [transaction, ...old.data].slice(0, 50),
          total: old.total + 1
        };
      }
    );
  };

  /**
   * Update transaction in cache (called from WebSocket)
   */
  const updateTransactionInCache = (transaction: Transaction) => {
    // Update single transaction cache
    queryClient.setQueryData(
      [QUERY_KEYS.transaction, transaction.id],
      transaction
    );

    // Update in lists
    const updateList = (old: any) => {
      if (!old) return old;
      
      return {
        ...old,
        data: old.data.map((t: Transaction) =>
          t.id === transaction.id ? transaction : t
        )
      };
    };

    queryClient.setQueryData(
      [QUERY_KEYS.activeTransactions, 1, 20],
      updateList
    );

    queryClient.setQueryData(
      [QUERY_KEYS.recentTransactions, undefined, 1, 50],
      updateList
    );
  };

  /**
   * Add alert to cache (called from WebSocket)
   */
  const addAlertToCache = (alert: Alert) => {
    queryClient.setQueryData(
      [QUERY_KEYS.alerts, false, 1, 20],
      (old: any) => {
        if (!old) return old;
        
        return {
          ...old,
          data: [alert, ...old.data].slice(0, 20),
          total: old.total + 1
        };
      }
    );
  };

  return {
    // Queries
    useMetrics,
    useActiveTransactions,
    useRecentTransactions,
    useTransaction,
    useAlerts,
    useSystemHealth,

    // Mutations
    acknowledgeAlert: acknowledgeAlert.mutateAsync,
    exportTransactions: exportTransactions.mutateAsync,
    isAcknowledging: acknowledgeAlert.isLoading,
    isExporting: exportTransactions.isLoading,

    // Cache updates (for WebSocket)
    updateMetricsCache,
    addTransactionToCache,
    updateTransactionInCache,
    addAlertToCache,

    // Manual refresh
    refreshDashboard
  };
};
