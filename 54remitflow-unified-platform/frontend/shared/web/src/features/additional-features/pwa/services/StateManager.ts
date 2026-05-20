import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

// --- Configuration and Constants ---

/**
 * @constant {number} API_TIMEOUT_MS - Timeout for API calls in milliseconds.
 */
const API_TIMEOUT_MS = 15000;

/**
 * @constant {string} API_BASE_URL - Base URL for the backend API.
 */
const API_BASE_URL = '/api/v1';

// --- Type Definitions for State Structure ---

/**
 * @interface UserProfile
 * Defines the structure for the authenticated user's profile data.
 */
interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isVerified: boolean;
  lastLogin: number; // Unix timestamp
}

/**
 * @interface CDPData
 * Defines the structure for Customer Data Platform (CDP) information.
 */
interface CDPData {
  segment: 'HighValue' | 'Standard' | 'New';
  lifetimeValueUSD: number;
  lastActivity: number; // Unix timestamp
  preferences: Record<string, any>;
}

/**
 * @interface KYCStatus
 * Defines the structure for Know Your Customer (KYC) verification status.
 */
interface KYCStatus {
  level: 0 | 1 | 2; // 0: None, 1: Basic, 2: Full
  status: 'Pending' | 'Approved' | 'Rejected' | 'Required';
  lastSubmission: number | null;
}

/**
 * @interface TransactionSummary
 * Defines the structure for a summary of recent transactions.
 */
interface TransactionSummary {
  totalTransactions: number;
  lastTransactionAmount: number;
  currency: string;
  pendingClearance: number;
}

/**
 * @interface AppState
 * The unified application state structure.
 */
interface AppState {
  user: UserProfile | null;
  cdp: CDPData | null;
  kyc: KYCStatus | null;
  transactions: TransactionSummary | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * @constant {AppState} INITIAL_STATE - The default initial state of the application.
 */
const INITIAL_STATE: AppState = {
  user: null,
  cdp: null,
  kyc: null,
  transactions: null,
  isLoading: false,
  error: null,
};

// --- Type Definitions for State Manager API ---

/**
 * @type {Function} StateUpdateCallback
 * A function type for subscribers to receive state updates.
 * @param {AppState} newState - The new state.
 */
type StateUpdateCallback = (newState: AppState) => void;

/**
 * @interface StateManagerAPI
 * Defines the public interface for the StateManager, to be exposed via React Context.
 */
interface StateManagerAPI {
  state: AppState;
  setState: (partialState: Partial<AppState>) => void;
  subscribe: (callback: StateUpdateCallback) => () => void;
  getUserContext: () => Promise<UserProfile | null>;
  fetchInitialData: () => Promise<void>;
  updateKYCStatus: (newStatus: KYCStatus) => Promise<void>;
  clearState: () => void;
}

// --- State Manager Core Class ---

/**
 * @class StateManager
 * Manages the application state, subscriptions, and backend API interactions.
 * This class is designed to be a singleton within the React Context.
 */
class StateManager {
  private state: AppState;
  private subscribers: Set<StateUpdateCallback>;
  private apiBaseUrl: string;

  constructor(initialState: AppState, apiBaseUrl: string) {
    this.state = initialState;
    this.subscribers = new Set();
    this.apiBaseUrl = apiBaseUrl;
    console.log('StateManager initialized.');
  }

  /**
   * @method getState
   * Retrieves the current state.
   * @returns {AppState} The current application state.
   */
  public getState(): AppState {
    return this.state;
  }

  /**
   * @method setState
   * Updates the state with a partial object and notifies all subscribers.
   * @param {Partial<AppState>} partialState - The part of the state to update.
   */
  public setState(partialState: Partial<AppState>): void {
    const newState = { ...this.state, ...partialState };
    if (JSON.stringify(this.state) !== JSON.stringify(newState)) {
      this.state = newState;
      this.notifySubscribers();
    }
  }

  /**
   * @private
   * @method notifySubscribers
   * Calls all registered subscriber callbacks with the new state.
   */
  private notifySubscribers(): void {
    this.subscribers.forEach(callback => {
      try {
        callback(this.state);
      } catch (error) {
        console.error('Error in state subscriber callback:', error);
      }
    });
  }

  /**
   * @method subscribe
   * Registers a callback function to be called on state changes.
   * @param {StateUpdateCallback} callback - The function to call on state update.
   * @returns {() => void} An unsubscribe function.
   */
  public subscribe(callback: StateUpdateCallback): () => void {
    this.subscribers.add(callback);
    // Immediately call the callback with the current state
    callback(this.state);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * @method clearState
   * Resets the state to its initial value, typically used on logout.
   */
  public clearState(): void {
    this.setState(INITIAL_STATE);
    console.log('Application state cleared.');
  }

  // --- API Integration Methods ---

  /**
   * @private
   * @method apiFetch
   * A robust, type-safe wrapper around the native fetch API with error handling and timeout.
   * @param {string} endpoint - The API endpoint path.
   * @param {RequestInit} options - Fetch request options.
   * @returns {Promise<T>} The parsed JSON response.
   * @template T
   */
  private async apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    this.setState({ isLoading: true, error: null });

    try {
      const url = `${this.apiBaseUrl}${endpoint}`;
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          // Add authorization headers here, e.g., 'Authorization': `Bearer ${token}`
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`API Error ${response.status}: ${errorBody.message}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      let errorMessage = 'An unknown error occurred during API call.';
      if (error instanceof Error) {
        errorMessage = error.message;
        if (error.name === 'AbortError') {
          errorMessage = `API call timed out after ${API_TIMEOUT_MS / 1000}s.`;
        }
      }
      this.setState({ error: errorMessage });
      throw new Error(errorMessage); // Re-throw to allow component-level handling
    } finally {
      // Only set isLoading to false if no other concurrent loading operation is active
      // For simplicity, we'll just set it to false here.
      this.setState({ isLoading: false });
    }
  }

  /**
   * @method fetchInitialData
   * Fetches all core user data (user, CDP, KYC, transactions) in parallel.
   */
  public async fetchInitialData(): Promise<void> {
    console.log('Fetching initial application data...');
    this.setState({ isLoading: true, error: null });

    try {
      const [user, cdp, kyc, transactions] = await Promise.all([
        this.apiFetch<UserProfile>('/user/profile'),
        this.apiFetch<CDPData>('/cdp/data'),
        this.apiFetch<KYCStatus>('/kyc/status'),
        this.apiFetch<TransactionSummary>('/transactions/summary'),
      ]);

      this.setState({
        user,
        cdp,
        kyc,
        transactions,
        isLoading: false,
      });
      console.log('Initial data fetch successful.');
    } catch (error) {
      // Error is already set in apiFetch, just log and re-throw if needed
      console.error('Failed to fetch initial data:', error);
      this.setState({ isLoading: false });
      throw error;
    }
  }

  /**
   * @method getUserContext
   * Retrieves the current user profile from the state.
   * If the profile is null, it attempts to fetch it from the API.
   * @returns {Promise<UserProfile | null>} The user profile or null.
   */
  public async getUserContext(): Promise<UserProfile | null> {
    if (this.state.user) {
      return this.state.user;
    }

    try {
      const user = await this.apiFetch<UserProfile>('/user/profile');
      this.setState({ user });
      return user;
    } catch (error) {
      console.warn('Could not retrieve user context:', error);
      return null;
    }
  }

  /**
   * @method updateKYCStatus
   * Sends an update to the KYC status and updates the local state.
   * @param {KYCStatus} newStatus - The new KYC status object.
   */
  public async updateKYCStatus(newStatus: KYCStatus): Promise<void> {
    console.log('Updating KYC status...');
    try {
      // Simulate a PUT request to the backend
      const updatedStatus = await this.apiFetch<KYCStatus>('/kyc/update', {
        method: 'PUT',
        body: JSON.stringify(newStatus),
      });

      this.setState({ kyc: updatedStatus });
      console.log('KYC status updated successfully.');
    } catch (error) {
      console.error('Failed to update KYC status:', error);
      throw error;
    }
  }
}

// --- React Context Implementation ---

/**
 * @constant {StateManagerAPI} DEFAULT_CONTEXT_VALUE
 * A default, non-functional context value for safety.
 */
const DEFAULT_CONTEXT_VALUE: StateManagerAPI = {
  state: INITIAL_STATE,
  setState: () => {
    throw new Error('StateManagerProvider not found. Must be used within a provider.');
  },
  subscribe: () => {
    throw new Error('StateManagerProvider not found. Must be used within a provider.');
  },
  getUserContext: async () => {
    throw new Error('StateManagerProvider not found. Must be used within a provider.');
  },
  fetchInitialData: async () => {
    throw new Error('StateManagerProvider not found. Must be used within a provider.');
  },
  updateKYCStatus: async () => {
    throw new Error('StateManagerProvider not found. Must be used within a provider.');
  },
  clearState: () => {
    throw new Error('StateManagerProvider not found. Must be used within a provider.');
  },
};

/**
 * @constant {React.Context<StateManagerAPI>} StateContext
 * The React Context object for the StateManager API.
 */
const StateContext = createContext<StateManagerAPI>(DEFAULT_CONTEXT_VALUE);

/**
 * @interface StateManagerProviderProps
 * Props for the StateManagerProvider component.
 */
interface StateManagerProviderProps {
  children: React.ReactNode;
}

/**
 * @component StateManagerProvider
 * The main provider component that instantiates the StateManager and provides
 * the state and actions to the rest of the application via React Context.
 * @param {StateManagerProviderProps} props - Component props.
 */
export const StateManagerProvider: React.FC<StateManagerProviderProps> = ({ children }) => {
  // Use a ref to hold the StateManager instance, ensuring it's a singleton across renders
  const managerRef = React.useRef<StateManager | null>(null);

  if (!managerRef.current) {
    managerRef.current = new StateManager(INITIAL_STATE, API_BASE_URL);
  }

  const manager = managerRef.current;

  // Use a state hook to hold the current state, which will trigger re-renders
  const [state, setInternalState] = useState<AppState>(manager.getState());

  // Effect to subscribe to the manager's state changes
  useEffect(() => {
    const unsubscribe = manager.subscribe(newState => {
      setInternalState(newState);
    });

    // Cleanup function to unsubscribe when the component unmounts
    return () => unsubscribe();
  }, [manager]);

  // Memoize the API object to prevent unnecessary re-renders of consumers
  const api: StateManagerAPI = useMemo(() => ({
    state,
    setState: manager.setState.bind(manager),
    subscribe: manager.subscribe.bind(manager),
    getUserContext: manager.getUserContext.bind(manager),
    fetchInitialData: manager.fetchInitialData.bind(manager),
    updateKYCStatus: manager.updateKYCStatus.bind(manager),
    clearState: manager.clearState.bind(manager),
  }), [state, manager]);

  return (
    <StateContext.Provider value={api}>
      {children}
    </StateContext.Provider>
  );
};

/**
 * @hook useStateManager
 * A custom hook to easily access the StateManager API from any component.
 * @returns {StateManagerAPI} The state and action methods.
 */
export const useStateManager = (): StateManagerAPI => {
  const context = useContext(StateContext);
  if (context === DEFAULT_CONTEXT_VALUE) {
    // This check is redundant if DEFAULT_CONTEXT_VALUE throws, but good for type safety
    throw new Error('useStateManager must be used within a StateManagerProvider');
  }
  return context;
};

// --- Export Types for External Use ---

export type { AppState, UserProfile, CDPData, KYCStatus, TransactionSummary, StateManagerAPI };

// --- Example Usage (Optional, for documentation purposes) ---
/*
// Example of how to use the hook in a component:

import React, { useEffect } from 'react';
import { useStateManager } from './StateManager';

const UserDashboard: React.FC = () => {
  const { state, fetchInitialData, updateKYCStatus, clearState } = useStateManager();

  useEffect(() => {
    // Fetch data when the component mounts
    if (!state.user) {
      fetchInitialData();
    }
  }, [fetchInitialData, state.user]);

  if (state.isLoading) {
    return <div>Loading user data...</div>;
  }

  if (state.error) {
    return <div>Error: {state.error}</div>;
  }

  if (!state.user) {
    return <div>Please log in.</div>;
  }

  const handleKYCUpdate = () => {
    const newStatus = {
      level: 1,
      status: 'Pending' as const,
      lastSubmission: Date.now(),
    };
    updateKYCStatus(newStatus).catch(err => {
      console.error('Update failed in component:', err);
    });
  };

  return (
    <div>
      <h1>Welcome, {state.user.firstName}</h1>
      <p>Email: {state.user.email}</p>
      <p>KYC Status: {state.kyc?.status} (Level {state.kyc?.level})</p>
      <p>CDP Segment: {state.cdp?.segment}</p>
      <p>Total Transactions: {state.transactions?.totalTransactions}</p>
      <button onClick={handleKYCUpdate}>Start KYC Level 1</button>
      <button onClick={clearState}>Logout</button>
    </div>
  );
};
*/
