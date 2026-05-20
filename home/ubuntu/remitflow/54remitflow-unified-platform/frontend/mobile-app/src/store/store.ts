/**
 * Redux Store Configuration with Offline Support
 * Includes persistence, middleware, and offline queue management
 */

import {configureStore, combineReducers} from '@reduxjs/toolkit';
import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Reducers
import authReducer from './slices/authSlice';
import transactionReducer from './slices/transactionSlice';
import customerReducer from './slices/customerSlice';
import offlineReducer from './slices/offlineSlice';
import notificationReducer from './slices/notificationSlice';
import settingsReducer from './slices/settingsSlice';
import syncReducer from './slices/syncSlice';

// Middleware
import {offlineMiddleware} from './middleware/offlineMiddleware';
import {syncMiddleware} from './middleware/syncMiddleware';

const rootReducer = combineReducers({
  auth: authReducer,
  transactions: transactionReducer,
  customers: customerReducer,
  offline: offlineReducer,
  notifications: notificationReducer,
  settings: settingsReducer,
  sync: syncReducer,
});

const persistConfig = {
  key: 'root',
  version: 1,
  storage: AsyncStorage,
  whitelist: [
    'auth',
    'transactions',
    'customers',
    'offline',
    'settings',
    'sync',
  ], // Only persist these reducers
  blacklist: ['notifications'], // Don't persist notifications
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    })
      .concat(offlineMiddleware)
      .concat(syncMiddleware),
  devTools: __DEV__,
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
