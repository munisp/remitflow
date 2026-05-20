import UIKit
import CoreHaptics

/// Comprehensive Haptic Feedback Manager
/// Provides contextual tactile responses for all user interactions
class HapticFeedbackManager {
    static let shared = HapticFeedbackManager()
    
    private var engine: CHHapticEngine?
    private let impactLight = UIImpactFeedbackGenerator(style: .light)
    private let impactMedium = UIImpactFeedbackGenerator(style: .medium)
    private let impactHeavy = UIImpactFeedbackGenerator(style: .heavy)
    private let selectionGenerator = UISelectionFeedbackGenerator()
    private let notificationGenerator = UINotificationFeedbackGenerator()
    
    private init() {
        setupHapticEngine()
        prepareGenerators()
    }
    
    private func setupHapticEngine() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        
        do {
            engine = try CHHapticEngine()
            try engine?.start()
            
            engine?.stoppedHandler = { reason in
                print("Haptic engine stopped: \(reason)")
            }
            
            engine?.resetHandler = { [weak self] in
                do {
                    try self?.engine?.start()
                } catch {
                    print("Failed to restart haptic engine: \(error)")
                }
            }
        } catch {
            print("Haptic engine creation failed: \(error)")
        }
    }
    
    private func prepareGenerators() {
        impactLight.prepare()
        impactMedium.prepare()
        impactHeavy.prepare()
        selectionGenerator.prepare()
        notificationGenerator.prepare()
    }
    
    // MARK: - Basic Haptics
    
    /// Light feedback for button presses and taps
    func lightImpact() {
        impactLight.impactOccurred()
    }
    
    /// Medium feedback for selections and toggles
    func mediumImpact() {
        impactMedium.impactOccurred()
    }
    
    /// Heavy feedback for confirmations and important actions
    func heavyImpact() {
        impactHeavy.impactOccurred()
    }
    
    /// Selection feedback for scrolling and picking
    func selection() {
        selectionGenerator.selectionChanged()
    }
    
    // MARK: - Notification Haptics
    
    /// Success vibration for completed transactions
    func success() {
        notificationGenerator.notificationOccurred(.success)
    }
    
    /// Warning pattern for alerts
    func warning() {
        notificationGenerator.notificationOccurred(.warning)
    }
    
    /// Error pattern for failures
    func error() {
        notificationGenerator.notificationOccurred(.error)
    }
    
    // MARK: - Custom Patterns
    
    /// Transaction completed pattern
    func transactionCompleted() {
        playCustomPattern(intensity: 0.8, sharpness: 0.5, duration: 0.3)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            self.playCustomPattern(intensity: 1.0, sharpness: 0.8, duration: 0.2)
        }
    }
    
    /// Money sent pattern
    func moneySent() {
        playCustomPattern(intensity: 0.6, sharpness: 0.3, duration: 0.2)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.playCustomPattern(intensity: 0.4, sharpness: 0.2, duration: 0.15)
        }
    }
    
    /// Money received pattern
    func moneyReceived() {
        playCustomPattern(intensity: 0.5, sharpness: 0.4, duration: 0.15)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.playCustomPattern(intensity: 0.7, sharpness: 0.6, duration: 0.2)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.playCustomPattern(intensity: 0.9, sharpness: 0.8, duration: 0.25)
        }
    }
    
    /// Biometric authentication success
    func biometricSuccess() {
        playCustomPattern(intensity: 0.7, sharpness: 0.6, duration: 0.2)
    }
    
    /// Pull to refresh
    func pullToRefresh() {
        playCustomPattern(intensity: 0.4, sharpness: 0.3, duration: 0.1)
    }
    
    private func playCustomPattern(intensity: Float, sharpness: Float, duration: TimeInterval) {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            // Fallback to basic haptic
            impactMedium.impactOccurred(intensity: CGFloat(intensity))
            return
        }
        
        let intensityParameter = CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity)
        let sharpnessParameter = CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
        
        let event = CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [intensityParameter, sharpnessParameter],
            relativeTime: 0,
            duration: duration
        )
        
        do {
            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let player = try engine?.makePlayer(with: pattern)
            try player?.start(atTime: 0)
        } catch {
            print("Failed to play custom haptic: \(error)")
        }
    }
}

// MARK: - SwiftUI View Extension
import SwiftUI

extension View {
    func hapticFeedback(_ type: HapticType, trigger: some Equatable) -> some View {
        self.onChange(of: trigger) { _ in
            HapticFeedbackManager.shared.performHaptic(type)
        }
    }
}

enum HapticType {
    case light, medium, heavy, selection
    case success, warning, error
    case transactionCompleted, moneySent, moneyReceived
    case biometricSuccess, pullToRefresh
}

extension HapticFeedbackManager {
    func performHaptic(_ type: HapticType) {
        switch type {
        case .light: lightImpact()
        case .medium: mediumImpact()
        case .heavy: heavyImpact()
        case .selection: selection()
        case .success: success()
        case .warning: warning()
        case .error: error()
        case .transactionCompleted: transactionCompleted()
        case .moneySent: moneySent()
        case .moneyReceived: moneyReceived()
        case .biometricSuccess: biometricSuccess()
        case .pullToRefresh: pullToRefresh()
        }
    }
}
