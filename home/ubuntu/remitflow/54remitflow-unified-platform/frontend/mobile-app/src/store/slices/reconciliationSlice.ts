import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface Reconciliation {
  id: string;
  date: string;
  totalTransactions: number;
  matchedTransactions: number;
  discrepancies: number;
  status: 'pending' | 'in_progress' | 'completed';
  discrepancyAmount: number;
}

interface ReconciliationState {
  reconciliations: Reconciliation[];
  currentReconciliation: Reconciliation | null;
  loading: boolean;
  error: string | null;
  totalDiscrepancies: number;
}

const initialState: ReconciliationState = {
  reconciliations: [],
  currentReconciliation: null,
  loading: false,
  error: null,
  totalDiscrepancies: 0,
};

export const fetchReconciliations = createAsyncThunk('reconciliation/fetchAll', async () => {
  const response = await ApiService.get('/reconciliations');
  return response.data;
});

export const runReconciliation = createAsyncThunk('reconciliation/run', async (date: string) => {
  const response = await ApiService.post('/reconciliations/run', { date });
  return response.data;
});

const reconciliationSlice = createSlice({
  name: 'reconciliation',
  initialState,
  reducers: {
    clearError: (state) => { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReconciliations.pending, (state) => { state.loading = true; })
      .addCase(fetchReconciliations.fulfilled, (state, action) => {
        state.loading = false;
        state.reconciliations = action.payload.reconciliations;
        state.totalDiscrepancies = action.payload.totalDiscrepancies;
      })
      .addCase(fetchReconciliations.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch reconciliations';
      })
      .addCase(runReconciliation.fulfilled, (state, action) => {
        state.currentReconciliation = action.payload;
        state.reconciliations.unshift(action.payload);
      });
  },
});

export const { clearError } = reconciliationSlice.actions;
export default reconciliationSlice.reducer;

