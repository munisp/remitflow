import { TransactionFlowManager } from '../TransactionFlowManager'; // Assuming the source file is one level up
import { BackendAPI } from '../BackendAPI'; // Assuming a separate module for API calls
import { Logger } from '../Logger'; // Assuming a logging utility

// --- Mocks ---

// Mock the entire BackendAPI module
jest.mock('../BackendAPI', () => ({
  BackendAPI: {
    initiate: jest.fn(),
    continue: jest.fn(),
    kycUpgrade: jest.fn(),
  },
}));

// Mock the Logger utility to prevent console noise during tests
jest.mock('../Logger', () => ({
  Logger: {
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// Cast the mocked module to a specific type for easier access to mock functions
const mockBackendAPI = BackendAPI as jest.Mocked<typeof BackendAPI>;
const mockLogger = Logger as jest.Mocked<typeof Logger>;

// --- Constants and Types (Inferred) ---

const MOCK_TRANSACTION_DETAILS = {
  type: 'deposit',
  amount: 100,
  currency: 'USD',
};

const MOCK_TRANSACTION_ID = 'txn_12345';
const MOCK_SESSION_TOKEN = 'sess_abcde';

const SUCCESS_RESPONSE = {
  status: 'success',
  transactionId: MOCK_TRANSACTION_ID,
  nextStep: 'completed',
  data: { message: 'Transaction successful' },
};

const PENDING_RESPONSE = {
  status: 'pending',
  transactionId: MOCK_TRANSACTION_ID,
  nextStep: 'verification_required',
  sessionToken: MOCK_SESSION_TOKEN,
  data: { verificationUrl: 'https://verify.com/123' },
};

const KYC_REQUIRED_RESPONSE = {
  status: 'error',
  code: 'KYC_UPGRADE_REQUIRED',
  message: 'KYC level too low for this transaction.',
};

const GENERIC_ERROR_RESPONSE = {
  status: 'error',
  code: 'GENERIC_ERROR',
  message: 'Something went wrong.',
};

// --- Test Suite ---

describe('TransactionFlowManager', () => {
  let manager: TransactionFlowManager;

  // Setup: Clear mocks and re-initialize the manager before each test
  beforeEach(() => {
    jest.clearAllMocks();
    manager = new TransactionFlowManager();
  });

  // Teardown: Optional, but good practice for complex setups
  afterEach(() => {
    // Any cleanup logic can go here
  });

  // Helper function to check for transaction state
  const getManagerPrivateState = (instance: any) => ({
    transactionId: instance['transactionId'],
    sessionToken: instance['sessionToken'],
  });

  // --- Test Suite for initiateTransaction ---

  describe('initiateTransaction', () => {
    it('should successfully initiate a transaction and return the final success response', async () => {
      // Arrange
      mockBackendAPI.initiate.mockResolvedValue(SUCCESS_RESPONSE);

      // Act
      const result = await manager.initiateTransaction(MOCK_TRANSACTION_DETAILS);

      // Assert
      expect(mockBackendAPI.initiate).toHaveBeenCalledTimes(1);
      expect(mockBackendAPI.initiate).toHaveBeenCalledWith(MOCK_TRANSACTION_DETAILS);
      expect(result).toEqual(SUCCESS_RESPONSE);
      expect(getManagerPrivateState(manager).transactionId).toBe(MOCK_TRANSACTION_ID);
      expect(getManagerPrivateState(manager).sessionToken).toBeUndefined();
    });

    it('should initiate a transaction and return a pending response, storing the session token', async () => {
      // Arrange
      mockBackendAPI.initiate.mockResolvedValue(PENDING_RESPONSE);

      // Act
      const result = await manager.initiateTransaction(MOCK_TRANSACTION_DETAILS);

      // Assert
      expect(mockBackendAPI.initiate).toHaveBeenCalledTimes(1);
      expect(result).toEqual(PENDING_RESPONSE);
      expect(getManagerPrivateState(manager).transactionId).toBe(MOCK_TRANSACTION_ID);
      expect(getManagerPrivateState(manager).sessionToken).toBe(MOCK_SESSION_TOKEN);
    });

    it('should handle a generic API error during initiation', async () => {
      // Arrange
      mockBackendAPI.initiate.mockResolvedValue(GENERIC_ERROR_RESPONSE);

      // Act & Assert
      await expect(manager.initiateTransaction(MOCK_TRANSACTION_DETAILS)).rejects.toThrow(
        GENERIC_ERROR_RESPONSE.message
      );
      expect(mockBackendAPI.initiate).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Transaction initiation failed:',
        GENERIC_ERROR_RESPONSE
      );
      expect(getManagerPrivateState(manager).transactionId).toBeUndefined();
    });

    it('should handle a network/exception error during initiation', async () => {
      // Arrange
      const networkError = new Error('Network timeout');
      mockBackendAPI.initiate.mockRejectedValue(networkError);

      // Act & Assert
      await expect(manager.initiateTransaction(MOCK_TRANSACTION_DETAILS)).rejects.toThrow(
        networkError.message
      );
      expect(mockBackendAPI.initiate).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Transaction initiation failed with exception:',
        networkError
      );
      expect(getManagerPrivateState(manager).transactionId).toBeUndefined();
    });

    // Edge Case: KYC Upgrade Required on initiation
    it('should throw a specific error when KYC upgrade is required on initiation', async () => {
      // Arrange
      mockBackendAPI.initiate.mockResolvedValue(KYC_REQUIRED_RESPONSE);

      // Act & Assert
      await expect(manager.initiateTransaction(MOCK_TRANSACTION_DETAILS)).rejects.toThrow(
        KYC_REQUIRED_RESPONSE.message
      );
      expect(mockBackendAPI.initiate).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Transaction initiation failed:',
        KYC_REQUIRED_RESPONSE
      );
    });
  });

  // --- Test Suite for continueTransaction ---

  describe('continueTransaction', () => {
    const MOCK_CONTINUE_DATA = { otp: '123456' };

    // Setup for a pending transaction state
    const setupPendingTransaction = () => {
      // Simulate a pending transaction state
      (manager as any)['transactionId'] = MOCK_TRANSACTION_ID;
      (manager as any)['sessionToken'] = MOCK_SESSION_TOKEN;
    };

    it('should successfully continue a pending transaction to completion', async () => {
      // Arrange
      setupPendingTransaction();
      mockBackendAPI.continue.mockResolvedValue(SUCCESS_RESPONSE);

      // Act
      const result = await manager.continueTransaction(MOCK_CONTINUE_DATA);

      // Assert
      expect(mockBackendAPI.continue).toHaveBeenCalledTimes(1);
      expect(mockBackendAPI.continue).toHaveBeenCalledWith(
        MOCK_TRANSACTION_ID,
        MOCK_SESSION_TOKEN,
        MOCK_CONTINUE_DATA
      );
      expect(result).toEqual(SUCCESS_RESPONSE);
      // State should be cleared after completion
      expect(getManagerPrivateState(manager).transactionId).toBe(MOCK_TRANSACTION_ID); // ID remains for reference
      expect(getManagerPrivateState(manager).sessionToken).toBeUndefined();
    });

    it('should continue a transaction and return a new pending response, updating the session token', async () => {
      // Arrange
      setupPendingTransaction();
      const NEW_SESSION_TOKEN = 'sess_new_token';
      const NEW_PENDING_RESPONSE = {
        ...PENDING_RESPONSE,
        sessionToken: NEW_SESSION_TOKEN,
        nextStep: 'additional_verification',
      };
      mockBackendAPI.continue.mockResolvedValue(NEW_PENDING_RESPONSE);

      // Act
      const result = await manager.continueTransaction(MOCK_CONTINUE_DATA);

      // Assert
      expect(mockBackendAPI.continue).toHaveBeenCalledTimes(1);
      expect(result).toEqual(NEW_PENDING_RESPONSE);
      expect(getManagerPrivateState(manager).transactionId).toBe(MOCK_TRANSACTION_ID);
      expect(getManagerPrivateState(manager).sessionToken).toBe(NEW_SESSION_TOKEN);
    });

    it('should throw an error if continueTransaction is called without an active transaction ID', async () => {
      // Arrange
      // Manager is in initial state (no ID/token)

      // Act & Assert
      await expect(manager.continueTransaction(MOCK_CONTINUE_DATA)).rejects.toThrow(
        'Cannot continue transaction: No active transaction ID found.'
      );
      expect(mockBackendAPI.continue).not.toHaveBeenCalled();
    });

    it('should handle a generic API error during continuation', async () => {
      // Arrange
      setupPendingTransaction();
      mockBackendAPI.continue.mockResolvedValue(GENERIC_ERROR_RESPONSE);

      // Act & Assert
      await expect(manager.continueTransaction(MOCK_CONTINUE_DATA)).rejects.toThrow(
        GENERIC_ERROR_RESPONSE.message
      );
      expect(mockBackendAPI.continue).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Transaction continuation failed:',
        GENERIC_ERROR_RESPONSE
      );
      // State should remain for potential retry
      expect(getManagerPrivateState(manager).transactionId).toBe(MOCK_TRANSACTION_ID);
      expect(getManagerPrivateState(manager).sessionToken).toBe(MOCK_SESSION_TOKEN);
    });

    it('should handle a network/exception error during continuation', async () => {
      // Arrange
      setupPendingTransaction();
      const networkError = new Error('Connection lost');
      mockBackendAPI.continue.mockRejectedValue(networkError);

      // Act & Assert
      await expect(manager.continueTransaction(MOCK_CONTINUE_DATA)).rejects.toThrow(
        networkError.message
      );
      expect(mockBackendAPI.continue).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Transaction continuation failed with exception:',
        networkError
      );
    });
  });

  // --- Test Suite for handleKYCUpgradeRequired ---

  describe('handleKYCUpgradeRequired', () => {
    const MOCK_KYC_DATA = { documentType: 'passport' };

    it('should successfully call the KYC upgrade API and return the response', async () => {
      // Arrange
      const KYC_SUCCESS_RESPONSE = {
        status: 'success',
        data: { redirectUrl: 'https://kyc.provider.com/start' },
      };
      mockBackendAPI.kycUpgrade.mockResolvedValue(KYC_SUCCESS_RESPONSE);

      // Act
      const result = await manager.handleKYCUpgradeRequired(MOCK_KYC_DATA);

      // Assert
      expect(mockBackendAPI.kycUpgrade).toHaveBeenCalledTimes(1);
      expect(mockBackendAPI.kycUpgrade).toHaveBeenCalledWith(MOCK_KYC_DATA);
      expect(result).toEqual(KYC_SUCCESS_RESPONSE);
    });

    it('should handle an API error during KYC upgrade', async () => {
      // Arrange
      const KYC_ERROR_RESPONSE = {
        status: 'error',
        code: 'KYC_DOC_INVALID',
        message: 'Invalid document type provided.',
      };
      mockBackendAPI.kycUpgrade.mockResolvedValue(KYC_ERROR_RESPONSE);

      // Act & Assert
      await expect(manager.handleKYCUpgradeRequired(MOCK_KYC_DATA)).rejects.toThrow(
        KYC_ERROR_RESPONSE.message
      );
      expect(mockBackendAPI.kycUpgrade).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'KYC upgrade failed:',
        KYC_ERROR_RESPONSE
      );
    });

    it('should handle a network/exception error during KYC upgrade', async () => {
      // Arrange
      const networkError = new Error('KYC service unreachable');
      mockBackendAPI.kycUpgrade.mockRejectedValue(networkError);

      // Act & Assert
      await expect(manager.handleKYCUpgradeRequired(MOCK_KYC_DATA)).rejects.toThrow(
        networkError.message
      );
      expect(mockBackendAPI.kycUpgrade).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'KYC upgrade failed with exception:',
        networkError
      );
    });
  });

  // --- Edge Case: State Management and Reset ---

  describe('State Management', () => {
    it('should clear sessionToken after a successful completion', async () => {
      // Arrange
      const pendingResponse = { ...PENDING_RESPONSE };
      const successResponse = { ...SUCCESS_RESPONSE };

      // 1. Initiate (Pending)
      mockBackendAPI.initiate.mockResolvedValue(pendingResponse);
      await manager.initiateTransaction(MOCK_TRANSACTION_DETAILS);
      expect(getManagerPrivateState(manager).sessionToken).toBe(MOCK_SESSION_TOKEN);

      // 2. Continue (Success)
      mockBackendAPI.continue.mockResolvedValue(successResponse);
      await manager.continueTransaction({});

      // Assert
      expect(getManagerPrivateState(manager).transactionId).toBe(MOCK_TRANSACTION_ID);
      expect(getManagerPrivateState(manager).sessionToken).toBeUndefined();
    });

    it('should retain state after a failed continuation for potential retry', async () => {
      // Arrange
      const pendingResponse = { ...PENDING_RESPONSE };
      const errorResponse = { ...GENERIC_ERROR_RESPONSE };

      // 1. Initiate (Pending)
      mockBackendAPI.initiate.mockResolvedValue(pendingResponse);
      await manager.initiateTransaction(MOCK_TRANSACTION_DETAILS);
      expect(getManagerPrivateState(manager).sessionToken).toBe(MOCK_SESSION_TOKEN);

      // 2. Continue (Error)
      mockBackendAPI.continue.mockResolvedValue(errorResponse);
      await expect(manager.continueTransaction({})).rejects.toThrow();

      // Assert
      expect(getManagerPrivateState(manager).transactionId).toBe(MOCK_TRANSACTION_ID);
      expect(getManagerPrivateState(manager).sessionToken).toBe(MOCK_SESSION_TOKEN); // State retained
    });
  });
});