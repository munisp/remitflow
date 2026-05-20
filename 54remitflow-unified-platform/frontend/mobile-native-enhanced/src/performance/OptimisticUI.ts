// OptimisticUI.ts - Instant Feedback System
// Makes app feel 10x faster

import { Platform, Vibration } from 'react-native';
import HapticManager from '../utils/HapticManager';

interface OptimisticUpdate {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  status: 'pending' | 'success' | 'error';
  rollbackData?: any;
}

interface Transaction {
  id: string;
  amount: number;
  recipient: string;
  status: 'pending' | 'completed' | 'failed';
}

class OptimisticUI {
  private static instance: OptimisticUI;
  private pendingUpdates: Map<string, OptimisticUpdate> = new Map();
  private updateCallbacks: Map<string, Function[]> = new Map();

  static getInstance(): OptimisticUI {
    if (!OptimisticUI.instance) {
      OptimisticUI.instance = new OptimisticUI();
    }
    return OptimisticUI.instance;
  }

  async performOptimisticUpdate<T>(
    updateId: string,
    optimisticData: T,
    apiCall: () => Promise<T>,
    rollbackData?: T
  ): Promise<T> {
    // 1. Immediately update UI with optimistic data
    this.applyOptimisticUpdate(updateId, optimisticData, rollbackData);
    
    // 2. Provide haptic feedback
    this.provideHapticFeedback('start');

    try {
      // 3. Make actual API call in background
      const result = await apiCall();
      
      // 4. Mark as success
      this.markSuccess(updateId);
      this.provideHapticFeedback('success');
      
      return result;
    } catch (error) {
      // 5. Rollback on error
      this.rollback(updateId);
      this.provideHapticFeedback('error');
      
      throw error;
    }
  }

  private applyOptimisticUpdate(updateId: string, data: any, rollbackData?: any): void {
    const update: OptimisticUpdate = {
      id: updateId,
      type: 'update',
      data,
      timestamp: Date.now(),
      status: 'pending',
      rollbackData,
    };

    this.pendingUpdates.set(updateId, update);
    this.notifySubscribers(updateId, data);
    
    console.log('[OPTIMISTIC] Applied update:', updateId);
  }

  private markSuccess(updateId: string): void {
    const update = this.pendingUpdates.get(updateId);
    if (update) {
      update.status = 'success';
      this.pendingUpdates.delete(updateId);
      console.log('[OPTIMISTIC] Update succeeded:', updateId);
    }
  }

  private rollback(updateId: string): void {
    const update = this.pendingUpdates.get(updateId);
    if (update && update.rollbackData) {
      update.status = 'error';
      this.notifySubscribers(updateId, update.rollbackData);
      this.pendingUpdates.delete(updateId);
      console.log('[OPTIMISTIC] Rolled back:', updateId);
    }
  }

  private provideHapticFeedback(type: 'start' | 'success' | 'error'): void {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      switch (type) {
        case 'start':
          HapticManager.light();
          break;
        case 'success':
          HapticManager.success();
          break;
        case 'error':
          HapticManager.error();
          break;
      }
    }
  }

  subscribe(updateId: string, callback: Function): () => void {
    if (!this.updateCallbacks.has(updateId)) {
      this.updateCallbacks.set(updateId, []);
    }
    
    this.updateCallbacks.get(updateId)!.push(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.updateCallbacks.get(updateId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  private notifySubscribers(updateId: string, data: any): void {
    const callbacks = this.updateCallbacks.get(updateId);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  // Transaction-specific optimistic update
  async sendMoneyOptimistically(
    transaction: Transaction,
    apiCall: () => Promise<Transaction>
  ): Promise<Transaction> {
    const updateId = `transaction_${transaction.id}`;
    
    // Show pending state immediately
    const optimisticTransaction: Transaction = {
      ...transaction,
      status: 'pending',
    };

    return this.performOptimisticUpdate(
      updateId,
      optimisticTransaction,
      apiCall,
      { ...transaction, status: 'failed' }
    );
  }

  // Balance update optimistically
  async updateBalanceOptimistically(
    currentBalance: number,
    change: number,
    apiCall: () => Promise<number>
  ): Promise<number> {
    const updateId = 'balance_update';
    const optimisticBalance = currentBalance + change;

    return this.performOptimisticUpdate(
      updateId,
      optimisticBalance,
      apiCall,
      currentBalance
    );
  }

  getPendingUpdates(): OptimisticUpdate[] {
    return Array.from(this.pendingUpdates.values());
  }

  hasPendingUpdates(): boolean {
    return this.pendingUpdates.size > 0;
  }
}

export default OptimisticUI.getInstance();
