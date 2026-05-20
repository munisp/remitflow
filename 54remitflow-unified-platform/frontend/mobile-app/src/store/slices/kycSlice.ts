import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface KYCDocument {
  id: string;
  type: 'id_card' | 'passport' | 'drivers_license' | 'utility_bill';
  documentNumber: string;
  status: 'pending' | 'verified' | 'rejected';
  uploadedAt: string;
  verifiedAt?: string;
  rejectionReason?: string;
}

interface KYCState {
  documents: KYCDocument[];
  kycStatus: 'not_started' | 'pending' | 'verified' | 'rejected';
  loading: boolean;
  error: string | null;
}

const initialState: KYCState = {
  documents: [],
  kycStatus: 'not_started',
  loading: false,
  error: null,
};

export const fetchKYCStatus = createAsyncThunk('kyc/fetchStatus', async () => {
  const response = await ApiService.get('/kyc/status');
  return response.data;
});

export const uploadKYCDocument = createAsyncThunk(
  'kyc/uploadDocument',
  async (data: FormData) => {
    const response = await ApiService.post('/kyc/upload', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }
);

export const submitKYC = createAsyncThunk('kyc/submit', async () => {
  const response = await ApiService.post('/kyc/submit');
  return response.data;
});

const kycSlice = createSlice({
  name: 'kyc',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchKYCStatus.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchKYCStatus.fulfilled, (state, action) => {
        state.loading = false;
        state.kycStatus = action.payload.status;
        state.documents = action.payload.documents;
      })
      .addCase(fetchKYCStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch KYC status';
      })
      .addCase(uploadKYCDocument.fulfilled, (state, action) => {
        state.documents.push(action.payload);
      })
      .addCase(submitKYC.fulfilled, (state) => {
        state.kycStatus = 'pending';
      });
  },
});

export const { clearError } = kycSlice.actions;
export default kycSlice.reducer;

