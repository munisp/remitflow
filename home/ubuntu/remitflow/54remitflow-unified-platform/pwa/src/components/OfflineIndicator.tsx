/**
 * Offline Indicator Component
 * Shows network status and pending sync items
 * Critical for African markets with spotty connectivity
 */

import React, { useEffect, useState } from 'react';
import { useOfflineStore, useIsOnline, usePendingCount, useSyncInProgress } from '../stores/offlineStore';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useIsOnline();
  const pendingCount = usePendingCount();
  const syncInProgress = useSyncInProgress();
  const syncPendingTransactions = useOfflineStore((state) => state.syncPendingTransactions);
  const [showBanner, setShowBanner] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setShowBanner(true);
      setWasOffline(true);
    } else if (wasOffline) {
      // Show "back online" message briefly
      setTimeout(() => {
        setShowBanner(false);
        setWasOffline(false);
      }, 3000);
    }
  }, [isOnline, wasOffline]);

  const handleManualSync = () => {
    if (isOnline && pendingCount > 0) {
      syncPendingTransactions();
    }
  };

  // Don't show anything if online and no pending items
  if (isOnline && pendingCount === 0 && !showBanner) {
    return null;
  }

  return (
    <>
      {/* Offline Banner */}
      {showBanner && (
        <div
          className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-center text-sm font-medium transition-all duration-300 ${
            isOnline
              ? 'bg-green-500 text-white'
              : 'bg-yellow-500 text-yellow-900'
          }`}
        >
          {isOnline ? (
            <div className="flex items-center justify-center space-x-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Back online! Syncing your data...</span>
            </div>
          ) : (
            <div className="flex items-center justify-center space-x-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656M6.343 6.343a8 8 0 000 11.314" />
              </svg>
              <span>You're offline. Don't worry, your data is saved locally.</span>
            </div>
          )}
        </div>
      )}

      {/* Pending Sync Indicator */}
      {pendingCount > 0 && (
        <div className="fixed bottom-20 right-4 z-40">
          <button
            onClick={handleManualSync}
            disabled={!isOnline || syncInProgress}
            className={`flex items-center space-x-2 px-4 py-2 rounded-full shadow-lg transition-all ${
              isOnline
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-400 text-gray-200 cursor-not-allowed'
            }`}
          >
            {syncInProgress ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Syncing...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{pendingCount} pending</span>
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
};

/**
 * Offline-aware fetch wrapper
 * Queues requests when offline and syncs when back online
 */
export const offlineFetch = async (
  url: string,
  options: RequestInit & { offlineData?: Record<string, unknown>; transactionType?: 'transfer' | 'airtime' | 'bill_payment' | 'wallet_fund' }
): Promise<Response> => {
  const { offlineData, transactionType, ...fetchOptions } = options;
  
  // Check if online
  if (navigator.onLine) {
    try {
      return await fetch(url, fetchOptions);
    } catch (error) {
      // Network error - queue for later if we have offline data
      if (offlineData && transactionType) {
        useOfflineStore.getState().addPendingTransaction({
          type: transactionType,
          data: offlineData,
        });
        
        // Return a mock successful response
        return new Response(JSON.stringify({ 
          success: true, 
          queued: true,
          message: 'Transaction queued for sync when online'
        }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw error;
    }
  }
  
  // Offline - queue the transaction
  if (offlineData && transactionType) {
    useOfflineStore.getState().addPendingTransaction({
      type: transactionType,
      data: offlineData,
    });
    
    return new Response(JSON.stringify({ 
      success: true, 
      queued: true,
      message: 'Transaction queued for sync when online'
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // No offline data provided - throw error
  throw new Error('Network unavailable and no offline fallback provided');
};

/**
 * Hook for offline-aware data fetching with caching
 */
export const useOfflineData = <T,>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMinutes: number = 60
): { data: T | null; loading: boolean; error: Error | null; refetch: () => Promise<void> } => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isOnline = useIsOnline();
  const { cacheData, getCachedData } = useOfflineStore();

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Try to get cached data first
      const cached = getCachedData<T>(key);
      if (cached) {
        setData(cached);
        setLoading(false);
        
        // If online, refresh in background
        if (isOnline) {
          try {
            const fresh = await fetcher();
            setData(fresh);
            cacheData(key, fresh, ttlMinutes);
          } catch {
            // Silently fail background refresh
          }
        }
        return;
      }
      
      // No cache - fetch fresh data
      if (isOnline) {
        const fresh = await fetcher();
        setData(fresh);
        cacheData(key, fresh, ttlMinutes);
      } else {
        throw new Error('No cached data available offline');
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [key, isOnline]);

  return { data, loading, error, refetch: fetchData };
};

export default OfflineIndicator;
