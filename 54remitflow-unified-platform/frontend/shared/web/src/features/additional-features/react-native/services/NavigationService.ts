/**
 * @file NavigationService.ts
 * @description A centralized, type-safe navigation service for React Native applications
 *              using React Navigation (v6+). It utilizes a ref-based approach to
 *              allow navigation from outside of React components, such as from Redux
 *              actions, sagas, or other non-component services.
 *
 * @author Manus AI
 * @version 1.0.0
 * @license MIT
 */

import * as React from 'react';
import {
  createNavigationContainerRef,
  NavigationAction,
  ParamListBase,
} from '@react-navigation/native';

// --- Type Definitions ---

/**
 * Defines the complete list of routes and their expected parameters for the application.
 * This ensures type safety across the entire navigation service.
 *
 * NOTE: For a real-world application, this list would be much larger.
 * The parameters here are illustrative of the data passed during navigation.
 */
export type RootStackParamList = {
  // Core Application Routes
  Home: undefined;
  Settings: undefined;
  Profile: { userId: string };

  // Transaction Flow Routes
  TransactionDetail: { transactionId: string; type: 'deposit' | 'withdrawal' };
  TransactionConfirmation: { transactionId: string; amount: number };

  // KYC/Upgrade Flow Routes
  KYCStart: undefined;
  KYCUpload: { step: number };
  KYCReview: { submissionId: string };
  KYCUpgradeSuccess: { message: string };

  // Generic/Utility Routes
  ErrorScreen: { title: string; message: string; retryAction?: () => void };
  ModalScreen: { content: React.ReactNode };
};

/**
 * The navigation ref object, which holds the state of the navigation container.
 * This is the core mechanism for navigating outside of components.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// --- Utility Functions ---

/**
 * A utility function to safely check if the navigation container is ready.
 * @returns {boolean} True if the navigation ref is mounted and ready to navigate.
 */
const isReady = (): boolean => {
  return navigationRef.isReady();
};

/**
 * Handles a navigation action, ensuring the navigation container is ready.
 * @param {() => void} action - The navigation action to execute.
 * @param {string} methodName - The name of the method calling this utility for logging.
 */
const safeNavigate = (action: () => void, methodName: string): void => {
  if (isReady()) {
    try {
      action();
    } catch (error) {
      console.error(`[NavigationService] Error in ${methodName}:`, error);
      // Optionally navigate to a generic error screen on failure
      // navigate('ErrorScreen', { title: 'Navigation Failed', message: 'Could not complete navigation action.' });
    }
  } else {
    console.warn(
      `[NavigationService] Navigation ref is not ready. Cannot execute ${methodName}.`
    );
    // In a production app, you might queue the action or show a splash screen
  }
};

// --- API Integration Mock (Simulated Backend Service) ---

/**
 * A mock service to simulate interaction with a backend API.
 * In a real application, this would be a separate service file.
 */
const APIService = {
  /**
   * Simulates fetching the current KYC status from the backend.
   * @returns {Promise<'PENDING' | 'REQUIRED' | 'COMPLETE'>} The current status.
   */
  fetchKYCStatus: async (): Promise<'PENDING' | 'REQUIRED' | 'COMPLETE'> => {
    // Simulate API latency
    await new Promise(resolve => setTimeout(resolve, 500));
    // In a real app, this would be a network request
    const mockStatus = Math.random() > 0.7 ? 'PENDING' : 'REQUIRED';
    console.log(`[APIService] Mock KYC Status: ${mockStatus}`);
    return mockStatus;
  },

  /**
   * Simulates initiating a new transaction on the backend.
   * @param {number} amount - The transaction amount.
   * @param {'deposit' | 'withdrawal'} type - The transaction type.
   * @returns {Promise<{ transactionId: string }>} The created transaction ID.
   */
  initiateTransaction: async (
    amount: number,
    type: 'deposit' | 'withdrawal'
  ): Promise<{ transactionId: string }> => {
    await new Promise(resolve => setTimeout(resolve, 800));
    if (amount <= 0) {
      throw new Error('Transaction amount must be positive.');
    }
    const transactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    console.log(
      `[APIService] Transaction initiated: ${transactionId} (${type} ${amount})`
    );
    return { transactionId };
  },
};

// --- Navigation Service Core ---

/**
 * The main Navigation Service object, containing all public navigation methods.
 */
export const NavigationService = {
  /**
   * Generic navigation function. Use this for simple, direct route navigation.
   * @param {keyof RootStackParamList} name - The name of the route to navigate to.
   * @param {RootStackParamList[T]} [params] - Optional parameters for the route.
   */
  navigate: <T extends keyof RootStackParamList>(
    name: T,
    params?: RootStackParamList[T]
  ): void => {
    safeNavigate(() => {
      // The 'as any' is necessary here because the ref's navigate method
      // is generic and we are using a type-safe wrapper.
      navigationRef.navigate(name as any, params as any);
    }, 'navigate');
  },

  /**
   * Resets the navigation state to a new state. Useful for logging out or
   * moving to a completely new flow.
   * @param {string} name - The name of the route to reset to.
   */
  reset: (name: keyof RootStackParamList): void => {
    safeNavigate(() => {
      navigationRef.reset({
        index: 0,
        routes: [{ name }],
      });
    }, 'reset');
  },

  /**
   * Dispatches a raw navigation action. Use this for advanced actions like
   * `POP`, `PUSH`, or custom actions.
   * @param {NavigationAction} action - The action object to dispatch.
   */
  dispatch: (action: NavigationAction): void => {
    safeNavigate(() => {
      navigationRef.dispatch(action);
    }, 'dispatch');
  },

  /**
   * Navigates to the KYC (Know Your Customer) upgrade flow.
   * This method includes business logic to check the current KYC status
   * via a backend API before deciding the destination route.
   *
   * @async
   * @returns {Promise<void>}
   */
  navigateToKYCUpgrade: async (): Promise<void> => {
    console.log('[NavigationService] Attempting to navigate to KYC upgrade flow...');
    try {
      const status = await APIService.fetchKYCStatus();

      switch (status) {
        case 'REQUIRED':
          // Start the KYC process from the beginning
          NavigationService.navigate('KYCStart');
          break;
        case 'PENDING':
          // If already submitted, navigate to the review screen
          // NOTE: In a real app, we'd fetch the submissionId here.
          NavigationService.navigate('KYCReview', { submissionId: 'MOCK_SUB_123' });
          break;
        case 'COMPLETE':
          // If complete, show a success message or redirect to profile
          NavigationService.navigate('Profile', { userId: 'current_user_id' });
          break;
        default:
          // Handle unexpected status
          NavigationService.navigate('ErrorScreen', {
            title: 'KYC Status Error',
            message: `Received unexpected status: ${status}`,
          });
          break;
      }
    } catch (error) {
      console.error('[NavigationService] navigateToKYCUpgrade failed:', error);
      NavigationService.navigate('ErrorScreen', {
        title: 'API Error',
        message: 'Failed to fetch KYC status from the server.',
      });
    }
  },

  /**
   * Initiates a transaction (e.g., deposit or withdrawal) and navigates to the
   * confirmation screen upon successful backend initiation.
   *
   * @async
   * @param {number} amount - The amount for the transaction.
   * @param {'deposit' | 'withdrawal'} type - The type of transaction.
   * @returns {Promise<void>}
   */
  navigateToTransaction: async (
    amount: number,
    type: 'deposit' | 'withdrawal'
  ): Promise<void> => {
    console.log(
      `[NavigationService] Initiating ${type} transaction for amount: ${amount}...`
    );
    try {
      // 1. Call backend API to initiate the transaction
      const { transactionId } = await APIService.initiateTransaction(
        amount,
        type
      );

      // 2. Navigate to the confirmation screen with the transaction details
      NavigationService.navigate('TransactionConfirmation', {
        transactionId,
        amount,
      });
    } catch (error) {
      console.error('[NavigationService] navigateToTransaction failed:', error);
      // 3. Handle API or business logic error by navigating to an error screen
      NavigationService.navigate('ErrorScreen', {
        title: 'Transaction Failed',
        message:
          error instanceof Error
            ? error.message
            : 'An unknown error occurred during transaction initiation.',
        retryAction: () => NavigationService.navigateToTransaction(amount, type),
      });
    }
  },

  /**
   * Handles the post-KYC completion flow, typically called from a deep link
   * or a webhook handler after the backend confirms the KYC process is done.
   * It resets the navigation stack to a success screen and then to the Home screen.
   *
   * @param {string} [message] - An optional success message to display.
   * @returns {void}
   */
  handleKYCComplete: (message?: string): void => {
    console.log('[NavigationService] Handling KYC completion...');
    safeNavigate(() => {
      // Reset the stack to show a success screen first, then allow back to Home
      navigationRef.reset({
        index: 1, // The route at index 1 will be the active route
        routes: [
          { name: 'Home' }, // Route 0: Home
          {
            name: 'KYCUpgradeSuccess', // Route 1: Success Screen
            params: {
              message: message || 'Your account upgrade is complete!',
            },
          },
        ],
      });
    }, 'handleKYCComplete');
  },

  /**
   * A helper to get the current route name. Useful for analytics or conditional logic.
   * @returns {string | undefined} The name of the current route, or undefined if not ready.
   */
  getCurrentRouteName: (): string | undefined => {
    return navigationRef.getCurrentRoute()?.name;
  },

  /**
   * A helper to check if a specific screen is currently mounted.
   * @param {keyof RootStackParamList} name - The name of the screen to check.
   * @returns {boolean} True if the screen is currently mounted.
   */
  canGoBack: (): boolean => {
    return navigationRef.canGoBack();
  },

  /**
   * Go back to the previous screen in the stack.
   */
  goBack: (): void => {
    safeNavigate(() => {
      if (navigationRef.canGoBack()) {
        navigationRef.goBack();
      } else {
        console.warn(
          '[NavigationService] Cannot go back. No previous screen in stack.'
        );
        // Optionally navigate to a default screen if back is not possible
        // NavigationService.reset('Home');
      }
    }, 'goBack');
  },
};

// --- Export for Usage ---

// Export the types for use in components (e.g., to type `useNavigation`)
export type { NavigationAction };

// Export the service and ref
export default NavigationService;
