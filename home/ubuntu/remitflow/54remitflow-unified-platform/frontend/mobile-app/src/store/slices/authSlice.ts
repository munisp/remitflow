/**
 * Authentication Slice with Biometric Support
 * Handles user authentication, session management, and security
 */

import {createSlice, createAsyncThunk, PayloadAction} from '@reduxjs/toolkit';
import {AuthService} from '../../services/AuthService';
import {BiometricService} from '../../services/BiometricService';

export interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
  agentId?: string;
  branchId?: string;
  profileImage?: string;
  lastLogin?: string;
  mfaEnabled: boolean;
  biometricEnabled: boolean;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  sessionExpiry: number | null;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  mfaRequired: boolean;
  loginAttempts: number;
  isLocked: boolean;
  lockUntil: number | null;
}

const initialState: AuthState = {
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  sessionExpiry: null,
  biometricAvailable: false,
  biometricEnabled: false,
  mfaRequired: false,
  loginAttempts: 0,
  isLocked: false,
  lockUntil: null,
};

// Async Thunks
export const login = createAsyncThunk(
  'auth/login',
  async (
    credentials: {username: string; password: string},
    {rejectWithValue}
  ) => {
    try {
      const response = await AuthService.login(credentials);
      return response;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Login failed');
    }
  }
);

export const loginWithBiometric = createAsyncThunk(
  'auth/loginWithBiometric',
  async (_, {rejectWithValue}) => {
    try {
      const biometricResult = await BiometricService.authenticate();
      if (biometricResult.success) {
        const response = await AuthService.loginWithBiometric();
        return response;
      } else {
        throw new Error(biometricResult.error || 'Biometric authentication failed');
      }
    } catch (error: any) {
      return rejectWithValue(error.message || 'Biometric login failed');
    }
  }
);

export const verifyMFA = createAsyncThunk(
  'auth/verifyMFA',
  async (code: string, {rejectWithValue}) => {
    try {
      const response = await AuthService.verifyMFA(code);
      return response;
    } catch (error: any) {
      return rejectWithValue(error.message || 'MFA verification failed');
    }
  }
);

export const refreshAuthToken = createAsyncThunk(
  'auth/refreshToken',
  async (_, {getState, rejectWithValue}) => {
    try {
      const state = getState() as {auth: AuthState};
      const {refreshToken} = state.auth;
      
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await AuthService.refreshToken(refreshToken);
      return response;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Token refresh failed');
    }
  }
);

export const logout = createAsyncThunk(
  'auth/logout',
  async (_, {getState}) => {
    const state = getState() as {auth: AuthState};
    const {token} = state.auth;
    
    if (token) {
      await AuthService.logout(token);
    }
    
    return null;
  }
);

export const enableBiometric = createAsyncThunk(
  'auth/enableBiometric',
  async (_, {rejectWithValue}) => {
    try {
      const isAvailable = await BiometricService.isAvailable();
      if (!isAvailable) {
        throw new Error('Biometric authentication is not available');
      }

      const result = await BiometricService.authenticate();
      if (result.success) {
        await AuthService.enableBiometric();
        return true;
      } else {
        throw new Error(result.error || 'Biometric setup failed');
      }
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to enable biometric');
    }
  }
);

export const disableBiometric = createAsyncThunk(
  'auth/disableBiometric',
  async (_, {rejectWithValue}) => {
    try {
      await AuthService.disableBiometric();
      return false;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to disable biometric');
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: state => {
      state.error = null;
    },
    setMFARequired: (state, action: PayloadAction<boolean>) => {
      state.mfaRequired = action.payload;
    },
    incrementLoginAttempts: state => {
      state.loginAttempts += 1;
      if (state.loginAttempts >= 5) {
        state.isLocked = true;
        state.lockUntil = Date.now() + 30 * 60 * 1000; // Lock for 30 minutes
      }
    },
    resetLoginAttempts: state => {
      state.loginAttempts = 0;
      state.isLocked = false;
      state.lockUntil = null;
    },
    checkLockStatus: state => {
      if (state.isLocked && state.lockUntil && Date.now() > state.lockUntil) {
        state.isLocked = false;
        state.lockUntil = null;
        state.loginAttempts = 0;
      }
    },
    updateSessionExpiry: (state, action: PayloadAction<number>) => {
      state.sessionExpiry = action.payload;
    },
    setBiometricAvailable: (state, action: PayloadAction<boolean>) => {
      state.biometricAvailable = action.payload;
    },
    updateUserProfile: (state, action: PayloadAction<Partial<User>>) => {
      if (state.user) {
        state.user = {...state.user, ...action.payload};
      }
    },
  },
  extraReducers: builder => {
    builder
      // Login
      .addCase(login.pending, state => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
        state.isAuthenticated = true;
        state.sessionExpiry = action.payload.expiresAt;
        state.mfaRequired = action.payload.mfaRequired || false;
        state.loginAttempts = 0;
        state.isLocked = false;
        state.lockUntil = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.loginAttempts += 1;
        if (state.loginAttempts >= 5) {
          state.isLocked = true;
          state.lockUntil = Date.now() + 30 * 60 * 1000;
        }
      })
      
      // Biometric Login
      .addCase(loginWithBiometric.pending, state => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loginWithBiometric.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
        state.isAuthenticated = true;
        state.sessionExpiry = action.payload.expiresAt;
        state.loginAttempts = 0;
      })
      .addCase(loginWithBiometric.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      
      // MFA Verification
      .addCase(verifyMFA.pending, state => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(verifyMFA.fulfilled, (state, action) => {
        state.isLoading = false;
        state.mfaRequired = false;
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
        state.sessionExpiry = action.payload.expiresAt;
      })
      .addCase(verifyMFA.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      
      // Token Refresh
      .addCase(refreshAuthToken.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
        state.sessionExpiry = action.payload.expiresAt;
      })
      .addCase(refreshAuthToken.rejected, state => {
        // Token refresh failed, logout user
        state.user = null;
        state.token = null;
        state.refreshToken = null;
        state.isAuthenticated = false;
        state.sessionExpiry = null;
        state.mfaRequired = false;
      })
      
      // Logout
      .addCase(logout.fulfilled, state => {
        state.user = null;
        state.token = null;
        state.refreshToken = null;
        state.isAuthenticated = false;
        state.sessionExpiry = null;
        state.mfaRequired = false;
        state.error = null;
        state.loginAttempts = 0;
        state.isLocked = false;
        state.lockUntil = null;
      })
      
      // Enable Biometric
      .addCase(enableBiometric.fulfilled, (state, action) => {
        state.biometricEnabled = action.payload;
        if (state.user) {
          state.user.biometricEnabled = action.payload;
        }
      })
      .addCase(enableBiometric.rejected, (state, action) => {
        state.error = action.payload as string;
      })
      
      // Disable Biometric
      .addCase(disableBiometric.fulfilled, (state, action) => {
        state.biometricEnabled = action.payload;
        if (state.user) {
          state.user.biometricEnabled = action.payload;
        }
      })
      .addCase(disableBiometric.rejected, (state, action) => {
        state.error = action.payload as string;
      });
  },
});

export const {
  clearError,
  setMFARequired,
  incrementLoginAttempts,
  resetLoginAttempts,
  checkLockStatus,
  updateSessionExpiry,
  setBiometricAvailable,
  updateUserProfile,
} = authSlice.actions;

export default authSlice.reducer;

// Selectors
export const selectAuth = (state: {auth: AuthState}) => state.auth;
export const selectUser = (state: {auth: AuthState}) => state.auth.user;
export const selectIsAuthenticated = (state: {auth: AuthState}) => state.auth.isAuthenticated;
export const selectIsLoading = (state: {auth: AuthState}) => state.auth.isLoading;
export const selectAuthError = (state: {auth: AuthState}) => state.auth.error;
export const selectMFARequired = (state: {auth: AuthState}) => state.auth.mfaRequired;
export const selectBiometricEnabled = (state: {auth: AuthState}) => state.auth.biometricEnabled;
export const selectIsLocked = (state: {auth: AuthState}) => state.auth.isLocked;
