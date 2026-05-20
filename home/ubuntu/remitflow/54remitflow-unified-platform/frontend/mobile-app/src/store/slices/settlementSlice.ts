import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface Settlement {
  id: string;
  batchId: string;
  agentId: string;
  amount: number;
  commissionAmount: number;
  status: 'pending' | 'approved' | 'processing' | 'completed' | 'failed';
  method: 'bank' | 'mobile_money' | 'wallet' | 'cash';
  scheduledDate: string;
  completedDate?: string;
}

interface SettlementState {
  settlements: Settlement[];
  currentSettlement: Settlement | null;
  loading: boolean;
  error: string | null;
  pendingAmount: number;
  completedAmount: number;
}

const initialState: SettlementState = {
  settlements: [],
  currentSettlement: null,
  loading: false,
  error: null,
  pendingAmount: 0,
  completedAmount: 0,
};

export const fetchSettlements = createAsyncThunk('settlement/fetchAll', async () => {
  const response = await ApiService.get('/settlements');
  return response.data;
});

export const requestSettlement = createAsyncThunk('settlement/request', async (data: Partial<Settlement>) => {
  const response = await ApiService.post('/settlements/request', data);
  return response.data;
});

export const fetchSettlementDetail = createAsyncThunk('settlement/fetchDetail', async (id: string) => {
  const response = await ApiService.get(`/settlements/${id}`);
  return response.data;
});

const settlementSlice = createSlice({
  name: 'settlement',
  initialState,
  reducers: {
    clearError: (state) => { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSettlements.pending, (state) => { state.loading = true; })
      .addCase(fetchSettlements.fulfilled, (state, action) => {
        state.loading = false;
        state.settlements = action.payload.settlements;
        state.pendingAmount = action.payload.pendingAmount;
        state.completedAmount = action.payload.completedAmount;
      })
      .addCase(fetchSettlements.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch settlements';
      })
      .addCase(requestSettlement.fulfilled, (state, action) => {
        state.settlements.unshift(action.payload);
      })
      .addCase(fetchSettlementDetail.fulfilled, (state, action) => {
        state.currentSettlement = action.payload;
      });
  },
});

export const { clearError } = settlementSlice.actions;
export default settlementSlice.reducer;

