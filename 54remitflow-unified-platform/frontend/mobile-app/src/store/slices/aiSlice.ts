import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Recommendation {
  id: string;
  type: 'product' | 'customer' | 'action';
  title: string;
  description: string;
  confidence: number;
}

interface AIState {
  chatHistory: ChatMessage[];
  recommendations: Recommendation[];
  fraudAlerts: any[];
  loading: boolean;
  error: string | null;
}

const initialState: AIState = {
  chatHistory: [],
  recommendations: [],
  fraudAlerts: [],
  loading: false,
  error: null,
};

export const sendChatMessage = createAsyncThunk('ai/chat', async (message: string) => {
  const response = await ApiService.post('/ai/chat', { message });
  return response.data;
});

export const fetchRecommendations = createAsyncThunk('ai/recommendations', async () => {
  const response = await ApiService.get('/ai/recommendations');
  return response.data;
});

export const checkFraud = createAsyncThunk('ai/fraud-check', async (transactionId: string) => {
  const response = await ApiService.post('/ai/fraud-check', { transactionId });
  return response.data;
});

const aiSlice = createSlice({
  name: 'ai',
  initialState,
  reducers: {
    clearChatHistory: (state) => {
      state.chatHistory = [];
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(sendChatMessage.pending, (state) => {
        state.loading = true;
      })
      .addCase(sendChatMessage.fulfilled, (state, action) => {
        state.loading = false;
        state.chatHistory.push(action.payload.userMessage);
        state.chatHistory.push(action.payload.assistantMessage);
      })
      .addCase(sendChatMessage.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to send message';
      })
      .addCase(fetchRecommendations.fulfilled, (state, action) => {
        state.recommendations = action.payload;
      })
      .addCase(checkFraud.fulfilled, (state, action) => {
        if (action.payload.isFraud) {
          state.fraudAlerts.push(action.payload);
        }
      });
  },
});

export const { clearChatHistory, clearError } = aiSlice.actions;
export default aiSlice.reducer;

