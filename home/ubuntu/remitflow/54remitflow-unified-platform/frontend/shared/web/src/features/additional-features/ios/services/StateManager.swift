//
//  StateManager.swift
//  MyApp
//
//  Created by Manus AI on 2025/11/05.
//  Copyright © 2025 Manus AI. All rights reserved.
//

import Foundation
import Combine

// MARK: - 1. Data Models

/// Represents a simplified user profile.
struct UserProfile: Codable, Equatable {
    let id: String
    var email: String
    var firstName: String
    var lastName: String
    var lastLogin: Date?
}

/// Represents the unified application state.
struct AppState: Equatable {
    var isAuthenticated: Bool = false
    var userProfile: UserProfile? = nil
    var isLoading: Bool = false
    var error: AppError? = nil
    var settings: [String: String] = [:]
    
    /// Static initial state.
    static let initial = AppState()
}

// MARK: - 2. Error Handling

/// Custom error type for the application.
enum AppError: Error, Equatable {
    case networkError(String)
    case authenticationFailed
    case invalidData
    case custom(String)
    
    var localizedDescription: String {
        switch self {
        case .networkError(let message):
            return "Network Error: \(message)"
        case .authenticationFailed:
            return "Authentication failed. Please check your credentials."
        case .invalidData:
            return "The received data was invalid or corrupted."
        case .custom(let message):
            return message
        }
    }
}

// MARK: - 3. API Service Protocol (Simulated Backend Integration)

/// Protocol defining the interface for interacting with the backend API.
/// This allows for easy mocking and testing.
protocol APIServiceProtocol {
    func fetchUserProfile(userId: String) async throws -> UserProfile
    func updateSettings(key: String, value: String) async throws -> [String: String]
    func performLogin(credentials: (String, String)) async throws -> UserProfile
}

/// Concrete implementation of the API Service.
final class MockAPIService: APIServiceProtocol {
    
    /// Simulates a network delay.
    private func simulateDelay() async {
        try? await Task.sleep(nanoseconds: UInt64(1_000_000_000 * Double.random(in: 0.5...1.5)))
    }
    
    /// Simulates fetching a user profile from a backend.
    /// - Parameter userId: The ID of the user to fetch.
    /// - Returns: A `UserProfile` object.
    func fetchUserProfile(userId: String) async throws -> UserProfile {
        await simulateDelay()
        
        if userId == "error_user" {
            throw AppError.networkError("Failed to connect to user service.")
        }
        
        return UserProfile(
            id: userId,
            email: "user@example.com",
            firstName: "John",
            lastName: "Doe",
            lastLogin: Date()
        )
    }
    
    /// Simulates updating user settings.
    /// - Parameters:
    ///   - key: The setting key.
    ///   - value: The new setting value.
    /// - Returns: The updated dictionary of settings.
    func updateSettings(key: String, value: String) async throws -> [String: String] {
        await simulateDelay()
        
        if key == "fail_key" {
            throw AppError.custom("Failed to save setting due to server validation.")
        }
        
        var currentSettings = ["theme": "dark", "notifications": "on"]
        currentSettings[key] = value
        return currentSettings
    }
    
    /// Simulates a user login process.
    /// - Parameter credentials: A tuple of (username, password).
    /// - Returns: The logged-in `UserProfile`.
    func performLogin(credentials: (String, String)) async throws -> UserProfile {
        await simulateDelay()
        
        if credentials.0 == "test" && credentials.1 == "password" {
            return UserProfile(
                id: "user123",
                email: "test@app.com",
                firstName: "Test",
                lastName: "User",
                lastLogin: Date()
            )
        } else {
            throw AppError.authenticationFailed
        }
    }
}

// MARK: - 4. State Manager Implementation

/// A centralized, observable state manager for the entire application.
/// It conforms to `ObservableObject` to integrate seamlessly with SwiftUI.
/// All state mutations are handled within this class to ensure a single source of truth.
final class StateManager: ObservableObject {
    
    // MARK: - Published State
    
    /// The single source of truth for the application state.
    /// Any change to this property will automatically notify all SwiftUI views that are observing this object.
    @Published private(set) var state: AppState = .initial
    
    // MARK: - Dependencies
    
    /// The service layer dependency for API interactions.
    private let apiService: APIServiceProtocol
    
    /// A set to hold all Combine cancellables to prevent memory leaks.
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    /// Initializes the StateManager with a specific API service.
    /// - Parameter apiService: The service used for backend communication. Defaults to `MockAPIService`.
    init(apiService: APIServiceProtocol = MockAPIService()) {
        self.apiService = apiService
        // Perform initial setup or data loading here if necessary
        print("StateManager initialized.")
    }
    
    // MARK: - Required Methods
    
    /// Subscribes to the state changes and executes a closure when the state is updated.
    /// This is primarily for external components (like logging or analytics) that need to react to state changes
    /// without being a SwiftUI View. SwiftUI Views should use `@EnvironmentObject` or `@ObservedObject`.
    /// - Parameter handler: A closure that receives the new `AppState`.
    /// - Returns: An `AnyCancellable` token that must be stored to keep the subscription alive.
    func subscribe(handler: @escaping (AppState) -> Void) -> AnyCancellable {
        return $state
            .sink { newState in
                handler(newState)
            }
    }
    
    /// Mutates the current state using a closure, ensuring all changes are batched and published atomically.
    /// This is the *only* way to modify the `state` property.
    /// - Parameter mutation: A closure that takes a mutable reference to the current `AppState` and modifies it.
    func setState(mutation: (inout AppState) -> Void) {
        // Ensure state changes happen on the main thread, as required by ObservableObject
        DispatchQueue.main.async {
            mutation(&self.state)
            print("State updated: \(self.state)")
        }
    }
    
    /// Retrieves a specific piece of information from the current state.
    /// - Returns: The current `UserProfile` if authenticated, otherwise `nil`.
    func getUserContext() -> UserProfile? {
        return state.userProfile
    }
    
    // MARK: - Business Logic / API Integration
    
    /// Attempts to log in a user with the given credentials.
    /// Uses modern Swift concurrency (`async/await`) for asynchronous operations.
    /// - Parameters:
    ///   - username: The user's username or email.
    ///   - password: The user's password.
    @MainActor
    func login(username: String, password: String) async {
        setState { $0.isLoading = true; $0.error = nil }
        
        do {
            let userProfile = try await apiService.performLogin(credentials: (username, password))
            
            setState {
                $0.userProfile = userProfile
                $0.isAuthenticated = true
                $0.isLoading = false
            }
            
        } catch let error as AppError {
            // Handle specific application errors
            setState {
                $0.error = error
                $0.isLoading = false
                $0.isAuthenticated = false
            }
            print("Login failed with AppError: \(error.localizedDescription)")
            
        } catch {
            // Handle unexpected errors (e.g., system errors)
            let customError = AppError.custom("An unexpected error occurred during login: \(error.localizedDescription)")
            setState {
                $0.error = customError
                $0.isLoading = false
                $0.isAuthenticated = false
            }
            print("Login failed with unexpected error: \(error.localizedDescription)")
        }
    }
    
    /// Logs out the current user and resets the state to its initial value.
    @MainActor
    func logout() {
        // In a real app, this would also involve clearing tokens/session data
        setState {
            $0 = .initial
        }
        print("User logged out. State reset.")
    }
    
    /// Fetches the latest user profile data from the backend.
    @MainActor
    func refreshUserProfile() async {
        guard let userId = state.userProfile?.id else {
            setState { $0.error = AppError.custom("Cannot refresh profile: User ID not found.") }
            return
        }
        
        setState { $0.isLoading = true; $0.error = nil }
        
        do {
            let updatedProfile = try await apiService.fetchUserProfile(userId: userId)
            
            setState {
                $0.userProfile = updatedProfile
                $0.isLoading = false
            }
            
        } catch let error as AppError {
            setState {
                $0.error = error
                $0.isLoading = false
            }
            print("Profile refresh failed: \(error.localizedDescription)")
            
        } catch {
            setState {
                $0.error = AppError.custom("An unexpected error occurred during profile refresh.")
                $0.isLoading = false
            }
        }
    }
    
    /// Updates a specific setting and persists it via the API.
    /// - Parameters:
    ///   - key: The setting key.
    ///   - value: The new setting value.
    @MainActor
    func updateSetting(key: String, value: String) async {
        setState { $0.isLoading = true; $0.error = nil }
        
        do {
            let updatedSettings = try await apiService.updateSettings(key: key, value: value)
            
            setState {
                $0.settings = updatedSettings
                $0.isLoading = false
            }
            
        } catch let error as AppError {
            setState {
                $0.error = error
                $0.isLoading = false
            }
            print("Setting update failed: \(error.localizedDescription)")
            
        } catch {
            setState {
                $0.error = AppError.custom("An unexpected error occurred during setting update.")
                $0.isLoading = false
            }
        }
    }
    
    // MARK: - Utility and Debugging
    
    /// Prints the current state to the console for debugging purposes.
    func printCurrentState() {
        print("--- Current App State ---")
        print("Is Authenticated: \(state.isAuthenticated)")
        print("User Profile: \(state.userProfile?.firstName ?? "N/A")")
        print("Is Loading: \(state.isLoading)")
        print("Error: \(state.error?.localizedDescription ?? "None")")
        print("Settings: \(state.settings)")
        print("-------------------------")
    }
    
    /// Resets the error state.
    func clearError() {
        setState { $0.error = nil }
    }
}

// MARK: - 5. Example Usage (Documentation)

/*
 
 // --- How to use the StateManager in a SwiftUI App ---
 
 // 1. Inject the StateManager into the environment in your App file:
 
 @main
 struct MyApp: App {
     @StateObject var stateManager = StateManager()
 
     var body: some Scene {
         WindowGroup {
             ContentView()
                 .environmentObject(stateManager) // Inject into environment
         }
     }
 }
 
 // 2. Observe the state in a SwiftUI View:
 
 struct ContentView: View {
     @EnvironmentObject var stateManager: StateManager
 
     var body: some View {
         VStack {
             if stateManager.state.isLoading {
                 ProgressView("Loading...")
             } else if let error = stateManager.state.error {
                 Text("Error: \(error.localizedDescription)")
                     .foregroundColor(.red)
             } else if stateManager.state.isAuthenticated {
                 // Display authenticated view
                 Text("Welcome, \(stateManager.state.userProfile?.firstName ?? "User")!")
                 Button("Logout") {
                     stateManager.logout()
                 }
                 Button("Refresh Profile") {
                     Task { await stateManager.refreshUserProfile() }
                 }
             } else {
                 // Display login view
                 LoginView()
             }
         }
     }
 }
 
 // 3. Mutate the state from a View (e.g., a Login button action):
 
 struct LoginView: View {
     @EnvironmentObject var stateManager: StateManager
     @State private var username = ""
     @State private var password = ""
 
     var body: some View {
         VStack {
             TextField("Username", text: $username)
             SecureField("Password", text: $password)
             Button("Login") {
                 Task {
                     await stateManager.login(username: username, password: password)
                 }
             }
         }
     }
 }
 
 // 4. Using the `subscribe` method for non-UI logic (e.g., analytics):
 
 func setupAnalytics(manager: StateManager) {
     manager.subscribe { state in
         if state.isAuthenticated {
             // Log event to analytics service
             print("Analytics: User logged in with ID: \(state.userProfile?.id ?? "N/A")")
         }
     }
     .store(in: &cancellables) // Ensure you store the cancellable
 }
 
 */
