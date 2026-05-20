/**
 * Offline Store - Manages offline data persistence and sync queue
 * Critical for African markets with spotty connectivity
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface PendingTransaction {
  id: string;
  type: 'transfer' | 'airtime' | 'bill_payment' | 'wallet_fund';
  data: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  lastRetryAt?: string;
  status: 'pending' | 'syncing' | 'failed' | 'completed';
  error?: string;
}

interface CachedData {
  key: string;
  data: unknown;
  cachedAt: string;
  expiresAt: string;
}

interface OfflineState {
  isOnline: boolean;
  lastOnlineAt: string | null;
  pendingTransactions: PendingTransaction[];
  cachedData: Record<string, CachedData>;
  syncInProgress: boolean;
  
  // Actions
  setOnlineStatus: (isOnline: boolean) => void;
  addPendingTransaction: (transaction: Omit<PendingTransaction, 'id' | 'createdAt' | 'retryCount' | 'status'>) => string;
  updatePendingTransaction: (id: string, updates: Partial<PendingTransaction>) => void;
  removePendingTransaction: (id: string) => void;
  cacheData: (key: string, data: unknown, ttlMinutes?: number) => void;
  getCachedData: <T>(key: string) => T | null;
  clearExpiredCache: () => void;
  syncPendingTransactions: () => Promise<void>;
  getPendingCount: () => number;
}

const generateId = () => `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      lastOnlineAt: null,
      pendingTransactions: [],
      cachedData: {},
      syncInProgress: false,

      setOnlineStatus: (isOnline: boolean) => {
        set((state) => ({
          isOnline,
          lastOnlineAt: isOnline ? new Date().toISOString() : state.lastOnlineAt,
        }));
        
        // Auto-sync when coming back online
        if (isOnline && get().pendingTransactions.length > 0) {
          get().syncPendingTransactions();
        }
      },

      addPendingTransaction: (transaction) => {
        const id = generateId();
        const newTransaction: PendingTransaction = {
          ...transaction,
          id,
          createdAt: new Date().toISOString(),
          retryCount: 0,
          status: 'pending',
        };
        
        set((state) => ({
          pendingTransactions: [...state.pendingTransactions, newTransaction],
        }));
        
        return id;
      },

      updatePendingTransaction: (id, updates) => {
        set((state) => ({
          pendingTransactions: state.pendingTransactions.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }));
      },

      removePendingTransaction: (id) => {
        set((state) => ({
          pendingTransactions: state.pendingTransactions.filter((t) => t.id !== id),
        }));
      },

      cacheData: (key, data, ttlMinutes = 60) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
        
        set((state) => ({
          cachedData: {
            ...state.cachedData,
            [key]: {
              key,
              data,
              cachedAt: now.toISOString(),
              expiresAt: expiresAt.toISOString(),
            },
          },
        }));
      },

      getCachedData: <T>(key: string): T | null => {
        const cached = get().cachedData[key];
        if (!cached) return null;
        
        const now = new Date();
        const expiresAt = new Date(cached.expiresAt);
        
        if (now > expiresAt) {
          // Data expired, remove it
          set((state) => {
            const newCache = { ...state.cachedData };
            delete newCache[key];
            return { cachedData: newCache };
          });
          return null;
        }
        
        return cached.data as T;
      },

      clearExpiredCache: () => {
        const now = new Date();
        set((state) => {
          const newCache: Record<string, CachedData> = {};
          Object.entries(state.cachedData).forEach(([key, value]) => {
            if (new Date(value.expiresAt) > now) {
              newCache[key] = value;
            }
          });
          return { cachedData: newCache };
        });
      },

      syncPendingTransactions: async () => {
        const state = get();
        if (state.syncInProgress || !state.isOnline) return;
        
        set({ syncInProgress: true });
        
        const pendingTxns = state.pendingTransactions.filter(
          (t) => t.status === 'pending' || t.status === 'failed'
        );
        
        for (const txn of pendingTxns) {
          try {
            get().updatePendingTransaction(txn.id, { status: 'syncing' });
            
            // Simulate API call - in production, call actual API
            const endpoint = getEndpointForType(txn.type);
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(txn.data),
            });
            
            if (response.ok) {
              get().updatePendingTransaction(txn.id, { status: 'completed' });
              // Remove completed transactions after a delay
              setTimeout(() => {
                get().removePendingTransaction(txn.id);
              }, 5000);
            } else {
              throw new Error(`HTTP ${response.status}`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            get().updatePendingTransaction(txn.id, {
              status: 'failed',
              retryCount: txn.retryCount + 1,
              lastRetryAt: new Date().toISOString(),
              error: errorMessage,
            });
          }
        }
        
        set({ syncInProgress: false });
      },

      getPendingCount: () => {
        return get().pendingTransactions.filter(
          (t) => t.status === 'pending' || t.status === 'failed'
        ).length;
      },
    }),
    {
      name: 'offline-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        pendingTransactions: state.pendingTransactions,
        cachedData: state.cachedData,
        lastOnlineAt: state.lastOnlineAt,
      }),
    }
  )
);

// Helper function to get API endpoint for transaction type
function getEndpointForType(type: PendingTransaction['type']): string {
  const endpoints: Record<string, string> = {
    transfer: '/api/transactions/transfer',
    airtime: '/api/airtime/purchase',
    bill_payment: '/api/bills/pay',
    wallet_fund: '/api/wallet/fund',
  };
  return endpoints[type] || '/api/transactions';
}

// Initialize online/offline listeners
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useOfflineStore.getState().setOnlineStatus(true);
  });
  
  window.addEventListener('offline', () => {
    useOfflineStore.getState().setOnlineStatus(false);
  });
  
  // Clear expired cache on load
  useOfflineStore.getState().clearExpiredCache();
}

// Export hooks for common operations
export const useIsOnline = () => useOfflineStore((state) => state.isOnline);
export const usePendingCount = () => useOfflineStore((state) => state.getPendingCount());
export const useSyncInProgress = () => useOfflineStore((state) => state.syncInProgress);
