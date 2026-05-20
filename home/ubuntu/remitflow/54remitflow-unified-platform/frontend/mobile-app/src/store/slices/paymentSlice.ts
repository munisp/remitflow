import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface Payment {
  id: string;
  transactionId: string;
  amount: number;
  method: 'card' | 'bank' | 'mobile_money' | 'wallet' | 'cash' | 'qr';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  reference: string;
  createdAt: string;
  completedAt?: string;
}

interface PaymentState {
  payments: Payment[];
  currentPayment: Payment | null;
  loading: boolean;
  error: string | null;
  paymentMethods: string[];
}

const initialState: PaymentState = {
  payments: [],
  currentPayment: null,
  loading: false,
  error: null,
  paymentMethods: ['card', 'bank', 'mobile_money', 'wallet', 'cash', 'qr'],
};

export const fetchPayments = createAsyncThunk('payment/fetchAll', async () => {
  const response = await ApiService.get('/payments');
  return response.data;
});

export const processPayment = createAsyncThunk('payment/process', async (data: Partial<Payment>) => {
  const response = await ApiService.post('/payments/process', data);
  return response.data;
});

export const verifyPayment = createAsyncThunk('payment/verify', async (reference: string) => {
  const response = await ApiService.get(`/payments/verify/${reference}`);
  return response.data;
});

const paymentSlice = createSlice({
  name: 'payment',
  initialState,
  reducers: {
    clearError: (state) => { state.error = null; },
    clearCurrentPayment: (state) => { state.currentPayment = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPayments.pending, (state) => { state.loading = true; })
      .addCase(fetchPayments.fulfilled, (state, action) => {
        state.loading = false;
        state.payments = action.payload;
      })
      .addCase(fetchPayments.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch payments';
      })
      .addCase(processPayment.fulfilled, (state, action) => {
        state.currentPayment = action.payload;
        state.payments.unshift(action.payload);
      })
      .addCase(verifyPayment.fulfilled, (state, action) => {
        const index = state.payments.findIndex(p => p.reference === action.payload.reference);
        if (index !== -1) {
          state.payments[index] = action.payload;
        }
      });
  },
});

export const { clearError, clearCurrentPayment } = paymentSlice.actions;
export default paymentSlice.reducer;

