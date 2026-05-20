//
//  TransactionFlowManager.swift
//  MyApp
//
//  Created by Manus AI on 2025/11/05.
//
//  A production-ready Swift service for orchestrating complex transaction flows,
//  including automatic Know Your Customer (KYC) checking and utilizing modern
//  Swift concurrency (async/await) for a non-blocking experience.
//
//  The implementation adheres to platform best practices, is type-safe, and
//  includes comprehensive error handling.
//

import Foundation

// MARK: - Protocols and Dependencies

/// A protocol defining the necessary API interactions for the transaction flow.
protocol TransactionAPIServicing {
    /// Simulates a network call to check the current KYC status of the user.
    /// - Returns: The current KYC status.
    func fetchKYCStatus() async throws -> KYCStatus

    /// Simulates a network call to initiate a transaction.
    /// - Parameter request: The transaction details.
    /// - Returns: A confirmation object for the initiated transaction.
    func submitTransaction(request: TransactionRequest) async throws -> TransactionConfirmation

    /// Simulates a network call to check the status of a pending transaction.
    /// - Parameter transactionID: The ID of the transaction to check.
    /// - Returns: The current status of the transaction.
    func fetchTransactionStatus(transactionID: String) async throws -> TransactionStatus
}

/// A concrete implementation of the API service.
final class DefaultTransactionAPIService: TransactionAPIServicing {
    // MARK: - Mock Data and Latency

    private let mockLatency: UInt64 = 500_000_000 // 0.5 seconds in nanoseconds

    // In a real application, this would be an actual network layer (e.g., URLSession).
    // For demonstration, we use mock data and artificial delay.

    func fetchKYCStatus() async throws -> KYCStatus {
        try await Task.sleep(nanoseconds: mockLatency)
        // Simulate different statuses based on a simple condition
        let userID = "user123" // Assume this is fetched from a session manager
        if userID.hasSuffix("3") {
            return .pendingReview
        } else if userID.hasSuffix("2") {
            return .rejected
        } else {
            return .verified
        }
    }

    func submitTransaction(request: TransactionRequest) async throws -> TransactionConfirmation {
        try await Task.sleep(nanoseconds: mockLatency * 2) // Longer delay for submission
        print("Submitting transaction: \(request.id)")

        // Simulate a server-side validation error 10% of the time
        if Int.random(in: 1...10) == 1 {
            throw TransactionError.apiError(message: "Server rejected transaction due to insufficient funds.")
        }

        let confirmation = TransactionConfirmation(
            transactionID: request.id,
            status: .pending,
            timestamp: Date()
        )
        return confirmation
    }

    func fetchTransactionStatus(transactionID: String) async throws -> TransactionStatus {
        try await Task.sleep(nanoseconds: mockLatency)
        // Simulate a successful completion after a few checks
        if Int.random(in: 1...5) == 1 {
            return .completed
        } else {
            return .processing
        }
    }
}

// MARK: - Data Models

/// Represents the possible states of a user's KYC verification.
enum KYCStatus: String, Codable {
    case unverified
    case pendingReview
    case verified
    case rejected
}

/// Represents the possible states of a transaction.
enum TransactionStatus: String, Codable {
    case pending
    case processing
    case completed
    case failed
    case cancelled
}

/// The request payload for initiating a transaction.
struct TransactionRequest: Codable {
    let id: String
    let amount: Decimal
    let recipientAccount: String
    let currency: String
}

/// The response payload after a transaction is initiated.
struct TransactionConfirmation: Codable {
    let transactionID: String
    let status: TransactionStatus
    let timestamp: Date
}

// MARK: - Error Handling

/// Custom errors for the transaction flow manager.
enum TransactionError: Error, LocalizedError {
    case kycNotVerified(status: KYCStatus)
    case invalidTransactionRequest(reason: String)
    case apiError(message: String)
    case transactionFailed(id: String, reason: String)
    case unknownError(underlyingError: Error)

    var errorDescription: String? {
        switch self {
        case .kycNotVerified(let status):
            return "KYC check failed. Current status: \(status.rawValue). Transaction cannot proceed."
        case .invalidTransactionRequest(let reason):
            return "The transaction request is invalid: \(reason)."
        case .apiError(let message):
            return "A backend API error occurred: \(message)."
        case .transactionFailed(let id, let reason):
            return "Transaction \(id) failed during processing: \(reason)."
        case .unknownError(let underlyingError):
            return "An unexpected error occurred: \(underlyingError.localizedDescription)"
        }
    }
}

// MARK: - Transaction Flow Manager

/// Manages the end-to-end lifecycle of a transaction, from pre-flight checks to submission.
final class TransactionFlowManager {
    private let apiService: TransactionAPIServicing
    private let kycRequiredStatus: KYCStatus = .verified

    /// Initializes the manager with a dependency on the API service.
    /// - Parameter apiService: The service responsible for network communication.
    init(apiService: TransactionAPIServicing = DefaultTransactionAPIService()) {
        self.apiService = apiService
    }

    // MARK: - Core Methods

    /// Performs a pre-flight check to ensure the user is authorized to transact.
    /// This includes an automatic KYC status check.
    /// - Throws: `TransactionError.kycNotVerified` if the user's KYC status is not `.verified`.
    private func performPreFlightChecks() async throws {
        print("Starting pre-flight checks...")
        let currentKYCStatus = try await apiService.fetchKYCStatus()

        guard currentKYCStatus == kycRequiredStatus else {
            print("KYC check failed. Status: \(currentKYCStatus.rawValue)")
            throw TransactionError.kycNotVerified(status: currentKYCStatus)
        }

        print("Pre-flight checks passed. KYC Status: Verified.")
    }

    /// Orchestrates the entire transaction process.
    /// 1. Performs KYC check.
    /// 2. Submits the transaction request.
    /// 3. Polls for the final transaction status.
    ///
    /// - Parameter request: The details of the transaction to initiate.
    /// - Returns: The final, completed transaction confirmation.
    /// - Throws: A `TransactionError` if any step in the flow fails.
    func initiateTransaction(request: TransactionRequest) async throws -> TransactionConfirmation {
        do {
            // 1. Pre-flight checks (KYC)
            try await performPreFlightChecks()

            // 2. Submit the transaction
            let initialConfirmation = try await apiService.submitTransaction(request: request)
            print("Transaction submitted. ID: \(initialConfirmation.transactionID)")

            // 3. Poll for final status (Simulated)
            let finalConfirmation = try await pollForTransactionCompletion(
                transactionID: initialConfirmation.transactionID,
                initialConfirmation: initialConfirmation
            )

            return finalConfirmation

        } catch let error as TransactionError {
            // Re-throw known custom errors
            throw error
        } catch {
            // Wrap any unexpected system or network errors
            throw TransactionError.unknownError(underlyingError: error)
        }
    }

    /// Polls the backend for the final status of a transaction until it is completed or failed.
    /// - Parameters:
    ///   - transactionID: The ID of the transaction to monitor.
    ///   - initialConfirmation: The initial confirmation object.
    /// - Returns: The final transaction confirmation with a completed status.
    /// - Throws: `TransactionError.transactionFailed` if the transaction fails.
    private func pollForTransactionCompletion(
        transactionID: String,
        initialConfirmation: TransactionConfirmation
    ) async throws -> TransactionConfirmation {
        let maxAttempts = 10
        let delaySeconds: Double = 2.0

        for attempt in 1...maxAttempts {
            try await Task.sleep(for: .seconds(delaySeconds))
            print("Polling status for \(transactionID)... Attempt \(attempt)/\(maxAttempts)")

            let status = try await apiService.fetchTransactionStatus(transactionID: transactionID)

            switch status {
            case .completed:
                print("Transaction \(transactionID) completed successfully.")
                return TransactionConfirmation(
                    transactionID: transactionID,
                    status: .completed,
                    timestamp: Date()
                )
            case .failed:
                throw TransactionError.transactionFailed(
                    id: transactionID,
                    reason: "Failed after multiple checks."
                )
            case .pending, .processing:
                continue // Continue polling
            case .cancelled:
                throw TransactionError.transactionFailed(
                    id: transactionID,
                    reason: "Transaction was cancelled."
                )
            }
        }

        // If the loop finishes without completion
        throw TransactionError.transactionFailed(
            id: transactionID,
            reason: "Timed out waiting for final status after \(maxAttempts) attempts."
        )
    }
}

// MARK: - Example Usage (For Documentation)

/*
/// Example of how to use the TransactionFlowManager in a ViewModel or Controller.
final class TransactionViewModel: ObservableObject {
    private let manager = TransactionFlowManager()
    @Published var transactionStatusMessage: String = "Ready"

    func handleTransaction(amount: Decimal, recipient: String) async {
        let request = TransactionRequest(
            id: UUID().uuidString,
            amount: amount,
            recipientAccount: recipient,
            currency: "USD"
        )

        transactionStatusMessage = "Initiating transaction..."

        do {
            let confirmation = try await manager.initiateTransaction(request: request)
            DispatchQueue.main.async {
                self.transactionStatusMessage = "Success! Transaction ID: \(confirmation.transactionID). Status: \(confirmation.status.rawValue)"
            }
        } catch let error as TransactionError {
            DispatchQueue.main.async {
                self.transactionStatusMessage = "Transaction Failed: \(error.errorDescription ?? "Unknown Error")"
            }
        } catch {
            DispatchQueue.main.async {
                self.transactionStatusMessage = "An unexpected error occurred: \(error.localizedDescription)"
            }
        }
    }
}
*/
