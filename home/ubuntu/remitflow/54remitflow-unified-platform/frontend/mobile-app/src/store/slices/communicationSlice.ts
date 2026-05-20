import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import ApiService from '../../services/ApiService';

export interface Message {
  id: string;
  type: 'email' | 'sms' | 'whatsapp' | 'push';
  subject?: string;
  content: string;
  recipient: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  sentAt: string;
}

interface CommunicationState {
  messages: Message[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
}

const initialState: CommunicationState = {
  messages: [],
  unreadCount: 0,
  loading: false,
  error: null,
};

export const fetchMessages = createAsyncThunk('communication/fetchAll', async () => {
  const response = await ApiService.get('/messages');
  return response.data;
});

export const sendMessage = createAsyncThunk('communication/send', async (data: Partial<Message>) => {
  const response = await ApiService.post('/messages/send', data);
  return response.data;
});

export const markAsRead = createAsyncThunk('communication/markRead', async (id: string) => {
  const response = await ApiService.patch(`/messages/${id}/read`);
  return response.data;
});

const communicationSlice = createSlice({
  name: 'communication',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMessages.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchMessages.fulfilled, (state, action) => {
        state.loading = false;
        state.messages = action.payload.messages;
        state.unreadCount = action.payload.unreadCount;
      })
      .addCase(fetchMessages.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch messages';
      })
      .addCase(sendMessage.fulfilled, (state, action) => {
        state.messages.unshift(action.payload);
      })
      .addCase(markAsRead.fulfilled, (state, action) => {
        const index = state.messages.findIndex(m => m.id === action.payload.id);
        if (index !== -1) {
          state.messages[index].status = 'read';
          state.unreadCount = Math.max(0, state.unreadCount - 1);
        }
      });
  },
});

export const { clearError } = communicationSlice.actions;
export default communicationSlice.reducer;

