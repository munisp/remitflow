import Foundation
import SwiftUI

/// Accessibility Manager - WCAG 2.1 AAA Compliance
class AccessibilityManager: ObservableObject {
    static let shared = AccessibilityManager()
    
    @Published var isVoiceOverEnabled: Bool = false
    @Published var preferredContentSize: ContentSizeCategory = .large
    @Published var isHighContrastEnabled: Bool = false
    @Published var isReduceMotionEnabled: Bool = false
    @Published var colorBlindMode: ColorBlindMode = .none
    
    enum ColorBlindMode: String, CaseIterable {
        case none = "None"
        case protanopia = "Protanopia (Red-Blind)"
        case deuteranopia = "Deuteranopia (Green-Blind)"
        case tritanopia = "Tritanopia (Blue-Blind)"
    }
    
    init() {
        observeAccessibilityChanges()
    }
    
    private func observeAccessibilityChanges() {
        isVoiceOverEnabled = UIAccessibility.isVoiceOverRunning
        isReduceMotionEnabled = UIAccessibility.isReduceMotionEnabled
        
        NotificationCenter.default.addObserver(
            forName: UIAccessibility.voiceOverStatusDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.isVoiceOverEnabled = UIAccessibility.isVoiceOverRunning
        }
        
        NotificationCenter.default.addObserver(
            forName: UIAccessibility.reduceMotionStatusDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.isReduceMotionEnabled = UIAccessibility.isReduceMotionEnabled
        }
    }
    
    // MARK: - VoiceOver Helpers
    
    func announce(_ message: String) {
        UIAccessibility.post(notification: .announcement, argument: message)
    }
    
    func screenChanged(to element: Any?) {
        UIAccessibility.post(notification: .screenChanged, argument: element)
    }
    
    func layoutChanged(to element: Any?) {
        UIAccessibility.post(notification: .layoutChanged, argument: element)
    }
}

// MARK: - Dynamic Type Support

extension View {
    func dynamicTypeSize(min: DynamicTypeSize = .xSmall, max: DynamicTypeSize = .accessibility5) -> some View {
        self.dynamicTypeSize(min...max)
    }
    
    func accessibleFont(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> some View {
        self.font(.system(style, design: .default).weight(weight))
    }
}

// MARK: - High Contrast Colors

struct AccessibleColors {
    static func primary(isHighContrast: Bool) -> Color {
        isHighContrast ? Color.black : Color.primary
    }
    
    static func background(isHighContrast: Bool) -> Color {
        isHighContrast ? Color.white : Color(.systemBackground)
    }
    
    static func accent(isHighContrast: Bool) -> Color {
        isHighContrast ? Color.blue : Color.accentColor
    }
}

// MARK: - Reduced Motion

extension View {
    func animateIfAllowed<V: Equatable>(_ value: V, duration: Double = 0.3) -> some View {
        let shouldAnimate = !AccessibilityManager.shared.isReduceMotionEnabled
        return self.animation(shouldAnimate ? .easeInOut(duration: duration) : nil, value: value)
    }
}
