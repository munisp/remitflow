import XCTest

// MARK: - Assumed Model and Protocol Definitions

/// A simple struct representing the data required to initiate a transaction.
struct TransactionRequest: Encodable {
    let amount: Double
    let recipientID: String
}

/// A simple struct representing the successful result of a transaction.
struct TransactionReceipt: Decodable, Equatable {
    let transactionID: String
    let status: String
    let timestamp: Date
}

/// Custom errors that the API service or manager might throw.
enum TransactionError: Error, Equatable {
    case invalidInput
    case apiError(statusCode: Int, message: String)
    case serverError
    case transactionFailed(reason: String)
    case unknown
}

/// Protocol for the dependency that handles network communication.
protocol APIServiceProtocol {
    func performTransaction(request: TransactionRequest) async throws -> TransactionReceipt
}

/// Protocol for the system under test (SUT).
protocol TransactionFlowManaging {
    func initiateTransaction(amount: Double, recipientID: String) async throws -> TransactionReceipt
}

/// The actual class being tested (SUT).
class TransactionFlowManager: TransactionFlowManaging {
    private let apiService: APIServiceProtocol
    
    init(apiService: APIServiceProtocol) {
        self.apiService = apiService
    }
    
    func initiateTransaction(amount: Double, recipientID: String) async throws -> TransactionReceipt {
        // 1. Input validation
        guard amount > 0 else {
            throw TransactionError.invalidInput
        }
        guard !recipientID.isEmpty else {
            throw TransactionError.invalidInput
        }
        
        // 2. Prepare request
        let request = TransactionRequest(amount: amount, recipientID: recipientID)
        
        // 3. Perform API call
        do {
            let receipt = try await apiService.performTransaction(request: request)
            
            // 4. Post-processing/Status check (Simulated)
            if receipt.status == "PENDING" {
                // For this test, we'll assume PENDING is a success, but a real-world scenario might throw an error here.
                return receipt
            } else if receipt.status == "FAILED" {
                throw TransactionError.transactionFailed(reason: "Transaction status returned FAILED")
            }
            
            return receipt
        } catch let apiError as TransactionError {
            // Re-throw specific API errors
            throw apiError
        } catch {
            // Catch all other errors (e.g., network issues, decoding errors)
            throw TransactionError.serverError
        }
    }
}

// MARK: - Mock Implementation for APIServiceProtocol

class MockAPIService: APIServiceProtocol {
    enum Result {
        case success(TransactionReceipt)
        case failure(Error)
    }
    
    var nextResult: Result?
    var capturedRequest: TransactionRequest?
    
    func performTransaction(request: TransactionRequest) async throws -> TransactionReceipt {
        capturedRequest = request
        
        guard let result = nextResult else {
            XCTFail("MockAPIService was called without a configured result.")
            throw TransactionError.unknown
        }
        
        switch result {
        case .success(let receipt):
            return receipt
        case .failure(let error):
            throw error
        }
    }
}

// MARK: - XCTest Case

final class TransactionFlowManagerTests: XCTestCase {
    
    var sut: TransactionFlowManager! // System Under Test
    var mockAPIService: MockAPIService!
    
    // MARK: Setup and Teardown
    
    override func setUp() {
        super.setUp()
        // Initialize mock and SUT before each test
        mockAPIService = MockAPIService()
        sut = TransactionFlowManager(apiService: mockAPIService)
    }
    
    override func tearDown() {
        // Clean up after each test
        sut = nil
        mockAPIService = nil
        super.tearDown()
    }
    
    // MARK: Test Cases for initiateTransaction
    
    /// Test case 1: Successful transaction with valid inputs.
    func test_initiateTransaction_success() async throws {
        // GIVEN
        let expectedReceipt = TransactionReceipt(
            transactionID: "TX-12345",
            status: "COMPLETED",
            timestamp: Date()
        )
        mockAPIService.nextResult = .success(expectedReceipt)
        let amount: Double = 100.50
        let recipientID: String = "user-abc-123"
        
        // WHEN
        let receipt = try await sut.initiateTransaction(amount: amount, recipientID: recipientID)
        
        // THEN
        XCTAssertEqual(receipt, expectedReceipt, "The returned receipt should match the expected receipt.")
        XCTAssertEqual(mockAPIService.capturedRequest?.amount, amount, "Mock should capture the correct amount.")
        XCTAssertEqual(mockAPIService.capturedRequest?.recipientID, recipientID, "Mock should capture the correct recipient ID.")
    }
    
    /// Test case 2: Transaction fails due to zero amount (Input validation edge case).
    func test_initiateTransaction_failure_zeroAmount() async {
        // GIVEN
        let amount: Double = 0.0
        let recipientID: String = "user-abc-123"
        
        // WHEN
        do {
            _ = try await sut.initiateTransaction(amount: amount, recipientID: recipientID)
            XCTFail("Expected TransactionError.invalidInput but transaction succeeded.")
        } catch let error as TransactionError {
            // THEN
            XCTAssertEqual(error, .invalidInput, "Should fail with invalidInput for zero amount.")
        } catch {
            XCTFail("Expected TransactionError.invalidInput but received a different error: \(error)")
        }
    }
    
    /// Test case 3: Transaction fails due to negative amount (Input validation edge case).
    func test_initiateTransaction_failure_negativeAmount() async {
        // GIVEN
        let amount: Double = -10.0
        let recipientID: String = "user-abc-123"
        
        // WHEN
        do {
            _ = try await sut.initiateTransaction(amount: amount, recipientID: recipientID)
            XCTFail("Expected TransactionError.invalidInput but transaction succeeded.")
        } catch let error as TransactionError {
            // THEN
            XCTAssertEqual(error, .invalidInput, "Should fail with invalidInput for negative amount.")
        } catch {
            XCTFail("Expected TransactionError.invalidInput but received a different error: \(error)")
        }
    }
    
    /// Test case 4: Transaction fails due to empty recipient ID (Input validation edge case).
    func test_initiateTransaction_failure_emptyRecipientID() async {
        // GIVEN
        let amount: Double = 50.0
        let recipientID: String = ""
        
        // WHEN
        do {
            _ = try await sut.initiateTransaction(amount: amount, recipientID: recipientID)
            XCTFail("Expected TransactionError.invalidInput but transaction succeeded.")
        } catch let error as TransactionError {
            // THEN
            XCTAssertEqual(error, .invalidInput, "Should fail with invalidInput for empty recipient ID.")
        } catch {
            XCTFail("Expected TransactionError.invalidInput but received a different error: \(error)")
        }
    }
    
    /// Test case 5: API returns a specific, expected error (e.g., 401 Unauthorized).
    func test_initiateTransaction_failure_apiSpecificError() async {
        // GIVEN
        let expectedError: TransactionError = .apiError(statusCode: 401, message: "Unauthorized")
        mockAPIService.nextResult = .failure(expectedError)
        
        // WHEN
        do {
            _ = try await sut.initiateTransaction(amount: 10.0, recipientID: "user-456")
            XCTFail("Expected a specific API error but transaction succeeded.")
        } catch let error as TransactionError {
            // THEN
            XCTAssertEqual(error, expectedError, "Should fail with the specific API error.")
        } catch {
            XCTFail("Expected TransactionError but received a different error: \(error)")
        }
    }
    
    /// Test case 6: API returns a generic network or decoding error, which should be mapped to a server error.
    func test_initiateTransaction_failure_genericServerError() async {
        // GIVEN
        // Use a standard Swift error to simulate a non-TransactionError from the API layer (e.g., URLSession error, decoding error)
        struct MockNetworkError: Error {}
        mockAPIService.nextResult = .failure(MockNetworkError())
        
        // WHEN
        do {
            _ = try await sut.initiateTransaction(amount: 10.0, recipientID: "user-456")
            XCTFail("Expected a server error but transaction succeeded.")
        } catch let error as TransactionError {
            // THEN
            XCTAssertEqual(error, .serverError, "Should map generic errors to .serverError.")
        } catch {
            XCTFail("Expected TransactionError.serverError but received a different error: \(error)")
        }
    }
    
    /// Test case 7: API returns a receipt with a 'FAILED' status, which should be handled as a specific business logic error.
    func test_initiateTransaction_failure_receiptStatusFailed() async {
        // GIVEN
        let failedReceipt = TransactionReceipt(
            transactionID: "TX-99999",
            status: "FAILED",
            timestamp: Date()
        )
        mockAPIService.nextResult = .success(failedReceipt)
        
        // WHEN
        do {
            _ = try await sut.initiateTransaction(amount: 10.0, recipientID: "user-456")
            XCTFail("Expected a transaction failed error but transaction succeeded.")
        } catch let error as TransactionError {
            // THEN
            // We check for the specific case where the receipt status indicates failure
            if case .transactionFailed = error {
                XCTAssert(true, "Should fail with .transactionFailed.")
            } else {
                XCTFail("Expected .transactionFailed but received \(error)")
            }
        } catch {
            XCTFail("Expected TransactionError.transactionFailed but received a different error: \(error)")
        }
    }
    
    /// Test case 8: Successful transaction with a 'PENDING' status (Edge case for post-processing).
    func test_initiateTransaction_success_pendingStatus() async throws {
        // GIVEN
        let expectedReceipt = TransactionReceipt(
            transactionID: "TX-67890",
            status: "PENDING",
            timestamp: Date()
        )
        mockAPIService.nextResult = .success(expectedReceipt)
        
        // WHEN
        let receipt = try await sut.initiateTransaction(amount: 5.0, recipientID: "user-pending")
        
        // THEN
        XCTAssertEqual(receipt.status, "PENDING", "The returned receipt status should be PENDING.")
        XCTAssertEqual(receipt, expectedReceipt, "The returned receipt should match the expected receipt.")
    }
    
    /// Test case 9: Test for a very large amount (Boundary/Edge case).
    func test_initiateTransaction_success_largeAmount() async throws {
        // GIVEN
        let largeAmount: Double = 999_999_999.99
        let expectedReceipt = TransactionReceipt(
            transactionID: "TX-LARGE",
            status: "COMPLETED",
            timestamp: Date()
        )
        mockAPIService.nextResult = .success(expectedReceipt)
        
        // WHEN
        let receipt = try await sut.initiateTransaction(amount: largeAmount, recipientID: "user-large")
        
        // THEN
        XCTAssertEqual(receipt, expectedReceipt)
        XCTAssertEqual(mockAPIService.capturedRequest?.amount, largeAmount)
    }
}