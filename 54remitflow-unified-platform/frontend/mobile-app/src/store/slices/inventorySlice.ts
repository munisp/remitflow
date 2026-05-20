import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  reorderLevel: number;
  location: string;
  lastUpdated: string;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
}

interface InventoryState {
  items: InventoryItem[];
  currentItem: InventoryItem | null;
  loading: boolean;
  error: string | null;
  lowStockItems: InventoryItem[];
  outOfStockItems: InventoryItem[];
}

const initialState: InventoryState = {
  items: [],
  currentItem: null,
  loading: false,
  error: null,
  lowStockItems: [],
  outOfStockItems: [],
};

export const fetchInventory = createAsyncThunk('inventory/fetchAll', async () => {
  const response = await ApiService.get('/inventory');
  return response.data;
});

export const updateInventory = createAsyncThunk(
  'inventory/update',
  async ({ id, quantity }: { id: string; quantity: number }) => {
    const response = await ApiService.patch(`/inventory/${id}`, { quantity });
    return response.data;
  }
);

export const syncInventory = createAsyncThunk('inventory/sync', async () => {
  const response = await ApiService.post('/inventory/sync');
  return response.data;
});

const inventorySlice = createSlice({
  name: 'inventory',
  initialState,
  reducers: {
    clearError: (state) => { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchInventory.pending, (state) => { state.loading = true; })
      .addCase(fetchInventory.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload.items;
        state.lowStockItems = action.payload.lowStockItems;
        state.outOfStockItems = action.payload.outOfStockItems;
      })
      .addCase(fetchInventory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch inventory';
      })
      .addCase(updateInventory.fulfilled, (state, action) => {
        const index = state.items.findIndex(i => i.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      });
  },
});

export const { clearError } = inventorySlice.actions;
export default inventorySlice.reducer;

