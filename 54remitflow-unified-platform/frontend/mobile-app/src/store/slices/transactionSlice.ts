import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { TransactionService } from '../../services/TransactionService';

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  customerId: string;
  customerName: string;
  timestamp: string;
  reference: string;
  commission?: number;
}

interface TransactionState {
  transactions: Transaction[];
  currentTransaction: Transaction | null;
  loading: boolean;
  error: string | null;
  totalAmount: number;
  totalCount: number;
}

const initialState: TransactionState = {
  transactions: [],
  currentTransaction: null,
  loading: false,
  error: null,
  totalAmount: 0,
  totalCount: 0,
};

export const fetchTransactions = createAsyncThunk(
  'transaction/fetchAll',
  async (params: { page?: number; limit?: number; status?: string }) => {
    const response = await TransactionService.getTransactions(params);
    return response.data;
  }
);

export const createTransaction = createAsyncThunk(
  'transaction/create',
  async (data: Partial<Transaction>) => {
    const response = await TransactionService.createTransaction(data);
    return response.data;
  }
);

export const getTransactionDetail = createAsyncThunk(
  'transaction/getDetail',
  async (id: string) => {
    const response = await TransactionService.getTransactionById(id);
    return response.data;
  }
);

const transactionSlice = createSlice({
  name: 'transaction',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearCurrentTransaction: (state) => {
      state.currentTransaction = null;
    },
    updateTransaction: (state, action: PayloadAction<Transaction>) => {
      const index = state.transactions.findIndex(t => t.id === action.payload.id);
      if (index !== -1) {
        state.transactions[index] = action.payload;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTransactions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTransactions.fulfilled, (state, action) => {
        state.loading = false;
        state.transactions = action.payload.transactions;
        state.totalAmount = action.payload.totalAmount;
        state.totalCount = action.payload.totalCount;
      })
      .addCase(fetchTransactions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch transactions';
      })
      .addCase(createTransaction.fulfilled, (state, action) => {
        state.transactions.unshift(action.payload);
        state.totalCount += 1;
        state.totalAmount += action.payload.amount;
      })
      .addCase(getTransactionDetail.fulfilled, (state, action) => {
        state.currentTransaction = action.payload;
      });
  },
});

export const { clearError, clearCurrentTransaction, updateTransaction } = transactionSlice.actions;
export default transactionSlice.reducer;

