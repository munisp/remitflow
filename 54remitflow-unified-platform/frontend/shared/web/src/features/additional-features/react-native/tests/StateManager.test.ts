import React, { useContext } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react-native';
import { StateProvider, useAppState, StateContext } from '../StateManager'; // Hypothetical path
import { fetchUserData } from '../api'; // Hypothetical API service

// --- Mocks ---

// 1. Mock the API service
jest.mock('../api', () => ({
  fetchUserData: jest.fn(),
}));

// 2. Mock the StateManager module to ensure we can test the context directly if needed,
//    but for this test, we'll focus on the hook and provider.
//    We'll assume StateManager.ts exports the Provider and the Hook.

// --- Test Component for Hook Consumption ---

// A simple component to consume the hook and display the state and actions
const TestComponent = () => {
  const { state, actions } = useAppState();

  return (
    <>
      <screen.Text testID="data">{state.data ? state.data.name : 'No Data'}</screen.Text>
      <screen.Text testID="loading">{state.isLoading ? 'Loading' : 'Not Loading'}</screen.Text>
      <screen.Text testID="error">{state.error || 'No Error'}</screen.Text>
      <screen.Button
        testID="fetch-button"
        onPress={() => actions.fetchUser(1)}
        title="Fetch User"
      />
      <screen.Button
        testID="clear-button"
        onPress={actions.clearState}
        title="Clear State"
      />
      <screen.Button
        testID="update-button"
        onPress={() => actions.updateLocalData('New Local Data')}
        title="Update Local"
      />
    </>
  );
};

// --- Test Component for Context Consumption (Edge Case: Outside Provider) ---

// A component to test direct context access (for testing the 'outside provider' error)
const ContextConsumer = () => {
  const context = useContext(StateContext);
  if (!context) {
    return <screen.Text testID="context-error">Context Error</screen.Text>;
  }
  return <screen.Text testID="context-success">Context Success</screen.Text>;
};

// --- Setup/Teardown ---

beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

// --- Test Suite ---

describe('StateManager Context and Hook Tests', () => {
  // Edge Case 1: Testing useAppState hook outside of the provider
  it('should throw an error when useAppState is called outside of StateProvider', () => {
    // Suppress console.error for this specific test to keep the output clean
    const consoleError = console.error;
    console.error = jest.fn();

    // We expect a specific error to be thrown when rendering the hook outside the provider
    expect(() => render(<TestComponent />)).toThrow(
      'useAppState must be used within a StateProvider',
    );

    // Restore console.error
    console.error = consoleError;
  });

  // Test 1: Initial state check
  it('should render with correct initial state', () => {
    render(
      <StateProvider>
        <TestComponent />
      </StateProvider>,
    );

    expect(screen.getByTestId('data').props.children).toBe('No Data');
    expect(screen.getByTestId('loading').props.children).toBe('Not Loading');
    expect(screen.getByTestId('error').props.children).toBe('No Error');
  });

  // Test 2: Local state update (non-API action)
  it('should update local state correctly via action', () => {
    render(
      <StateProvider>
        <TestComponent />
      </StateProvider>,
    );

    const updateButton = screen.getByTestId('update-button');
    act(() => {
      updateButton.props.onPress();
    });

    expect(screen.getByTestId('data').props.children).toBe('New Local Data');
  });

  // Test 3: API call success scenario
  it('should fetch user data successfully and update state', async () => {
    const mockUser = { id: 1, name: 'John Doe', email: 'john@example.com' };
    (fetchUserData as jest.Mock).mockResolvedValue(mockUser);

    render(
      <StateProvider>
        <TestComponent />
      </StateProvider>,
    );

    const fetchButton = screen.getByTestId('fetch-button');

    // 1. Initial state check (already done in Test 1, but good to re-verify)
    expect(screen.getByTestId('loading').props.children).toBe('Not Loading');

    // 2. Trigger the API call
    act(() => {
      fetchButton.props.onPress();
    });

    // 3. Check loading state immediately after call
    expect(screen.getByTestId('loading').props.children).toBe('Loading');
    expect(fetchUserData).toHaveBeenCalledWith(1);

    // 4. Wait for the API call to resolve and state to update
    await waitFor(() => {
      expect(screen.getByTestId('loading').props.children).toBe('Not Loading');
      expect(screen.getByTestId('data').props.children).toBe('John Doe');
      expect(screen.getByTestId('error').props.children).toBe('No Error');
    });
  });

  // Test 4: API call error scenario
  it('should handle API error and update error state', async () => {
    const mockError = 'Failed to fetch user data';
    (fetchUserData as jest.Mock).mockRejectedValue(new Error(mockError));

    render(
      <StateProvider>
        <TestComponent />
      </StateProvider>,
    );

    const fetchButton = screen.getByTestId('fetch-button');

    // 1. Trigger the API call
    act(() => {
      fetchButton.props.onPress();
    });

    // 2. Check loading state
    expect(screen.getByTestId('loading').props.children).toBe('Loading');

    // 3. Wait for the API call to reject and state to update
    await waitFor(() => {
      expect(screen.getByTestId('loading').props.children).toBe('Not Loading');
      expect(screen.getByTestId('data').props.children).toBe('No Data');
      expect(screen.getByTestId('error').props.children).toBe(mockError);
    });
  });

  // Test 5: Clear state action
  it('should clear the state back to initial values', async () => {
    const mockUser = { id: 1, name: 'John Doe', email: 'john@example.com' };
    (fetchUserData as jest.Mock).mockResolvedValue(mockUser);

    render(
      <StateProvider>
        <TestComponent />
      </StateProvider>,
    );

    const fetchButton = screen.getByTestId('fetch-button');
    const clearButton = screen.getByTestId('clear-button');

    // 1. Populate state first (success scenario)
    act(() => {
      fetchButton.props.onPress();
    });
    await waitFor(() => {
      expect(screen.getByTestId('data').props.children).toBe('John Doe');
    });

    // 2. Clear the state
    act(() => {
      clearButton.props.onPress();
    });

    // 3. Verify state is cleared
    expect(screen.getByTestId('data').props.children).toBe('No Data');
    expect(screen.getByTestId('loading').props.children).toBe('Not Loading');
    expect(screen.getByTestId('error').props.children).toBe('No Error');
  });

  // Test 6: Testing Context value existence (ensuring provider works)
  it('should provide a non-null context value', () => {
    render(
      <StateProvider>
        <ContextConsumer />
      </StateProvider>,
    );

    expect(screen.getByTestId('context-success')).toBeOnTheScreen();
    expect(screen.queryByTestId('context-error')).toBeNull();
  });

  // Edge Case 2: Testing consecutive API calls (ensuring state is reset/updated correctly)
  it('should handle consecutive API calls correctly', async () => {
    const mockUser1 = { id: 1, name: 'User One' };
    const mockUser2 = { id: 2, name: 'User Two' };

    // Mock the API to resolve differently on subsequent calls
    (fetchUserData as jest.Mock)
      .mockResolvedValueOnce(mockUser1)
      .mockResolvedValueOnce(mockUser2);

    render(
      <StateProvider>
        <TestComponent />
      </StateProvider>,
    );

    const fetchButton = screen.getByTestId('fetch-button');

    // 1. First call
    act(() => {
      fetchButton.props.onPress();
    });
    await waitFor(() => {
      expect(screen.getByTestId('data').props.children).toBe('User One');
    });

    // 2. Second call
    act(() => {
      fetchButton.props.onPress();
    });
    await waitFor(() => {
      expect(screen.getByTestId('data').props.children).toBe('User Two');
    });
  });
});