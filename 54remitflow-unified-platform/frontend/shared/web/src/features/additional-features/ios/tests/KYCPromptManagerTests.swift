import XCTest
import UIKit
import SwiftUI // Assuming SwiftUI support for presentation

// MARK: - Mock Dependencies

// 1. Mock KYCService
protocol KYCServiceProtocol {
    var kycStatus: KYCStatus { get }
    var isLimitReached: Bool { get }
    func upgradeKYC()
}

enum KYCStatus {
    case notVerified
    case pending
    case verified
    case limitReached
}

class MockKYCService: KYCServiceProtocol {
    var kycStatus: KYCStatus = .notVerified
    var isLimitReached: Bool = false
    
    // Spy properties
    var upgradeKYCCalledCount = 0
    
    func upgradeKYC() {
        upgradeKYCCalledCount += 1
    }
}

// 2. Mock PromptPresenter
protocol PromptPresenterProtocol {
    func present(viewController: UIViewController, title: String, message: String, actions: [UIAlertAction])
    func presentSwiftUIPrompt(title: String, message: String, primaryAction: (() -> Void)?)
}

class MockPromptPresenter: PromptPresenterProtocol {
    // Spy properties
    var presentVCCalledCount = 0
    var presentSwiftUICalledCount = 0
    var lastPresentedTitle: String?
    var lastPresentedMessage: String?
    var lastPresentedActionCount: Int?
    var lastPresentedPrimaryAction: (() -> Void)?
    
    func present(viewController: UIViewController, title: String, message: String, actions: [UIAlertAction]) {
        presentVCCalledCount += 1
        lastPresentedTitle = title
        lastPresentedMessage = message
        lastPresentedActionCount = actions.count
    }
    
    func presentSwiftUIPrompt(title: String, message: String, primaryAction: (() -> Void)?) {
        presentSwiftUICalledCount += 1
        lastPresentedTitle = title
        lastPresentedMessage = message
        lastPresentedPrimaryAction = primaryAction
    }
}

// MARK: - Inferred System Under Test (SUT)

class KYCPromptManager {
    private let kycService: KYCServiceProtocol
    private let presenter: PromptPresenterProtocol
    
    init(kycService: KYCServiceProtocol, presenter: PromptPresenterProtocol) {
        self.kycService = kycService
        self.presenter = presenter
    }
    
    // MARK: - Public Methods
    
    func showUpgradePrompt(on viewController: UIViewController) -> Bool {
        guard kycService.kycStatus == .notVerified else {
            return false
        }
        
        let upgradeAction = UIAlertAction(title: "Upgrade Now", style: .default) { [weak self] _ in
            self?.kycService.upgradeKYC()
        }
        
        presenter.present(
            viewController: viewController,
            title: "KYC Upgrade Required",
            message: "Your account needs to be verified to unlock full features.",
            actions: [upgradeAction, UIAlertAction(title: "Later", style: .cancel)]
        )
        return true
    }
    
    func showLimitWarning(on viewController: UIViewController) -> Bool {
        guard kycService.isLimitReached else {
            return false
        }
        
        let increaseLimitAction = UIAlertAction(title: "Increase Limit", style: .default) { [weak self] _ in
            self?.kycService.upgradeKYC() // Re-using upgradeKYC for simplicity
        }
        
        presenter.present(
            viewController: viewController,
            title: "Transaction Limit Reached",
            message: "You have reached your current transaction limit. Please increase your KYC level.",
            actions: [increaseLimitAction, UIAlertAction(title: "Dismiss", style: .cancel)]
        )
        return true
    }
    
    // SwiftUI-specific presentation
    func showUpgradePromptSwiftUI(primaryAction: (() -> Void)?) -> Bool {
        guard kycService.kycStatus == .notVerified else {
            return false
        }
        
        presenter.presentSwiftUIPrompt(
            title: "KYC Upgrade Required (SwiftUI)",
            message: "Your account needs to be verified to unlock full features.",
            primaryAction: primaryAction
        )
        return true
    }
}

// MARK: - Test Suite

final class KYCPromptManagerTests: XCTestCase {
    
    var sut: KYCPromptManager!
    var mockKYCService: MockKYCService!
    var mockPresenter: MockPromptPresenter!
    var mockViewController: UIViewController!
    
    override func setUp() {
        super.setUp()
        mockKYCService = MockKYCService()
        mockPresenter = MockPromptPresenter()
        sut = KYCPromptManager(kycService: mockKYCService, presenter: mockPresenter)
        mockViewController = UIViewController() // A simple mock VC for presentation
    }
    
    override func tearDown() {
        sut = nil
        mockKYCService = nil
        mockPresenter = nil
        mockViewController = nil
        super.tearDown()
    }
    
    // MARK: - showUpgradePrompt Tests (UIViewController)
    
    func test_showUpgradePrompt_whenNotVerified_shouldPresentPromptAndReturnTrue() {
        // Arrange
        mockKYCService.kycStatus = .notVerified
        
        // Act
        let result = sut.showUpgradePrompt(on: mockViewController)
        
        // Assert
        XCTAssertTrue(result, "Should return true when prompt is shown")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 1, "Presenter should be called once")
        XCTAssertEqual(mockPresenter.lastPresentedTitle, "KYC Upgrade Required", "Should present the correct title")
        XCTAssertEqual(mockPresenter.lastPresentedActionCount, 2, "Should present two actions (Upgrade Now, Later)")
    }
    
    func test_showUpgradePrompt_whenNotVerified_shouldCallUpgradeKYC_whenUpgradeActionIsTapped() {
        // Arrange
        mockKYCService.kycStatus = .notVerified
        
        // Let's refine the MockPromptPresenter to capture the actions for execution
        class ExecutableMockPromptPresenter: MockPromptPresenter {
            var lastPresentedActions: [UIAlertAction]?
            override func present(viewController: UIViewController, title: String, message: String, actions: [UIAlertAction]) {
                super.present(viewController: viewController, title: title, message: message, actions: actions)
                lastPresentedActions = actions
            }
        }
        
        let executablePresenter = ExecutableMockPromptPresenter()
        sut = KYCPromptManager(kycService: mockKYCService, presenter: executablePresenter)
        
        // Act
        _ = sut.showUpgradePrompt(on: mockViewController)
        
        // Simulate tapping the first action (Upgrade Now)
        let upgradeAction = executablePresenter.lastPresentedActions?.first
        XCTAssertNotNil(upgradeAction, "Upgrade action should be present")
        
        // Use KVC to execute the action handler, as UIAlertAction's handler is internal
        // This is a common, though fragile, technique in XCTest for UI elements
        if let action = upgradeAction {
            action.performAction()
        }
        
        // Assert
        XCTAssertEqual(mockKYCService.upgradeKYCCalledCount, 1, "UpgradeKYC should be called when the upgrade action is tapped")
    }
    
    // Helper extension to execute UIAlertAction handler (fragile but necessary for testing)
    private extension UIAlertAction {
        func performAction() {
            guard let handler = value(forKey: "handler") as? ((UIAlertAction) -> Void) else { return }
            handler(self)
        }
    }
    
    func test_showUpgradePrompt_whenAlreadyVerified_shouldNotPresentPromptAndReturnFalse() {
        // Arrange
        mockKYCService.kycStatus = .verified
        
        // Act
        let result = sut.showUpgradePrompt(on: mockViewController)
        
        // Assert
        XCTAssertFalse(result, "Should return false when prompt is not shown")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 0, "Presenter should not be called")
    }
    
    func test_showUpgradePrompt_whenPending_shouldNotPresentPromptAndReturnFalse() {
        // Arrange
        mockKYCService.kycStatus = .pending
        
        // Act
        let result = sut.showUpgradePrompt(on: mockViewController)
        
        // Assert
        XCTAssertFalse(result, "Should return false when prompt is not shown")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 0, "Presenter should not be called")
    }
    
    // MARK: - showLimitWarning Tests (UIViewController)
    
    func test_showLimitWarning_whenLimitReached_shouldPresentPromptAndReturnTrue() {
        // Arrange
        mockKYCService.isLimitReached = true
        
        // Act
        let result = sut.showLimitWarning(on: mockViewController)
        
        // Assert
        XCTAssertTrue(result, "Should return true when warning is shown")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 1, "Presenter should be called once")
        XCTAssertEqual(mockPresenter.lastPresentedTitle, "Transaction Limit Reached", "Should present the correct title")
        XCTAssertEqual(mockPresenter.lastPresentedActionCount, 2, "Should present two actions (Increase Limit, Dismiss)")
    }
    
    func test_showLimitWarning_whenLimitReached_shouldCallUpgradeKYC_whenIncreaseLimitActionIsTapped() {
        // Arrange
        mockKYCService.isLimitReached = true
        
        // Re-setup with ExecutableMockPromptPresenter
        class ExecutableMockPromptPresenter: MockPromptPresenter {
            var lastPresentedActions: [UIAlertAction]?
            override func present(viewController: UIViewController, title: String, message: String, actions: [UIAlertAction]) {
                super.present(viewController: viewController, title: title, message: message, actions: actions)
                lastPresentedActions = actions
            }
        }
        
        let executablePresenter = ExecutableMockPromptPresenter()
        sut = KYCPromptManager(kycService: mockKYCService, presenter: executablePresenter)
        
        // Act
        _ = sut.showLimitWarning(on: mockViewController)
        
        // Simulate tapping the first action (Increase Limit)
        let increaseLimitAction = executablePresenter.lastPresentedActions?.first
        XCTAssertNotNil(increaseLimitAction, "Increase Limit action should be present")
        
        if let action = increaseLimitAction {
            action.performAction()
        }
        
        // Assert
        XCTAssertEqual(mockKYCService.upgradeKYCCalledCount, 1, "UpgradeKYC should be called when the Increase Limit action is tapped")
    }
    
    func test_showLimitWarning_whenLimitNotReached_shouldNotPresentPromptAndReturnFalse() {
        // Arrange
        mockKYCService.isLimitReached = false
        
        // Act
        let result = sut.showLimitWarning(on: mockViewController)
        
        // Assert
        XCTAssertFalse(result, "Should return false when warning is not shown")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 0, "Presenter should not be called")
    }
    
    // MARK: - UI Presentation Tests (SwiftUI Mock)
    
    func test_showUpgradePromptSwiftUI_whenNotVerified_shouldPresentSwiftUIPromptAndReturnTrue() {
        // Arrange
        mockKYCService.kycStatus = .notVerified
        var primaryActionCalled = false
        let primaryAction: () -> Void = {
            primaryActionCalled = true
        }
        
        // Act
        let result = sut.showUpgradePromptSwiftUI(primaryAction: primaryAction)
        
        // Assert
        XCTAssertTrue(result, "Should return true when SwiftUI prompt is shown")
        XCTAssertEqual(mockPresenter.presentSwiftUICalledCount, 1, "SwiftUI Presenter should be called once")
        XCTAssertEqual(mockPresenter.lastPresentedTitle, "KYC Upgrade Required (SwiftUI)", "Should present the correct SwiftUI title")
        
        // Act: Simulate tapping the primary action
        mockPresenter.lastPresentedPrimaryAction?()
        
        // Assert
        XCTAssertTrue(primaryActionCalled, "The provided primary action closure should be executed")
    }
    
    func test_showUpgradePromptSwiftUI_whenAlreadyVerified_shouldNotPresentPromptAndReturnFalse() {
        // Arrange
        mockKYCService.kycStatus = .verified
        
        // Act
        let result = sut.showUpgradePromptSwiftUI(primaryAction: {})
        
        // Assert
        XCTAssertFalse(result, "Should return false when SwiftUI prompt is not shown")
        XCTAssertEqual(mockPresenter.presentSwiftUICalledCount, 0, "SwiftUI Presenter should not be called")
    }
    
    // MARK: - Edge Case: Limit Reached and Not Verified (Prioritization Test)
    
    func test_showUpgradePrompt_whenLimitReached_shouldStillPresentUpgradePromptIfStatusIsNotVerified() {
        // Arrange
        mockKYCService.kycStatus = .notVerified // Not Verified is the trigger for upgrade prompt
        mockKYCService.isLimitReached = true // Limit Reached is the trigger for limit warning
        
        // Act: Test upgrade prompt first
        let upgradeResult = sut.showUpgradePrompt(on: mockViewController)
        
        // Assert
        XCTAssertTrue(upgradeResult, "Upgrade prompt should be shown if status is .notVerified, regardless of limit reached status")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 1)
        
        // Reset presenter
        mockPresenter = MockPromptPresenter()
        sut = KYCPromptManager(kycService: mockKYCService, presenter: mockPresenter)
        
        // Act: Test limit warning
        let warningResult = sut.showLimitWarning(on: mockViewController)
        
        // Assert
        XCTAssertTrue(warningResult, "Limit warning should be shown if limit is reached, regardless of KYC status")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 1)
    }
    
    // MARK: - Edge Case: KYC Status is .limitReached (Should not show upgrade prompt)
    
    func test_showUpgradePrompt_whenStatusIsLimitReached_shouldNotPresentUpgradePrompt() {
        // Arrange
        mockKYCService.kycStatus = .limitReached
        
        // Act
        let result = sut.showUpgradePrompt(on: mockViewController)
        
        // Assert
        XCTAssertFalse(result, "Upgrade prompt should only show for .notVerified, not .limitReached")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 0)
    }
    
    // MARK: - Edge Case: KYC Status is .limitReached and isLimitReached is true (Should show limit warning)
    
    func test_showLimitWarning_whenStatusIsLimitReachedAndFlagIsTrue_shouldPresentLimitWarning() {
        // Arrange
        mockKYCService.kycStatus = .limitReached // This status might imply limit reached, but we rely on the flag
        mockKYCService.isLimitReached = true
        
        // Act
        let result = sut.showLimitWarning(on: mockViewController)
        
        // Assert
        XCTAssertTrue(result, "Limit warning should be shown when isLimitReached is true")
        XCTAssertEqual(mockPresenter.presentVCCalledCount, 1)
    }
}
