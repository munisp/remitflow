/**
 * @file TransactionFlowManager.ts
 * @description TypeScript service for transaction orchestration with automatic KYC checking
 *              in a React Native application. It manages the multi-step process of
 *              initiating and continuing financial transactions, handling state
 *              transitions, and integrating with backend APIs.
 * @author Manus AI
 * @version 1.0.0
 */

// --- Type Definitions ---

/**
 * Represents the status of a Know Your Customer (KYC) check.
 */
export enum KYCStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REQUIRED = 'REQUIRED',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

/**
 * Represents the current state of a transaction in the flow.
 */
export enum TransactionState {
  INITIATED = 'INITIATED',
  KYC_CHECK = 'KYC_CHECK',
  PROCESSING = 'PROCESSING',
  AWAITING_USER_ACTION = 'AWAITING_USER_ACTION',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Base structure for all API responses.
 */
interface BaseResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

/**
 * The payload for initiating a new transaction.
 */
export interface InitiateTransactionRequest {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  // Optional field for additional context, e.g., transaction type, notes
  metadata?: Record<string, any>;
}

/**
 * The response from the backend after initiating a transaction.
 */
export interface InitiateTransactionResponse extends BaseResponse {
  transactionId: string;
  currentStatus: TransactionState;
  kycStatus: KYCStatus;
  // Specifies the required action if currentStatus is AWAITING_USER_ACTION or KYC_CHECK
  requiredAction?: string; // e.g., 'OTP_VERIFICATION', 'UPLOAD_DOCUMENTS'
  // Optional data for the next step, e.g., a challenge token
  nextStepData?: Record<string, any>;
}

/**
 * The payload for continuing a transaction that requires further action.
 */
export interface ContinueTransactionRequest {
  transactionId: string;
  actionType: string; // e.g., 'SUBMIT_OTP', 'UPLOAD_DOCUMENTS'
  payload: Record<string, any>; // The data for the specific action
}

/**
 * The response from the backend after continuing a transaction.
 */
export interface ContinueTransactionResponse extends BaseResponse {
  transactionId: string;
  currentStatus: TransactionState;
  kycStatus: KYCStatus;
  requiredAction?: string;
  nextStepData?: Record<string, any>;
}

// --- Custom Errors ---

/**
 * Base class for all transaction-related errors, providing a structured way
 * to handle errors across the application.
 */
export class TransactionError extends Error {
  constructor(
    message: string,
    public code: string = 'TRANSACTION_ERROR',
    public details: Record<string, any> = {},
  ) {
    super(message);
    this.name = 'TransactionError';
    // Set the prototype explicitly to ensure instanceof works correctly
    Object.setPrototypeOf(this, TransactionError.prototype);
  }
}

/**
 * Error thrown when the backend returns a non-successful response or an HTTP error.
 */
export class ApiError extends TransactionError {
  constructor(
    message: string,
    public statusCode: number,
    public apiCode: string = 'BACKEND_FAILURE',
    details: Record<string, any> = {},
  ) {
    super(message, 'API_ERROR', { ...details, statusCode, apiCode });
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Error thrown when a transaction is in a state that prevents the requested action.
 */
export class InvalidTransactionStateError extends TransactionError {
  constructor(
    message: string,
    public transactionId: string,
    public currentState: TransactionState,
  ) {
    super(message, 'INVALID_STATE', { transactionId, currentState });
    this.name = 'InvalidTransactionStateError';
    Object.setPrototypeOf(this, InvalidTransactionStateError.prototype);
  }
}

// --- API Client Mock (for demonstration) ---

/**
 * A mock implementation of an HTTP client to simulate backend interaction.
 * In a real React Native app, this would use a library like `axios` or `fetch`.
 */
class ApiClient {
  private baseUrl: string = 'https://api.example.com/v1/transactions';

  /**
   * Generic POST request wrapper with error handling.
   * @param endpoint The API endpoint path.
   * @param data The request payload.
   * @returns A promise that resolves with the response data.
   */
  private async post<T extends BaseResponse>(endpoint: string, data: any): Promise<T> {
    try {
      // Simulate network request and delay
      await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 700));

      // Simulate API call and response parsing
      const response: BaseResponse & Partial<T> = this.mockApiCall(endpoint, data);

      if (!response.success) {
        // Throw a structured API error for non-successful responses
        throw new ApiError(
          response.message || `Request to ${endpoint} failed.`,
          400, // Assuming a generic client error for a failed business logic
          (response as any).errorCode || 'UNKNOWN_ERROR',
          { requestData: data, endpoint },
        );
      }

      return response as T;
    } catch (error) {
      // Re-throw if it's already an ApiError, otherwise wrap in a generic TransactionError
      if (error instanceof ApiError) {
        throw error;
      }
      // Simulate network or parsing error
      throw new TransactionError(
        `Network or parsing error during POST to ${endpoint}: ${error.message}`,
        'NETWORK_ERROR',
        { originalError: error },
      );
    }
  }

  /**
   * Internal function to simulate various backend responses based on input.
   */
  private mockApiCall(endpoint: string, data: any): BaseResponse & Partial<any> {
    const timestamp = new Date().toISOString();

    if (endpoint.includes('initiate')) {
      const req = data as InitiateTransactionRequest;
      const transactionId = `txn_${Date.now()}`;

      if (req.amount > 10000) {
        // High-value transaction requires KYC check
        return {
          success: true,
          message: 'Transaction initiated. KYC documents required.',
          timestamp,
          transactionId,
          currentStatus: TransactionState.KYC_CHECK,
          kycStatus: KYCStatus.REQUIRED,
          requiredAction: 'UPLOAD_DOCUMENTS',
          nextStepData: { kycFormUrl: 'https://kyc.example.com/upload' },
        };
      }
      if (req.amount > 5000) {
        // Medium-value transaction requires OTP verification
        return {
          success: true,
          message: 'Transaction initiated. Awaiting OTP verification.',
          timestamp,
          transactionId,
          currentStatus: TransactionState.AWAITING_USER_ACTION,
          kycStatus: KYCStatus.APPROVED,
          requiredAction: 'OTP_VERIFICATION',
          nextStepData: { maskedContact: '***-***-1234', otpLength: 6 },
        };
      }
      if (req.amount < 100) {
        // Low-value transaction completes immediately
        return {
          success: true,
          message: 'Transaction completed successfully.',
          timestamp,
          transactionId,
          currentStatus: TransactionState.COMPLETED,
          kycStatus: KYCStatus.NOT_APPLICABLE,
        };
      }
      // Standard transaction, processing
      return {
        success: true,
        message: 'Transaction initiated and is now processing.',
        timestamp,
        transactionId,
        currentStatus: TransactionState.PROCESSING,
        kycStatus: KYCStatus.APPROVED,
      };
    }

    if (endpoint.includes('continue')) {
      const req = data as ContinueTransactionRequest;
      const { transactionId, actionType, payload } = req;

      if (actionType === 'SUBMIT_OTP') {
        if (payload.otp === '123456') {
          // Successful OTP submission
          return {
            success: true,
            message: 'OTP verified. Transaction processing.',
            timestamp,
            transactionId,
            currentStatus: TransactionState.PROCESSING,
            kycStatus: KYCStatus.APPROVED,
          };
        } else {
          // Failed OTP submission
          return {
            success: false,
            message: 'Invalid OTP provided. Please try again.',
            timestamp,
            transactionId,
            errorCode: 'INVALID_OTP',
          };
        }
      }

      if (actionType === 'UPLOAD_DOCUMENTS') {
        // Successful document upload, leads to PENDING KYC check
        return {
          success: true,
          message: 'Documents uploaded. KYC check is now pending.',
          timestamp,
          transactionId,
          currentStatus: TransactionState.KYC_CHECK,
          kycStatus: KYCStatus.PENDING,
          requiredAction: 'POLL_FOR_KYC_STATUS',
        };
      }
    }

    return {
      success: false,
      message: 'Unknown API endpoint or internal server error.',
      timestamp,
      errorCode: 'INTERNAL_SERVER_ERROR',
    };
  }

  public async initiate(request: InitiateTransactionRequest): Promise<InitiateTransactionResponse> {
    return this.post<InitiateTransactionResponse>('/initiate', request);
  }

  public async continue(request: ContinueTransactionRequest): Promise<ContinueTransactionResponse> {
    return this.post<ContinueTransactionResponse>('/continue', request);
  }
}

// --- Service Class ---

/**
 * @class TransactionFlowManager
 * @description A singleton-like service class responsible for orchestrating the
 *              transaction lifecycle. It abstracts the multi-step process,
 *              including conditional KYC checks, user action prompts, and
 *              robust error handling.
 */
export class TransactionFlowManager {
  private api: ApiClient;

  /**
   * Initializes the TransactionFlowManager.
   * @param apiClient An optional instance of ApiClient for dependency injection (e.g., for testing).
   */
  constructor(apiClient?: ApiClient) {
    this.api = apiClient || new ApiClient();
  }

  /**
   * Validates the input request for initiating a transaction.
   * @param request The transaction request object.
   * @throws {TransactionError} if validation fails.
   */
  private validateInitiateRequest(request: InitiateTransactionRequest): void {
    const { sourceAccountId, destinationAccountId, amount, currency } = request;

    if (!sourceAccountId || !destinationAccountId) {
      throw new TransactionError('Source and destination accounts must be provided.', 'VALIDATION_ERROR');
    }
    if (typeof amount !== 'number' || amount <= 0) {
      throw new TransactionError('Amount must be a positive number.', 'VALIDATION_ERROR');
    }
    if (!currency || currency.length !== 3) {
      throw new TransactionError('Currency must be a valid 3-letter code.', 'VALIDATION_ERROR');
    }
  }

  /**
   * Validates the input request for continuing a transaction.
   * @param request The transaction continuation request object.
   * @throws {TransactionError} if validation fails.
   */
  private validateContinueRequest(request: ContinueTransactionRequest): void {
    const { transactionId, actionType, payload } = request;

    if (!transactionId) {
      throw new TransactionError('Transaction ID is required to continue a transaction.', 'VALIDATION_ERROR');
    }
    if (!actionType) {
      throw new TransactionError('Action type is required to continue a transaction.', 'VALIDATION_ERROR');
    }
    if (!payload || Object.keys(payload).length === 0) {
      // Depending on the action, payload might be required
      console.warn(`ContinueTransactionRequest for ${actionType} has an empty payload.`);
    }
  }

  /**
   * Starts a new transaction and handles the initial state transition.
   * This method is the entry point for any new transaction flow.
   *
   * @param request The details of the transaction to initiate.
   * @returns A promise that resolves with the transaction response, which
   *          will indicate the next required step (if any).
   * @throws {TransactionError} for any failure during the process, including
   *         validation, network, or backend business logic errors.
   */
  public async initiateTransaction(
    request: InitiateTransactionRequest,
  ): Promise<InitiateTransactionResponse> {
    try {
      this.validateInitiateRequest(request);
      console.log(`Attempting to initiate transaction from ${request.sourceAccountId} to ${request.destinationAccountId} for ${request.amount} ${request.currency}.`);

      const response = await this.api.initiate(request);

      console.log(`Transaction ${response.transactionId} initiated. Status: ${response.currentStatus}. KYC: ${response.kycStatus}.`);

      // A successful initiation can still require immediate user action (e.g., OTP, KYC)
      if (response.currentStatus === TransactionState.FAILED) {
        throw new TransactionError(
          `Transaction failed immediately upon initiation: ${response.message}`,
          'INITIATION_FAILED',
          { transactionId: response.transactionId, message: response.message },
        );
      }

      return response;
    } catch (error) {
      // Ensure all thrown errors are instances of TransactionError for consistent handling
      if (error instanceof TransactionError) {
        throw error;
      }
      // Catch any unexpected errors and wrap them
      throw new TransactionError(
        `An unexpected error occurred during transaction initiation: ${error.message}`,
        'UNEXPECTED_ERROR',
        { originalError: error },
      );
    }
  }

  /**
   * Continues an existing transaction, typically after a required user action
   * like OTP verification, document upload, or a status check.
   *
   * @param request The details for continuing the transaction, including the
   *                transaction ID and the action being performed.
   * @returns A promise that resolves with the updated transaction response.
   * @throws {TransactionError} for any failure or invalid state.
   */
  public async continueTransaction(
    request: ContinueTransactionRequest,
  ): Promise<ContinueTransactionResponse> {
    try {
      this.validateContinueRequest(request);
      console.log(`Attempting to continue transaction ${request.transactionId} with action: ${request.actionType}.`);

      const response = await this.api.continue(request);

      console.log(`Transaction ${response.transactionId} continued. New Status: ${response.currentStatus}. KYC: ${response.kycStatus}.`);

      // Check for final failure state
      if (response.currentStatus === TransactionState.FAILED || response.currentStatus === TransactionState.CANCELLED) {
        throw new TransactionError(
          `Transaction ${response.transactionId} ended in a terminal failure state: ${response.message}`,
          'TERMINAL_STATE',
          { transactionId: response.transactionId, finalStatus: response.currentStatus, message: response.message },
        );
      }

      // If the transaction is already completed, throw an error to prevent unnecessary calls
      if (response.currentStatus === TransactionState.COMPLETED) {
        throw new InvalidTransactionStateError(
          `Cannot continue transaction ${response.transactionId}. It is already completed.`,
          response.transactionId,
          TransactionState.COMPLETED,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof TransactionError) {
        throw error;
      }
      throw new TransactionError(
        `An unexpected error occurred during transaction continuation: ${error.message}`,
        'UNEXPECTED_ERROR',
        { originalError: error },
      );
    }
  }

  /**
   * Helper method to check if a transaction requires a user action.
   * @param response The transaction response object.
   * @returns True if a user action is required, false otherwise.
   */
  public static requiresUserAction(response: InitiateTransactionResponse | ContinueTransactionResponse): boolean {
    return response.currentStatus === TransactionState.AWAITING_USER_ACTION ||
           (response.currentStatus === TransactionState.KYC_CHECK && !!response.requiredAction);
  }

  /**
   * Helper method to check if a transaction is in a final, non-continuable state.
   * @param response The transaction response object.
   * @returns True if the transaction is completed, failed, or cancelled.
   */
  public static isTerminalState(response: InitiateTransactionResponse | ContinueTransactionResponse): boolean {
    return response.currentStatus === TransactionState.COMPLETED ||
           response.currentStatus === TransactionState.FAILED ||
           response.currentStatus === TransactionState.CANCELLED;
  }
}
