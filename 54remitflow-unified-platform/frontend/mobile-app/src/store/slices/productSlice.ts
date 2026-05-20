import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  images: string[];
  rating: number;
}

interface ProductState {
  products: Product[];
  categories: string[];
  currentProduct: Product | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductState = {
  products: [],
  categories: [],
  currentProduct: null,
  loading: false,
  error: null,
};

export const fetchProducts = createAsyncThunk('product/fetchAll', async () => {
  const response = await ApiService.get('/products');
  return response.data;
});

export const fetchProductById = createAsyncThunk('product/fetchById', async (id: string) => {
  const response = await ApiService.get(`/products/${id}`);
  return response.data;
});

export const searchProducts = createAsyncThunk('product/search', async (query: string) => {
  const response = await ApiService.get(`/products/search?q=${query}`);
  return response.data;
});

const productSlice = createSlice({
  name: 'product',
  initialState,
  reducers: {
    clearError: (state) => { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProducts.pending, (state) => { state.loading = true; })
      .addCase(fetchProducts.fulfilled, (state, action) => {
        state.loading = false;
        state.products = action.payload.products;
        state.categories = action.payload.categories;
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch products';
      })
      .addCase(fetchProductById.fulfilled, (state, action) => {
        state.currentProduct = action.payload;
      });
  },
});

export const { clearError } = productSlice.actions;
export default productSlice.reducer;
