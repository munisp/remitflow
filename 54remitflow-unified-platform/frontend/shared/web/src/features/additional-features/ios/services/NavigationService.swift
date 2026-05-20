//
//  NavigationService.swift
//  MyApp
//
//  Created by Manus AI on 2025/11/05.
//

import Foundation
import UIKit
import SwiftUI

// MARK: - 1. Protocols and Enums

/// A protocol defining the contract for the application's navigation service.
/// This allows for easy mocking and dependency injection.
protocol NavigationServiceProtocol: AnyObject {
    /// The main entry point for all navigation actions.
    /// - Parameter route: The specific destination to navigate to.
    func navigate(to route: AppRoute) async
    
    /// Navigates the user to the Know Your Customer (KYC) upgrade flow.
    /// This is typically a modal presentation or a deep link into a specific flow.
    /// - Parameter sourceViewController: The view controller from which the navigation is initiated.
    func navigateToKYCUpgrade(from sourceViewController: UIViewController) async
    
    /// Navigates the user to a specific transaction detail or creation screen.
    /// - Parameters:
    ///   - transactionID: The unique identifier of the transaction to view (optional for creation).
    ///   - sourceViewController: The view controller from which the navigation is initiated.
    func navigateToTransaction(withID transactionID: String?, from sourceViewController: UIViewController) async
    
    /// Handles the completion of the KYC process, typically by dismissing the flow
    /// and refreshing the user's state.
    /// - Parameter result: The outcome of the KYC process.
    func handleKYCComplete(with result: KYCCompletionResult) async
}

/// Defines all possible navigation destinations within the application.
enum AppRoute {
    case home
    case profile
    case settings
    case kycUpgrade
    case transactionDetail(id: String)
    case transactionCreation
    case webView(url: URL)
    case custom(viewController: UIViewController)
}

/// Defines the possible outcomes of the KYC completion process.
enum KYCCompletionResult {
    case success(userID: String)
    case failure(error: NavigationError)
    case cancelled
}

/// Custom error types for the navigation service.
enum NavigationError: Error, LocalizedError {
    case invalidURL(url: String)
    case missingRootViewController
    case navigationFailed(route: AppRoute, reason: String)
    case apiError(statusCode: Int, message: String)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL(let url):
            return "The provided URL is invalid: \(url)"
        case .missingRootViewController:
            return "The application's root view controller could not be found."
        case .navigationFailed(let route, let reason):
            return "Navigation to route \(route) failed: \(reason)"
        case .apiError(let statusCode, let message):
            return "API call failed with status code \(statusCode): \(message)"
        }
    }
}

// MARK: - 2. Navigation Service Implementation

/// A concrete implementation of the `NavigationServiceProtocol` using the Coordinator pattern.
/// It manages the flow and presentation of view controllers and SwiftUI views.
final class NavigationService: NavigationServiceProtocol {
    
    // MARK: - Properties
    
    /// The main window of the application.
    private let window: UIWindow?
    
    /// A simple mock API client for demonstration purposes.
    private let apiClient: MockAPIClient
    
    /// A weak reference to the currently active coordinator, if any.
    private weak var activeCoordinator: Coordinator?
    
    // MARK: - Initialization
    
    /// Initializes the navigation service.
    /// - Parameters:
    ///   - window: The application's main window.
    ///   - apiClient: The client used for backend API interactions.
    init(window: UIWindow?, apiClient: MockAPIClient = MockAPIClient()) {
        self.window = window
        self.apiClient = apiClient
        Logger.log("NavigationService initialized.")
    }
    
    // MARK: - NavigationServiceProtocol Implementation
    
    /// The unified navigation entry point.
    /// - Parameter route: The destination route.
    func navigate(to route: AppRoute) async {
        Logger.log("Attempting to navigate to route: \(route)")
        
        guard let rootViewController = window?.rootViewController else {
            Logger.error("Navigation failed: Missing root view controller.")
            return
        }
        
        do {
            switch route {
            case .home:
                // Assuming the root is already the home screen or a tab bar controller
                // We might just pop to root or select a tab.
                if let tabBarController = rootViewController as? UITabBarController {
                    tabBarController.selectedIndex = 0
                } else {
                    Logger.log("Already at home or no tab bar controller.")
                }
                
            case .profile:
                // Example of navigating to a SwiftUI view hosted in a UIHostingController
                let profileView = ProfileView(viewModel: ProfileViewModel(apiClient: apiClient))
                let hostingController = UIHostingController(rootView: profileView)
                await present(hostingController, from: rootViewController)
                
            case .settings:
                let settingsVC = SettingsViewController()
                await push(settingsVC, onto: rootViewController)
                
            case .kycUpgrade:
                // Delegate to the specific method
                await navigateToKYCUpgrade(from: rootViewController)
                
            case .transactionDetail(let id):
                await navigateToTransaction(withID: id, from: rootViewController)
                
            case .transactionCreation:
                await navigateToTransaction(withID: nil, from: rootViewController)
                
            case .webView(let url):
                let webVC = WebViewController(url: url)
                await present(webVC, from: rootViewController)
                
            case .custom(let viewController):
                await present(viewController, from: rootViewController)
            }
            
            Logger.log("Successfully navigated to route: \(route)")
            
        } catch let error as NavigationError {
            Logger.error("Navigation failed with error: \(error.localizedDescription)")
            // Present a user-facing alert for the error
            await presentErrorAlert(error, on: rootViewController)
        } catch {
            Logger.error("An unexpected error occurred during navigation: \(error.localizedDescription)")
        }
    }
    
    /// Navigates the user to the KYC upgrade flow.
    /// - Parameter sourceViewController: The view controller to present from.
    func navigateToKYCUpgrade(from sourceViewController: UIViewController) async {
        Logger.log("Starting KYC Upgrade flow...")
        
        do {
            // 1. Pre-flight check with API (simulated async operation)
            let isEligible = try await apiClient.checkKYCEligibility()
            
            guard isEligible else {
                throw NavigationError.navigationFailed(route: .kycUpgrade, reason: "User is not eligible for KYC upgrade.")
            }
            
            // 2. Start the KYC Coordinator
            let kycCoordinator = KYCUpgradeCoordinator(
                presenter: sourceViewController,
                navigationService: self,
                apiClient: apiClient
            )
            
            // Keep a strong reference to the coordinator while it's active
            self.activeCoordinator = kycCoordinator
            
            // Start the flow
            await kycCoordinator.start()
            
        } catch let error as NavigationError {
            Logger.error("KYC Upgrade flow failed: \(error.localizedDescription)")
            await presentErrorAlert(error, on: sourceViewController)
        } catch {
            Logger.error("An unexpected error occurred during KYC flow: \(error.localizedDescription)")
        }
    }
    
    /// Navigates the user to a specific transaction detail or creation screen.
    /// - Parameters:
    ///   - transactionID: The unique identifier of the transaction to view (optional for creation).
    ///   - sourceViewController: The view controller to present from.
    func navigateToTransaction(withID transactionID: String?, from sourceViewController: UIViewController) async {
        Logger.log("Navigating to transaction flow. ID: \(transactionID ?? "New Transaction")")
        
        do {
            let transactionVC: UIViewController
            
            if let id = transactionID {
                // 1. Fetch transaction details (simulated async operation)
                let transaction = try await apiClient.fetchTransaction(id: id)
                
                // 2. Create the detail view controller
                let detailView = TransactionDetailView(transaction: transaction)
                transactionVC = UIHostingController(rootView: detailView)
                transactionVC.title = "Transaction Detail"
            } else {
                // 1. Create the creation view controller
                let creationView = TransactionCreationView(apiClient: apiClient)
                transactionVC = UIHostingController(rootView: creationView)
                transactionVC.title = "New Transaction"
            }
            
            // 3. Present the view controller
            await push(transactionVC, onto: sourceViewController)
            
        } catch let error as NavigationError {
            Logger.error("Transaction navigation failed: \(error.localizedDescription)")
            await presentErrorAlert(error, on: sourceViewController)
        } catch {
            Logger.error("An unexpected error occurred during transaction navigation: \(error.localizedDescription)")
        }
    }
    
    /// Handles the completion of the KYC process.
    /// - Parameter result: The outcome of the KYC process.
    func handleKYCComplete(with result: KYCCompletionResult) async {
        Logger.log("Handling KYC completion with result: \(result)")
        
        // 1. Dismiss the KYC flow
        await activeCoordinator?.finish()
        self.activeCoordinator = nil // Release the coordinator
        
        // 2. Handle the result
        switch result {
        case .success(let userID):
            Logger.log("KYC successfully completed for user: \(userID). Refreshing user state.")
            // Perform post-KYC actions, e.g., refresh user data from API
            do {
                try await apiClient.refreshUserState(for: userID)
                // Navigate to a success screen or back to home
                await navigate(to: .home)
            } catch let error as NavigationError {
                Logger.error("Post-KYC refresh failed: \(error.localizedDescription)")
                await presentErrorAlert(error, on: window?.rootViewController)
            } catch {
                Logger.error("An unexpected error occurred during post-KYC refresh: \(error.localizedDescription)")
            }
            
        case .failure(let error):
            Logger.error("KYC failed with error: \(error.localizedDescription)")
            // Navigate to an error screen or present an alert
            await presentErrorAlert(error, on: window?.rootViewController)
            
        case .cancelled:
            Logger.log("KYC process was cancelled by the user.")
            // Optionally navigate back to a safe screen
            await navigate(to: .home)
        }
    }
    
    // MARK: - Private Helper Methods (Presentation Logic)
    
    /// Presents a view controller modally.
    @MainActor
    private func present(_ viewController: UIViewController, from sourceViewController: UIViewController) async {
        // Find the top-most view controller to present from
        let topVC = sourceViewController.topMostViewController()
        
        // Wrap in a UINavigationController for a better modal experience
        let navigationController = UINavigationController(rootViewController: viewController)
        
        // Use a continuation to bridge the UIKit completion handler to Swift's async/await
        await withCheckedContinuation { continuation in
            topVC.present(navigationController, animated: true) {
                continuation.resume()
            }
        }
    }
    
    /// Pushes a view controller onto the navigation stack.
    @MainActor
    private func push(_ viewController: UIViewController, onto sourceViewController: UIViewController) async {
        // Find the navigation controller
        let navigationController = sourceViewController.navigationController ?? (sourceViewController as? UINavigationController)
        
        guard let nav = navigationController else {
            Logger.error("Cannot push view controller: No navigation controller found.")
            // Fallback to presenting modally if push is not possible
            await present(viewController, from: sourceViewController)
            return
        }
        
        // Use a continuation to bridge the UIKit completion handler to Swift's async/await
        await withCheckedContinuation { continuation in
            nav.pushViewController(viewController, animated: true)
            // Push doesn't have a completion handler, so we resume immediately
            continuation.resume()
        }
    }
    
    /// Presents a user-facing alert for a given error.
    @MainActor
    private func presentErrorAlert(_ error: Error, on sourceViewController: UIViewController?) async {
        guard let topVC = sourceViewController?.topMostViewController() else { return }
        
        let alertController = UIAlertController(
            title: "Navigation Error",
            message: error.localizedDescription,
            preferredStyle: .alert
        )
        alertController.addAction(UIAlertAction(title: "OK", style: .default))
        
        await withCheckedContinuation { continuation in
            topVC.present(alertController, animated: true) {
                continuation.resume()
            }
        }
    }
}

// MARK: - 3. Supporting Components (Mocks and Helpers)

/// A simple protocol for the Coordinator pattern.
protocol Coordinator: AnyObject {
    func start() async
    func finish() async
}

/// A concrete coordinator for the KYC Upgrade flow.
final class KYCUpgradeCoordinator: Coordinator {
    
    private let presenter: UIViewController
    private let navigationService: NavigationServiceProtocol
    private let apiClient: MockAPIClient
    private var rootNavigationController: UINavigationController?
    
    init(presenter: UIViewController, navigationService: NavigationServiceProtocol, apiClient: MockAPIClient) {
        self.presenter = presenter
        self.navigationService = navigationService
        self.apiClient = apiClient
    }
    
    /// Starts the KYC flow by presenting the initial view controller.
    func start() async {
        Logger.log("KYCUpgradeCoordinator started.")
        
        // 1. Create the initial SwiftUI view
        let kycStartView = KYCStartView(
            viewModel: KYCStartViewModel(
                apiClient: apiClient,
                onComplete: { [weak self] result in
                    Task { await self?.navigationService.handleKYCComplete(with: result) }
                }
            )
        )
        
        // 2. Host the SwiftUI view in a UIHostingController
        let hostingController = UIHostingController(rootView: kycStartView)
        hostingController.title = "KYC Verification"
        
        // 3. Wrap in a navigation controller for multi-step flow
        let navigationController = UINavigationController(rootViewController: hostingController)
        self.rootNavigationController = navigationController
        
        // 4. Present the flow modally
        await withCheckedContinuation { continuation in
            presenter.topMostViewController().present(navigationController, animated: true) {
                continuation.resume()
            }
        }
    }
    
    /// Finishes the KYC flow by dismissing the presented view controller.
    func finish() async {
        Logger.log("KYCUpgradeCoordinator finished.")
        await withCheckedContinuation { continuation in
            rootNavigationController?.dismiss(animated: true) {
                continuation.resume()
            }
        }
    }
}

/// A mock API client to simulate backend interactions.
final class MockAPIClient {
    
    /// Simulates checking user eligibility for KYC upgrade.
    func checkKYCEligibility() async throws -> Bool {
        Logger.log("API: Checking KYC eligibility...")
        try await Task.sleep(for: .seconds(0.5)) // Simulate network delay
        
        // 80% chance of being eligible
        if Bool.random() {
            return true
        } else {
            // Simulate a non-eligible status from the API
            throw NavigationError.apiError(statusCode: 403, message: "User profile does not meet minimum requirements.")
        }
    }
    
    /// Simulates fetching a transaction.
    func fetchTransaction(id: String) async throws -> Transaction {
        Logger.log("API: Fetching transaction ID: \(id)...")
        try await Task.sleep(for: .seconds(0.3))
        
        if id.isEmpty {
            throw NavigationError.apiError(statusCode: 404, message: "Transaction ID is empty.")
        }
        
        // Simulate a successful fetch
        return Transaction(id: id, amount: 123.45, date: Date(), description: "Payment for services.")
    }
    
    /// Simulates refreshing the user's state after a successful KYC.
    func refreshUserState(for userID: String) async throws {
        Logger.log("API: Refreshing user state for \(userID)...")
        try await Task.sleep(for: .seconds(0.2))
        // Simulate a successful API call
    }
}

/// A simple struct to represent a Transaction model.
struct Transaction: Identifiable {
    let id: String
    let amount: Double
    let date: Date
    let description: String
}

// MARK: - 4. SwiftUI Views (Placeholders)

/// Placeholder for the KYC Start View.
struct KYCStartView: View {
    @StateObject var viewModel: KYCStartViewModel
    
    var body: some View {
        VStack(spacing: 20) {
            Text("KYC Verification Flow")
                .font(.largeTitle)
            
            Text("This is a multi-step process to verify your identity.")
                .font(.subheadline)
                .multilineTextAlignment(.center)
            
            Button("Start Verification") {
                // Simulate a successful completion after a delay
                Task {
                    await viewModel.startVerification()
                }
            }
            .buttonStyle(.borderedProminent)
            
            Button("Cancel") {
                viewModel.onComplete(.cancelled)
            }
            .foregroundColor(.red)
        }
        .padding()
        .navigationTitle("KYC")
    }
}

/// ViewModel for the KYC Start View.
final class KYCStartViewModel: ObservableObject {
    private let apiClient: MockAPIClient
    let onComplete: (KYCCompletionResult) -> Void
    
    init(apiClient: MockAPIClient, onComplete: @escaping (KYCCompletionResult) -> Void) {
        self.apiClient = apiClient
        self.onComplete = onComplete
    }
    
    @MainActor
    func startVerification() async {
        Logger.log("Verification started in ViewModel.")
        do {
            // Simulate the actual verification process (e.g., calling a third-party SDK)
            try await Task.sleep(for: .seconds(1.5))
            
            // Simulate a successful result
            onComplete(.success(userID: "user-\(UUID().uuidString.prefix(8))"))
        } catch {
            onComplete(.failure(error: .navigationFailed(route: .kycUpgrade, reason: "Verification SDK failed.")))
        }
    }
}

/// Placeholder for the Transaction Detail View.
struct TransactionDetailView: View {
    let transaction: Transaction
    
    var body: some View {
        List {
            Text("Transaction ID: \(transaction.id)")
            Text("Amount: $\(transaction.amount, specifier: "%.2f")")
            Text("Date: \(transaction.date, style: .date)")
            Text("Description: \(transaction.description)")
        }
        .navigationTitle("Transaction Detail")
    }
}

/// Placeholder for the Transaction Creation View.
struct TransactionCreationView: View {
    let apiClient: MockAPIClient
    @State private var amount: String = ""
    @State private var description: String = ""
    
    var body: some View {
        Form {
            TextField("Amount", text: $amount)
                .keyboardType(.decimalPad)
            TextField("Description", text: $description)
            
            Button("Create Transaction") {
                // Logic to call API to create transaction
                Logger.log("Creating transaction...")
            }
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("New Transaction")
    }
}

/// Placeholder for the Profile View.
struct ProfileView: View {
    @StateObject var viewModel: ProfileViewModel
    
    var body: some View {
        VStack {
            Text("User Profile")
                .font(.largeTitle)
            Text("Status: \(viewModel.status)")
            
            Button("Check KYC Status") {
                Task { await viewModel.checkStatus() }
            }
        }
        .navigationTitle("Profile")
    }
}

/// ViewModel for the Profile View.
final class ProfileViewModel: ObservableObject {
    @Published var status: String = "Loading..."
    private let apiClient: MockAPIClient
    
    init(apiClient: MockAPIClient) {
        self.apiClient = apiClient
    }
    
    @MainActor
    func checkStatus() async {
        status = "Checking..."
        do {
            let isEligible = try await apiClient.checkKYCEligibility()
            status = isEligible ? "Eligible for KYC Upgrade" : "KYC Complete"
        } catch {
            status = "Error: \(error.localizedDescription)"
        }
    }
}

// MARK: - 5. UIKit View Controllers (Placeholders)

/// Placeholder for a standard UIKit View Controller.
final class SettingsViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = "Settings"
        
        let label = UILabel()
        label.text = "Settings View Controller (UIKit)"
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }
}

/// Placeholder for a Web View Controller.
final class WebViewController: UIViewController {
    private let url: URL
    
    init(url: URL) {
        self.url = url
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGray6
        title = "Web View"
        
        let label = UILabel()
        label.text = "Loading web page: \(url.absoluteString)"
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20)
        ])
    }
}

// MARK: - 6. Extensions and Utilities

/// Utility for logging.
struct Logger {
    static func log(_ message: String) {
        print("[\(Date().formatted(date: .omitted, time: .standard))] [NAV] \(message)")
    }
    
    static func error(_ message: String) {
        print("[\(Date().formatted(date: .omitted, time: .standard))] [NAV ERROR] \(message)")
    }
}

/// Extension to find the top-most view controller.
extension UIViewController {
    func topMostViewController() -> UIViewController {
        if let presented = self.presentedViewController {
            return presented.topMostViewController()
        }
        if let navigation = self as? UINavigationController {
            return navigation.visibleViewController?.topMostViewController() ?? navigation
        }
        if let tab = self as? UITabBarController {
            return tab.selectedViewController?.topMostViewController() ?? tab
        }
        return self
    }
}

// MARK: - 7. Comprehensive Documentation

/*
 The NavigationService is the central hub for all application flow and screen transitions.
 It abstracts the underlying UIKit and SwiftUI presentation logic, allowing business logic
 to simply request a destination (`AppRoute`) without knowing the implementation details.
 
 Key Features:
 - **Unified Navigation**: Handles both UIKit (UIViewController) and SwiftUI (UIHostingController) presentations.
 - **Coordinator Pattern**: Uses the `KYCUpgradeCoordinator` to manage complex, multi-step flows, preventing massive view controllers.
 - **Asynchronous Operations**: Leverages Swift's `async/await` for all navigation and API-related tasks, ensuring a non-blocking UI.
 - **Error Handling**: Uses a custom `NavigationError` enum for type-safe and localized error reporting.
 - **Dependency Injection**: Designed with the `NavigationServiceProtocol` for easy testing and mocking.
 - **Platform Best Practices**: Utilizes `UIWindow` and `topMostViewController()` extension to reliably find the presentation context.
 
 The service is designed to be initialized once in the `SceneDelegate` or `AppDelegate` and injected
 into view models or other services that need to trigger navigation.
 */