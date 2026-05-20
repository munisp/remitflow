import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface AnalyticsData {
  totalRevenue: number;
  totalTransactions: number;
  totalCustomers: number;
  totalCommission: number;
  revenueGrowth: number;
  transactionGrowth: number;
  topProducts: Array<{ name: string; sales: number }>;
  revenueByPeriod: Array<{ date: string; amount: number }>;
}

interface AnalyticsState {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  period: 'day' | 'week' | 'month' | 'year';
}

const initialState: AnalyticsState = {
  data: null,
  loading: false,
  error: null,
  period: 'month',
};

export const fetchAnalytics = createAsyncThunk(
  'analytics/fetch',
  async (period: 'day' | 'week' | 'month' | 'year') => {
    const response = await ApiService.get(`/analytics?period=${period}`);
    return response.data;
  }
);

export const fetchSalesAnalytics = createAsyncThunk('analytics/sales', async () => {
  const response = await ApiService.get('/analytics/sales');
  return response.data;
});

export const fetchCustomerAnalytics = createAsyncThunk('analytics/customers', async () => {
  const response = await ApiService.get('/analytics/customers');
  return response.data;
});

const analyticsSlice = createSlice({
  name: 'analytics',
  initialState,
  reducers: {
    setPeriod: (state, action) => {
      state.period = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAnalytics.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchAnalytics.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchAnalytics.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch analytics';
      });
  },
});

export const { setPeriod, clearError } = analyticsSlice.actions;
export default analyticsSlice.reducer;

