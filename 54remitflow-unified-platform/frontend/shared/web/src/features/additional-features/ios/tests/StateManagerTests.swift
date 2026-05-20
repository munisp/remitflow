import XCTest
import Combine
@testable import StateManagerApp // Assuming the module name is StateManagerApp, replace with actual module name if known

// Include the supporting types and classes for the test environment
// In a real project, these would be imported from the main module or a TestSupport module.
// For this standalone test file, we include them here for completeness.

// MARK: - Supporting Types (Copied from MockAPIClient.swift)
struct UserContext: Codable, Equatable {
    let userId: String
    let username: String
    let email: String
    let isLoggedIn: Bool
}

enum APIError: Error, Equatable {
    case networkError
    case serverError(code: Int)
    case decodingError
    case unknown
}

protocol APIClient {
    func fetchUserContext() -> AnyPublisher<UserContext, APIError>
    func updateState(key: String, value: String) -> AnyPublisher<Void, APIError>
}

class MockAPIClient: APIClient {
    enum MockScenario {
        case success
        case failure(APIError)
    }

    var scenario: MockScenario = .success
    var fetchUserContextCallCount = 0
    var updateStateCallCount = 0
    var updateStateParameters: (key: String, value: String)?

    func fetchUserContext() -> AnyPublisher<UserContext, APIError> {
        fetchUserContextCallCount += 1
        switch scenario {
        case .success:
            let mockContext = UserContext(
                userId: "user-123",
                username: "testuser",
                email: "test@example.com",
                isLoggedIn: true
            )
            return Just(mockContext)
                .setFailureType(to: APIError.self)
                .eraseToAnyPublisher()
        case .failure(let error):
            return Fail(error: error)
                .eraseToAnyPublisher()
        }
    }

    func updateState(key: String, value: String) -> AnyPublisher<Void, APIError> {
        updateStateCallCount += 1
        updateStateParameters = (key, value)
        switch scenario {
        case .success:
            return Just(())
                .setFailureType(to: APIError.self)
                .eraseToAnyPublisher()
        case .failure(let error):
            return Fail(error: error)
                .eraseToAnyPublisher()
        }
    }
}

// MARK: - StateManager (Copied from StateManager.swift)
struct AppState: Equatable {
    var userContext: UserContext? = nil
    var settings: [String: String] = [:]
    var isLoading: Bool = false
}

class StateManager {
    private let apiClient: APIClient
    private var cancellables = Set<AnyCancellable>()
    private let stateSubject: CurrentValueSubject<AppState, Never>

    var statePublisher: AnyPublisher<AppState, Never> {
        stateSubject.eraseToAnyPublisher()
    }

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        self.stateSubject = CurrentValueSubject(AppState())
    }

    func getUserContext() -> UserContext? {
        return stateSubject.value.userContext
    }

    func fetchUserContext() {
        stateSubject.value.isLoading = true
        apiClient.fetchUserContext()
            .receive(on: DispatchQueue.main)
            .sink(receiveCompletion: { [weak self] completion in
                guard let self = self else { return }
                self.stateSubject.value.isLoading = false
                if case .failure(let error) = completion {
                    print("Error fetching user context: \(error)")
                    // In a real app, we might update an error state here
                }
            }, receiveValue: { [weak self] context in
                guard let self = self else { return }
                self.stateSubject.value.userContext = context
            })
            .store(in: &cancellables)
    }

    func setState(key: String, value: String) {
        var newState = stateSubject.value
        newState.settings[key] = value
        stateSubject.value = newState

        apiClient.updateState(key: key, value: value)
            .sink(receiveCompletion: { completion in
                if case .failure(let error) = completion {
                    print("Error updating state via API: \(error)")
                    // In a real app, we might revert the local state or show an error
                }
            }, receiveValue: { _ in
                // API update successful
            })
            .store(in: &cancellables)
    }

    func subscribe(handler: @escaping (AppState) -> Void) -> AnyCancellable {
        return statePublisher
            .sink(receiveValue: handler)
    }
}

// MARK: - StateManagerTests
class StateManagerTests: XCTestCase {

    var sut: StateManager! // System Under Test
    var mockAPIClient: MockAPIClient!
    var cancellables: Set<AnyCancellable>!

    // MARK: - Setup and Teardown

    override func setUp() {
        super.setUp()
        mockAPIClient = MockAPIClient()
        sut = StateManager(apiClient: mockAPIClient)
        cancellables = Set<AnyCancellable>()
    }

    override func tearDown() {
        sut = nil
        mockAPIClient = nil
        cancellables.removeAll()
        super.tearDown()
    }

    // MARK: - Test getUserContext

    func test_getUserContext_initiallyReturnsNil() {
        // Given the initial state
        // When
        let context = sut.getUserContext()
        // Then
        XCTAssertNil(context, "User context should be nil initially")
    }

    func test_getUserContext_returnsContextAfterSuccessfulFetch() {
        // Given
        let expectation = XCTestExpectation(description: "Fetch user context completes")
        let expectedContext = UserContext(userId: "user-123", username: "testuser", email: "test@example.com", isLoggedIn: true)

        // When
        sut.fetchUserContext()

        // Wait for the Combine publisher to complete and update the state
        sut.statePublisher
            .dropFirst() // Drop initial state
            .filter { $0.userContext != nil && !$0.isLoading }
            .sink { state in
                XCTAssertEqual(state.userContext, expectedContext)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)

        // Then
        XCTAssertEqual(sut.getUserContext(), expectedContext, "getUserContext should return the fetched context")
    }

    // MARK: - Test fetchUserContext (API Calls and Combine Publishers)

    func test_fetchUserContext_updatesLoadingState() {
        // Given
        let expectation = XCTestExpectation(description: "Loading state changes")
        expectation.expectedFulfillmentCount = 2 // true -> false

        var loadingStates: [Bool] = []

        // When
        sut.statePublisher
            .map { $0.isLoading }
            .sink { isLoading in
                loadingStates.append(isLoading)
                if loadingStates.count == 3 {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        sut.fetchUserContext()

        // Then
        wait(for: [expectation], timeout: 1.0)
        // Initial state (false), Start fetch (true), End fetch (false)
        XCTAssertEqual(loadingStates, [false, true, false], "Loading state should transition from false to true and back to false")
        XCTAssertEqual(mockAPIClient.fetchUserContextCallCount, 1, "API client fetchUserContext should be called once")
    }

    func test_fetchUserContext_successScenario_updatesUserContext() {
        // Given
        let expectation = XCTestExpectation(description: "User context is updated")
        let expectedContext = UserContext(userId: "user-123", username: "testuser", email: "test@example.com", isLoggedIn: true)

        // When
        sut.fetchUserContext()

        // Then
        sut.statePublisher
            .dropFirst() // Drop initial state
            .filter { $0.userContext != nil }
            .sink { state in
                XCTAssertEqual(state.userContext, expectedContext, "State should contain the fetched user context")
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
    }

    func test_fetchUserContext_errorScenario_doesNotUpdateUserContext() {
        // Given
        let expectation = XCTestExpectation(description: "Error scenario completes")
        mockAPIClient.scenario = .failure(.networkError)
        let initialContext = sut.getUserContext()

        // When
        sut.fetchUserContext()

        // Wait for the operation to complete (loading state to return to false)
        sut.statePublisher
            .dropFirst() // Drop initial state
            .filter { !$0.isLoading }
            .sink { state in
                // Then
                XCTAssertEqual(state.userContext, initialContext, "User context should remain nil on API error")
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(mockAPIClient.fetchUserContextCallCount, 1)
    }

    // MARK: - Test setState

    func test_setState_updatesLocalStateImmediately() {
        // Given
        let key = "theme"
        let value = "dark"

        // When
        sut.setState(key: key, value: value)

        // Then
        let currentState = sut.statePublisher.value
        XCTAssertEqual(currentState.settings[key], value, "Local state should be updated immediately")
        XCTAssertEqual(mockAPIClient.updateStateCallCount, 1, "API client updateState should be called once")
        XCTAssertEqual(mockAPIClient.updateStateParameters?.key, key)
        XCTAssertEqual(mockAPIClient.updateStateParameters?.value, value)
    }

    func test_setState_multipleCalls_updatesLocalStateCorrectly() {
        // Given
        let key1 = "theme"
        let value1 = "dark"
        let key2 = "notifications"
        let value2 = "off"

        // When
        sut.setState(key: key1, value: value1)
        sut.setState(key: key2, value: value2)

        // Then
        let currentState = sut.statePublisher.value
        XCTAssertEqual(currentState.settings[key1], value1)
        XCTAssertEqual(currentState.settings[key2], value2)
        XCTAssertEqual(mockAPIClient.updateStateCallCount, 2)
    }

    func test_setState_apiErrorScenario_localStateRemainsUpdated() {
        // Given
        let key = "language"
        let value = "fr"
        mockAPIClient.scenario = .failure(.serverError(code: 500))

        // When
        sut.setState(key: key, value: value)

        // Wait for the API call to complete (even though it fails, the sink closure runs)
        let expectation = XCTestExpectation(description: "API call completes with error")
        // Since the StateManager does not revert state on error, we just ensure the API call was made.
        // We use a short delay to allow the Combine pipeline to execute.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1.0)

        // Then
        let currentState = sut.statePublisher.value
        XCTAssertEqual(currentState.settings[key], value, "Local state should remain updated even if API call fails (as per current StateManager logic)")
        XCTAssertEqual(mockAPIClient.updateStateCallCount, 1)
    }

    // MARK: - Test subscribe (Combine Publishers)

    func test_subscribe_receivesInitialState() {
        // Given
        let expectation = XCTestExpectation(description: "Subscriber receives initial state")
        var receivedState: AppState?

        // When
        sut.subscribe { state in
            receivedState = state
            expectation.fulfill()
        }
        .store(in: &cancellables)

        // Then
        wait(for: [expectation], timeout: 0.1)
        XCTAssertNotNil(receivedState)
        XCTAssertEqual(receivedState, AppState(), "Received state should be the initial state")
    }

    func test_subscribe_receivesStateUpdates() {
        // Given
        let expectation = XCTestExpectation(description: "Subscriber receives two state updates")
        expectation.expectedFulfillmentCount = 3 // Initial + 2 updates
        var receivedStates: [AppState] = []

        // When
        sut.subscribe { state in
            receivedStates.append(state)
            if receivedStates.count == 3 {
                expectation.fulfill()
            }
        }
        .store(in: &cancellables)

        sut.setState(key: "key1", value: "value1")
        sut.setState(key: "key2", value: "value2")

        // Then
        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(receivedStates.count, 3)

        // Check the final state
        let finalState = receivedStates.last!
        XCTAssertEqual(finalState.settings["key1"], "value1")
        XCTAssertEqual(finalState.settings["key2"], "value2")
    }

    func test_statePublisher_isAnyPublisher() {
        // Given
        let publisher = sut.statePublisher
        // Then
        XCTAssertTrue(type(of: publisher) == AnyPublisher<AppState, Never>.self, "statePublisher should be an AnyPublisher")
    }

    // MARK: - Edge Case Testing

    func test_setState_emptyKeyAndValue() {
        // Given
        let key = ""
        let value = ""

        // When
        sut.setState(key: key, value: value)

        // Then
        let currentState = sut.statePublisher.value
        XCTAssertEqual(currentState.settings[key], value, "Should handle empty key and value")
        XCTAssertEqual(mockAPIClient.updateStateParameters?.key, key)
        XCTAssertEqual(mockAPIClient.updateStateParameters?.value, value)
    }

    func test_fetchUserContext_calledTwice() {
        // Given
        let expectation = XCTestExpectation(description: "Two fetch operations complete")
        expectation.expectedFulfillmentCount = 2

        // When
        sut.fetchUserContext()
        sut.fetchUserContext()

        // Wait for the loading state to return to false twice (initial is false, then true, false, true, false)
        sut.statePublisher
            .dropFirst()
            .filter { !$0.isLoading }
            .sink { _ in
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 2.0)

        // Then
        XCTAssertEqual(mockAPIClient.fetchUserContextCallCount, 2, "API client fetchUserContext should be called twice")
        XCTAssertNotNil(sut.getUserContext(), "User context should be set after two successful fetches")
    }
}