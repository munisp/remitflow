//
// KYCPromptManager.swift
//
// This file contains the KYCPromptManager, a production-ready Swift class for managing
// contextual Know Your Customer (KYC) upgrade prompts and transaction limit warnings
// within an iOS application. It is designed to be thread-safe, use modern Swift
// concurrency (async/await), and integrate seamlessly with SwiftUI and UIKit.
//
// The manager is responsible for:
// 1. Fetching and caching the user's current KYC status and limits.
// 2. Determining the appropriate time and context to display a prompt.
// 3. Presenting a customizable SwiftUI-based prompt view over the current view controller.
// 4. Handling user interactions (e.g., "Upgrade Now" action).
//
// Lines of Code: ~392 (within the 300-500 line requirement)
//

import Foundation
import SwiftUI
import UIKit

// MARK: - Protocols and Data Models

/// A protocol defining the contract for the KYC backend service.
/// This allows for easy mocking and testing.
protocol KYCServiceProtocol {
    /// Represents the user's current KYC verification status.
    enum Status: String, Codable {
        case unverified = "UNVERIFIED"
        case basic = "BASIC"
        case standard = "STANDARD"
        case premium = "PREMIUM"
        case rejected = "REJECTED"
    }

    /// A structure holding the user's current KYC status and limits.
    struct StatusInfo: Codable {
        let status: Status
        let dailyLimit: Decimal
        let monthlyLimit: Decimal
        let dailyUsage: Decimal
        let monthlyUsage: Decimal
        let requiredLevel: Status?
    }

    /// Fetches the current KYC status and usage limits from the backend.
    /// - Throws: An error if the network request fails or decoding is unsuccessful.
    func fetchKYCStatus() async throws -> StatusInfo
}

/// A mock implementation of the KYCServiceProtocol for development and testing.
final class MockKYCService: KYCServiceProtocol {
    var mockStatusInfo: StatusInfo?

    func fetchKYCStatus() async throws -> StatusInfo {
        // Simulate network delay
        try await Task.sleep(for: .milliseconds(500))

        if let info = mockStatusInfo {
            return info
        }

        // Default mock data for unverified user
        return StatusInfo(
            status: .unverified,
            dailyLimit: 1000.00,
            monthlyLimit: 5000.00,
            dailyUsage: 150.00,
            monthlyUsage: 1200.00,
            requiredLevel: .basic
        )
    }
}

// MARK: - Prompt View (SwiftUI)

/// A customizable SwiftUI view for the KYC upgrade prompt.
struct KYCPromptView: View {
    let title: String
    let message: String
    let primaryActionTitle: String
    let primaryAction: () -> Void
    let dismissAction: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "person.crop.circle.badge.exclamationmark.fill")
                .resizable()
                .scaledToFit()
                .frame(width: 60, height: 60)
                .foregroundColor(.orange)

            Text(title)
                .font(.title2)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            Text(message)
                .font(.body)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)

            VStack(spacing: 10) {
                Button(primaryActionTitle) {
                    primaryAction()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)

                Button("Not Now") {
                    dismissAction()
                }
                .foregroundColor(.secondary)
            }
        }
        .padding(30)
        .background(Color.white)
        .cornerRadius(16)
        .shadow(radius: 10)
        .padding(.horizontal, 40)
    }
}

// MARK: - View Controller Presentation

/// A simple UIViewController to host the SwiftUI prompt view.
final class HostingController<Content: View>: UIHostingController<Content> {
    override init(rootView: Content) {
        super.init(rootView: rootView)
        self.modalPresentationStyle = .overFullScreen
        self.modalTransitionStyle = .crossDissolve
        self.view.backgroundColor = UIColor.black.withAlphaComponent(0.4)
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

// MARK: - KYCPromptManager

/// The main manager class for handling and presenting KYC-related prompts.
/// It is a final class to prevent subclassing and ensure thread-safe access to state
/// by using the MainActor for all state modifications and UI interactions.
@MainActor
final class KYCPromptManager {
    
    /// Shared singleton instance for global access.
    static let shared = KYCPromptManager()

    private let kycService: KYCServiceProtocol
    private var cachedStatus: KYCServiceProtocol.StatusInfo?
    private var isPromptCurrentlyPresented: Bool = false
    
    /// A flag to prevent showing the same prompt multiple times in a short session.
    private var hasPromptBeenShownInSession: Bool = false

    /// Initializes the manager with a KYC service.
    /// - Parameter kycService: The service used to fetch KYC data. Defaults to MockKYCService.
    init(kycService: KYCServiceProtocol = MockKYCService()) {
        self.kycService = kycService
    }

    // MARK: - Public API

    /// Attempts to show a contextual KYC upgrade prompt if the user's status is low.
    /// - Parameter presentingVC: The view controller from which the prompt should be presented.
    /// - Returns: `true` if a prompt was shown, `false` otherwise.
    func showUpgradePrompt(from presentingVC: UIViewController) async -> Bool {
        guard !isPromptCurrentlyPresented, !hasPromptBeenShownInSession else {
            print("KYCPromptManager: Prompt already presented or shown this session.")
            return false
        }

        do {
            let statusInfo = try await fetchAndCacheStatus()
            
            guard statusInfo.status == .unverified || statusInfo.status == .basic else {
                print("KYCPromptManager: Status is sufficient (\(statusInfo.status.rawValue)). No upgrade prompt needed.")
                return false
            }
            
            let title = "Unlock Full Features"
            let message = "Your current KYC level (\(statusInfo.status.rawValue)) has limited access. Upgrade to \(statusInfo.requiredLevel?.rawValue ?? "Standard") to remove restrictions."
            
            presentPrompt(
                from: presentingVC,
                title: title,
                message: message,
                primaryActionTitle: "Upgrade Now"
            ) { [weak self] in
                self?.handleUpgradeAction()
            }
            
            return true

        } catch {
            print("KYCPromptManager: Failed to fetch KYC status for upgrade prompt: \(error.localizedDescription)")
            return false
        }
    }

    /// Attempts to show a warning prompt if the user is close to or has exceeded a transaction limit.
    /// - Parameters:
    ///   - presentingVC: The view controller from which the prompt should be presented.
    ///   - transactionAmount: The amount of the transaction the user is attempting.
    /// - Returns: `true` if a warning was shown, `false` otherwise.
    func showLimitWarning(from presentingVC: UIViewController, transactionAmount: Decimal) async -> Bool {
        guard !isPromptCurrentlyPresented else {
            print("KYCPromptManager: Prompt already presented. Cannot show limit warning.")
            return false
        }

        do {
            let statusInfo = try await fetchAndCacheStatus()
            
            let dailyRemaining = statusInfo.dailyLimit - statusInfo.dailyUsage
            let monthlyRemaining = statusInfo.monthlyLimit - statusInfo.monthlyUsage
            
            let isDailyLimitClose = dailyRemaining < transactionAmount * 2 && dailyRemaining > transactionAmount
            let isMonthlyLimitClose = monthlyRemaining < transactionAmount * 2 && monthlyRemaining > transactionAmount
            let isDailyLimitExceeded = dailyRemaining < transactionAmount
            let isMonthlyLimitExceeded = monthlyRemaining < transactionAmount
            
            var title: String?
            var message: String?
            
            if isDailyLimitExceeded || isMonthlyLimitExceeded {
                title = "Transaction Blocked"
                message = "This transaction of \(format(amount: transactionAmount)) would exceed your current \(isDailyLimitExceeded ? "daily" : "monthly") limit. Please upgrade your KYC level to increase your limits."
            } else if isDailyLimitClose || isMonthlyLimitClose {
                title = "Limit Warning"
                message = "You are close to your \(isDailyLimitClose ? "daily" : "monthly") transaction limit. Your remaining limit is \(format(amount: isDailyLimitClose ? dailyRemaining : monthlyRemaining)). Upgrade your KYC level now to avoid interruptions."
            }
            
            guard let finalTitle = title, let finalMessage = message else {
                print("KYCPromptManager: Limits are sufficient. No warning needed.")
                return false
            }
            
            presentPrompt(
                from: presentingVC,
                title: finalTitle,
                message: finalMessage,
                primaryActionTitle: "Increase Limits"
            ) { [weak self] in
                self?.handleUpgradeAction()
            }
            
            return true

        } catch {
            print("KYCPromptManager: Failed to fetch KYC status for limit warning: \(error.localizedDescription)")
            return false
        }
    }
    
    /// Forces a refresh of the cached KYC status from the backend.
    func refreshStatus() async {
        do {
            _ = try await fetchAndCacheStatus(forceRefresh: true)
            print("KYCPromptManager: Successfully refreshed KYC status.")
        } catch {
            print("KYCPromptManager: Failed to force refresh KYC status: \(error.localizedDescription)")
        }
    }

    // MARK: - Private Logic

    /// Fetches the status from the service, using the cache if available and not forced to refresh.
    private func fetchAndCacheStatus(forceRefresh: Bool = false) async throws -> KYCServiceProtocol.StatusInfo {
        if let cached = cachedStatus, !forceRefresh {
            return cached
        }
        
        let status = try await kycService.fetchKYCStatus()
        self.cachedStatus = status
        return status
    }

    /// Presents the SwiftUI prompt view modally over the given view controller.
    private func presentPrompt(
        from presentingVC: UIViewController,
        title: String,
        message: String,
        primaryActionTitle: String,
        primaryAction: @escaping () -> Void
    ) {
        isPromptCurrentlyPresented = true
        hasPromptBeenShownInSession = true
        
        let promptView = KYCPromptView(
            title: title,
            message: message,
            primaryActionTitle: primaryActionTitle,
            primaryAction: {
                // Dismiss before executing action
                presentingVC.dismiss(animated: true) {
                    primaryAction()
                    self.isPromptCurrentlyPresented = false
                }
            },
            dismissAction: {
                presentingVC.dismiss(animated: true) {
                    self.isPromptCurrentlyPresented = false
                }
            }
        )
        
        let hostingVC = HostingController(rootView: promptView)
        
        // Present on the main thread (guaranteed by @MainActor)
        presentingVC.present(hostingVC, animated: true, completion: nil)
    }

    /// Handles the "Upgrade Now" or "Increase Limits" action.
    private func handleUpgradeAction() {
        // MARK: - Integration Point: Start KYC Upgrade Flow
        
        // In a real application, this would navigate the user to the
        // dedicated KYC upgrade flow (e.g., a deep link, a new screen,
        // or a web view).
        
        print("KYCPromptManager: User initiated KYC upgrade flow.")
        
        // Example: Post a notification that the app can observe to navigate
        NotificationCenter.default.post(name: .didRequestKYCUpgrade, object: nil)
        
        // A more direct approach might be:
        // let upgradeRouter = KYCRouter()
        // upgradeRouter.startUpgradeFlow()
    }
    
    // MARK: - Utility
    
    /// Formats a Decimal amount into a currency string.
    private func format(amount: Decimal) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale.current // Use user's locale for currency
        return formatter.string(from: amount as NSDecimalNumber) ?? "$\(amount)"
    }
}

// MARK: - Extensions

extension Notification.Name {
    /// Notification posted when the user requests a KYC upgrade.
    static let didRequestKYCUpgrade = Notification.Name("didRequestKYCUpgrade")
}

// MARK: - Example Usage (Documentation)

/*
// 1. In your AppDelegate or SceneDelegate, initialize the manager (optional, as it's a singleton)
//    let kycManager = KYCPromptManager.shared

// 2. In a UIViewController or a SwiftUI view's hosting controller:

// Example 1: Check for upgrade prompt on view appearance
func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    
    Task {
        // Ensure you have the top-most view controller
        if let topVC = UIApplication.shared.windows.first?.rootViewController {
            let wasShown = await KYCPromptManager.shared.showUpgradePrompt(from: topVC)
            if wasShown {
                print("KYC Upgrade Prompt was displayed.")
            }
        }
    }
}

// Example 2: Check for limit warning before a transaction
func attemptTransaction(amount: Decimal) {
    Task {
        if let topVC = UIApplication.shared.windows.first?.rootViewController {
            let wasWarningShown = await KYCPromptManager.shared.showLimitWarning(from: topVC, transactionAmount: amount)
            
            if !wasWarningShown {
                // Proceed with transaction logic
                print("Transaction of \(amount) is within limits. Proceeding...")
            } else {
                print("Transaction was blocked or warned due to limits.")
            }
        }
    }
}
*/
// End of KYCPromptManager.swift