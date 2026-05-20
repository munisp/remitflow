import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { CustomerService } from '../../services/CustomerService';

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  kycStatus: 'pending' | 'verified' | 'rejected';
  totalTransactions: number;
  totalVolume: number;
  createdAt: string;
}

interface CustomerState {
  customers: Customer[];
  currentCustomer: Customer | null;
  loading: boolean;
  error: string | null;
  searchResults: Customer[];
}

const initialState: CustomerState = {
  customers: [],
  currentCustomer: null,
  loading: false,
  error: null,
  searchResults: [],
};

export const fetchCustomers = createAsyncThunk(
  'customer/fetchAll',
  async (params?: { page?: number; limit?: number }) => {
    const response = await CustomerService.getCustomers(params);
    return response.data;
  }
);

export const searchCustomers = createAsyncThunk(
  'customer/search',
  async (query: string) => {
    const response = await CustomerService.searchCustomers(query);
    return response.data;
  }
);

export const createCustomer = createAsyncThunk(
  'customer/create',
  async (data: Partial<Customer>) => {
    const response = await CustomerService.createCustomer(data);
    return response.data;
  }
);

const customerSlice = createSlice({
  name: 'customer',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearSearchResults: (state) => {
      state.searchResults = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCustomers.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchCustomers.fulfilled, (state, action) => {
        state.loading = false;
        state.customers = action.payload;
      })
      .addCase(fetchCustomers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch customers';
      })
      .addCase(searchCustomers.fulfilled, (state, action) => {
        state.searchResults = action.payload;
      })
      .addCase(createCustomer.fulfilled, (state, action) => {
        state.customers.unshift(action.payload);
      });
  },
});

export const { clearError, clearSearchResults } = customerSlice.actions;
export default customerSlice.reducer;

