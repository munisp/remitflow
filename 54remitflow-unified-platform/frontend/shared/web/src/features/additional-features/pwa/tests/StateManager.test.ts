import { StateManager, AppState } from './StateManager';

// Mock the API service to control its behavior during tests
const mockApiService = {
  fetchUserContext: jest.fn(),
};

// Define a clean initial state for tests
const TEST_INITIAL_STATE: AppState = {
  userContext: {
    id: null,
    username: null,
    isAuthenticated: false,
    role: 'guest',
  },
  settings: {
    theme: 'light',
    notificationsEnabled: true,
  },
  loading: false,
  error: null,
};

describe('StateManager', () => {
  let stateManager: StateManager;

  // Setup: Create a new StateManager instance before each test
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    // Create a new instance with the mock service and initial state
    stateManager = new StateManager(TEST_INITIAL_STATE, mockApiService as any);
  });

  // Test 1: Initialization and getState
  it('should initialize with the correct initial state and return it via getState', () => {
    expect(stateManager.getState()).toEqual(TEST_INITIAL_STATE);
  });

  // Test 2: getUserContext
  it('should correctly return the user context via getUserContext', () => {
    expect(stateManager.getUserContext()).toEqual(TEST_INITIAL_STATE.userContext);
  });

  // Test 3: setState - basic update
  it('should update the state correctly using setState', () => {
    const newStatePartial = { loading: true, error: 'Test Error' };
    stateManager.setState(newStatePartial);

    const currentState = stateManager.getState();
    expect(currentState.loading).toBe(true);
    expect(currentState.error).toBe('Test Error');
    expect(currentState.userContext).toEqual(TEST_INITIAL_STATE.userContext); // Check other properties are unchanged
  });

  // Test 4: setState - nested object update (shallow merge)
  it('should perform a shallow merge when updating nested objects like settings', () => {
    const newSettings = { theme: 'dark' as const };
    stateManager.setState({ settings: newSettings });

    const currentState = stateManager.getState();
    // The entire 'settings' object is replaced
    expect(currentState.settings).toEqual(newSettings);
    // Other top-level properties are preserved
    expect(currentState.loading).toBe(false);
  });

  // Test 5: subscribe - listener is called on state change
  it('should notify all subscribed listeners when state changes', () => {
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    stateManager.subscribe(listener1);
    stateManager.subscribe(listener2);

    const newStatePartial = { loading: true };
    stateManager.setState(newStatePartial);

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    const expectedNewState = { ...TEST_INITIAL_STATE, ...newStatePartial };
    // Check listener arguments: (newState, oldState)
    expect(listener1).toHaveBeenCalledWith(expectedNewState, TEST_INITIAL_STATE);
  });

  // Test 6: subscribe - listener is NOT called if state is unchanged (edge case)
  it('should NOT notify listeners if setState is called with the current state', () => {
    const listener = jest.fn();
    stateManager.subscribe(listener);

    // Call setState with a value that is already the current value
    stateManager.setState({ loading: false });

    expect(listener).not.toHaveBeenCalled();
  });

  // Test 7: unsubscribe - listener is removed
  it('should stop notifying a listener after it has unsubscribed', () => {
    const listener = jest.fn();
    const unsubscribe = stateManager.subscribe(listener);

    // First update: listener should be called
    stateManager.setState({ loading: true });
    expect(listener).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsubscribe();

    // Second update: listener should NOT be called
    stateManager.setState({ error: 'New Error' });
    expect(listener).toHaveBeenCalledTimes(1); // Still 1
  });

  // Test 8-10: fetchAndUpdateUserContext - API call scenarios
  describe('fetchAndUpdateUserContext', () => {
    const mockUserContext = {
      id: '123',
      username: 'testuser',
      isAuthenticated: true,
      role: 'user' as const,
    };

    beforeEach(() => {
      // Mock successful API response
      mockApiService.fetchUserContext.mockResolvedValue(mockUserContext);
    });

    // Test 8: Success scenario
    it('should set loading to true, call API, update user context, and set loading to false on success', async () => {
      const listener = jest.fn();
      stateManager.subscribe(listener);

      const promise = stateManager.fetchAndUpdateUserContext('123');

      // 1. Check state immediately after call (loading: true)
      expect(stateManager.getState().loading).toBe(true);
      expect(stateManager.getState().error).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1); // Called for loading: true

      await promise;

      // 2. Check state after API resolves (loading: false, new userContext)
      const finalState = stateManager.getState();
      expect(finalState.loading).toBe(false);
      expect(finalState.error).toBeNull();
      expect(finalState.userContext).toEqual(mockUserContext);
      expect(mockApiService.fetchUserContext).toHaveBeenCalledWith('123');
      expect(listener).toHaveBeenCalledTimes(2); // Called for loading: true, and for userContext update
    });

    // Test 9: Error scenario
    it('should set loading to true, handle API error, set error state, and set loading to false on failure', async () => {
      const apiError = new Error('API fetch failed');
      mockApiService.fetchUserContext.mockRejectedValue(apiError);

      const listener = jest.fn();
      stateManager.subscribe(listener);

      // Expect the function to re-throw the error
      await expect(stateManager.fetchAndUpdateUserContext('error')).rejects.toThrow('API fetch failed');

      // 1. Check state immediately after call (loading: true)
      expect(stateManager.getState().loading).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1); // Called for loading: true

      // 2. Check state after API rejects (loading: false, error set)
      const finalState = stateManager.getState();
      expect(finalState.loading).toBe(false);
      expect(finalState.error).toBe('API fetch failed');
      expect(finalState.userContext).toEqual(TEST_INITIAL_STATE.userContext); // User context should be unchanged
      expect(listener).toHaveBeenCalledTimes(2); // Called for loading: true, and for error/loading: false update
    });

    // Test 10: Edge case - unknown error type from API
    it('should handle non-Error object rejections gracefully', async () => {
      mockApiService.fetchUserContext.mockRejectedValue('A string error');

      await expect(stateManager.fetchAndUpdateUserContext('unknown')).rejects.toBe('A string error');

      const finalState = stateManager.getState();
      expect(finalState.loading).toBe(false);
      expect(finalState.error).toBe('An unknown error occurred');
    });
  });

  // Test 11: Edge case - multiple subscriptions and updates
  it('should handle multiple subscriptions and sequential updates correctly', () => {
    const listenerA = jest.fn();
    const listenerB = jest.fn();

    const unsubscribeA = stateManager.subscribe(listenerA);
    stateManager.subscribe(listenerB);

    // Update 1
    stateManager.setState({ loading: true });
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    // Update 2
    stateManager.setState({ error: 'Error 1' });
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).toHaveBeenCalledTimes(2);

    // Unsubscribe A
    unsubscribeA();

    // Update 3
    stateManager.setState({ error: 'Error 2' });
    expect(listenerA).toHaveBeenCalledTimes(2); // Should not be called again
    expect(listenerB).toHaveBeenCalledTimes(3);
  });

  // Test 12: Edge case - initial state deep copy
  it('should ensure the internal state is a deep copy of the initial state', () => {
    const externalState = { ...TEST_INITIAL_STATE };
    const manager = new StateManager(externalState, mockApiService as any);

    // Mutate the external object
    externalState.loading = true;

    // Check that the internal state is unchanged
    expect(manager.getState().loading).toBe(false);
  });
});